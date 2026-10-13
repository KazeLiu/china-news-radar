import { BadRequestException } from '@nestjs/common';
import { canonicalUrl, isDomesticUrl, plainText, publisherForUrl, safePublishedAt } from './rules';

export function manualInput(body: unknown) {
  if (!body || typeof body !== 'object' || Array.isArray(body)) throw new BadRequestException('新闻内容格式无效');
  const value = body as Record<string, unknown>;
  const text = (key: string, max: number) => {
    if (typeof value[key] !== 'string' || (value[key] as string).length > max) throw new BadRequestException(`${key} 的类型或长度无效`);
    return (value[key] as string).trim();
  };
  const title = plainText(text('title', 600));
  if (!title) throw new BadRequestException('请填写新闻标题');
  const rawUrl = text('url', 2000); const url = rawUrl ? canonicalUrl(rawUrl) : null;
  if (rawUrl && (!url || isDomesticUrl(url))) throw new BadRequestException('请填写有效的海外原文 HTTP(S) 链接');
  const published = text('publishedAt', 50); const publishedAt = published ? safePublishedAt(published) : null;
  if (published && !publishedAt) throw new BadRequestException('发布时间无效或晚于当前时间');
  if (!Array.isArray(value.images) || value.images.length > 20) throw new BadRequestException('图片最多 20 张');
  const images = value.images.map(image => {
    if (typeof image !== 'string' || image.length > 2000) throw new BadRequestException('图片链接格式无效');
    const url = canonicalUrl(image); if (!url) throw new BadRequestException('图片必须是 HTTP(S) 链接'); return url;
  });
  return { title, summary: plainText(text('summary', 1600)), body: text('body', 200000), originalUrl: url,
    originalPublisher: url ? publisherForUrl(url) || plainText(text('publisher', 120)) || null : null,
    publishedAt, images: JSON.stringify([...new Set(images)]) };
}
