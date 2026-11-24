// FaychiAI 弹窗逻辑
(function () {
  const F = globalThis.Faychi;
  const Storage = F.Storage;

  const $ = function (id) { return document.getElementById(id); };
  const elEnabled = $('enabled');
  const elStrength = $('strength');
  const elPattern = $('newPattern');
  const elType = $('newType');
  const elAdd = $('addBtn');
  const elList = $('ruleList');
  const elCount = $('ruleCount');
  const elEmpty = $('empty');
  const elBlocked = $('blocked');
  const elAiStatus = $('aiStatus');

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
    elPattern.addEventListener('keydown', function (e) {
      if (e.key === 'Enter') addRule();
    });

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
  }

  async function addRule() {
    const pattern = elPattern.value.trim();
    if (!pattern) return;
    await Storage.addRule({ type: elType.value, pattern: pattern });
    elPattern.value = '';
  }
})();
