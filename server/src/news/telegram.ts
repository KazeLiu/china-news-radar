import { createHash } from 'node:crypto';
import { isIP } from 'node:net';
import { BadRequestException } from '@nestjs/common';
import { load } from 'cheerio';
import { canonicalUrl, eventKey, isDomesticUrl, plainText, publisherForUrl, shouldDisplay, safePublishedAt, topicFor, withinNewsWindow } from './rules';
import { NEWS_SOURCES, NewsSourceConfig } from './sources';
import type { CollectedItem } from './collector';
import { isPublicAddress } from './public-network';

function cleanLink(value: string) {
  let url = value.trim().replace(/[。，、；：！？）】》.,;!]+$/u, '');
  for (const [open, close] of [['(', ')'], ['[', ']'], ['{', '}']]) {
    while (url.endsWith(close) && url.split(close).length > url.split(open).length) url = url.slice(0, -1);
  }
  return canonicalUrl(url);
}

function externalLink(url: string) {
  const host = new URL(url).hostname.toLowerCase().replace(/^\[|\]$/g, '');
  return !/(^|\.)(t\.me|telegram\.me|telegram\.org|telegra\.ph|localhost|local|internal)$/i.test(host)
    && (isIP(host) ? isPublicAddress(host) : host.includes('.')) && !isDomesticUrl(url);
}

function telegramLinks(text: string, links: unknown) {
  const supplied = Array.isArray(links) ? links.slice(0, 30).filter((link): link is string => typeof link === 'string' && link.length <= 2000) : [];
  const $ = load(text);
  $('script, style, iframe').remove();
  const anchors = $('a[href]').map((_, element) => $(element).attr('href')!).get();
  const autolinks = [...text.matchAll(/<(https?:\/\/[^<>\s]+)>/gi)].map(match => match[1]);
  const plain = [...$.text().matchAll(/https?:\/\/[^\s<>"'“”]+/gi)].map(match => match[0]);
  const candidates = [...new Set([...supplied, ...anchors, ...autolinks, ...plain].flatMap(value => {
    if (value.length > 2000) return [];
    const url = cleanLink(value);
    return url ? [url] : [];
  }))].slice(0, 30);
  return { candidates, external: candidates.filter(externalLink) };
}

export function telegramItem(input: { channel?: unknown; messageId?: unknown; text?: unknown; links?: unknown; publishedAt?: unknown; backfill?: unknown }, filterByRules = true, sources: NewsSourceConfig[] = NEWS_SOURCES): { sourceId: string; item: CollectedItem } | null {
  const source = sources.find(s => s.kind === 'telegram' && s.channel?.toLowerCase() === String(input.channel).replace(/^@/, '').toLowerCase());
  if (!source || !Number.isSafeInteger(input.messageId) || Number(input.messageId) <= 0 || typeof input.text !== 'string' || input.text.length > 20_000) throw new BadRequestException('频道或消息格式无效');
  if (input.backfill !== undefined && typeof input.backfill !== 'boolean') throw new BadRequestException('回填标记必须为布尔值');
  const text = plainText(input.text).slice(0, 6000);
  const publishedAt = safePublishedAt(input.publishedAt);
  if (!text || (filterByRules && !shouldDisplay(text, '', `https://t.me/${source.channel}/${input.messageId}`)) || !withinNewsWindow(publishedAt)) return null;
  const { candidates: links, external } = telegramLinks(input.text, input.links);
  const originalUrl = external.find(link => !!publisherForUrl(link)) || external[0] || null;
  if (!external.some(link => !!publisherForUrl(link)) && links.some(isDomesticUrl)) return null;
  const title = text.slice(0, 220);
  return { sourceId: source.id, item: { title, sourceTitlePresent: false, body: input.text, acquisitionKind: 'telegram', sourceLinks: JSON.stringify(external), summary: text, url: `https://t.me/${source.channel}/${input.messageId}`, originalUrl,
    originalPublisher: originalUrl ? publisherForUrl(originalUrl) : null, publishedAt, author: source.name,
    topic: topicFor(text), eventKey: eventKey(title), contentHash: createHash('sha256').update(JSON.stringify([text, links, publishedAt])).digest('hex') } };
}
