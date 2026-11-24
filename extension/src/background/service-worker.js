// FaychiAI 后台 Service Worker：AI 语义分类网关 + 屏蔽统计
importScripts('/src/shared/constants.js', '/src/shared/storage.js');

const Storage = globalThis.Faychi.Storage;

let statBuf = 0;
let statTimer = null;

chrome.runtime.onMessage.addListener(function (msg, sender, sendResponse) {
  if (!msg || !msg.type) return;

  if (msg.type === 'ai-classify') {
    classify(msg)
      .then(sendResponse)
      .catch(function (err) {
        sendResponse({ matched: [], error: String((err && err.message) || err) });
      });
    return true; // 异步响应
  }

  if (msg.type === 'stat') {
    statBuf += msg.n || 0;
    if (!statTimer) statTimer = setTimeout(flushStats, 2000);
    sendResponse({ ok: true });
    return;
  }

  if (msg.type === 'test-ai') {
    testAI(msg.ai)
      .then(sendResponse)
      .catch(function (err) {
        sendResponse({ ok: false, error: String((err && err.message) || err) });
      });
    return true;
  }
});

async function flushStats() {
  statTimer = null;
  const n = statBuf;
  statBuf = 0;
  if (!n) return;
  try {
    await Storage.addBlocked(n);
  } catch (e) { /* ignore */ }
}

async function classify(msg) {
  const ai = msg.ai || {};
  if (!ai.enabled || !ai.apiKey) return { matched: [], skipped: 'ai-not-configured' };

  const rules = (msg.rules || []).filter(function (r) { return r && r.pattern; });
  const texts = msg.texts || [];
  if (!rules.length || !texts.length) return { matched: [] };

  const ruleLines = rules.map(function (r, i) {
    const typeLabel = r.type === 'spoiler' ? '剧透屏蔽' : 'AI 语义';
    const aliasStr = (r.aliases && r.aliases.length) ? '（别名：' + r.aliases.join('、') + '）' : '';
    return (i + 1) + '. [' + typeLabel + '] ' + r.pattern + aliasStr;
  });

  const content = await chat(ai, [
    { role: 'system', content: '你是 FaychiAI 的内容过滤引擎，严格按规则判断，禁止联想和扩大范围。' },
    {
      role: 'user',
      content:
        '规则说明：\n' +
        '- 【AI 语义】：文本必须明确提及规则所指的人/事/物/概念才算命中；同义、暗喻、指代可算，但必须有明确关联，禁止猜测。\n' +
        '- 【剧透屏蔽】：文本必须揭示该作品的具体剧情（结局、人物死亡、重大反转、关键情节）才算命中；仅提及作品名、角色名、评分、出版信息、求推荐、无具体剧情的讨论不算剧透。\n\n' +
        '规则：\n' + ruleLines.join('\n') + '\n\n' +
        '待判定文本：\n' + texts.map(function (t, i) { return '[' + i + '] ' + t; }).join('\n') + '\n\n' +
        '对每条文本判断命中了哪些规则（命中规则序号从 1 开始）。未命中则 matched 为空数组。\n' +
        '严格只输出 JSON，不要任何解释：{"results":[{"idx":0,"matched":[1]}]}'
    }
  ]);

  let results = [];
  try {
    const parsed = JSON.parse(content);
    results = Array.isArray(parsed) ? parsed : (parsed.results || []);
  } catch (e) { return { matched: [] }; }

  const matched = [];
  results.forEach(function (r) {
    const idx = Number(r && r.idx);
    const m = Array.isArray(r && r.matched) ? r.matched : [];
    if (!Number.isInteger(idx) || idx < 0 || idx >= texts.length) return;
    m.forEach(function (ruleNo) {
      const ruleIdx = Number(ruleNo) - 1;
      const rule = rules[ruleIdx];
      if (!rule) return;
      matched.push({ idx: idx, strength: rule.strength || null });
    });
  });

  return { matched: matched };
}

async function testAI(ai) {
  if (!ai || !ai.apiKey) return { ok: false, error: '未填写 API Key' };
  const content = await chat(ai, [
    { role: 'user', content: '回复 JSON：{"ok":true}' }
  ]);
  return { ok: true, content: String(content).slice(0, 80) };
}

async function chat(ai, messages) {
  const endpoint = String(ai.baseUrl || '').replace(/\/+$/, '') + '/chat/completions';
  const ctrl = new AbortController();
  const timer = setTimeout(function () { ctrl.abort(); }, 20000);
  try {
    const resp = await fetch(endpoint, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': 'Bearer ' + ai.apiKey
      },
      body: JSON.stringify({
        model: ai.model || 'deepseek-chat',
        temperature: 0,
        response_format: { type: 'json_object' },
        messages: messages
      }),
      signal: ctrl.signal
    });
    if (!resp.ok) {
      const body = await resp.text();
      throw new Error('HTTP ' + resp.status + ' ' + body.slice(0, 200));
    }
    const data = await resp.json();
    const content = data && data.choices && data.choices[0] &&
      data.choices[0].message && data.choices[0].message.content;
    return content || '';
  } finally {
    clearTimeout(timer);
  }
}
