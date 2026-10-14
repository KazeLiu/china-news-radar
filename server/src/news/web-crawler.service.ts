import { Injectable, OnModuleDestroy, OnModuleInit, BadRequestException, ConflictException, NotFoundException } from '@nestjs/common';
import { Browser, BrowserContext, errors } from 'playwright-core';
import { Camoufox, findInstalledVersion } from 'camoufox';
import { access } from 'node:fs/promises';
import { join } from 'node:path';
import { NewsSourceConfig } from './sources';
import { SourceAdapterService, CollectionResult, inspectRecords } from './source-adapter.service';
import { FilterRule } from './content-filter';
import { matchesHost } from './collector';
import { resolvePublicTarget, SourceFetchError } from './public-network';
import { checkPageAccess, clippedPageFragment, extractPage } from './web-parser';
import { createCrawlerPage, sourceHosts, CrawlerPage } from './web-browser';
import { randomUUID } from 'node:crypto';

type StorageState = Awaited<ReturnType<BrowserContext['storageState']>>;
interface Verification extends CrawlerPage { id: string; owner: string; source: NewsSourceConfig; expiresAt: number; timer: ReturnType<typeof setTimeout>; loading: boolean; busy: boolean; error?: string }
@Injectable()
export class WebCrawlerService implements OnModuleInit, OnModuleDestroy {
  private browser?: Promise<Browser>;
  private activeLimits: number[] = [];
  private waiting: Array<() => void> = [];
  private stopped = false;
  private verification?: Verification;
  private verificationOpening = false;
  private browserRevision = 0;
  private verified = new Map<string, { state: StorageState; timer: ReturnType<typeof setTimeout> }>();
  constructor(private readonly adapters: SourceAdapterService) {}
  onModuleInit() { this.adapters.registerWeb((source, rules) => this.collect(source, rules)); }
  async onModuleDestroy() { this.stopped = true; this.waiting.splice(0).forEach(wake => wake()); await this.clearVerification(); if (this.browser) await (await this.browser).close(); }
  private getBrowser() {
    if (!this.browser) {
      const env = Object.fromEntries(['PATH', 'HOME', 'USERPROFILE', 'SystemRoot', 'TEMP', 'TMP', 'LANG', 'APPDATA', 'LOCALAPPDATA', 'XDG_RUNTIME_DIR', 'DISPLAY'].flatMap(key => process.env[key] ? [[key, process.env[key]!]] : []));
      this.browser = (async () => {
        const installed = await findInstalledVersion('official/156.0.1-beta.36');
        const executablePath = process.env.CAMOUFOX_EXECUTABLE_PATH || (installed ? join(installed, process.platform === 'win32' ? 'camoufox.exe' : 'camoufox-bin') : '');
        if (!executablePath) throw new Error('Camoufox not installed');
        await access(executablePath);
        // Supply launch options directly: replace only the engine, without identity spoofing,
        // model/addon downloads or inherited credentials. The dead-end proxy blocks
        // background traffic; routed page requests still use requestPublic and its proxy.
        return Camoufox({ from_options: { headless: true, executablePath, env,
          proxy: { server: 'http://127.0.0.1:9' },
          firefoxUserPrefs: { 'media.peerconnection.enabled': false, 'network.http.http3.enable': false,
            'network.prefetch-next': false, 'network.dns.disablePrefetch': true, 'network.http.speculative-parallel-limit': 0,
            'network.captive-portal-service.enabled': false, 'network.connectivity-service.enabled': false } } });
      })().then(browser => {
          browser.on('disconnected', () => { this.browser = undefined; }); return browser;
        }).catch(() => { this.browser = undefined; throw new SourceFetchError('browser-unavailable', 'Camoufox 启动失败，请安装项目固定浏览器包并检查系统依赖；不会回退到 Chromium'); });
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
      const saved = this.verified.get(this.sourceKey(source));
      const session = await createCrawlerPage(browser, source, false, saved?.state);
      context = session.context;
      const timeoutMs = source.web!.timeoutSeconds * 1000;
      const { page } = session; const allowedHosts = sourceHosts(source);
      controller.signal.addEventListener('abort', () => session.controller.abort(), { once: true });
      let target: string | undefined = source.target!; const visited = new Set<string>(); let result: CollectionResult | undefined;
      let pageFragment = '';
      for (let number = 0; target && number < (fragmentOnly ? 1 : source.web!.maxPages); number++) {
        if (!matchesHost(target, allowedHosts)) throw new SourceFetchError('blocked-domain', '翻页链接超出来源域名');
        deadline = setTimeout(() => { controller.abort(); void context?.close().catch(() => console.warn('网页超时上下文关闭失败')); }, timeoutMs);
        if (visited.has(target)) break; visited.add(target); session.failure = undefined; session.resources = 0;
        try { await page.goto(target, { waitUntil: 'domcontentloaded' }); }
        catch (error) { throw session.failure || (controller.signal.aborted || error instanceof errors.TimeoutError
          ? new SourceFetchError('page-timeout', '页面未能在时间上限内加载') : new SourceFetchError('navigation-error', '浏览器页面导航失败，请检查目标地址与网站访问限制')); }
        if (session.failure) throw session.failure;
        let html = await page.content(); if (html.length > 3_000_000) throw new SourceFetchError('response-too-large', '页面超过解析大小上限');
        let extracted: ReturnType<typeof extractPage> | undefined;
        if (!fragmentOnly) {
          try { extracted = extractPage(html, page.url(), source.web!.rules, source.web!.maxItems); }
          catch (error) {
            if (!(error instanceof SourceFetchError) || error.code !== 'structure-invalid' || source.web!.rules.mode !== 'css') throw error;
            // Client-rendered lists may attach their article fields after DOMContentLoaded.
            try {
              await page.waitForFunction(rules => Array.from(document.querySelectorAll(rules.item)).some(node => {
                const find = (selector: string) => node.matches(selector) ? node : node.querySelector(selector);
                const title = rules.title ? find(rules.title) : null; const body = rules.body ? find(rules.body) : null; const link = find(rules.link);
                return !!(title?.getAttribute('content') || title?.textContent || body?.textContent || '').trim()
                  && !!(link?.getAttribute('href') || link?.getAttribute('data-url') || link?.getAttribute('content'));
              }), source.web!.rules, { timeout: timeoutMs });
            } catch { throw error; }
            html = await page.content(); if (html.length > 3_000_000) throw new SourceFetchError('response-too-large', '页面超过解析大小上限');
            extracted = extractPage(html, page.url(), source.web!.rules, source.web!.maxItems);
          }
        }
        clearTimeout(deadline);
        pageFragment ||= clippedPageFragment(html);
        if (fragmentOnly) { checkPageAccess(html); return { ...inspectRecords([], source, rules), pageFragment, structure: { fragmentLength: pageFragment.length }, status: session.status }; }
        const parsed = extracted!;
        const inspected = inspectRecords(parsed.records, source, rules, { rules: source.web!.rules, matched: parsed.records.length, counts: parsed.counts, checkedAt: new Date().toISOString(), pages: number + 1, empty: parsed.empty }, page.url());
        result = result ? { ...inspected, items: [...result.items, ...inspected.items], samples: [...result.samples, ...inspected.samples], rawCount: result.rawCount + inspected.rawCount, checkedCount: result.checkedCount + inspected.checkedCount } : inspected;
        if (result.items.length >= source.web!.maxItems) break;
        target = parsed.next; await resolvePublicTarget(target || page.url());
      }
      const output = result!;
      output.items = [...new Map(output.items.map(item => [item.url, item])).values()].slice(0, source.web!.maxItems);
      return { ...output, pageFragment, status: session.status };
    } catch (error) {
      if (error instanceof SourceFetchError) throw error;
      throw new SourceFetchError(controller.signal.aborted ? 'page-timeout' : 'browser-error', controller.signal.aborted ? '页面处理超过时间上限，已关闭上下文' : '浏览器页面处理失败，请核对浏览器依赖和来源配置');
    } finally {
      clearTimeout(deadline); controller.abort();
      try { if (context) await context.close(); }
      finally { this.activeLimits.splice(this.activeLimits.indexOf(limit), 1); this.waiting.splice(0).forEach(wake => wake()); }
    }
  }
  private sourceKey(source: NewsSourceConfig) { return `${source.id}\n${source.target}`; }
  async clearVerification() {
    this.browserRevision++;
    this.verified.forEach(saved => clearTimeout(saved.timer));
    this.verified.clear();
    if (this.verification) { const session = this.verification; this.verification = undefined; clearTimeout(session.timer); session.controller.abort(); await session.context.close(); }
  }
  private requireVerification(id: string, owner: string, allowExpired = false) {
    const session = this.verification;
    if (!session || session.id !== id || session.owner !== owner || (!allowExpired && session.expiresAt <= Date.now())) throw new NotFoundException('浏览器会话已结束，请重新打开');
    return session;
  }
  async openVerification(source: NewsSourceConfig, owner: string) {
    if (this.verification || this.verificationOpening) throw new ConflictException('已有人工操作窗口，请先关闭，或等待十分钟自动结束');
    this.verificationOpening = true;
    const revision = this.browserRevision;
    try {
      await resolvePublicTarget(source.target!);
      const browser = await this.getBrowser();
      const page = await createCrawlerPage(browser, source, true);
      if (revision !== this.browserRevision) { page.controller.abort(); await page.context.close(); throw new ConflictException('网络设置已改变，请重新打开浏览器'); }
      const id = randomUUID();
      const session = { ...page, id, owner, source, expiresAt: Date.now() + 600000, loading: true, busy: false } as Verification;
      this.verification = session;
      session.timer = setTimeout(() => { void this.closeVerification(id, owner).catch(() => console.warn('人工浏览器清理失败')); }, 600000);
      void session.page.goto(source.target!, { waitUntil: 'domcontentloaded' }).catch(() => { session.error = session.failure?.message || '页面加载未完成，可查看画面后重试'; }).finally(() => { session.loading = false; });
      return { id, sourceId: source.id, expiresAt: new Date(session.expiresAt).toISOString(), width: 1280, height: 800 };
    } finally { this.verificationOpening = false; }
  }
  async verificationFrame(id: string, owner: string) {
    const session = this.requireVerification(id, owner);
    const screenshot = await session.page.screenshot({ type: 'jpeg', quality: 65, timeout: 5000 });
    return { image: `data:image/jpeg;base64,${screenshot.toString('base64')}`, url: session.page.url(), loading: session.loading, error: session.failure?.message || session.error, expiresAt: new Date(session.expiresAt).toISOString() };
  }
  async verificationInput(id: string, owner: string, input: unknown) {
    const session = this.requireVerification(id, owner);
    if (session.busy || session.loading) throw new ConflictException('浏览器正在处理上一操作');
    const body = input as { type?: string; x?: number; y?: number; delta?: number; text?: string; key?: string } | null;
    if (!body || !['click', 'move', 'down', 'up', 'scroll', 'text', 'key', 'reload'].includes(String(body.type))) throw new BadRequestException('浏览器操作无效');
    session.busy = true;
    try {
      if (['click', 'move', 'down', 'up'].includes(body.type!)) {
        if (!Number.isFinite(body.x) || !Number.isFinite(body.y) || body.x! < 0 || body.x! >= 1280 || body.y! < 0 || body.y! >= 800) throw new BadRequestException('点击坐标无效');
        await session.page.mouse.move(body.x!, body.y!);
        if (body.type === 'click') await session.page.mouse.click(body.x!, body.y!);
        if (body.type === 'down') await session.page.mouse.down();
        if (body.type === 'up') await session.page.mouse.up();
      } else if (body.type === 'scroll') {
        if (!Number.isFinite(body.delta) || Math.abs(body.delta!) > 1600) throw new BadRequestException('滚动距离无效');
        await session.page.mouse.wheel(0, body.delta!);
      } else if (body.type === 'text') {
        if (typeof body.text !== 'string' || body.text.length > 500) throw new BadRequestException('输入文字过长');
        await session.page.keyboard.insertText(body.text);
      } else if (body.type === 'key') {
        if (!['Enter', 'Tab', 'Shift+Tab', 'Backspace', 'Delete', 'Escape', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'Space'].includes(body.key || '')) throw new BadRequestException('不支持此按键');
        await session.page.keyboard.press(body.key!);
      } else { session.failure = undefined; session.error = undefined; session.resources = 0; await session.page.reload({ waitUntil: 'domcontentloaded' }); }
      return { ok: true };
    } catch (error) {
      if (error instanceof BadRequestException) throw error;
      throw new BadRequestException(session.failure?.message || '浏览器操作未完成，请刷新画面后重试');
    } finally { session.busy = false; }
  }
  async finishVerification(id: string, owner: string, rules: FilterRule[]): Promise<CollectionResult & { sourceId: string }> {
    const session = this.requireVerification(id, owner);
    if (session.busy || session.loading) throw new ConflictException('页面仍在加载，请稍后继续');
    session.busy = true;
    try {
      const html = await session.page.content();
      if (html.length > 3_000_000) throw new SourceFetchError('response-too-large', '页面超过解析大小上限');
      try { checkPageAccess(html); }
      catch (error) { if (error instanceof SourceFetchError) throw new SourceFetchError(error.code, error.message, session.status); throw error; }
      if (session.failure) throw session.failure;
      const key = this.sourceKey(session.source);
      if (this.verified.has(key)) clearTimeout(this.verified.get(key)!.timer);
      if (this.verified.size >= 20) { const oldest = this.verified.keys().next().value!; clearTimeout(this.verified.get(oldest)!.timer); this.verified.delete(oldest); }
      this.verified.set(key, { state: await session.context.storageState(), timer: setTimeout(() => this.verified.delete(key), 1800000) });
      const parsed = extractPage(html, session.page.url(), session.source.web!.rules, session.source.web!.maxItems);
      const result = inspectRecords(parsed.records, session.source, rules, { rules: session.source.web!.rules, matched: parsed.records.length, counts: parsed.counts, checkedAt: new Date().toISOString(), pages: 1, empty: parsed.empty }, session.page.url());
      await this.closeVerification(id, owner);
      return { ...result, sourceId: session.source.id };
    } finally { session.busy = false; }
  }
  async closeVerification(id: string, owner: string) {
    const session = this.requireVerification(id, owner, true); this.verification = undefined;
    clearTimeout(session.timer); session.controller.abort(); await session.context.close(); return { ok: true };
  }
}
