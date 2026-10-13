export type NewsTopic = 'policy' | 'economy' | 'diplomacy' | 'technology' | 'security' | 'society';
export interface ApiSourceConfig {
  method: 'GET' | 'POST'; body: string;
  auth: { type: 'none' | 'bearer' | 'header'; header: string; value: string };
  mapping: { items: string; title: string; summary: string; url: string; publishedAt: string; author: string; images: string; body: string };
}
export interface WebRules { mode: 'metadata' | 'css'; item: string; title: string; summary: string; link: string; date: string; image: string; body: string; author: string; next: string }
export interface WebSourceConfig { rules: WebRules; previousRules?: WebRules; timeoutSeconds: number; maxItems: number; maxPages: number; concurrency: number }
export interface NewsSourceConfig {
  id: string;
  name: string;
  englishName: string;
  kind: 'rss' | 'google-rss' | 'rsshub' | 'telegram' | 'reserved' | 'api' | 'web';
  website: string;
  feedUrl?: string;
  feedUrls?: string[];
  publisherHosts: string[];
  description: string;
  enabled: boolean;
  pollSeconds: number;
  channel?: string;
  logo?: string;
  notes?: string;
  timeZone?: string;
  target?: string;
  adapter?: 'generic' | 'twitter' | 'bing' | 'hackernews' | 'bilibili' | 'sogou';
  api?: ApiSourceConfig;
  web?: WebSourceConfig;
}

function googleFeed(host: string) {
  const url = new URL('https://news.google.com/rss/search');
  url.search = new URLSearchParams({ q: `(China OR Chinese OR Beijing OR "Hong Kong" OR Taiwan OR Xinjiang OR Tibet) when:1d site:${host}`, hl: 'en-US', gl: 'US', ceid: 'US:en' }).toString();
  return url.toString();
}

const SOURCES: NewsSourceConfig[] = [
  { id: 'reuters', name: '路透社', englishName: 'Reuters', kind: 'google-rss', website: 'https://www.reuters.com/world/china/', feedUrl: googleFeed('reuters.com'), publisherHosts: ['reuters.com'], description: '政策、外交与经济。通过 Google News RSS 获取报道索引，原文由路透发布。', enabled: true, pollSeconds: 120 },
  { id: 'ap', name: '美联社', englishName: 'Associated Press', kind: 'google-rss', website: 'https://apnews.com/hub/china', feedUrl: googleFeed('apnews.com'), publisherHosts: ['apnews.com'], description: '重大事件与现场报道。通过 Google News RSS 获取报道索引。', enabled: true, pollSeconds: 120 },
  { id: 'bloomberg', name: '彭博', englishName: 'Bloomberg', kind: 'rss', website: 'https://www.bloomberg.com/asia', feedUrl: 'https://www.bloomberg.com/feeds/economics/news.rss', publisherHosts: ['bloomberg.com'], description: '媒体公开经济 RSS，涉华关系由 AI 或规则筛选；全文可能需要订阅。', enabled: true, pollSeconds: 180 },
  { id: 'cnbc', name: 'CNBC', englishName: 'CNBC', kind: 'rss', website: 'https://www.cnbc.com/china/', feedUrl: 'https://search.cnbc.com/rs/search/combinedcms/view.xml?partnerId=wrss01&id=100003114', publisherHosts: ['cnbc.com'], description: '媒体公开 Top News RSS，涉华关系由 AI 或规则筛选；无需等待 RSSHub 全文抓取。', enabled: true, pollSeconds: 180 },
  { id: 'nikkei', name: '日经亚洲', englishName: 'Nikkei Asia', kind: 'google-rss', website: 'https://asia.nikkei.com/', feedUrl: googleFeed('asia.nikkei.com'), publisherHosts: ['nikkei.com'], description: '供应链、制造业与亚洲政策。公开标题索引；全文可能需要订阅。', enabled: true, pollSeconds: 180 },
  { id: 'guardian', name: '卫报', englishName: 'The Guardian', kind: 'rss', website: 'https://www.theguardian.com/world/china', feedUrl: 'https://www.theguardian.com/world/china/rss', publisherHosts: ['theguardian.com'], description: '直接读取媒体公开的中国专题 RSS，筛除评论与生活内容。', enabled: true, pollSeconds: 120 },
  { id: 'bbc', name: 'BBC', englishName: 'BBC News', kind: 'rss', website: 'https://www.bbc.com/news/world/asia/china', feedUrl: 'https://feeds.bbci.co.uk/news/world/asia/rss.xml', publisherHosts: ['bbc.com', 'bbc.co.uk'], description: '直接读取亚洲 RSS，再筛选中国相关报道。', enabled: true, pollSeconds: 120 },
  { id: 'afp', name: '法新社', englishName: 'AFP', kind: 'reserved', website: 'https://www.afp.com/en', publisherHosts: ['afp.com'], description: '重点关注来源。尚未配置稳定的免费快讯入口，当前不自动采集。', enabled: false, pollSeconds: 120 },
  ...[
    ['FakeNewsCN', '二流报纸'], ['zaihuapd', '在花科技圈'], ['xhqcankao', '风向旗参考快讯'],
    ['landiansub', '蓝点网订阅频道'], ['tnews365', '竹新社'], ['kejiqu', '科技＆趣闻＆杂记'], ['Trump_TS', 'Trump.truthsocial_中文'],
  ].map(([channel, name]): NewsSourceConfig => ({
    id: `tg-${channel.toLowerCase()}`, name, englishName: `@${channel}`, kind: 'telegram', website: `https://t.me/${channel}`, publisherHosts: [],
    description: '可选个人账号监听。开关仅控制本站采集；开启统一 AI 后频道新闻也会分析，非简体中文会翻译。真实接入需核对平台内容使用范围。', enabled: false, pollSeconds: 0, channel,
  })),
];

export const NEWS_SOURCES = SOURCES.map(source => ({ ...source, feedUrls: source.feedUrl ? [source.feedUrl] : [] }));

export const ORIGINAL_PUBLISHERS = [
  ...NEWS_SOURCES.filter(s => s.publisherHosts.length).map(s => ({ name: s.englishName, hosts: s.publisherHosts })),
  { name: 'Financial Times', hosts: ['ft.com'] }, { name: 'The Wall Street Journal', hosts: ['wsj.com'] },
  { name: 'France 24', hosts: ['france24.com'] }, { name: 'RFI', hosts: ['rfi.fr'] },
  { name: 'DW', hosts: ['dw.com'] }, { name: 'Truth Social 原帖', hosts: ['truthsocial.com'] },
  { name: '美国财政部', hosts: ['treasury.gov'] }, { name: '美国商务部', hosts: ['commerce.gov', 'bis.gov'] },
  { name: '欧盟委员会', hosts: ['ec.europa.eu'] },
];
