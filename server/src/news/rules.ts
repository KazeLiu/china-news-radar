import { createHash } from 'node:crypto';
import { load } from 'cheerio';
import { ORIGINAL_PUBLISHERS, type NewsTopic } from './sources';

const CHINA = /\b(china|chinese|beijing|shanghai|shenzhen|hong kong|taiwan|xinjiang|tibet|xi jinping|li qiang|pboc|renminbi|huawei|alibaba|tencent|byd|smic|deepseek|bytedance)\b|中国|中國|中共|北京|上海|深圳|香港|台湾|臺灣|新疆|西藏|习近平|習近平|人民币|人民幣|华为|華為|阿里巴巴|腾讯|騰訊|比亚迪|比亞迪|字节跳动|字節跳動/i;
const HARD_NEWS = /\b(policy|sanction|tariff|trade|regulat|government|minister|security|attack|arrest|protest|crackdown|export|military|outbreak|evacuat|emergency)\w*\b|\bban(?:s|ned|ning)?\b|政策|制裁|关税|關稅|监管|監管|政府|安全|袭击|襲擊|逮捕|抗议|抗議|禁令|出口|军|軍|疫情|撤离|撤離|紧急|緊急/i;
const SOFT_NEWS = /\b(tennis|football|soccer|basketball|nba|grand slam|china open|shanghai masters|djokovic|hurkacz|medvedev|alcaraz|atp|wta|singer|actress|actor|celebrity|recipe|travel guide|ballet|dancer|memoir|punk|bands?|book review)\b|网球|網球|足球|篮球|籃球|明星|影评|影評|菜谱|菜譜|旅游攻略|旅遊攻略/i;
const OPINION = /\b(opinion|editorial|the guardian view|letters to the editor|podcast|book review)\b|\b(analysis|explainer)\s*:|社论|社論|读者来信|讀者來信/i;

export function plainText(html: string): string {
  const $ = load(html || '');
  $('script, style, iframe').remove();
  return $.text().replace(/\s+/g, ' ').trim();
}

export function distinctSummary(title: string, summary: string): string {
  const clean = plainText(summary);
  const comparable = (text: string) => text.normalize('NFKC').replace(/[\p{P}\p{S}\s]/gu, '').toLowerCase();
  const heading = plainText(title);
  const left = comparable(heading); const right = comparable(clean);
  const numbers = (text: string) => JSON.stringify(text.normalize('NFKC').match(/\p{N}+(?:[.,]\p{N}+)*/gu));
  if (numbers(heading) !== numbers(clean)) return clean;
  if (!right || left === right) return '';
  // Keep short excerpts and changed numbers; only discard very close textual copies.
  const limit = Math.floor(Math.max(left.length, right.length) * 0.03);
  if (Math.min(left.length, right.length) < 40 || Math.abs(left.length - right.length) > limit) return clean;
  let previous = Array.from({ length: right.length + 1 }, (_, index) => index);
  for (let row = 1; row <= left.length; row++) {
    const current = new Array<number>(right.length + 1).fill(limit + 1); current[0] = row;
    for (let column = Math.max(1, row - limit); column <= Math.min(right.length, row + limit); column++) {
      current[column] = Math.min(previous[column] + 1, current[column - 1] + 1, previous[column - 1] + Number(left[row - 1] !== right[column - 1]));
    }
    if (Math.min(...current) > limit) return clean;
    previous = current;
  }
  return previous[right.length] <= limit ? '' : clean;
}

export function relevantToChina(title: string, summary = '', forceChina = false): boolean {
  const text = `${title} ${summary}`;
  return (forceChina || CHINA.test(text)) && !OPINION.test(title) && !/check out .*stock price|stock quote|stock price .*in real time/i.test(title) && !(SOFT_NEWS.test(title) && !HARD_NEWS.test(text));
}

