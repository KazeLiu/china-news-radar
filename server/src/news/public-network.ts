import { lookup } from 'node:dns/promises';
import { isIP } from 'node:net';
import http from 'node:http';
import https from 'node:https';
import { brotliDecompressSync, gunzipSync, inflateSync } from 'node:zlib';
import { isLocalFeed } from './transports';

export class SourceFetchError extends Error {
  constructor(readonly code: string, message: string, readonly status?: number) { super(message); }
}
export function isPublicAddress(address: string) {
  if (isIP(address) === 4) {
    const [a, b, c] = address.split('.').map(Number);
    return !(a === 0 || a === 10 || a === 127 || a >= 224 || (a === 100 && b >= 64 && b <= 127) || (a === 169 && b === 254) || (a === 172 && b >= 16 && b <= 31)
      || (a === 192 && (b === 168 || b === 0 || (b === 88 && c === 99))) || (a === 198 && (b === 18 || b === 19 || (b === 51 && c === 100))) || (a === 203 && b === 0 && c === 113));
  }
  if (isIP(address) === 6) return /^[23][0-9a-f]{3}:/i.test(address) && !/^(2001:(db8:|0{0,4}:)|2002:)/i.test(address);
  return false;
}
export async function resolvePublicTarget(raw: string, allowRsshub = false) {
  let url: URL;
  try { url = new URL(raw); } catch { throw new SourceFetchError('invalid-target', '采集目标不是有效地址'); }
  const hostname = url.hostname.replace(/^\[|\]$/g, '');
  if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password || hostname.endsWith('.local') || hostname.endsWith('.internal')) throw new SourceFetchError('blocked-target', '采集目标必须是公开 HTTP(S) 地址');
  let timer: ReturnType<typeof setTimeout> | undefined;
  const addresses = await Promise.race([
    lookup(hostname, { all: true, verbatim: true }),
    new Promise<never>((_, reject) => { timer = setTimeout(() => reject(new SourceFetchError('dns-timeout', '域名解析超时')), 5000); }),
  ]).catch(error => { if (error instanceof SourceFetchError) throw error; throw new SourceFetchError('dns-error', '无法解析来源域名'); }).finally(() => clearTimeout(timer));
  if (!addresses.length || (!(allowRsshub && isLocalFeed(raw)) && addresses.some(entry => !isPublicAddress(entry.address)))) throw new SourceFetchError('blocked-target', '禁止访问内网、回环或保留地址');
  return { url, address: addresses[0].address };
}
export interface PublicResponse { status: number; headers: http.IncomingHttpHeaders; body: Buffer; url: string }
export async function requestPublic(raw: string, options: { method?: string; headers?: Record<string, string>; body?: string | Buffer; timeoutMs?: number; maxBytes?: number; allowRsshub?: boolean; signal?: AbortSignal } = {}, redirects = 0, initialOrigin?: string): Promise<PublicResponse> {
  const { url, address } = await resolvePublicTarget(raw, options.allowRsshub);
  const origin = initialOrigin || url.origin;
  const maxBytes = options.maxBytes ?? 3_000_000;
  const headers = url.origin === origin ? options.headers || {} : {};
  const result = await new Promise<PublicResponse>((resolve, reject) => {
    const transport = url.protocol === 'https:' ? https : http;
    // Resolve and validate once, then connect to that address to prevent DNS rebinding.
    const settings: https.RequestOptions = { protocol: url.protocol, hostname: address, servername: url.hostname, port: url.port || (url.protocol === 'https:' ? 443 : 80), path: url.pathname + url.search,
      method: options.method || 'GET', signal: options.signal, headers: { ...headers, Host: url.host, 'Accept-Encoding': 'identity', 'User-Agent': 'ChinaRadar/1.0' } };
    const request = transport.request(settings, response => {
      const chunks: Buffer[] = []; let length = 0;
      response.on('data', chunk => { length += chunk.length; if (length > maxBytes) request.destroy(new SourceFetchError('response-too-large', '来源响应超过大小上限')); else chunks.push(chunk); });
      response.on('error', () => reject(new SourceFetchError('connection-error', '读取来源响应失败')));
      response.on('end', () => {
        try {
          let body = Buffer.concat(chunks);
          const encoding = response.headers['content-encoding'];
          if (encoding === 'gzip') body = gunzipSync(body, { maxOutputLength: maxBytes });
          else if (encoding === 'br') body = brotliDecompressSync(body, { maxOutputLength: maxBytes });
          else if (encoding === 'deflate') body = inflateSync(body, { maxOutputLength: maxBytes });
          resolve({ status: response.statusCode || 0, headers: response.headers, body, url: url.href });
        } catch { reject(new SourceFetchError('decode-error', '来源响应无法解码或超过大小上限')); }
      });
    });
    request.setTimeout(options.timeoutMs ?? 15000, () => request.destroy(new SourceFetchError('timeout', '来源请求超时')));
    const deadline = setTimeout(() => request.destroy(new SourceFetchError('timeout', '来源请求超过总时间上限')), options.timeoutMs ?? 15000);
    request.on('close', () => clearTimeout(deadline));
    request.on('error', error => reject(error instanceof SourceFetchError ? error : new SourceFetchError('connection-error', '无法连接来源，或连接被中断')));
    if (options.body) request.write(options.body);
    request.end();
  });
  if ([301, 302, 303, 307, 308].includes(result.status) && result.headers.location) {
    if (redirects >= 3) throw new SourceFetchError('redirect-limit', '来源重定向超过三次');
    const next = new URL(result.headers.location, url).href;
    if (new URL(next).origin !== origin && options.body) throw new SourceFetchError('redirect-origin', '跨域重定向不能转发 API 请求内容');
    const changeMethod = result.status === 303 || ((result.status === 301 || result.status === 302) && options.method === 'POST');
    return requestPublic(next, { ...options, ...(changeMethod ? { method: 'GET', body: undefined } : {}) }, redirects + 1, origin);
  }
  return result;
}
