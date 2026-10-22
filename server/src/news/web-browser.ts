import { Browser, BrowserContext, Page, Response } from 'playwright-core';
import { NewsSourceConfig } from './sources';
import { matchesHost } from './collector';
import { resolvePublicTarget, sourceProxyAgent, SourceFetchError } from './public-network';
import { createBrowserProxy } from './web-proxy';

export interface CrawlerPage {
  context: BrowserContext; page: Page; controller: AbortController;
  status: number; failure?: SourceFetchError; resources: number; responseCheck?: Promise<void>; responsePending: boolean;
  navigationVersion: number; navigating: boolean; lastNavigationAt: number;
}
export function navigationInterrupted(error: unknown) {
  return error instanceof Error && /NS_BINDING_ABORTED|navigation (?:was |is )?interrupted|interrupted by another navigation|Execution context was destroyed|Cannot find context with specified id|(?:page|frame) is navigating/i.test(error.message);
}
export function sourceHosts(source: NewsSourceConfig) { return [new URL(source.target!).hostname.replace(/^www\./, ''), ...source.publisherHosts]; }
export async function createCrawlerPage(browser: Browser, source: NewsSourceConfig, interactive = false, storageState?: Awaited<ReturnType<BrowserContext['storageState']>>): Promise<CrawlerPage> {
  const controller = new AbortController();
  const timeoutMs = source.web!.timeoutSeconds * 1000;
  let session: CrawlerPage | undefined; let pendingOrigin = '';
  const proxy = await createBrowserProxy(controller.signal, Math.min(timeoutMs, 15000), (origin, error) => {
    if (session && pendingOrigin && origin === pendingOrigin) session.failure ||= error;
  }, source.useProxy);
  let context: BrowserContext | undefined;
  try {
    // The SDK initializes window geometry; a second fixed viewport can stall Firefox.
    context = await browser.newContext({ serviceWorkers: 'block', acceptDownloads: false, viewport: null, storageState, proxy: { server: proxy.server } });
    context.on('close', () => controller.abort());
    context.setDefaultNavigationTimeout(timeoutMs); context.setDefaultTimeout(timeoutMs);
    await context.addInitScript(() => {
      for (const key of ['RTCPeerConnection', 'webkitRTCPeerConnection', 'WebTransport']) Object.defineProperty(globalThis, key, { value: undefined, configurable: false });
    });
    await context.routeWebSocket('**/*', socket => socket.close());
    const page = await context.newPage();
    const current: CrawlerPage = { context, page, controller, status: 200, resources: 0, responsePending: false, navigationVersion: 0, navigating: false, lastNavigationAt: Date.now() }; session = current;
    page.on('framenavigated', frame => { if (frame === page.mainFrame()) { current.navigationVersion++; current.navigating = false; current.lastNavigationAt = Date.now(); } });
    page.on('load', () => { current.lastNavigationAt = Date.now(); });
    context.on('page', popup => { if (popup !== page) void popup.close(); });
    page.on('dialog', dialog => { void dialog.dismiss(); });
    page.on('response', response => {
      const request = response.request();
      if (!request.isNavigationRequest() || request.frame() !== page.mainFrame()) return;
      pendingOrigin = ''; current.status = response.status();
      if ([301, 302, 303, 307, 308].includes(current.status)) return;
      if (!interactive) {
        const headers = response.headers();
        if (headers['cf-mitigated'] === 'challenge') current.failure ||= new SourceFetchError('captcha', '页面要求 Cloudflare 浏览器验证，当前不能自动采集', current.status);
        else if ([401, 403].includes(current.status) && headers['x-datadome']) current.failure ||= new SourceFetchError('captcha', '页面要求人机或设备验证，当前不能自动采集', current.status);
        else if ([401, 403].includes(current.status)) current.failure ||= new SourceFetchError('access-denied', `页面访问被拒绝（HTTP ${current.status}）`, current.status);
        else if (current.status === 402) current.failure ||= new SourceFetchError('paywall', '页面要求付费访问', current.status);
        else if (current.status >= 400) current.failure ||= new SourceFetchError('http-error', `页面返回 HTTP ${current.status}`, current.status);
      }
      current.responsePending = true;
      const check: Promise<void> = inspectResponse(response).catch(error => {
        if (!controller.signal.aborted && current.responseCheck === check) {
          if (navigationInterrupted(error)) { current.navigating = true; current.lastNavigationAt = Date.now(); }
          else {
            current.failure = error instanceof SourceFetchError ? error : new SourceFetchError('connection-error', '读取浏览器页面响应失败', response.status());
            if (current.failure.code === 'response-too-large') controller.abort();
          }
        }
      }).finally(() => { if (current.responseCheck === check) current.responsePending = false; });
      current.responseCheck = check;
    });
    await context.route('**/*', async route => {
      const request = route.request(); const main = request.isNavigationRequest() && request.frame() === page.mainFrame();
      if (main && !controller.signal.aborted) { current.failure = undefined; current.responseCheck = undefined; current.responsePending = false; pendingOrigin = new URL(request.url()).origin;
        current.navigationVersion++; current.navigating = true; current.lastNavigationAt = Date.now(); }
      try {
        // Let ordinary page scripts finish a device check; never submit a form or solve a CAPTCHA.
        const methods = !interactive && main ? ['GET', 'HEAD', 'OPTIONS'] : ['GET', 'HEAD', 'OPTIONS', 'POST'];
        if (controller.signal.aborted || (!interactive && current.failure && current.failure.code !== 'captcha') || ++current.resources > (interactive ? 1000 : 200) || !methods.includes(request.method())) { await route.abort(); return; }
        if (main && !matchesHost(request.url(), sourceHosts(source))) throw new SourceFetchError('blocked-domain', '页面导航超出来源允许的域名');
        let depth = 0; let previous = request.redirectedFrom(); while (previous) { depth++; previous = previous.redirectedFrom(); }
        if (depth > 3) throw new SourceFetchError('redirect-limit', '网页重定向超过三次');
        const body = request.postDataBuffer();
        if (body && body.length > 65536) throw new SourceFetchError('request-too-large', '浏览器提交内容超过大小上限');
        await resolvePublicTarget(request.url(), false, sourceProxyAgent(request.url(), false, source.useProxy));
        await route.continue();
      } catch (error) {
        if (main) current.failure = error instanceof SourceFetchError ? error : new SourceFetchError('connection-error', '网页请求未完成');
        if (!controller.signal.aborted) await route.abort().catch(() => {});
      }
    });
    return current;
  } catch (error) { controller.abort(); try { await context?.close(); } finally { await proxy.close(); } throw error; }
}

async function inspectResponse(response: Response) {
  const status = response.status(); const headers = response.headers();
  if (Number(headers['content-length']) > 3_000_000) throw new SourceFetchError('response-too-large', '页面响应超过大小上限', status);
  if (!headers['content-type']?.includes('html')) return;
  const body = await response.body();
  if (body.length > 3_000_000) throw new SourceFetchError('response-too-large', '页面响应超过大小上限', status);
}
