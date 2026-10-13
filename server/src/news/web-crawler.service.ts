import { Injectable, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { Browser, chromium } from 'playwright-core';
import { NewsSourceConfig } from './sources';
import { SourceAdapterService, CollectionResult, inspectRecords } from './source-adapter.service';
import { FilterRule } from './content-filter';
import { matchesHost } from './collector';
import { requestPublic, resolvePublicTarget, SourceFetchError } from './public-network';
import { checkPageAccess, clippedPageFragment, extractPage } from './web-parser';
@Injectable()
export class WebCrawlerService implements OnModuleInit, OnModuleDestroy {
  private browser?: Promise<Browser>;
  private activeLimits: number[] = [];
  private waiting: Array<() => void> = [];
  private stopped = false;
  constructor(private readonly adapters: SourceAdapterService) {}
  onModuleInit() { this.adapters.registerWeb((source, rules) => this.collect(source, rules)); }
  async onModuleDestroy() { this.stopped = true; this.waiting.splice(0).forEach(wake => wake()); if (this.browser) await (await this.browser).close(); }
  private getBrowser() {
    if (!this.browser) {
      const env = Object.fromEntries(['PATH', 'HOME', 'USERPROFILE', 'SystemRoot', 'TEMP', 'TMP', 'LANG', 'APPDATA', 'LOCALAPPDATA', 'XDG_RUNTIME_DIR', 'DISPLAY'].flatMap(key => process.env[key] ? [[key, process.env[key]!]] : []));
      this.browser = chromium.launch({ headless: true, executablePath: process.env.CHROMIUM_EXECUTABLE_PATH || undefined, chromiumSandbox: true, env,
        args: ['--disable-quic', '--disable-background-networking', '--disable-extensions', '--force-webrtc-ip-handling-policy=disable_non_proxied_udp'] }).then(browser => {
          browser.on('disconnected', () => { this.browser = undefined; }); return browser;
        }).catch(() => { this.browser = undefined; throw new SourceFetchError('browser-unavailable', 'Chromium 启动失败，请检查浏览器安装和系统依赖'); });
    }
    return this.browser;
  }
  async collect(source: NewsSourceConfig, rules: FilterRule[], fragmentOnly = false): Promise<CollectionResult> {
    const limit = source.web!.concurrency;
    while (!this.stopped && this.activeLimits.length >= Math.min(limit, ...this.activeLimits)) await new Promise<void>(resolve => this.waiting.push(resolve));
    if (this.stopped) throw new SourceFetchError('stopped', '网页采集正在停止');
    this.activeLimits.push(limit);
    const controller = new AbortController();
    let context: Awaited<ReturnType<Browser['newContext']>> | undefined;
    let deadline: ReturnType<typeof setTimeout> | undefined;
    try {
      await resolvePublicTarget(source.target!);
      const browser = await this.getBrowser();
      context = await browser.newContext({ serviceWorkers: 'block', acceptDownloads: false, viewport: { width: 1280, height: 800 } });
      const timeoutMs = source.web!.timeoutSeconds * 1000;
      context.setDefaultNavigationTimeout(timeoutMs); context.setDefaultTimeout(timeoutMs);
      await context.addInitScript(() => {
        for (const key of ['RTCPeerConnection', 'webkitRTCPeerConnection', 'WebTransport']) Object.defineProperty(globalThis, key, { value: undefined, configurable: false });
      });
      await context.routeWebSocket('**/*', socket => socket.close());
      let resourceCount = 0; let mainStatus = 200; let mainFailure: SourceFetchError | undefined;
      const allowedHosts = [new URL(source.target!).hostname.replace(/^www\./, ''), ...source.publisherHosts];
      await context.route('**/*', async route => {
        const request = route.request(); const main = request.isNavigationRequest() && request.frame().parentFrame() === null;
        try {
          if (++resourceCount > 200 || !['GET', 'HEAD', 'OPTIONS'].includes(request.method())) { await route.abort(); return; }
          if (main && !matchesHost(request.url(), allowedHosts)) throw new SourceFetchError('blocked-domain', '页面导航超出来源允许的域名');
          let depth = 0; let previous = request.redirectedFrom(); while (previous) { depth++; previous = previous.redirectedFrom(); }
          if (depth > 3) throw new SourceFetchError('redirect-limit', '网页重定向超过三次');
          const headers = await request.allHeaders();
          for (const name of ['host', 'connection', 'content-length', 'accept-encoding']) delete headers[name];
          const result = await requestPublic(request.url(), { method: request.method(), headers, signal: controller.signal, timeoutMs: Math.min(timeoutMs, 15000), followRedirects: false });
          if (main) mainStatus = result.status;
          const responseHeaders = Object.fromEntries(Object.entries(result.headers).filter(([key, value]) => value !== undefined && !['content-encoding', 'content-length', 'transfer-encoding', 'connection', 'set-cookie'].includes(key)).map(([key, value]) => [key, Array.isArray(value) ? value.join(', ') : String(value)]));
          await route.fulfill({ status: result.status, headers: responseHeaders, body: result.body });
        } catch (error) {
          if (main) mainFailure = error instanceof SourceFetchError ? error : new SourceFetchError('connection-error', '网页请求未完成');
          if (!controller.signal.aborted) await route.abort();
        }
      });
      const page = await context.newPage();
      context.on('page', popup => { if (popup !== page) void popup.close(); });
      let target: string | undefined = source.target!; const visited = new Set<string>(); let result: CollectionResult | undefined;
      let pageFragment = '';
      for (let number = 0; target && number < (fragmentOnly ? 1 : source.web!.maxPages); number++) {
        if (!matchesHost(target, allowedHosts)) throw new SourceFetchError('blocked-domain', '翻页链接超出来源域名');
        deadline = setTimeout(() => { controller.abort(); void context?.close().catch(() => console.warn('网页超时上下文关闭失败')); }, timeoutMs);
        if (visited.has(target)) break; visited.add(target); mainFailure = undefined; resourceCount = 0;
        try { await page.goto(target, { waitUntil: 'domcontentloaded' }); }
        catch { throw mainFailure || new SourceFetchError('page-timeout', '页面未能在时间上限内加载'); }
        if (mainFailure) throw mainFailure;
        if ([401, 403].includes(mainStatus)) throw new SourceFetchError('access-denied', `页面访问被拒绝（HTTP ${mainStatus}）`, mainStatus);
        if (mainStatus === 402) throw new SourceFetchError('paywall', '页面要求付费访问', mainStatus);
        if (mainStatus >= 400) throw new SourceFetchError('http-error', `页面返回 HTTP ${mainStatus}`, mainStatus);
        const html = await page.content(); if (html.length > 3_000_000) throw new SourceFetchError('response-too-large', '页面超过解析大小上限');
        clearTimeout(deadline);
        pageFragment ||= clippedPageFragment(html);
        if (fragmentOnly) { checkPageAccess(html); return { ...inspectRecords([], source, rules), pageFragment, structure: { fragmentLength: pageFragment.length }, status: mainStatus }; }
        const extracted = extractPage(html, page.url(), source.web!.rules, source.web!.maxItems);
        const inspected = inspectRecords(extracted.records, source, rules, { rules: source.web!.rules, matched: extracted.records.length, counts: extracted.counts, checkedAt: new Date().toISOString(), pages: number + 1, empty: extracted.empty }, page.url());
        result = result ? { ...inspected, items: [...result.items, ...inspected.items], samples: [...result.samples, ...inspected.samples], rawCount: result.rawCount + inspected.rawCount, checkedCount: result.checkedCount + inspected.checkedCount } : inspected;
        if (result.items.length >= source.web!.maxItems) break;
        target = extracted.next; await resolvePublicTarget(target || page.url());
      }
      const output = result!;
      output.items = [...new Map(output.items.map(item => [item.url, item])).values()].slice(0, source.web!.maxItems);
      return { ...output, pageFragment, status: mainStatus };
    } catch (error) {
      if (error instanceof SourceFetchError) throw error;
      throw new SourceFetchError(controller.signal.aborted ? 'page-timeout' : 'browser-error', controller.signal.aborted ? '页面处理超过时间上限，已关闭上下文' : '浏览器页面处理失败，请核对浏览器依赖和来源配置');
    } finally {
      clearTimeout(deadline); controller.abort();
      try { if (context) await context.close(); }
      finally { this.activeLimits.splice(this.activeLimits.indexOf(limit), 1); this.waiting.splice(0).forEach(wake => wake()); }
    }
  }
}
