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
        '- 【剧透屏蔽】：文本只要透露了该作品的剧情信息就算命中，包括剧情走向、结局、人物命运/生死、关键反转、重大伏笔、重要情节细节。\n' +
        '  以下不算剧透：仅出现作品名或角色名、评分、出版/上映信息、求推荐、纯主观评价（如"很好看/太烂了"）而无任何剧情信息。\n\n' +
        '规则：\n' + ruleLines.join('\n') + '\n\n' +
        '待判定文本：\n' + texts.map(function (t, i) { return '[' + i + '] ' + t; }).join('\n') + '\n\n' +
        '逐条判断命中了哪些规则（规则序号从 1 开始）。命中则把序号放入数组，未命中则为空数组。\n' +
        '严格只输出如下 JSON，不要任何解释或代码块标记：\n' +
        '{"results":[{"idx":0,"matched":[1]},{"idx":1,"matched":[]}]}'
    }
  ]);

  let results = [];
  try {
    const parsed = JSON.parse(extractJson(content));
    results = normalizeResults(parsed, texts.length);
  } catch (e) { return { matched: [] }; }

  const matched = [];
  results.forEach(function (item) {
    if (!item.rules.length) {
      matched.push({ idx: item.idx, strength: null });
      return;
    }
    item.rules.forEach(function (ruleNo) {
      const rule = rules[ruleNo - 1];
      if (!rule) return;
      matched.push({ idx: item.idx, strength: rule.strength || null });
    });
  });

  return { matched: matched };
}

// 从模型输出中提取 JSON（兼容代码围栏、前后多余文字）
function extractJson(s) {
  let t = String(s || '').trim();
  const fence = t.match(/```(?:json)?\s*([\s\S]*?)```/i);
  if (fence) t = fence[1].trim();
  const start = t.search(/[[{]/);
  if (start > 0) t = t.slice(start);
  const end = Math.max(t.lastIndexOf('}'), t.lastIndexOf(']'));
  if (end !== -1) t = t.slice(0, end + 1);
  return t;
}

function toIdxArray(v) {
  if (v === undefined || v === null) return [];
  if (Array.isArray(v)) {
    return v.map(function (x) {
      if (x && typeof x === 'object') x = x.rule !== undefined ? x.rule : x.ruleNo;
      return Number(x);
    }).filter(function (n) { return Number.isInteger(n); });
  }
  if (typeof v === 'object') {
    const n = Number(v.rule !== undefined ? v.rule : v.ruleNo);
    return Number.isInteger(n) ? [n] : [];
  }
  const n = Number(v);
  return Number.isInteger(n) ? [n] : [];
}

// 归一化为 [{idx, rules:[规则序号]}]，兼容新旧多种返回格式
function normalizeResults(parsed, len) {
  const out = [];
  const pick = function (obj) {
    const idx = Number(obj.idx !== undefined ? obj.idx : obj.index);
    const rules = toIdxArray(obj.matched !== undefined ? obj.matched : obj.rules);
    if (Number.isInteger(idx) && idx >= 0 && idx < len) out.push({ idx: idx, rules: rules });
  };

  let list = null;
  if (Array.isArray(parsed)) list = parsed;
  else if (parsed && Array.isArray(parsed.results)) list = parsed.results;
  else if (parsed && Array.isArray(parsed.matched)) list = parsed.matched;
  if (!list) return out;

  list.forEach(function (item) {
    if (item && typeof item === 'object') pick(item);
    else {
      const idx = Number(item);
      if (Number.isInteger(idx) && idx >= 0 && idx < len) out.push({ idx: idx, rules: [] });
    }
  });
  return out;
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
