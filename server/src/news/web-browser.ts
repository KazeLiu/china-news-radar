import { Browser, BrowserContext, Page } from 'playwright-core';
import { NewsSourceConfig } from './sources';
import { matchesHost } from './collector';
import { requestPublic, SourceFetchError } from './public-network';
import { checkPageAccess } from './web-parser';

export interface CrawlerPage {
  context: BrowserContext; page: Page; controller: AbortController;
  status: number; failure?: SourceFetchError; resources: number;
}
export function sourceHosts(source: NewsSourceConfig) { return [new URL(source.target!).hostname.replace(/^www\./, ''), ...source.publisherHosts]; }
export async function createCrawlerPage(browser: Browser, source: NewsSourceConfig, interactive = false, storageState?: Awaited<ReturnType<BrowserContext['storageState']>>): Promise<CrawlerPage> {
  const context = await browser.newContext({ serviceWorkers: 'block', acceptDownloads: false, viewport: { width: 1280, height: 800 }, storageState });
  const controller = new AbortController();
  try {
    const timeoutMs = source.web!.timeoutSeconds * 1000;
    context.setDefaultNavigationTimeout(timeoutMs); context.setDefaultTimeout(timeoutMs);
    await context.addInitScript(() => {
      for (const key of ['RTCPeerConnection', 'webkitRTCPeerConnection', 'WebTransport']) Object.defineProperty(globalThis, key, { value: undefined, configurable: false });
    });
    await context.routeWebSocket('**/*', socket => socket.close());
    const page = await context.newPage();
    const session: CrawlerPage = { context, page, controller, status: 200, resources: 0 };
    context.on('page', popup => { if (popup !== page) void popup.close(); });
    page.on('dialog', dialog => { void dialog.dismiss(); });
    await context.route('**/*', async route => {
      const request = route.request(); const main = request.isNavigationRequest() && request.frame() === page.mainFrame();
      if (main) session.failure = undefined;
      try {
        if (++session.resources > (interactive ? 1000 : 200) || !(interactive ? ['GET', 'HEAD', 'OPTIONS', 'POST'] : ['GET', 'HEAD', 'OPTIONS']).includes(request.method())) { await route.abort(); return; }
        if (main && !matchesHost(request.url(), sourceHosts(source))) throw new SourceFetchError('blocked-domain', '页面导航超出来源允许的域名');
        let depth = 0; let previous = request.redirectedFrom(); while (previous) { depth++; previous = previous.redirectedFrom(); }
        if (depth > 3) throw new SourceFetchError('redirect-limit', '网页重定向超过三次');
        const body = request.postDataBuffer();
        if (body && body.length > 65536) throw new SourceFetchError('request-too-large', '浏览器提交内容超过大小上限');
        const headers = await request.allHeaders();
        for (const name of ['host', 'connection', 'content-length', 'accept-encoding']) delete headers[name];
        const result = await requestPublic(request.url(), { method: request.method(), headers, body: body || undefined, signal: controller.signal, timeoutMs: Math.min(timeoutMs, 15000), followRedirects: false });
        if (main) {
          session.status = result.status;
          if (!interactive) {
            if (result.headers['content-type']?.includes('html')) {
              try { checkPageAccess(result.body.toString('utf8')); }
              catch (error) { if (error instanceof SourceFetchError) throw new SourceFetchError(error.code, error.message, result.status); throw error; }
            }
            if ([401, 403].includes(result.status)) throw new SourceFetchError('access-denied', `页面访问被拒绝（HTTP ${result.status}）`, result.status);
            if (result.status === 402) throw new SourceFetchError('paywall', '页面要求付费访问', result.status);
            if (result.status >= 400) throw new SourceFetchError('http-error', `页面返回 HTTP ${result.status}`, result.status);
          }
        }
        const responseHeaders = Object.fromEntries(Object.entries(result.headers).filter(([key, value]) => value !== undefined && !['content-encoding', 'content-length', 'transfer-encoding', 'connection'].includes(key)).map(([key, value]) => [key, Array.isArray(value) ? value.join(key === 'set-cookie' ? '\n' : ', ') : String(value)]));
        await route.fulfill({ status: result.status, headers: responseHeaders, body: result.body });
      } catch (error) {
        if (main) session.failure = error instanceof SourceFetchError ? error : new SourceFetchError('connection-error', '网页请求未完成');
        if (!controller.signal.aborted) await route.abort().catch(() => {});
      }
    });
    return session;
  } catch (error) { controller.abort(); await context.close(); throw error; }
}
