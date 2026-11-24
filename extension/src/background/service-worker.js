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

  const rules = (msg.rules || []).map(function (r) { return r.pattern; }).filter(Boolean);
  const texts = msg.texts || [];
  if (!rules.length || !texts.length) return { matched: [] };

  const content = await chat(ai, [
    { role: 'system', content: '你是 FaychiAI 的内容过滤引擎，负责判断中文内容是否命中用户的屏蔽规则。' },
    {
      role: 'user',
      content:
        '屏蔽规则：\n' + rules.map(function (r, i) { return (i + 1) + '. ' + r; }).join('\n') +
        '\n\n待判定文本：\n' + texts.map(function (t, i) { return '[' + i + '] ' + t; }).join('\n') +
        '\n\n请对每条文本做语义级判断（允许同义、暗喻、指代），判断是否命中任意规则。' +
        '严格只输出 JSON：{"matched":[命中文本的序号]}'
    }
  ]);

  let matched = [];
  try {
    const parsed = JSON.parse(content);
    matched = Array.isArray(parsed) ? parsed : (parsed.matched || []);
  } catch (e) { /* 解析失败则不屏蔽 */ }
  matched = (matched || []).map(Number).filter(function (x) {
    return Number.isInteger(x) && x >= 0 && x < texts.length;
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
