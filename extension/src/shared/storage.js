// FaychiAI 设置与统计读写（基于 chrome.storage.local）
// 说明：统计单独存放在 STATS 键，避免高频写入触发设置监听导致内容脚本反复重扫。
(function () {
  const F = globalThis.Faychi;
  const KEY = F.KEYS.SETTINGS;
  const STATS_KEY = F.KEYS.STATS;

  function mergeDefaults(stored) {
    const d = F.DEFAULT_SETTINGS;
    const s = Object.assign({}, d, stored || {});
    s.ai = Object.assign({}, d.ai, (stored && stored.ai) || {});
    s.scope = Object.assign({}, d.scope, (stored && stored.scope) || {});
    s.scope.sites = Array.isArray(s.scope.sites) ? s.scope.sites : [];
    const rawRules = Array.isArray(stored && stored.rules) ? stored.rules : d.rules.slice();
    s.rules = rawRules.map(normalizeRule);
    delete s.stats;
    return s;
  }

  function getSettings() {
    return new Promise(function (resolve) {
      chrome.storage.local.get(KEY, function (res) {
        resolve(mergeDefaults(res && res[KEY]));
      });
    });
  }

  function setSettings(s) {
    return new Promise(function (resolve) {
      chrome.storage.local.set({ [KEY]: s }, resolve);
    });
  }

  async function updateSettings(patch) {
    const s = await getSettings();
    const next = Object.assign({}, s, patch);
    await setSettings(next);
    return next;
  }

  function normalizeRule(rule) {
    const type = rule.type === 'spoiler' ? 'ai' : (rule.type || 'keyword');
    return {
      id: rule.id || F.uuid(),
      type: type,
      pattern: String(rule.pattern || '').trim(),
      strength: rule.strength || null,
      note: rule.note || '',
      aliases: Array.isArray(rule.aliases) ? rule.aliases :
        (rule.aliases ? String(rule.aliases).split(/[,，、\s]+/).filter(Boolean) : []),
      enabled: rule.enabled !== false,
      createdAt: rule.createdAt || Date.now()
    };
  }

  async function addRule(rule) {
    const s = await getSettings();
    s.rules.push(normalizeRule(rule));
    await setSettings(s);
    return s;
  }

  async function updateRule(id, patch) {
    const s = await getSettings();
    s.rules = s.rules.map(function (r) {
      return r.id === id ? Object.assign({}, r, patch) : r;
    });
    await setSettings(s);
    return s;
  }

  async function removeRule(id) {
    const s = await getSettings();
    s.rules = s.rules.filter(function (r) {
      return r.id !== id;
    });
    await setSettings(s);
    return s;
  }

  // ---------- 统计 ----------

  function getStats() {
    return new Promise(function (resolve) {
      chrome.storage.local.get(STATS_KEY, function (res) {
        const v = (res && res[STATS_KEY]) || {};
        resolve({ blocked: v.blocked || 0 });
      });
    });
  }

  function setStats(stats) {
    return new Promise(function (resolve) {
      chrome.storage.local.set({ [STATS_KEY]: stats }, resolve);
    });
  }

  async function addBlocked(n) {
    const s = await getStats();
    s.blocked += n;
    await setStats(s);
    return s;
  }

  function resetStats() {
    return setStats({ blocked: 0 });
  }

  F.Storage = {
    mergeDefaults: mergeDefaults,
    getSettings: getSettings,
    setSettings: setSettings,
    updateSettings: updateSettings,
    normalizeRule: normalizeRule,
    addRule: addRule,
    updateRule: updateRule,
    removeRule: removeRule,
    getStats: getStats,
    setStats: setStats,
    addBlocked: addBlocked,
    resetStats: resetStats
  };
})();
