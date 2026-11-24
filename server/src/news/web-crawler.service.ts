import { Injectable, OnModuleDestroy, OnModuleInit, BadRequestException, ConflictException, NotFoundException } from '@nestjs/common';
import { Browser, BrowserContext, errors } from 'playwright-core';
import { Camoufox, findInstalledVersion } from 'camoufox';
import { isModelInstalled } from 'camoufox/dist/fpgen/index.js';
import { getAddonPath } from 'camoufox/dist/addons.js';
import { access } from 'node:fs/promises';
import { join } from 'node:path';
import { NewsSourceConfig } from './sources';
import { SourceAdapterService, CollectionResult, inspectRecords } from './source-adapter.service';
import { FilterRule } from './content-filter';
import { matchesHost } from './collector';
import { resolvePublicTarget, sourceProxyAgent, SourceFetchError } from './public-network';
import { checkPageAccess, clippedPageFragment, extractPage } from './web-parser';
import { createCrawlerPage, sourceHosts, CrawlerPage } from './web-browser';
import { randomUUID } from 'node:crypto';
import { inspectWebPage } from './web-preview';
import { BrowserConfig, defaultBrowserConfig } from './browser-config';
import { captureStablePage, navigateCrawlerPage, readStablePage } from './web-page-readiness';

type StorageState = Awaited<ReturnType<BrowserContext['storageState']>>;
const BROWSER_MAX_AGE_MS = 60 * 60 * 1_000;
const BROWSER_MAX_SESSIONS = 80;
export interface LoadedWebPage {
  url: string; status: number; html: string; screenshot: string; bytes: number; browserMode: string; loadedAt: Date;
  loadMoreClicks: number; complete: boolean; stopReason: 'loaded' | 'no-more' | 'page-limit';
}
interface Verification extends CrawlerPage { id: string; owner: string; source: NewsSourceConfig; browser: Promise<Browser>; expiresAt: number; timer: ReturnType<typeof setTimeout>; loading: boolean; busy: boolean; error?: string }
@Injectable()
export class WebCrawlerService implements OnModuleInit, OnModuleDestroy {
  private browser?: Promise<Browser>;
  private browserClosing?: Promise<void>;
  private browserAgeTimer?: ReturnType<typeof setTimeout>;
  private browserExpired = false;
  private browserSessions = 0;
  private activeLimits: number[] = [];
  private waiting: Array<() => void> = [];
  private stopped = false;
  private verification?: Verification;
  private verificationOpening = false;
  private verificationClosing = false;
  private browserRevision = 0;
  private verified = new Map<string, { state: StorageState; timer: ReturnType<typeof setTimeout> }>();
  private siteStates = new Map<string, { state: StorageState; expiresAt: number; timer: ReturnType<typeof setTimeout> }>();
  private settings = defaultBrowserConfig();
  constructor(private readonly adapters: SourceAdapterService) {}
  onModuleInit() { this.adapters.registerWeb((source, rules) => this.collect(source, rules)); }
  async onModuleDestroy() {
    this.stopped = true;
    this.waiting.splice(0).forEach(wake => wake());
    try { await this.clearVerification(); }
    finally { this.resetBrowser(this.browser, '后端停止'); await this.browserClosing; }
  }
  private browserMode() { return process.env.CAMOUFOX_MODE || (process.platform === 'win32' ? 'headed' : 'virtual'); }
  configureBrowser(settings?: BrowserConfig) { this.settings = settings ? { ...settings } : defaultBrowserConfig(); }
  browserConfiguration() { return { ...this.settings, defaults: defaultBrowserConfig(), runtime: { engine: 'Camoufox', version: '156.0.1-beta.36', platform: process.platform, mode: this.browserMode() } }; }
  private getBrowser() {
    if (this.stopped) throw new SourceFetchError('stopped', '网页采集正在停止');
    if (!this.browser) {
      const env = Object.fromEntries(['PATH', 'HOME', 'USERPROFILE', 'SystemRoot', 'TEMP', 'TMP', 'LANG', 'APPDATA', 'LOCALAPPDATA', 'XDG_RUNTIME_DIR', 'DISPLAY'].flatMap(key => process.env[key] ? [[key, process.env[key]!]] : []));
      const pending: Promise<Browser> = (async () => {
        const installed = await findInstalledVersion('official/156.0.1-beta.36');
        const executablePath = process.env.CAMOUFOX_EXECUTABLE_PATH || (installed ? join(installed, process.platform === 'win32' ? 'camoufox.exe' : 'camoufox-bin') : '');
        if (!executablePath) throw new Error('Camoufox not installed');
        await access(executablePath);
        if (!isModelInstalled()) throw new SourceFetchError('browser-unavailable', '缺少 Camoufox 官方指纹模型，请运行 node scripts/install-camoufox.cjs 后重启后端');
        await access(join(getAddonPath('UBO'), 'manifest.json'));
        const mode = this.browserMode();
        if (!['headed', 'headless', 'virtual'].includes(mode) || (mode === 'virtual' && process.platform !== 'linux')) throw new SourceFetchError('browser-unavailable', 'CAMOUFOX_MODE 应为 headed、headless 或 virtual；virtual 仅支持 Linux');
        // Keep browser-wide background traffic blocked; each page context receives
        // its own validated proxy without inheriting source credentials.
        return Camoufox({ headless: mode === 'virtual' ? 'virtual' : mode === 'headless', os: process.platform === 'win32' ? 'windows' : 'linux', executable_path: executablePath, env, timeout: 30_000,
          proxy: { server: 'http://127.0.0.1:9' },
          firefox_user_prefs: { 'media.peerconnection.enabled': false, 'network.http.http3.enable': false,
            'network.prefetch-next': false, 'network.dns.disablePrefetch': true, 'network.http.speculative-parallel-limit': 0,
            'network.captive-portal-service.enabled': false, 'network.connectivity-service.enabled': false } });
      })().then(browser => {
        if (this.browser === pending) {
          browser.once('disconnected', () => this.forgetBrowser(pending));
          this.browserAgeTimer = setTimeout(() => { this.browserExpired = true; this.recycleIdleBrowser(); }, BROWSER_MAX_AGE_MS);
          this.browserAgeTimer.unref();
        }
        return browser;
      }).catch(error => {
        this.forgetBrowser(pending);
        throw error instanceof SourceFetchError ? error : new SourceFetchError('browser-unavailable', 'Camoufox 启动失败，请运行 node scripts/install-camoufox.cjs 并检查系统依赖；Linux 虚拟显示需要 Xvfb，不会回退到 Chromium');
      });
      this.browser = pending;
    }
    this.browserSessions++;
    return this.browser;
  }
  private get browserRecycleDue() { return this.browserExpired || this.browserSessions >= BROWSER_MAX_SESSIONS; }
  private async acquire(limit: number) {
    // Drain existing parallel work once retirement is due.
    while (!this.stopped && this.activeLimits.length >= Math.min(this.browserRecycleDue ? 1 : limit, ...this.activeLimits)) await new Promise<void>(resolve => this.waiting.push(resolve));
    if (this.stopped) throw new SourceFetchError('stopped', '网页采集正在停止');
    this.activeLimits.push(limit);
  }
  private release(limit: number) {
    this.activeLimits.splice(this.activeLimits.indexOf(limit), 1);
    this.recycleIdleBrowser();
    this.waiting.splice(0).forEach(wake => wake());
  }
  private recycleIdleBrowser() {
    if (this.stopped || this.activeLimits.length || this.verification || this.verificationOpening || this.verificationClosing) return;
    if (this.browserRecycleDue) this.resetBrowser(this.browser, '达到浏览器回收阈值');
  }
  private forgetBrowser(pending: Promise<Browser>) {
    if (this.browser !== pending) return;
    this.browser = undefined;
    clearTimeout(this.browserAgeTimer);
    this.browserExpired = false;
    this.browserSessions = 0;
    this.clearBrowserState();
    if (this.verification?.browser === pending) {
      const session = this.verification;
      this.verification = undefined;
      clearTimeout(session.timer);
      session.controller.abort();
    }
  }
  private resetBrowser(pending: Promise<Browser> | undefined, reason: string) {
    if (!pending || this.browser !== pending) return;
    const sessions = this.browserSessions;
    this.forgetBrowser(pending);
    const closing = pending.then(browser => browser.close({ reason }), () => undefined).catch(() => {
      throw new SourceFetchError('browser-close-failed', '旧采集浏览器未能正常退出，请重启后端；已停止启动新实例');
    });
    this.browserClosing = closing;
    // Keep the gate closed on failure so old and replacement processes cannot accumulate.
    void closing.then(() => {
      this.browserClosing = undefined;
      if (!this.stopped) console.info(`Camoufox 已关闭：${reason}（${sessions} 次会话）`);
    }, error => console.warn(error.message));
  }
  private async closeContext(session: CrawlerPage) {
    let deadline: ReturnType<typeof setTimeout> | undefined;
    try {
      await Promise.race([session.context.close(), new Promise<never>((_, reject) => {
        deadline = setTimeout(() => reject(new Error('浏览器上下文关闭超时')), 5000);
      })]);
    } finally { clearTimeout(deadline); session.controller.abort(); }
  }
  private async withPage<T>(source: NewsSourceConfig, settings: BrowserConfig, storageState: () => StorageState | undefined,
    run: (session: CrawlerPage, expiresAt: number, revision: number) => Promise<T>): Promise<T> {
    const limit = source.web!.concurrency;
    await this.acquire(limit);
    const controller = new AbortController();
    const expiresAt = Date.now() + settings.sessionTimeoutSeconds * 1000;
    let session: CrawlerPage | undefined; let browser: Browser | undefined; let pendingBrowser: Promise<Browser> | undefined;
    let rejectAborted!: (error: unknown) => void;
    const aborted = new Promise<never>((_, reject) => { rejectAborted = reject; });
    const onAbort = () => rejectAborted(controller.signal.reason);
    const onDisconnected = () => controller.abort(new SourceFetchError('browser-disconnected', '采集浏览器异常退出，本次任务已结束，后续任务将重新启动浏览器'));
    controller.signal.addEventListener('abort', onAbort, { once: true });
    const deadline = setTimeout(() => controller.abort(new SourceFetchError('page-timeout', `网页采集超过 ${settings.sessionTimeoutSeconds} 秒会话上限，已取消本次任务`)), settings.sessionTimeoutSeconds * 1000);
    try {
      // The deadline includes browser startup and context creation, not only navigation.
      return await Promise.race([aborted, (async () => {
        await resolvePublicTarget(source.target!, false, sourceProxyAgent(source.target!, false, source.useProxy));
        while (this.browserClosing) await this.browserClosing;
        controller.signal.throwIfAborted();
        pendingBrowser = this.getBrowser(); browser = await pendingBrowser;
        controller.signal.throwIfAborted();
        browser.once('disconnected', onDisconnected);
        if (!browser.isConnected()) onDisconnected();
        controller.signal.throwIfAborted();
        const revision = this.browserRevision;
        session = await createCrawlerPage(browser, source, false, storageState(), controller);
        controller.signal.throwIfAborted();
        return run(session, expiresAt, revision);
      })()]);
    } finally {
      clearTimeout(deadline);
      controller.signal.removeEventListener('abort', onAbort);
      browser?.off('disconnected', onDisconnected);
      try {
        if (session) await this.closeContext(session);
        else if (controller.signal.aborted) this.resetBrowser(pendingBrowser, '浏览器启动或上下文初始化中断');
      } catch {
        this.resetBrowser(pendingBrowser, '采集上下文关闭失败');
      } finally { controller.abort(); this.release(limit); }
    }
  }
  private forgetSiteState(key: string) {
    clearTimeout(this.siteStates.get(key)?.timer);
    this.siteStates.delete(key);
  }
  private clearSiteStates() {
    this.siteStates.forEach(saved => clearTimeout(saved.timer));
    this.siteStates.clear();
  }
  private siteState(source: NewsSourceConfig) {
    const key = this.siteKey(source);
    const saved = this.siteStates.get(key);
    if (saved && saved.expiresAt <= Date.now()) { this.forgetSiteState(key); return; }
    return saved?.state;
  }
  private async rememberSiteState(source: NewsSourceConfig, context: BrowserContext, revision: number, signal: AbortSignal) {
    const target = new URL(source.target!);
    const state = await context.storageState();
    if (signal.aborted || revision !== this.browserRevision) return;
    // Keep only this public site's own state, in memory and within this browser identity.
    state.cookies = state.cookies.filter(cookie => {
      const domain = cookie.domain.replace(/^\./, '');
      return target.hostname === domain || (cookie.domain.startsWith('.') && target.hostname.endsWith(`.${domain}`));
    });
    state.origins = state.origins.filter(origin => origin.origin === target.origin);
    const key = this.siteKey(source);
    if (!this.siteStates.has(key) && this.siteStates.size >= 20) this.forgetSiteState(this.siteStates.keys().next().value!);
    clearTimeout(this.siteStates.get(key)?.timer);
    // The reuse window stays at 30 minutes; release expired storage even if the site is never visited again.
    const expiresAt = Date.now() + 1800000;
    const timer = setTimeout(() => this.forgetSiteState(key), Math.max(0, expiresAt - Date.now()));
    timer.unref();
    this.siteStates.set(key, { state, expiresAt, timer });
  }
  async loadPage(source: NewsSourceConfig, includeScreenshot = true): Promise<LoadedWebPage> {
    const config = source.web!; const settings = this.settings;
    let session: CrawlerPage | undefined;
    let phase = '启动浏览器';
    try {
      return await this.withPage(source, settings, () => this.verified.get(this.sourceKey(source))?.state || this.siteState(source), async (opened, expiresAt, revision) => {
        session = opened;
        const current = session; const { page } = current;
        const timeoutMs = config.timeoutSeconds * 1000;
        const remaining = () => Math.max(1, Math.min(timeoutMs, expiresAt - Date.now()));
        const readHtml = () => readStablePage(current, settings, expiresAt);
        phase = '页面导航与等待跳转';
        let html = await navigateCrawlerPage(current, source.target!, timeoutMs, settings, expiresAt); let loadMoreClicks = 0;
        let stopReason: LoadedWebPage['stopReason'] = config.loadMoreText ? 'page-limit' : 'loaded';
        if (config.loadMoreText) {
          phase = '加载更多';
          const button = page.getByRole('button', { name: config.loadMoreText, exact: true });
          for (let number = 1; number < config.maxPages; number++) {
            if (!await button.count() || !await button.first().isVisible()) { stopReason = 'no-more'; break; }
            const before = await page.locator(config.loadMoreContainer!).evaluate(node => node.childElementCount, undefined, { timeout: remaining() });
            current.resources = 0;
            await button.click({ timeout: remaining() });
            // Observe the loading region growing, without extracting any article fields.
            await page.waitForFunction(({ selector, before, text }) => {
              const region = document.querySelector(selector);
              const button = Array.from(document.querySelectorAll('button')).find(node => node.innerText.trim() === text);
              return !!region && region.childElementCount > before && (!button || (!button.disabled && button.getAttribute('aria-busy') !== 'true'));
            }, { selector: config.loadMoreContainer!, before, text: config.loadMoreText }, { timeout: remaining() });
            loadMoreClicks++;
            html = await readHtml();
          }
          if (!await button.count() || !await button.first().isVisible()) stopReason = 'no-more';
        }
        phase = includeScreenshot ? '读取页面与截图' : '读取页面';
        // Automatic collection consumes HTML only; previews keep the original screenshot path.
        const captured = includeScreenshot ? await captureStablePage(current, settings, expiresAt, timeoutMs)
          : { html: await readHtml(), screenshot: null };
        html = captured.html;
        const screenshot = captured.screenshot;
        await this.rememberSiteState(source, current.context, revision, current.controller.signal);
        current.controller.signal.throwIfAborted();
        return { url: page.url(), status: current.status, html, bytes: Buffer.byteLength(html), screenshot: screenshot ? `data:image/jpeg;base64,${screenshot.toString('base64')}` : '',
          browserMode: this.browserMode(), loadedAt: new Date(), loadMoreClicks, stopReason, complete: stopReason !== 'page-limit' };
      });
    } catch (error) {
      if (error instanceof SourceFetchError && ['access-denied', 'captcha'].includes(error.code)) this.forgetSiteState(this.siteKey(source));
      if (error instanceof SourceFetchError) throw error;
      if (session?.failure) throw session.failure;
      throw new SourceFetchError(error instanceof errors.TimeoutError ? 'page-timeout' : 'browser-error',
        error instanceof errors.TimeoutError ? `网页在${phase}阶段超时（会话上限 ${settings.sessionTimeoutSeconds} 秒）` : `浏览器在${phase}阶段失败，请检查来源地址、页面状态与浏览器依赖`);
    }
  }
  async collect(source: NewsSourceConfig, rules: FilterRule[], fragmentOnly = false): Promise<CollectionResult> {
    if (source.web!.loadMoreText && !fragmentOnly) return inspectWebPage(await this.loadPage(source, false), source, rules);
    const settings = this.settings;
    try {
      return await this.withPage(source, settings, () => this.verified.get(this.sourceKey(source))?.state || this.siteState(source), async (session, expiresAt, revision) => {
        const timeoutMs = source.web!.timeoutSeconds * 1000;
        const { page } = session; const allowedHosts = sourceHosts(source);
        let target: string | undefined = source.target!; const visited = new Set<string>(); let result: CollectionResult | undefined;
        for (let number = 0; target && number < (fragmentOnly ? 1 : source.web!.maxPages); number++) {
          if (!matchesHost(target, allowedHosts)) throw new SourceFetchError('blocked-domain', '翻页链接超出来源域名');
          if (visited.has(target)) break; visited.add(target); session.failure = undefined; session.resources = 0;
          let html = await navigateCrawlerPage(session, target, timeoutMs, settings, expiresAt);
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
                }), source.web!.rules, { timeout: Math.max(1, Math.min(timeoutMs, expiresAt - Date.now())) });
              } catch { throw error; }
              html = await readStablePage(session, settings, expiresAt);
              extracted = extractPage(html, page.url(), source.web!.rules, source.web!.maxItems);
            }
          }
          if (fragmentOnly) {
            checkPageAccess(html);
            const pageFragment = clippedPageFragment(html);
            return { ...inspectRecords([], source, rules), pageFragment, structure: { fragmentLength: pageFragment.length }, status: session.status };
          }
          const parsed = extracted!;
          const inspected = { ...inspectRecords(parsed.records, source, rules, { rules: source.web!.rules, matched: parsed.matched, limited: parsed.limited, maxItems: source.web!.maxItems, counts: parsed.counts, checkedAt: new Date().toISOString(), pages: number + 1, empty: parsed.empty }, page.url()), rawCount: parsed.matched };
          result = result ? { ...inspected, items: [...result.items, ...inspected.items], samples: [...result.samples, ...inspected.samples], rawCount: result.rawCount + inspected.rawCount, checkedCount: result.checkedCount + inspected.checkedCount } : inspected;
          if (result.items.length >= source.web!.maxItems) break;
          target = parsed.next; await resolvePublicTarget(target || page.url(), false, sourceProxyAgent(target || page.url(), false, source.useProxy));
        }
        const output = result!;
        output.items = [...new Map(output.items.map(item => [item.url, item])).values()].slice(0, source.web!.maxItems);
        await this.rememberSiteState(source, session.context, revision, session.controller.signal);
        session.controller.signal.throwIfAborted();
        return { ...output, status: session.status };
      });
    } catch (error) {
      if (error instanceof SourceFetchError && ['access-denied', 'captcha'].includes(error.code)) this.forgetSiteState(this.siteKey(source));
      if (error instanceof SourceFetchError) throw error;
      throw new SourceFetchError(error instanceof errors.TimeoutError ? 'page-timeout' : 'browser-error', error instanceof errors.TimeoutError ? '页面处理超过时间上限，已关闭上下文' : '浏览器页面处理失败，请核对浏览器依赖和来源配置');
    }
  }
  private siteKey(source: NewsSourceConfig) { return `${new URL(source.target!).origin}\n${source.useProxy !== false ? 'shared' : 'direct'}`; }
  private sourceKey(source: NewsSourceConfig) { return `${source.id}\n${source.target}\n${source.useProxy !== false ? 'shared' : 'direct'}`; }
  private clearBrowserState() {
    this.browserRevision++;
    this.clearSiteStates();
    this.verified.forEach(saved => clearTimeout(saved.timer));
    this.verified.clear();
  }
  async clearVerification() {
    this.clearBrowserState();
    if (this.verification) await this.closeVerification(this.verification.id, this.verification.owner);
  }
  private requireVerification(id: string, owner: string, allowExpired = false) {
    const session = this.verification;
    if (!session || session.id !== id || session.owner !== owner || (!allowExpired && session.expiresAt <= Date.now())) throw new NotFoundException('浏览器会话已结束，请重新打开');
    return session;
  }
  async openVerification(source: NewsSourceConfig, owner: string) {
    if (this.verification || this.verificationOpening || this.verificationClosing) throw new ConflictException('已有人工操作窗口，请先关闭，或等待十分钟自动结束');
    this.verificationOpening = true;
    const revision = this.browserRevision;
    try {
      await resolvePublicTarget(source.target!, false, sourceProxyAgent(source.target!, false, source.useProxy));
      while (this.browserClosing) await this.browserClosing;
      const browser = this.getBrowser();
      const page = await createCrawlerPage(await browser, source, true);
      try {
        const size = await page.page.evaluate(() => ({ width: innerWidth, height: innerHeight }));
        if (revision !== this.browserRevision || this.stopped) throw new ConflictException('浏览器或网络状态已改变，请重新打开浏览器');
        const id = randomUUID();
        const timer = setTimeout(() => { void this.closeVerification(id, owner).catch(() => console.warn('人工浏览器清理失败')); }, 600000);
        const session: Verification = { ...page, id, owner, source, browser, timer, expiresAt: Date.now() + 600000, loading: true, busy: false };
        this.verification = session;
        void session.page.goto(source.target!, { waitUntil: 'domcontentloaded' }).catch(() => { session.error = session.failure?.message || '页面加载未完成，可查看画面后重试'; }).finally(() => { session.loading = false; });
        return { id, sourceId: source.id, expiresAt: new Date(session.expiresAt).toISOString(), ...size };
      } catch (error) {
        try { await this.closeContext(page); }
        catch { this.resetBrowser(browser, '人工窗口初始化后关闭失败'); }
        throw error;
      }
    } finally { this.verificationOpening = false; this.recycleIdleBrowser(); }
  }
  async verificationFrame(id: string, owner: string) {
    const session = this.requireVerification(id, owner);
    const size = await session.page.evaluate(() => ({ width: innerWidth, height: innerHeight }));
    const screenshot = await session.page.screenshot({ type: 'jpeg', quality: 65, scale: 'css', timeout: 5000 });
    return { image: `data:image/jpeg;base64,${screenshot.toString('base64')}`, ...size, url: session.page.url(), loading: session.loading, error: session.failure?.message || session.error, expiresAt: new Date(session.expiresAt).toISOString() };
  }
  async verificationInput(id: string, owner: string, input: unknown) {
    const session = this.requireVerification(id, owner);
    if (session.busy || session.loading) throw new ConflictException('浏览器正在处理上一操作');
    const body = input as { type?: string; x?: number; y?: number; delta?: number; text?: string; key?: string } | null;
    if (!body || !['click', 'move', 'down', 'up', 'scroll', 'text', 'key', 'reload'].includes(String(body.type))) throw new BadRequestException('浏览器操作无效');
    session.busy = true;
    try {
      if (['click', 'move', 'down', 'up'].includes(body.type!)) {
        const size = await session.page.evaluate(() => ({ width: innerWidth, height: innerHeight }));
        if (!Number.isFinite(body.x) || !Number.isFinite(body.y) || body.x! < 0 || body.x! >= size.width || body.y! < 0 || body.y! >= size.height) throw new BadRequestException('点击坐标无效');
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
      await session.responseCheck;
      if (session.failure) throw session.failure;
      const html = await session.page.content();
      if (html.length > 3_000_000) throw new SourceFetchError('response-too-large', '页面超过解析大小上限');
      try { checkPageAccess(html); }
      catch (error) { if (error instanceof SourceFetchError) throw new SourceFetchError(error.code, error.message, session.status); throw error; }
      const key = this.sourceKey(session.source);
      const state = await session.context.storageState();
      this.requireVerification(id, owner);
      if (this.verified.has(key)) clearTimeout(this.verified.get(key)!.timer);
      if (this.verified.size >= 20) { const oldest = this.verified.keys().next().value!; clearTimeout(this.verified.get(oldest)!.timer); this.verified.delete(oldest); }
      this.verified.set(key, { state, timer: setTimeout(() => this.verified.delete(key), 1800000) });
      const parsed = extractPage(html, session.page.url(), session.source.web!.rules, session.source.web!.maxItems);
      const result = inspectRecords(parsed.records, session.source, rules, { rules: session.source.web!.rules, matched: parsed.records.length, counts: parsed.counts, checkedAt: new Date().toISOString(), pages: 1, empty: parsed.empty }, session.page.url());
      await this.closeVerification(id, owner);
      return { ...result, sourceId: session.source.id };
    } finally { session.busy = false; }
  }
  async closeVerification(id: string, owner: string) {
    const session = this.requireVerification(id, owner, true); this.verification = undefined;
    clearTimeout(session.timer);
    this.verificationClosing = true;
    try { await this.closeContext(session); return { ok: true }; }
    catch (error) { this.resetBrowser(session.browser, '人工窗口关闭失败'); throw error; }
    finally { this.verificationClosing = false; this.recycleIdleBrowser(); }
  }
}
