const http = require('node:http');
const https = require('node:https');
const net = require('node:net');
const { PromisedNetSockets } = require('teleproto/extensions');

class TelegramProxyError extends Error {
  constructor(message = '无法连接共享代理，请检查“代理设置”中的地址、端口及代理服务。') { super(message); }
}

function httpProxySocket(proxyUrl) {
  const proxy = new URL(proxyUrl);
  if (!['http:', 'https:'].includes(proxy.protocol)) throw new TelegramProxyError('Telegram 共享代理必须使用 HTTP(S) 地址。');
  return class HttpProxySocket extends PromisedNetSockets {
    // teleproto 1.230.0 exposes a socket factory; reuse its packet buffering over CONNECT.
    async connect(port, ip) {
      this.chunks = []; this.headOffset = 0; this.available = 0;
      this.canRead = new Promise(resolve => { this.resolveRead = resolve; });
      const authority = `${net.isIPv6(ip) ? `[${ip}]` : ip}:${port}`;
      const headers = { Host: authority };
      if (proxy.username || proxy.password) headers['Proxy-Authorization'] = `Basic ${Buffer.from(`${decodeURIComponent(proxy.username)}:${decodeURIComponent(proxy.password)}`).toString('base64')}`;
      let timer;
      try {
        await new Promise((resolve, reject) => {
          const request = (proxy.protocol === 'https:' ? https : http).request({
            hostname: proxy.hostname.replace(/^\[|\]$/g, ''), port: proxy.port || (proxy.protocol === 'https:' ? 443 : 80),
            method: 'CONNECT', path: authority, headers, agent: false,
          });
          this.pendingRequest = request;
          timer = setTimeout(() => request.destroy(new TelegramProxyError('共享代理连接超时，请确认代理正在运行且允许连接 Telegram。')), 30_000);
          request.once('error', error => reject(error instanceof TelegramProxyError ? error : new TelegramProxyError()));
          request.once('close', () => reject(new TelegramProxyError('共享代理连接已结束，请检查代理服务后重新连接。')));
          request.once('connect', (response, socket, head) => {
            if (response.statusCode !== 200 || this.pendingRequest !== request) {
              socket.destroy();
              reject(new TelegramProxyError(response.statusCode === 407 ? '共享代理要求身份认证，请在代理地址中配置有效的用户名和密码。' : `共享代理拒绝 Telegram 隧道连接（HTTP ${response.statusCode}）。`));
              return;
            }
            this.client = socket; this.closed = false;
            socket.setNoDelay(true); socket.setKeepAlive(this.keepAliveInterval > 0, Math.max(0, this.keepAliveInterval));
            socket.on('error', () => socket.destroy());
            socket.once('close', () => { if (this.client === socket) { this.closed = true; this.resolveRead(false); } });
            this.receive();
            if (head.length) socket.unshift(head);
            socket.resume();
            resolve();
          });
          request.end();
        });
      } finally { clearTimeout(timer); this.pendingRequest = undefined; }
      return this;
    }

    async close() { this.pendingRequest?.destroy(); this.pendingRequest = undefined; await super.close(); }
  };
}

module.exports = { httpProxySocket, TelegramProxyError };
