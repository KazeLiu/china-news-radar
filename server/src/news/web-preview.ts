import { BadRequestException, ConflictException, ForbiddenException } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import { NewsSourceConfig } from './sources';
import { FilterRule } from './content-filter';
import { CollectionResult, inspectRecords } from './source-adapter.service';
import { extractPage } from './web-parser';

export const webLoadContext = (source: NewsSourceConfig) => JSON.stringify([source.id, source.target, source.publisherHosts, source.useProxy,
  source.web!.loadMoreText || '', source.web!.loadMoreContainer || '', source.web!.maxPages, source.web!.timeoutSeconds]);
export const webCandidateContext = (source: NewsSourceConfig) => JSON.stringify([webLoadContext(source), source.web!.rules, source.web!.parseInstructions || '']);
export const webParserContext = (source: NewsSourceConfig) => JSON.stringify([webCandidateContext(source), source.web!.maxItems, source.timeZone, !!source.forceChina]);

interface PageContent { html: string; url: string; status: number; loadMoreClicks: number; loadedAt: Date }
interface PageSnapshot extends PageContent {
  id: string; owner: string; context: string; expiresAt: number;
  preview?: { taskId: string; context: string };
}
export class WebPreviewCache {
  private pages = new Map<string, PageSnapshot>();
  private timers = new Map<string, ReturnType<typeof setTimeout>>();
  private remove(id: string) { this.pages.delete(id); clearTimeout(this.timers.get(id)); this.timers.delete(id); }
  capture(source: NewsSourceConfig, page: PageContent, owner: string) {
    for (const [id, saved] of this.pages) if (saved.expiresAt <= Date.now()) this.remove(id);
    if (this.pages.size >= 10) this.remove(this.pages.keys().next().value!);
    const saved: PageSnapshot = { html: page.html, url: page.url, status: page.status, loadMoreClicks: page.loadMoreClicks,
      id: randomUUID(), owner, context: webLoadContext(source), loadedAt: page.loadedAt, expiresAt: Date.now() + 30 * 60_000 };
    this.pages.set(saved.id, saved);
    const timer = setTimeout(() => this.remove(saved.id), Math.max(0, saved.expiresAt - Date.now()));
    timer.unref(); this.timers.set(saved.id, timer);
    return { snapshotId: saved.id, sourceId: source.id, loadedAt: saved.loadedAt, expiresAt: new Date(saved.expiresAt) };
  }
  forTask(id: string) {
    const page = this.pages.get(id);
    if (!page || page.expiresAt <= Date.now()) { this.remove(id); throw new ConflictException('页面快照已过期或后端已重启，请重新测试加载网页'); }
    return page;
  }
  require(id: unknown, source: NewsSourceConfig, owner: string) {
    if (typeof id !== 'string') throw new BadRequestException('请先测试加载网页，取得页面快照');
    const page = this.forTask(id);
    if (page.owner !== owner) throw new ForbiddenException('页面快照不属于当前管理员会话，请重新加载');
    if (page.context !== webLoadContext(source)) throw new ConflictException('网址或页面加载配置已修改，请重新测试加载网页');
    return page;
  }
  clear() { this.pages.clear(); this.timers.forEach(timer => clearTimeout(timer)); this.timers.clear(); }
}

export function inspectWebPage(page: PageContent, source: NewsSourceConfig, rules: FilterRule[]): CollectionResult {
  const parsed = extractPage(page.html, page.url, source.web!.rules, source.web!.maxItems);
  const result = inspectRecords(parsed.records, source, rules, { rules: source.web!.rules, matched: parsed.matched, limited: parsed.limited, maxItems: source.web!.maxItems,
    counts: parsed.counts, checkedAt: new Date().toISOString(), pages: page.loadMoreClicks + 1, empty: parsed.empty }, page.url, page.loadedAt);
  const items = [...new Map(result.items.map(item => [item.url, item])).values()];
  return { ...result, items, rawCount: parsed.matched, status: page.status };
}
