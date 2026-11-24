// FaychiAI 全局常量（在 content script / popup / options / service worker 中共用）
// 统一挂在 globalThis.Faychi 命名空间下，避免 ES Module 在不同运行环境的兼容问题。
(function () {
  const F = (globalThis.Faychi = globalThis.Faychi || {});

  F.KEYS = {
    SETTINGS: 'faychi_settings',
    STATS: 'faychi_stats'
  };

  // 屏蔽强度
  F.STRENGTHS = {
    light: '轻度（遮罩）',
    medium: '中度（模糊）',
    heavy: '重度（移除）'
  };

  // 规则类型
  F.RULE_TYPES = {
    keyword: '关键词',
    regex: '正则',
    ai: 'AI 语义',
    spoiler: '剧透屏蔽'
  };

  F.DEFAULT_SETTINGS = {
    enabled: true,
    defaultStrength: 'medium',
    rules: [],
    ai: {
      enabled: false,
      baseUrl: 'https://api.deepseek.com/v1',
      apiKey: '',
      model: 'deepseek-chat'
    }
  };

  F.uuid = function () {
    return 'r_' + Math.random().toString(36).slice(2, 10) + Date.now().toString(36);
  };
})();
