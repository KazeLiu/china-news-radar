import { lookup } from 'node:dns/promises';
import { isIP } from 'node:net';
import http from 'node:http';
import https from 'node:https';
import { brotliDecompressSync, gunzipSync, inflateSync } from 'node:zlib';
import { HttpsProxyAgent } from 'https-proxy-agent';
import { isLocalFeed } from './transports';
import { sourceNetwork } from './source-network';

export class SourceFetchError extends Error {
  constructor(readonly code: string, message: string, readonly status?: number, readonly retryAfter?: string) { super(message); }
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
type Address = { address: string; family: number };
const proxyDns = new Map<string, { expiresAt: number; pending: Promise<Address[]> }>();
let proxyUrl: string | undefined;
let proxyAgent: HttpsProxyAgent<string> | undefined;

export function sourceProxyAgent(raw: string, allowRsshub = false, useProxy?: boolean) {
  // null is an explicit direct connection; undefined retains the shared default.
  if (useProxy === false || allowRsshub && isLocalFeed(raw)) return null;
  const network = sourceNetwork();
  const configured = network.mode === 'proxy' ? network.proxyUrl : '';
  if (!configured) return undefined;
  if (configured !== proxyUrl) {
    try {
      const url = new URL(configured);
      if (!['http:', 'https:'].includes(url.protocol)) throw new Error();
      proxyAgent = new HttpsProxyAgent(url); proxyUrl = configured;
    } catch { throw new SourceFetchError('proxy-config', '来源代理配置无效，请使用 HTTP 或 HTTPS 代理地址'); }
  }
  return proxyAgent;
}

function lookupThroughProxy(hostname: string, agent: HttpsProxyAgent<string>): Promise<Address[]> {
  const key = `${agent.proxy.href}\n${hostname}`;
  const saved = proxyDns.get(key);
  if (saved && saved.expiresAt > Date.now()) return saved.pending;
  if (proxyDns.size >= 256) proxyDns.delete(proxyDns.keys().next().value!);
  const pending = (async () => {
    const signal = AbortSignal.timeout(5000);
    try {
      for (const type of ['A', 'AAAA']) {
        const url = new URL('https://cloudflare-dns.com/dns-query'); url.search = new URLSearchParams({ name: hostname, type }).toString();
        // Bootstrap at a fixed resolver IP; a poisoned local DNS must not select the proxy destination.
        const result = await requestResolved(url, '1.1.1.1', { agent, signal, timeoutMs: 5000, maxBytes: 65536, headers: { Accept: 'application/dns-json' } });
        if (result.status !== 200) throw new Error();
        const answer = JSON.parse(result.body.toString('utf8')) as { Status: number; Answer?: Array<{ type: number; data: string }> };
        if (answer.Status !== 0) throw new Error();
        const addresses = (answer.Answer || []).filter(item => item.type === (type === 'A' ? 1 : 28)).map(item => ({ address: item.data, family: type === 'A' ? 4 : 6 }));
        if (addresses.some(entry => typeof entry.address !== 'string' || isIP(entry.address) !== entry.family)) throw new Error();
        if (addresses.length) return addresses;
      }
      throw new Error();
    } catch { throw new SourceFetchError(signal.aborted ? 'dns-timeout' : 'dns-error', signal.aborted ? '代理安全 DNS 查询超时，请检查来源代理连接' : '代理安全 DNS 查询失败，请检查来源代理和域名'); }
  })().catch(error => { proxyDns.delete(key); throw error; });
  proxyDns.set(key, { expiresAt: Date.now() + 30_000, pending });
  return pending;
}

export async function resolvePublicTarget(raw: string, allowRsshub = false, agent: http.Agent | null | undefined = sourceProxyAgent(raw, allowRsshub)) {
  let url: URL;
  try { url = new URL(raw); } catch { throw new SourceFetchError('invalid-target', '采集目标不是有效地址'); }
  const hostname = url.hostname.replace(/^\[|\]$/g, '');
  const internalFeed = allowRsshub && isLocalFeed(raw);
  if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password || (!internalFeed && (hostname === 'localhost' || hostname.endsWith('.localhost') || hostname.endsWith('.local') || hostname.endsWith('.internal')))) throw new SourceFetchError('blocked-target', '采集目标必须是公开 HTTP(S) 地址');
  let timer: ReturnType<typeof setTimeout> | undefined;
  const addresses = await Promise.race([
    isIP(hostname) ? Promise.resolve([{ address: hostname, family: isIP(hostname) }])
      : agent instanceof HttpsProxyAgent && sourceNetwork().secureDns ? lookupThroughProxy(hostname, agent) : lookup(hostname, { all: true, verbatim: true }),
    new Promise<never>((_, reject) => { timer = setTimeout(() => reject(new SourceFetchError('dns-timeout', '域名解析超时')), 5000); }),
  ]).catch(error => { if (error instanceof SourceFetchError) throw error; throw new SourceFetchError('dns-error', '无法解析来源域名'); }).finally(() => clearTimeout(timer));
  if (!addresses.length || (!internalFeed && addresses.some(entry => !isPublicAddress(entry.address)))) throw new SourceFetchError('blocked-target', '禁止访问内网、回环或保留地址');
  return { url, address: (addresses.find(entry => entry.family === 4) || addresses[0]).address };
}
export interface PublicResponse { status: number; headers: http.IncomingHttpHeaders; body: Buffer; url: string }
interface RequestOptions { method?: string; headers?: Record<string, string>; body?: string | Buffer; timeoutMs?: number; maxBytes?: number; allowRsshub?: boolean; signal?: AbortSignal; followRedirects?: boolean; agent?: http.Agent | null; useProxy?: boolean }
function requestResolved(url: URL, address: string, options: RequestOptions): Promise<PublicResponse> {
  const maxBytes = options.maxBytes ?? 3_000_000;
  return new Promise<PublicResponse>((resolve, reject) => {
    const transport = url.protocol === 'https:' ? https : http;
    // Resolve and validate once, then connect to that address to prevent DNS rebinding.
    const settings: https.RequestOptions = { protocol: url.protocol, hostname: address, servername: url.hostname, port: url.port || (url.protocol === 'https:' ? 443 : 80), path: url.pathname + url.search,
      method: options.method || 'GET', signal: options.signal, agent: options.agent ?? undefined, timeout: options.timeoutMs ?? 15000,
      headers: { 'User-Agent': 'ChinaRadar/1.0', ...options.headers, Host: url.host, 'Accept-Encoding': 'identity' } };
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
    request.setTimeout(options.timeoutMs ?? 15000, () => request.destroy(new SourceFetchError('timeout', '来源请求超时，请检查网络或来源代理配置')));
    const deadline = setTimeout(() => request.destroy(new SourceFetchError('timeout', '来源请求超过总时间上限')), options.timeoutMs ?? 15000);
    request.on('close', () => clearTimeout(deadline));
    request.on('error', error => reject(error instanceof SourceFetchError ? error
      : ['ERR_TLS_CERT_ALTNAME_INVALID', 'CERT_HAS_EXPIRED', 'UNABLE_TO_VERIFY_LEAF_SIGNATURE'].includes((error as NodeJS.ErrnoException).code || '')
        ? new SourceFetchError('tls-error', '来源 TLS 证书校验失败，请检查 DNS、代理或网站证书')
        : new SourceFetchError('connection-error', '无法连接来源，请检查网络与来源代理配置')));
    if (options.body) request.write(options.body);
    request.end();
  });
}
export async function requestPublic(raw: string, options: RequestOptions = {}, redirects = 0, initialOrigin?: string): Promise<PublicResponse> {
  const agent = options.allowRsshub && isLocalFeed(raw) ? null : options.agent !== undefined ? options.agent : sourceProxyAgent(raw, options.allowRsshub, options.useProxy);
  const { url, address } = await resolvePublicTarget(raw, options.allowRsshub, agent);
  const origin = initialOrigin || url.origin;
  const result = await requestResolved(url, address, { ...options, agent, headers: url.origin === origin ? options.headers : {} });
  if (options.followRedirects !== false && [301, 302, 303, 307, 308].includes(result.status) && result.headers.location) {
    if (redirects >= 3) throw new SourceFetchError('redirect-limit', '来源重定向超过三次');
    const next = new URL(result.headers.location, url).href;
    if (new URL(next).origin !== origin && options.body) throw new SourceFetchError('redirect-origin', '跨域重定向不能转发 API 请求内容');
    const changeMethod = result.status === 303 || ((result.status === 301 || result.status === 302) && options.method === 'POST');
    return requestPublic(next, { ...options, ...(changeMethod ? { method: 'GET', body: undefined } : {}) }, redirects + 1, origin);
  }
  return result;
}
