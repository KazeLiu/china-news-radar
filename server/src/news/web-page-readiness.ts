import { setTimeout as delay } from 'node:timers/promises';
import { errors } from 'playwright-core';
import { BrowserConfig } from './browser-config';
import { SourceFetchError } from './public-network';
import { CrawlerPage, navigationInterrupted } from './web-browser';
import { checkPageAccess, dataDomeAccessError } from './web-parser';

async function checkRestrictedFrames(session: CrawlerPage) {
  const version = session.navigationVersion;
  for (const frame of session.page.frames()) {
    const url = frame.url();
    if (!URL.canParse(url)) continue;
    const host = new URL(url).hostname;
    if (frame === session.page.mainFrame() || !(host === 'captcha-delivery.com' || host.endsWith('.captcha-delivery.com'))) continue;
    try {
      const element = await frame.frameElement();
      try {
        if (!await element.isVisible()) continue;
        const body = frame.locator('body');
        if (!await body.count()) continue;
        const denied = dataDomeAccessError(await body.innerText({ timeout: 200 }), session.status);
        if (denied && version === session.navigationVersion && !session.navigating) throw denied;
      } finally { await element.dispose(); }
    } catch (error) {
      if (frame.isDetached() || navigationInterrupted(error) || error instanceof errors.TimeoutError) continue;
      throw error;
    }
  }
}

function waitingExpired(session: CrawlerPage, settings: BrowserConfig, challenge?: SourceFetchError) {
  if (session.failure?.code === 'captcha') return new SourceFetchError('captcha', `网页验证在 ${settings.sessionTimeoutSeconds} 秒内仍未完成，不会自动操作验证码`, session.status);
  if (session.failure) return session.failure;
  return challenge || new SourceFetchError('page-timeout', `页面在 ${settings.sessionTimeoutSeconds} 秒的会话上限内未完成加载或跳转，请检查网页或调整浏览器设置`, session.status);
}
export async function readStablePage(session: CrawlerPage, settings: BrowserConfig, expiresAt: number, readyAfter = 0): Promise<string> {
  let challenge: SourceFetchError | undefined;
  while (Date.now() < expiresAt && !session.controller.signal.aborted) {
    if (session.page.isClosed()) throw new SourceFetchError('browser-closed', '采集浏览器页面已关闭，请重新测试');
    if (session.failure && session.failure.code !== 'captcha') throw session.failure;
    if (!session.navigating) await checkRestrictedFrames(session);
    const version = session.navigationVersion;
    if (!session.failure && !session.navigating && !session.responsePending && Date.now() >= readyAfter && Date.now() - session.lastNavigationAt >= settings.navigationQuietSeconds * 1000) {
      try {
        // Third-party ad frames can keep window.load pending after the document is ready.
        if (await session.page.evaluate(() => document.readyState) !== 'loading') {
          const html = await session.page.content();
          if (version !== session.navigationVersion || session.navigating) continue;
          if (Buffer.byteLength(html) > 3_000_000) throw new SourceFetchError('response-too-large', '渲染后的页面超过 3 MB 上限', session.status);
          checkPageAccess(html);
          return html;
        }
      } catch (error) {
        if (error instanceof SourceFetchError && error.code === 'captcha') challenge = new SourceFetchError('captcha', '网页仍要求浏览器或人机验证；等待结束后仍未完成，不会自动操作验证码', session.status);
        else if (error instanceof SourceFetchError) throw new SourceFetchError(error.code, error.message, session.status);
        else if (version === session.navigationVersion && !navigationInterrupted(error)) throw error;
      }
    }
    await delay(Math.min(200, Math.max(1, expiresAt - Date.now())));
  }
  throw waitingExpired(session, settings, challenge);
}
export async function navigateCrawlerPage(session: CrawlerPage, url: string, stepTimeoutMs: number, settings: BrowserConfig, expiresAt: number) {
  const readyAfter = Date.now() + settings.initialWaitSeconds * 1000;
  try { await session.page.goto(url, { waitUntil: 'domcontentloaded', timeout: Math.max(1, Math.min(stepTimeoutMs, expiresAt - Date.now())) }); }
  catch (error) {
    if (session.failure && session.failure.code !== 'captcha') throw session.failure;
    if (!(error instanceof errors.TimeoutError) && !navigationInterrupted(error)) throw error;
  }
  return readStablePage(session, settings, expiresAt, readyAfter);
}
export async function captureStablePage(session: CrawlerPage, settings: BrowserConfig, expiresAt: number, stepTimeoutMs: number) {
  while (Date.now() < expiresAt && !session.controller.signal.aborted) {
    const version = session.navigationVersion;
    const html = await readStablePage(session, settings, expiresAt);
    if (version !== session.navigationVersion) continue;
    try {
      const screenshot = await session.page.screenshot({ type: 'jpeg', quality: 65, scale: 'css', timeout: Math.max(1, Math.min(stepTimeoutMs, expiresAt - Date.now())) });
      if (version === session.navigationVersion && !session.navigating) return { html, screenshot };
    } catch (error) { if (version === session.navigationVersion && !navigationInterrupted(error)) throw error; }
  }
  throw waitingExpired(session, settings);
}
