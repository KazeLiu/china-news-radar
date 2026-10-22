import http from 'node:http';
import https from 'node:https';
import net from 'node:net';
import { Duplex } from 'node:stream';
import { requestPublic, resolvePublicTarget, sourceProxyAgent, SourceFetchError } from './public-network';

export async function createBrowserProxy(signal: AbortSignal, timeoutMs: number, onFailure: (origin: string, error: SourceFetchError) => void, useProxy?: boolean) {
  const sockets = new Set<Duplex>();
  const requests = new Set<http.ClientRequest>();
  const failure = (error: unknown) => error instanceof SourceFetchError ? error : new SourceFetchError('connection-error', '浏览器连接未完成，请检查采集网络与来源代理配置');
  const track = (socket: Duplex) => { sockets.add(socket); socket.once('close', () => sockets.delete(socket)); };
  const resolveTarget = async (raw: string, protocol: string) => {
    let url: URL;
    try { url = new URL(raw); } catch { throw new SourceFetchError('blocked-target', '浏览器代理目标无效'); }
    if (url.protocol !== protocol) throw new SourceFetchError('blocked-target', '浏览器代理请求协议无效');
    const agent = sourceProxyAgent(raw, false, useProxy);
    return { ...await resolvePublicTarget(raw, false, agent), agent };
  };
  const report = (origin: string, error: unknown) => { if (!signal.aborted) onFailure(origin, failure(error)); };
  const server = http.createServer(async (req, res) => {
    let origin = '';
    try {
      origin = new URL(req.url!).origin;
      const target = await resolveTarget(req.url!, 'http:');
      if (!['GET', 'HEAD', 'OPTIONS', 'POST'].includes(req.method!)) throw new SourceFetchError('blocked-method', '浏览器请求方法不允许');
      const chunks: Buffer[] = []; let length = 0;
      for await (const chunk of req) {
        length += chunk.length;
        if (length > 65536) throw new SourceFetchError('request-too-large', '浏览器提交内容超过大小上限');
        chunks.push(chunk);
      }
      const headers = Object.fromEntries(Object.entries(req.headers).filter(([key, value]) => value !== undefined && !['host', 'connection', 'content-length', 'accept-encoding', 'proxy-authorization', 'proxy-connection'].includes(key)).map(([key, value]) => [key, Array.isArray(value) ? value.join(', ') : value!]));
      // Plain HTTP keeps the existing bounded forwarding path; HTTPS never passes through it.
      const result = await requestPublic(req.url!, { method: req.method, headers, body: length ? Buffer.concat(chunks) : undefined, signal, timeoutMs, followRedirects: false, agent: target.agent });
      const responseHeaders = Object.fromEntries(Object.entries(result.headers).filter(([key, value]) => value !== undefined && !['content-encoding', 'content-length', 'transfer-encoding', 'connection'].includes(key)));
      res.writeHead(result.status, responseHeaders); res.end(result.body);
    } catch (error) { report(origin, error); if (!res.destroyed) { res.writeHead(502); res.end(); } }
  });
  server.on('connection', socket => {
    track(socket); socket.on('error', () => socket.destroy());
    socket.setTimeout(timeoutMs, () => socket.destroy());
  });
  server.on('connect', async (req, client, head) => {
    let origin = ''; let upstream: Duplex | undefined;
    try {
      origin = new URL(`https://${req.url}`).origin;
      const target = await resolveTarget(`https://${req.url}`, 'https:');
      if (signal.aborted) { client.destroy(); return; }
      const port = Number(target.url.port || 443);
      if (target.agent) {
        const proxy = target.agent.proxy;
        const authority = `${net.isIPv6(target.address) ? `[${target.address}]` : target.address}:${port}`;
        const headers: http.OutgoingHttpHeaders = { Host: authority };
        if (proxy.username || proxy.password) headers['Proxy-Authorization'] = `Basic ${Buffer.from(`${decodeURIComponent(proxy.username)}:${decodeURIComponent(proxy.password)}`).toString('base64')}`;
        upstream = await new Promise<Duplex>((resolve, reject) => {
          const request = (proxy.protocol === 'https:' ? https : http).request({ hostname: proxy.hostname.replace(/^\[|\]$/g, ''), port: proxy.port || (proxy.protocol === 'https:' ? 443 : 80), method: 'CONNECT', path: authority, headers, agent: false, signal });
          requests.add(request); request.once('close', () => requests.delete(request));
          request.setTimeout(timeoutMs, () => request.destroy(new SourceFetchError('timeout', '来源代理连接超时')));
          client.once('close', () => request.destroy());
          request.once('error', reject);
          request.once('connect', (response, socket, buffered) => {
            track(socket); socket.on('error', error => { report(origin, error); client.destroy(); });
            if (response.statusCode !== 200) { socket.destroy(); reject(new SourceFetchError('proxy-error', '来源代理拒绝浏览器连接')); return; }
            if (buffered.length) socket.unshift(buffered);
            resolve(socket);
          });
          request.end();
        });
      } else {
        upstream = await new Promise<Duplex>((resolve, reject) => {
          const socket = net.connect({ host: target.address, port }); track(socket);
          socket.setTimeout(timeoutMs, () => socket.destroy(new SourceFetchError('timeout', '浏览器连接来源超时')));
          socket.once('connect', () => resolve(socket));
          socket.once('close', () => reject(new SourceFetchError('stopped', '浏览器连接已结束')));
          socket.on('error', error => { reject(error); report(origin, error); client.destroy(); });
          client.once('close', () => socket.destroy());
        });
      }
      if (signal.aborted || client.destroyed) { upstream.destroy(); return; }
      upstream.once('close', () => client.destroy()); client.once('close', () => upstream?.destroy());
      client.write('HTTP/1.1 200 Connection Established\r\n\r\n');
      if (head.length) upstream.write(head);
      // Preserve the browser's TLS handshake and HTTP/2 connection; relay only bytes.
      upstream.pipe(client); client.pipe(upstream);
    } catch (error) {
      upstream?.destroy(); report(origin, error);
      if (!client.destroyed) client.end('HTTP/1.1 502 Bad Gateway\r\nContent-Length: 0\r\n\r\n');
    }
  });
  await new Promise<void>((resolve, reject) => { server.once('error', reject); server.listen(0, '127.0.0.1', resolve); });
  server.on('error', error => report('', error));
  let closing: Promise<void> | undefined;
  const close = () => closing ||= new Promise<void>(resolve => {
    requests.forEach(request => request.destroy()); sockets.forEach(socket => socket.destroy()); server.close(() => resolve());
  });
  signal.addEventListener('abort', () => { void close(); }, { once: true });
  return {
    server: `http://127.0.0.1:${(server.address() as net.AddressInfo).port}`,
    close,
  };
}
