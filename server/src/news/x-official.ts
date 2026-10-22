import { requestPublic, SourceFetchError } from './public-network';
import { xUsername } from './sources';
import type { ScrapedRecord } from './source-adapter.service';

const API_BASE = 'https://api.x.com/2';
const MAX_POSTS = 20;
type JsonObject = Record<string, unknown>;
function isObject(value: unknown): value is JsonObject { return !!value && typeof value === 'object' && !Array.isArray(value); }

function apiError(status: number, phase: string): SourceFetchError {
  const messages: Record<number, [string, string]> = {
    400: ['invalid-request', 'X 官方 API 拒绝了请求参数，请检查接口版本与账号配置'],
    401: ['invalid-auth', 'X 官方 API 鉴权失败，请填写该平台的有效 Bearer Token，不是 Client ID、Client Secret 或 TwitterAPI.io Key'],
    402: ['credits-required', 'X 官方 API 需要可用额度，请检查开发者控制台的余额与用量'],
    403: ['access-denied', 'X 官方 API 拒绝访问，请检查应用读取权限、接口访问资格及目标账号是否公开'],
    404: ['account-not-found', 'X 官方 API 未找到账号或资源，请核对公开用户名'],
    429: ['rate-limited', 'X 官方 API 已限流或达到用量上限，请检查开发者控制台，稍后再试'],
  };
  const [code, message] = messages[status] || ['http-error', `X 官方 API 返回 HTTP ${status}`];
  return new SourceFetchError(code, `${phase}：${message}`, status);
}

async function requestX(path: string, token: string, phase: string, useProxy?: boolean): Promise<JsonObject> {
  const response = await requestPublic(`${API_BASE}${path}`, {
    method: 'GET', headers: { Accept: 'application/json', Authorization: `Bearer ${token}` },
    followRedirects: false, useProxy,
  });
  if (response.status < 200 || response.status >= 300) throw apiError(response.status, phase);
  let json: unknown;
  try { json = JSON.parse(response.body.toString('utf8')); }
  catch { throw new SourceFetchError('invalid-structure', `${phase}：X 官方 API 未返回有效 JSON`, response.status); }
  if (!isObject(json)) throw new SourceFetchError('invalid-structure', `${phase}：X 官方 API 响应不是对象`, response.status);
  return json;
}

export async function collectXAccount(target: string, token: string, useProxy?: boolean): Promise<{ records: ScrapedRecord[]; structure: JsonObject }> {
  const username = xUsername(target);
  if (!username) throw new SourceFetchError('invalid-target', '请填写 X 公开用户名（如 USA_China_Talk）、@用户名或账号主页地址');
  if (!token || token === 'placeholder' || token.startsWith('your_')) throw new SourceFetchError('missing-auth', '请填写 X 官方开发者平台的 Bearer Token');
  const lookup = await requestX(`/users/by/username/${username}`, token, '查询账号', useProxy);
  const user = lookup.data;
  if (!isObject(user) || typeof user.id !== 'string' || !/^\d{1,19}$/.test(user.id)) {
    throw new SourceFetchError('account-not-found', 'X 官方 API 未返回有效账号，请核对用户名、账号状态和读取权限');
  }
  const query = new URLSearchParams({ max_results: String(MAX_POSTS), 'post.fields': 'created_at,attachments,note_post',
    expansions: 'attachments.media_keys', 'media.fields': 'media_key,type,url,preview_image_url' });
  const timeline = await requestX(`/users/${user.id}/tweets?${query}`, token, '读取账号动态', useProxy);
  const list = timeline.data;
  const hasErrors = Array.isArray(timeline.errors) && timeline.errors.length > 0;
  if (list === undefined && isObject(timeline.meta) && timeline.meta.result_count === 0 && !hasErrors) {
    return { records: [], structure: { adapter: 'x-official', username, count: 0, maxPosts: MAX_POSTS } };
  }
  if (!Array.isArray(list) || (!list.length && hasErrors)) {
    throw new SourceFetchError('invalid-structure', 'X 官方 API 未返回动态列表，请检查账号状态和接口权限');
  }
  const media = new Map<string, string>();
  const included = isObject(timeline.includes) ? timeline.includes.media : undefined;
  if (Array.isArray(included)) for (const item of included) {
    if (!isObject(item) || typeof item.media_key !== 'string') continue;
    const image = item.type === 'photo' ? item.url : item.preview_image_url;
    if (typeof image === 'string') media.set(item.media_key, image);
  }
  const records = list.slice(0, MAX_POSTS).map((post): ScrapedRecord => {
    if (!isObject(post) || typeof post.id !== 'string' || !/^\d{1,19}$/.test(post.id) || typeof post.text !== 'string') {
      throw new SourceFetchError('invalid-structure', 'X 官方 API 的动态缺少有效 ID 或正文');
    }
    const body = isObject(post.note_post) && typeof post.note_post.text === 'string' ? post.note_post.text : post.text;
    const keys = isObject(post.attachments) && Array.isArray(post.attachments.media_keys) ? post.attachments.media_keys : [];
    return { sourceTitlePresent: false, body, summary: body, url: `https://x.com/${username}/status/${post.id}`,
      publishedAt: post.created_at, author: typeof user.name === 'string' ? user.name : username,
      images: keys.flatMap(key => typeof key === 'string' && media.has(key) ? [media.get(key)!] : []) };
  });
  return { records, structure: { adapter: 'x-official', username, count: records.length, maxPosts: MAX_POSTS } };
}
