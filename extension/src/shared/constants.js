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
    ai: 'AI 语义'
  };

  // 站点范围模式
  F.SCOPE_MODES = {
    all: '所有网站',
    include: '仅选中的网站',
    exclude: '除选中的网站外'
  };

  // 常用平台预设（勾选后即把 domains 加入站点范围）
  F.PLATFORMS = [
    { id: 'youtube', name: 'YouTube', domains: ['youtube.com'] },
    { id: 'twitter', name: 'X / Twitter', domains: ['x.com', 'twitter.com'] },
    { id: 'bilibili', name: '哔哩哔哩', domains: ['bilibili.com'] },
    { id: 'zhihu', name: '知乎', domains: ['zhihu.com'] },
    { id: 'weibo', name: '微博', domains: ['weibo.com'] },
    { id: 'reddit', name: 'Reddit', domains: ['reddit.com'] },
    { id: 'douban', name: '豆瓣', domains: ['douban.com'] },
    { id: 'douyin', name: '抖音', domains: ['douyin.com'] },
    { id: 'xiaohongshu', name: '小红书', domains: ['xiaohongshu.com'] },
    { id: 'facebook', name: 'Facebook', domains: ['facebook.com'] },
    { id: 'instagram', name: 'Instagram', domains: ['instagram.com'] },
    { id: 'tiktok', name: 'TikTok', domains: ['tiktok.com'] }
  ];

  F.DEFAULT_SETTINGS = {
    enabled: true,
    defaultStrength: 'medium',
    rules: [],
    scope: {
      mode: 'all',
      sites: []
    },
    ai: {
      enabled: false,
      baseUrl: 'https://api.deepseek.com/v1',
      apiKey: '',
      model: 'deepseek-chat'
    }
  };

  // 规范化域名：去掉协议、路径、前导 www. / *.
  F.normalizeDomain = function (input) {
    let d = String(input || '').trim().toLowerCase();
    if (!d) return '';
    d = d.replace(/^https?:\/\//, '').split('/')[0].split('?')[0];
    d = d.replace(/^\*\./, '').replace(/^www\./, '');
    return d;
  };

  // 判断 hostname 是否匹配某域名（含子域）
  F.matchSite = function (hostname, domain) {
    const h = String(hostname || '').toLowerCase();
    const d = F.normalizeDomain(domain);
    if (!d) return false;
    return h === d || h.endsWith('.' + d);
  };

  // 判断当前站点是否在生效范围内
  F.inScope = function (scope, hostname) {
    const s = scope || {};
    const mode = s.mode || 'all';
    if (mode === 'all') return true;
    const sites = Array.isArray(s.sites) ? s.sites : [];
    const matched = sites.some(function (d) { return F.matchSite(hostname, d); });
    if (mode === 'include') return matched;
    if (mode === 'exclude') return !matched;
    return true;
  };

  F.uuid = function () {
    return 'r_' + Math.random().toString(36).slice(2, 10) + Date.now().toString(36);
  };
})();
