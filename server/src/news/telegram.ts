import { createHash } from 'node:crypto';
import { BadRequestException } from '@nestjs/common';
import { canonicalUrl, eventKey, isDomesticUrl, plainText, publisherForUrl, shouldDisplay, safePublishedAt, topicFor, withinNewsWindow } from './rules';
import { NEWS_SOURCES } from './sources';
import type { CollectedItem } from './collector';

export function telegramItem(input: { channel?: unknown; messageId?: unknown; text?: unknown; links?: unknown; publishedAt?: unknown }, filterByRules = true): { sourceId: string; item: CollectedItem } | null {
  const source = NEWS_SOURCES.find(s => s.kind === 'telegram' && s.channel?.toLowerCase() === String(input.channel).toLowerCase());
  if (!source || !Number.isSafeInteger(input.messageId) || Number(input.messageId) <= 0 || typeof input.text !== 'string' || input.text.length > 20_000) throw new BadRequestException('频道或消息格式无效');
  const text = plainText(input.text).slice(0, 6000);
  const publishedAt = safePublishedAt(input.publishedAt);
  if (!text || (filterByRules && !shouldDisplay(text, '', `https://t.me/${source.channel}/${input.messageId}`)) || !withinNewsWindow(publishedAt)) return null;
  const links = Array.isArray(input.links) ? input.links.slice(0, 30).filter((l): l is string => typeof l === 'string').map(canonicalUrl).filter((l): l is string => !!l) : [];
  const originalUrl = links.find(l => !!publisherForUrl(l)) || null;
  if (!originalUrl && links.some(isDomesticUrl)) return null;
  const title = text.slice(0, 220);
  return { sourceId: source.id, item: { title, summary: text, url: `https://t.me/${source.channel}/${input.messageId}`, originalUrl,
    originalPublisher: originalUrl ? publisherForUrl(originalUrl) : null, publishedAt, author: source.name,
    topic: topicFor(text), eventKey: eventKey(title), contentHash: createHash('sha256').update(JSON.stringify([text, links, publishedAt])).digest('hex') } };
}