export function shouldDisplay(title: string, summary: string, url: string, forceChina = false) {
  if (!relevantToChina(title, summary, forceChina)) return false;
  try {
    const path = new URL(url).pathname;
    if (/\/(commentisfree|long-read|opinion|editorials)\//i.test(path)) return false;
    if (/\/(books|culture|travel|sport|lifeandstyle|food|film|music|fashion|artanddesign)\//i.test(path) && !HARD_NEWS.test(title)) return false;
    return true;
  } catch { return false; }
}

export function topicFor(text: string): NewsTopic {
  if (/\b(chips?|semiconductors?|ai|technology|huawei|nvidia|tiktok|bytedance|cyber\w*)\b|芯片|半导体|半導體|人工智能|科技|网络攻击|網絡攻擊/i.test(text)) return 'technology';
  if (/\b(military|missile|attack|outbreak|lockdown|earthquake|flood|evacuat|police|arrest|spy|defence|defense|drill|destabilis|destabiliz|provocation)\w*\b|军|軍|导弹|導彈|袭击|襲擊|疫情|封城|地震|洪水|撤离|撤離|警察|逮捕|间谍|間諜/i.test(text)) return 'security';
  if (/\b(tariff|trade|economy|economic|bank|yuan|renminbi|stock|market|property|export|import|inflation|debt|finance)\w*\b|关税|關稅|贸易|貿易|经济|經濟|银行|銀行|地产|地產|出口|进口|進口|债务|債務|金融/i.test(text)) return 'economy';
  if (/\b(diploma|summit|ambassador|embassy|sanction|foreign minister|treaty|bilateral)\w*\b|外交|峰会|峰會|大使|使馆|使館|制裁|条约|條約|双边|雙邊/i.test(text)) return 'diplomacy';
  if (/\b(policy|regulat|government|minister|law|party|parliament)\w*\b|\bban(?:s|ned|ning)?\b|政策|监管|監管|政府|部长|部長|禁令|法规|法規|中共/i.test(text)) return 'policy';
  return 'society';
}

export function canonicalUrl(raw: string): string | null {
  try {
    const url = new URL(raw);
    if (!['https:', 'http:'].includes(url.protocol) || url.username || url.password) return null;
    url.hash = '';
    [...url.searchParams.keys()].filter(k => /^(utm_|fbclid$|gclid$|ref$)/i.test(k)).forEach(k => url.searchParams.delete(k));
    url.searchParams.sort();
    return url.toString();
  } catch { return null; }
}

export function publisherForUrl(raw: string): string | null {
  try {
    const host = new URL(raw).hostname.toLowerCase();
    return ORIGINAL_PUBLISHERS.find(p => p.hosts.some(h => host === h || host.endsWith(`.${h}`)))?.name || null;
  } catch { return null; }
}

export function isDomesticUrl(raw: string): boolean {
  try {
    if (publisherForUrl(raw)) return false;
    const host = new URL(raw).hostname;
    return /(^|\.)(qq\.com|weibo\.com|sina\.com|sina\.com\.cn|ithome\.com|cls\.cn|xinhuanet\.com|people\.com\.cn|mofcom\.gov\.cn|ifeng\.com|36kr\.com|163\.com|baidu\.com|zhihu\.com|bilibili\.com|douyin\.com|toutiao\.com)$|\.cn$/i.test(host);
  } catch { return false; }
}

export function eventKey(title: string): string {
  const normalized = title.normalize('NFKC').toLowerCase().replace(/\s*[-–—|]\s*(reuters|associated press|ap news|bloomberg(?:\.com)?|cnbc|bbc news|nikkei asia|the guardian)\s*$/i, '').replace(/[^\p{L}\p{N}]+/gu, ' ').trim();
  return createHash('sha256').update(normalized).digest('hex').slice(0, 24);
}

export function safePublishedAt(value: unknown, now = new Date()): Date | null {
  if (typeof value !== 'string' && !(value instanceof Date)) return null;
  const date = new Date(value);
  if (!Number.isFinite(date.getTime()) || date.getTime() > now.getTime() + 5 * 60_000) return null;
  return date;
}

export function withinNewsWindow(date: Date | null, now = new Date()): boolean {
  return !date || date.getTime() >= now.getTime() - 7 * 86_400_000;
}

export function retryAfterMs(value: unknown, now = Date.now()): number {
  const seconds = Number(value);
  const duration = value != null && Number.isFinite(seconds) ? seconds * 1000 : Date.parse(String(value)) - now;
  return Math.max(60_000, Math.min(Number.isFinite(duration) ? duration : 300_000, 86_400_000));
}
