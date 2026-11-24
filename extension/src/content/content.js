// FaychiAI 内容脚本：DOM 捕获 → 匹配 → 屏蔽渲染
(function () {
  const F = globalThis.Faychi;
  if (!F || !F.Storage) return;
  const Storage = F.Storage;

  const SKIP_TAGS = new Set([
    'SCRIPT', 'STYLE', 'NOSCRIPT', 'TEXTAREA', 'INPUT', 'SELECT', 'OPTION',
    'CODE', 'PRE', 'SVG', 'CANVAS', 'TITLE', 'HEAD', 'IFRAME'
  ]);
  const INLINE_TAGS = new Set([
    'SPAN', 'A', 'EM', 'STRONG', 'B', 'I', 'U', 'S', 'SMALL', 'MARK', 'LABEL',
    'ABBR', 'CITE', 'Q', 'TIME', 'FONT', 'SUB', 'SUP', 'BDI', 'BDO'
  ]);
  const MAX_SCAN_NODES = 6000;
  const MAX_AI_BATCH = 30;

  let settings = null;
  let keywordRules = [];
  let regexRules = [];
  let aiRules = [];
  let scanning = false;
  let observer = null;
  let moQueue = [];
  let moTimer = null;
  let statTimer = null;

  const maskedEls = new Set();
  const aiCache = new Map();

  boot();

  async function boot() {
    settings = await Storage.getSettings();
    compile();
    injectStyles();
    listen();
    if (settings.enabled && hasRules()) {
      scheduleFullScan();
      startObserver();
    }
  }

  function hasRules() {
    return keywordRules.length + regexRules.length + aiRules.length > 0;
  }

  function compile() {
    keywordRules = [];
    regexRules = [];
    aiRules = [];
    (settings.rules || []).forEach(function (r) {
      if (!r || r.enabled === false || !r.pattern) return;
      const strength = r.strength || settings.defaultStrength;
      if (r.type === 'regex') {
        try {
          regexRules.push({ re: new RegExp(r.pattern, 'i'), strength: strength });
        } catch (e) { /* 无效正则忽略 */ }
      } else if (r.type === 'ai') {
        aiRules.push({ pattern: r.pattern, strength: strength });
      } else {
        keywordRules.push({ kw: String(r.pattern).toLowerCase(), strength: strength });
      }
    });
  }

  function listen() {
    chrome.storage.onChanged.addListener(function (changes, area) {
      if (area !== 'local' || !changes[F.KEYS.SETTINGS]) return;
      settings = Storage.mergeDefaults(changes[F.KEYS.SETTINGS].newValue);
      compile();
      resetAll();
      if (settings.enabled && hasRules()) {
        scheduleFullScan();
        startObserver();
      }
    });
  }

  // ---------- 扫描 ----------

  function scheduleFullScan() {
    const run = function () { scan(document.body); };
    if (window.requestIdleCallback) {
      window.requestIdleCallback(run, { timeout: 1500 });
    } else {
      setTimeout(run, 300);
    }
  }

  function scan(root) {
    if (!root || scanning) return;
    scanning = true;
    try {
      const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT, null);
      const aiCandidates = [];
      const seen = new Set();
      let node;
      let count = 0;

      while ((node = walker.nextNode())) {
        if (++count > MAX_SCAN_NODES) break;
        const text = node.nodeValue;
        if (!text || text.trim().length < 2) continue;

        const parent = node.parentElement;
        if (!parent) continue;
        if (SKIP_TAGS.has(parent.tagName)) continue;
        if (parent.closest('[data-faychi-owned]')) continue;

        const target = pickTarget(parent);
        if (!target || target.hasAttribute('data-faychi-owned')) continue;

        const hit = matchText(text);
        if (hit) {
          applyMask(target, hit.strength);
          continue;
        }

        if (aiRules.length) {
          const t = text.trim();
          if (t.length >= 2 && t.length <= 300 && !seen.has(t)) {
            seen.add(t);
            aiCandidates.push({ target: target, text: t });
            if (aiCandidates.length >= MAX_AI_BATCH) break;
          }
        }
      }

      if (aiCandidates.length) runAI(aiCandidates);
    } finally {
      scanning = false;
    }
  }

  function pickTarget(start) {
    let el = start;
    let depth = 0;
    while (el && INLINE_TAGS.has(el.tagName) && depth < 4) {
      const p = el.parentElement;
      if (!p || p.tagName === 'BODY' || p.tagName === 'HTML') break;
      el = p;
      depth++;
    }
    if (!el) return null;
    const tag = el.tagName;
    if (tag === 'BODY' || tag === 'HTML' || SKIP_TAGS.has(tag)) return null;
    return el;
  }

  function matchText(text) {
    const lower = text.toLowerCase();
    for (let i = 0; i < keywordRules.length; i++) {
      if (lower.indexOf(keywordRules[i].kw) !== -1) {
        return { strength: keywordRules[i].strength, reason: 'keyword' };
      }
    }
    for (let j = 0; j < regexRules.length; j++) {
      if (regexRules[j].re.test(text)) {
        return { strength: regexRules[j].strength, reason: 'regex' };
      }
    }
    return null;
  }

  // ---------- AI 语义识别 ----------

  function aiKey(text) {
    let h = 0;
    for (let i = 0; i < text.length; i++) {
      h = (h * 31 + text.charCodeAt(i)) | 0;
    }
    return h + ':' + text.slice(0, 24);
  }

  async function runAI(candidates) {
    if (!settings.ai || !settings.ai.enabled || !settings.ai.apiKey) return;

    const groups = new Map();
    for (let i = 0; i < candidates.length; i++) {
      const c = candidates[i];
      if (!groups.has(c.text)) groups.set(c.text, []);
      groups.get(c.text).push(c.target);
    }

    const texts = Array.from(groups.keys());
    const pending = [];
    const decided = new Map();

    texts.forEach(function (t) {
      const k = aiKey(t);
      if (aiCache.has(k)) decided.set(t, aiCache.get(k));
      else pending.push(t);
    });

    if (pending.length) {
      const resp = await sendMessage({
        type: 'ai-classify',
        texts: pending,
        rules: aiRules.map(function (r) { return { pattern: r.pattern }; }),
        ai: settings.ai
      });
      const matched = new Set((resp && resp.matched) || []);
      pending.forEach(function (t, idx) {
        const hit = matched.has(idx);
        aiCache.set(aiKey(t), hit);
        decided.set(t, hit);
      });
    }

    decided.forEach(function (hit, text) {
      if (!hit) return;
      const targets = groups.get(text) || [];
      targets.forEach(function (el) {
        if (el && el.isConnected && !el.hasAttribute('data-faychi-owned')) {
          applyMask(el, settings.defaultStrength);
        }
      });
    });
  }

  // ---------- 渲染 ----------

  function injectStyles() {
    if (document.getElementById('faychi-style')) return;
    const style = document.createElement('style');
    style.id = 'faychi-style';
    style.setAttribute('data-faychi-owned', 'style');
    style.textContent = [
      '.faychi-mask-overlay{position:absolute;inset:0;display:flex;align-items:center;',
      'justify-content:center;background:rgba(15,32,55,.82);color:#cbd5e1;font-size:12px;',
      'line-height:1.4;font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",',
      '"PingFang SC","Microsoft YaHei",sans-serif;border-radius:4px;cursor:pointer;',
      'z-index:2147483000;text-align:center;padding:4px;box-sizing:border-box;',
      'backdrop-filter:blur(1px);}',
      '.faychi-mask-overlay:hover{background:rgba(15,32,55,.92);color:#e2e8f0;}'
    ].join('');
    (document.head || document.documentElement).appendChild(style);
  }

  function applyMask(el, strength) {
    if (!el || maskedEls.has(el) || el.hasAttribute('data-faychi-owned')) return;
    maskedEls.add(el);
    el.setAttribute('data-faychi-owned', strength);
    if (!el.__faychiOrig) {
      el.__faychiOrig = { display: el.style.display, filter: el.style.filter, position: el.style.position };
    }

    if (strength === 'heavy') {
      el.style.display = 'none';
    } else if (strength === 'medium') {
      el.style.filter = 'blur(7px)';
      el.style.cursor = 'pointer';
      el.title = 'FaychiAI 已屏蔽 · 点击查看';
      el.addEventListener('click', function once(ev) {
        ev.stopPropagation();
        el.style.filter = (el.__faychiOrig && el.__faychiOrig.filter) || '';
        el.style.cursor = '';
        el.removeAttribute('title');
        el.removeAttribute('data-faychi-owned');
        el.removeEventListener('click', once, true);
      }, true);
    } else {
      if (getComputedStyle(el).position === 'static') el.style.position = 'relative';
      const ov = document.createElement('div');
      ov.className = 'faychi-mask-overlay';
      ov.setAttribute('data-faychi-owned', 'overlay');
      ov.textContent = 'FaychiAI 已屏蔽 · 点击查看';
      el.appendChild(ov);
      ov.addEventListener('click', function (ev) {
        ev.stopPropagation();
        ev.preventDefault();
        ov.remove();
        el.removeAttribute('data-faychi-owned');
        if (el.__faychiOrig) el.style.position = el.__faychiOrig.position;
      });
    }

    flushStats();
  }

  function resetAll() {
    maskedEls.forEach(function (el) {
      if (!el || !el.isConnected) return;
      if (el.__faychiOrig) {
        el.style.display = el.__faychiOrig.display;
        el.style.filter = el.__faychiOrig.filter;
        el.style.position = el.__faychiOrig.position;
      }
      el.style.cursor = '';
      el.removeAttribute('title');
      el.removeAttribute('data-faychi-owned');
      const overlays = el.querySelectorAll(':scope > .faychi-mask-overlay');
      overlays.forEach(function (o) { o.remove(); });
    });
    maskedEls.clear();
    aiCache.clear();
  }

  function flushStats() {
    window.__faychiStatBuf = (window.__faychiStatBuf || 0) + 1;
    if (statTimer) return;
    statTimer = setTimeout(function () {
      const n = window.__faychiStatBuf || 0;
      window.__faychiStatBuf = 0;
      statTimer = null;
      if (n > 0) sendMessage({ type: 'stat', n: n });
    }, 1500);
  }

  // ---------- 动态内容监听 ----------

  function startObserver() {
    if (observer || !document.body) return;
    observer = new MutationObserver(function (muts) {
      for (let i = 0; i < muts.length; i++) {
        const added = muts[i].addedNodes;
        if (!added) continue;
        for (let j = 0; j < added.length; j++) {
          const n = added[j];
          if (n.nodeType === 1) moQueue.push(n);
          else if (n.nodeType === 3 && n.parentElement) moQueue.push(n.parentElement);
        }
      }
      if (moQueue.length && !moTimer) {
        moTimer = setTimeout(processQueue, 400);
      }
    });
    observer.observe(document.body, { childList: true, subtree: true });
  }

  function processQueue() {
    moTimer = null;
    const batch = moQueue;
    moQueue = [];
    for (let i = 0; i < batch.length; i++) {
      if (batch[i] && batch[i].isConnected) scan(batch[i]);
    }
  }

  // ---------- 工具 ----------

  function sendMessage(msg) {
    return new Promise(function (resolve) {
      try {
        chrome.runtime.sendMessage(msg, function (resp) {
          if (chrome.runtime.lastError) return resolve(null);
          resolve(resp);
        });
      } catch (e) {
        resolve(null);
      }
    });
  }
})();
