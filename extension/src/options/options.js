// FaychiAI 设置页逻辑
(function () {
  const F = globalThis.Faychi;
  const Storage = F.Storage;

  const $ = function (id) { return document.getElementById(id); };

  const elEnabled = $('enabled');
  const elStrength = $('defaultStrength');
  const elNewType = $('newType');
  const elNewPattern = $('newPattern');
  const elNewStrength = $('newStrength');
  const elAdd = $('addBtn');
  const elRows = $('ruleRows');
  const elEmpty = $('empty');

  const elAiEnabled = $('aiEnabled');
  const elAiBaseUrl = $('aiBaseUrl');
  const elAiApiKey = $('aiApiKey');
  const elAiModel = $('aiModel');
  const elTestBtn = $('testBtn');
  const elTestResult = $('testResult');

  const elBlocked = $('blockedCount');

  let settings = null;

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

    elAdd.addEventListener('click', addRule);
    elNewPattern.addEventListener('keydown', function (e) {
      if (e.key === 'Enter') addRule();
    });

    // AI 配置（失焦即保存）
    [elAiEnabled, elAiBaseUrl, elAiApiKey, elAiModel].forEach(function (el) {
      const evt = el === elAiEnabled ? 'change' : 'blur';
      el.addEventListener(evt, saveAI);
    });

    elTestBtn.addEventListener('click', testAI);

    $('exportBtn').addEventListener('click', exportConfig);
    $('importBtn').addEventListener('click', function () { $('importFile').click(); });
    $('importFile').addEventListener('change', importConfig);
    $('resetStatsBtn').addEventListener('click', function () {
      Storage.resetStats();
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

    elAiEnabled.checked = !!settings.ai.enabled;
    elAiBaseUrl.value = settings.ai.baseUrl || '';
    elAiApiKey.value = settings.ai.apiKey || '';
    elAiModel.value = settings.ai.model || '';

    renderRules();
  }

  function renderRules() {
    const rules = settings.rules || [];
    elEmpty.style.display = rules.length ? 'none' : 'block';
    elRows.innerHTML = '';

    rules.forEach(function (rule) {
      const tr = document.createElement('tr');

      // 启用
      const tdOn = document.createElement('td');
      const cb = document.createElement('input');
      cb.type = 'checkbox';
      cb.checked = rule.enabled !== false;
      cb.addEventListener('change', function () {
        Storage.updateRule(rule.id, { enabled: cb.checked });
      });
      tdOn.appendChild(cb);

      // 类型
      const tdType = document.createElement('td');
      const typeSel = document.createElement('select');
      Object.keys(F.RULE_TYPES).forEach(function (k) {
        const o = document.createElement('option');
        o.value = k;
        o.textContent = F.RULE_TYPES[k];
        typeSel.appendChild(o);
      });
      typeSel.value = rule.type;
      typeSel.addEventListener('change', function () {
        Storage.updateRule(rule.id, { type: typeSel.value });
      });
      tdType.appendChild(typeSel);

      // 内容（可编辑）
      const tdPattern = document.createElement('td');
      const pInput = document.createElement('input');
      pInput.type = 'text';
      pInput.value = rule.pattern;
      pInput.style.width = '100%';
      pInput.addEventListener('blur', function () {
        const v = pInput.value.trim();
        if (v && v !== rule.pattern) Storage.updateRule(rule.id, { pattern: v });
      });
      tdPattern.appendChild(pInput);

      // 强度
      const tdStrength = document.createElement('td');
      const sSel = document.createElement('select');
      [['', '默认'], ['light', '轻度'], ['medium', '中度'], ['heavy', '重度']].forEach(function (pair) {
        const o = document.createElement('option');
        o.value = pair[0];
        o.textContent = pair[1];
        sSel.appendChild(o);
      });
      sSel.value = rule.strength || '';
      sSel.addEventListener('change', function () {
        Storage.updateRule(rule.id, { strength: sSel.value || null });
      });
      tdStrength.appendChild(sSel);

      // 删除
      const tdDel = document.createElement('td');
      const del = document.createElement('button');
      del.className = 'del-btn';
      del.textContent = '×';
      del.title = '删除';
      del.addEventListener('click', function () {
        Storage.removeRule(rule.id);
      });
      tdDel.appendChild(del);

      tr.appendChild(tdOn);
      tr.appendChild(tdType);
      tr.appendChild(tdPattern);
      tr.appendChild(tdStrength);
      tr.appendChild(tdDel);
      elRows.appendChild(tr);
    });
  }

  async function addRule() {
    const pattern = elNewPattern.value.trim();
    if (!pattern) return;
    await Storage.addRule({
      type: elNewType.value,
      pattern: pattern,
      strength: elNewStrength.value || null
    });
    elNewPattern.value = '';
  }

  function saveAI() {
    Storage.updateSettings({
      ai: {
        enabled: elAiEnabled.checked,
        baseUrl: elAiBaseUrl.value.trim(),
        apiKey: elAiApiKey.value.trim(),
        model: elAiModel.value.trim() || 'deepseek-chat'
      }
    });
  }

  function testAI() {
    saveAI();
    elTestResult.className = 'test-result';
    elTestResult.textContent = '测试中…';
    const ai = {
      enabled: true,
      baseUrl: elAiBaseUrl.value.trim(),
      apiKey: elAiApiKey.value.trim(),
      model: elAiModel.value.trim() || 'deepseek-chat'
    };
    chrome.runtime.sendMessage({ type: 'test-ai', ai: ai }, function (resp) {
      if (chrome.runtime.lastError) {
        elTestResult.className = 'test-result err';
        elTestResult.textContent = '失败：' + chrome.runtime.lastError.message;
        return;
      }
      if (resp && resp.ok) {
        elTestResult.className = 'test-result ok';
        elTestResult.textContent = '连接成功';
      } else {
        elTestResult.className = 'test-result err';
        elTestResult.textContent = '失败：' + ((resp && resp.error) || '未知错误');
      }
    });
  }

  function exportConfig() {
    const data = {
      version: 1,
      exportedAt: new Date().toISOString(),
      settings: settings
    };
    const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'faychi-config.json';
    a.click();
    URL.revokeObjectURL(url);
  }

  function importConfig(e) {
    const file = e.target.files && e.target.files[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = function () {
      try {
        const parsed = JSON.parse(reader.result);
        const incoming = parsed.settings || parsed;
        const merged = Storage.mergeDefaults(incoming);
        Storage.setSettings(merged);
      } catch (err) {
        alert('导入失败：文件格式不正确');
      }
    };
    reader.readAsText(file);
    e.target.value = '';
  }
})();
