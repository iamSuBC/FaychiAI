// FaychiAI 弹窗逻辑
(function () {
  const F = globalThis.Faychi;
  const Storage = F.Storage;

  const $ = function (id) { return document.getElementById(id); };
  const elEnabled = $('enabled');
  const elStrength = $('strength');
  const elPattern = $('newPattern');
  const elType = $('newType');
  const elAliases = $('newAliases');
  const elAddAliases = $('addAliases');
  const elAdd = $('addBtn');
  const elList = $('ruleList');
  const elCount = $('ruleCount');
  const elEmpty = $('empty');
  const elBlocked = $('blocked');
  const elAiStatus = $('aiStatus');
  const elScopeStatus = $('scopeStatus');
  const elSiteRow = $('siteRow');
  const elSiteHost = $('siteHost');
  const elSiteSwitch = $('siteSwitch');
  const elScopeMode = $('scopeMode');
  const elScopeChips = $('scopeChips');
  const elScopeInput = $('scopeInput');
  const elScopeAddBtn = $('scopeAddBtn');

  let settings = null;
  let currentHost = '';

  init();

  async function init() {
    settings = await Storage.getSettings();
    render();
    refreshStats();

    elEnabled.addEventListener('change', function () {
      Storage.updateSettings({ enabled: elEnabled.checked });
    });

    elStrength.addEventListener('change', function () {
      Storage.updateSettings({ defaultStrength: elStrength.value });
    });

    elSiteSwitch.addEventListener('change', function () {
      const turnOn = elSiteSwitch.checked;
      if (!currentHost) return;
      const scope = settings.scope || {};
      const mode = scope.mode || 'all';
      const sites = (scope.sites || []).slice();

      const toggle = function (list, host, want) {
        const has = list.indexOf(host) !== -1;
        if (want && !has) list.push(host);
        if (!want && has) return list.filter(function (s) { return s !== host; });
        return list;
      };

      let next;
      if (mode === 'all') {
        // 「所有网站」下关闭当前站点 → 转为「除选中的网站外」并加入该站
        next = turnOn ? { mode: 'all', sites: [] } : { mode: 'exclude', sites: [currentHost] };
      } else if (mode === 'include') {
        next = { mode: 'include', sites: toggle(sites, currentHost, turnOn) };
      } else {
        next = { mode: 'exclude', sites: toggle(sites, currentHost, !turnOn) };
      }
      Storage.updateSettings({ scope: next });
    });

    elScopeMode.addEventListener('change', function () {
      const scope = settings.scope || {};
      Storage.updateSettings({ scope: { mode: elScopeMode.value, sites: scope.sites || [] } });
    });

    elScopeAddBtn.addEventListener('click', addCustomSite);
    elScopeInput.addEventListener('keydown', function (e) {
      if (e.key === 'Enter') addCustomSite();
    });

    elAdd.addEventListener('click', addRule);
    elPattern.addEventListener('keydown', function (e) {
      if (e.key === 'Enter') addRule();
    });
    elAliases.addEventListener('keydown', function (e) {
      if (e.key === 'Enter') addRule();
    });

    function syncAliases() {
      elAddAliases.style.display = elType.value === 'ai' ? 'block' : 'none';
    }
    elType.addEventListener('change', syncAliases);
    syncAliases();

    $('openOptions').addEventListener('click', function (e) {
      e.preventDefault();
      chrome.runtime.openOptionsPage();
    });

    chrome.storage.onChanged.addListener(function (changes, area) {
      if (area !== 'local') return;
      if (changes[F.KEYS.SETTINGS]) {
        settings = Storage.mergeDefaults(changes[F.KEYS.SETTINGS].newValue);
        render();
      }
      if (changes[F.KEYS.STATS]) {
        refreshStats();
      }
    });
  }

  async function refreshStats() {
    const stats = await Storage.getStats();
    elBlocked.textContent = stats.blocked || 0;
  }

  function render() {
    elEnabled.checked = !!settings.enabled;
    elStrength.value = settings.defaultStrength;

    const rules = settings.rules || [];
    elCount.textContent = rules.length + ' 条';
    elEmpty.style.display = rules.length ? 'none' : 'block';

    elList.innerHTML = '';
    rules.forEach(function (rule) {
      const li = document.createElement('li');

      const cb = document.createElement('input');
      cb.type = 'checkbox';
      cb.checked = rule.enabled !== false;
      cb.addEventListener('change', function () {
        Storage.updateRule(rule.id, { enabled: cb.checked });
      });

      const span = document.createElement('span');
      span.className = 'rule-pattern';
      span.textContent = rule.pattern;
      span.title = rule.pattern;
      if (rule.aliases && rule.aliases.length) {
        span.title = rule.pattern + '（别名：' + rule.aliases.join('、') + '）';
      }

      const tag = document.createElement('span');
      tag.className = 'rule-tag';
      tag.textContent = F.RULE_TYPES[rule.type] || rule.type;

      const del = document.createElement('button');
      del.className = 'rule-del';
      del.textContent = '×';
      del.title = '删除';
      del.addEventListener('click', function () {
        Storage.removeRule(rule.id);
      });

      li.appendChild(cb);
      li.appendChild(span);
      li.appendChild(tag);
      li.appendChild(del);
      elList.appendChild(li);
    });

    const ai = settings.ai || {};
    if (ai.enabled && ai.apiKey) {
      elAiStatus.className = 'ai-status';
      elAiStatus.textContent = 'AI 语义识别已开启 · 模型 ' + (ai.model || '-');
    } else {
      elAiStatus.className = 'ai-status warn';
      elAiStatus.textContent = 'AI 语义识别未配置，当前仅关键词/正则生效（可在设置中开启）';
    }

    renderScopeUI();
    renderScopeStatus();
  }

  function renderScopeUI() {
    const scope = settings.scope || {};
    elScopeMode.value = scope.mode || 'all';
    const sites = scope.sites || [];

    const platformDomains = [];
    const chips = [];
    (F.PLATFORMS || []).forEach(function (p) {
      platformDomains.push.apply(platformDomains, p.domains);
      chips.push({ label: p.name, domains: p.domains.slice() });
    });
    // 平台未覆盖的自定义域名，单独作为标签展示
    (sites || []).forEach(function (d) {
      if (platformDomains.indexOf(d) === -1) chips.push({ label: d, domains: [d] });
    });

    elScopeChips.innerHTML = '';
    chips.forEach(function (c) {
      const on = c.domains.every(function (d) { return sites.indexOf(d) !== -1; });
      const b = document.createElement('button');
      b.type = 'button';
      b.className = 'chip' + (on ? ' on' : '');
      b.textContent = c.label;
      b.addEventListener('click', function () {
        const scope = settings.scope || {};
        const cur = (scope.sites || []).slice();
        if (on) {
          c.domains.forEach(function (d) {
            const i = cur.indexOf(d);
            if (i !== -1) cur.splice(i, 1);
          });
        } else {
          c.domains.forEach(function (d) {
            if (cur.indexOf(d) === -1) cur.push(d);
          });
        }
        Storage.updateSettings({ scope: { mode: scope.mode || 'all', sites: cur } });
      });
      elScopeChips.appendChild(b);
    });
  }

  async function addCustomSite() {
    const d = F.normalizeDomain(elScopeInput.value);
    if (!d) return;
    const scope = settings.scope || {};
    const cur = (scope.sites || []).slice();
    if (cur.indexOf(d) === -1) cur.push(d);
    await Storage.updateSettings({ scope: { mode: scope.mode || 'all', sites: cur } });
    elScopeInput.value = '';
  }

  function renderScopeStatus() {
    if (!chrome.tabs || !chrome.tabs.query) return;
    chrome.tabs.query({ active: true, currentWindow: true }, function (tabs) {
      const tab = tabs && tabs[0];
      let host = '';
      let isWeb = false;
      try {
        const u = tab && tab.url ? new URL(tab.url) : null;
        if (u && (u.protocol === 'http:' || u.protocol === 'https:')) {
          host = u.hostname.replace(/^www\./, '');
          isWeb = true;
        } else if (u) {
          host = u.protocol === 'chrome-extension:' ? '扩展内部页面'
            : (u.protocol === 'file:' ? '本地文件' : '浏览器内部页面');
        }
      } catch (e) { host = ''; }

      if (!host) {
        elScopeStatus.className = 'scope-status off';
        elScopeStatus.textContent = '无法读取当前页面地址，请在普通网页上打开弹窗';
        elSiteRow.style.display = 'none';
        currentHost = '';
        return;
      }
      if (!isWeb) {
        elScopeStatus.className = 'scope-status';
        elScopeStatus.textContent = '当前为' + host + '，无需屏蔽控制';
        elSiteRow.style.display = 'none';
        currentHost = '';
        return;
      }

      currentHost = F.normalizeDomain ? F.normalizeDomain(host) : host;
      const active = F.inScope(settings.scope, currentHost);
      elSiteRow.style.display = 'flex';
      elSiteHost.textContent = currentHost;
      elSiteHost.title = currentHost;
      elSiteSwitch.checked = active;
      elScopeStatus.className = 'scope-status' + (active ? '' : ' off');
      elScopeStatus.textContent = active ? '当前站点已生效：' + currentHost : '当前站点已停用：' + currentHost;
    });
  }

  async function addRule() {
    const pattern = elPattern.value.trim();
    if (!pattern) return;
    const rule = { type: elType.value, pattern: pattern };
    if (elType.value === 'ai') {
      const aliases = elAliases.value.trim();
      if (aliases) rule.aliases = aliases.split(/[,，、\s]+/).filter(Boolean);
    }
    await Storage.addRule(rule);
    elPattern.value = '';
    elAliases.value = '';
  }
})();
