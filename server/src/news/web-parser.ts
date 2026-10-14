import { load } from 'cheerio';
import { ScrapedRecord } from './source-adapter.service';
import { WebRules } from './sources';
import { SourceFetchError } from './public-network';

function metadataRecords(html: string, url: string): ScrapedRecord[] {
  const $ = load(html); const records: ScrapedRecord[] = [];
  const walk = (value: any, depth = 0) => {
    if (!value || typeof value !== 'object' || depth > 8) return;
    if (Array.isArray(value)) { value.slice(0, 150).forEach(v => walk(v, depth + 1)); return; }
    const types = Array.isArray(value['@type']) ? value['@type'] : [value['@type']];
    if (types.some((type: unknown) => ['NewsArticle', 'Article', 'ReportageNewsArticle', 'BlogPosting'].includes(String(type)))) {
      const author = Array.isArray(value.author) ? value.author[0] : value.author;
      records.push({ title: value.headline || value.name, summary: value.description, url: value.url || value.mainEntityOfPage?.['@id'] || url,
        publishedAt: value.datePublished, body: value.articleBody, author: typeof author === 'string' ? author : author?.name,
        images: (Array.isArray(value.image) ? value.image : [value.image]).flatMap((image: string | { url?: string; contentUrl?: string } | null | undefined) => typeof image === 'string' ? [image] : image?.url || image?.contentUrl ? [image.url || image.contentUrl] : []) });
    }
    if (types.includes('ListItem') && value.item && typeof value.item === 'object') records.push({ title: value.item.name || value.item.headline, summary: value.item.description, url: value.item.url || value.url });
    for (const key of ['@graph', 'itemListElement', 'mainEntity', 'hasPart', 'item']) if (value[key]) walk(value[key], depth + 1);
  };
  $('script[type="application/ld+json"]').slice(0, 20).each((_, node) => {
    const raw = $(node).text(); if (raw.length > 300000) return;
    try { walk(JSON.parse(raw)); } catch { /* 单个无效元数据块不影响其他已识别文章。 */ }
  });
  if (!records.length && $('meta[property="og:type"]').attr('content') === 'article') {
    records.push({ title: $('meta[property="og:title"]').attr('content') || $('h1').first().text(), summary: $('meta[property="og:description"]').attr('content') || $('meta[name="description"]').attr('content'),
      url: $('link[rel="canonical"]').attr('href') || $('meta[property="og:url"]').attr('content') || url,
      publishedAt: $('meta[property="article:published_time"]').attr('content') || $('time[datetime]').first().attr('datetime'),
      images: $('meta[property="og:image"]').map((_, node) => $(node).attr('content')).get(), author: $('meta[name="author"]').attr('content'),
      body: $('article').first().text() });
  }
  return records;
}
export function checkPageAccess(html: string) {
  const $ = load(html);
  const title = $('title').text();
  const content = $('body').clone(); content.find('script, style, noscript').remove();
  const deviceChallenge = /captcha-delivery\.com|datadome/i.test(html) && /please enable (?:javascript|js)|device check|verify (?:your|this) device|验证设备/i.test(`${title} ${content.text()}`);
  if (deviceChallenge || /captcha|verify (?:you are|that you are) human|checking your browser|人机验证|验证码/i.test(title) || $('[id*="captcha"], iframe[src*="captcha"]').length) throw new SourceFetchError('captcha', '页面要求人机或设备验证，当前不能自动采集；不会绕过验证');
  if ($('input[type="password"]').length && !$('#article, article').length) throw new SourceFetchError('login-required', '页面要求登录，未使用账号或登录资料');
  if ($('[class*="paywall"], [data-testid*="paywall"]').length && $('article').text().trim().length < 100) throw new SourceFetchError('paywall', '页面存在付费阅读限制');
  if ($('script[type="application/ld+json"]').toArray().some(node => /"isAccessibleForFree"\s*:\s*(?:false|"false")/i.test($(node).text()))) throw new SourceFetchError('paywall', '文章元数据标明需付费访问');
}
export function extractPage(html: string, url: string, rules: WebRules, maxItems: number) {
  checkPageAccess(html);
  const $ = load(html); const text = $('body').text().slice(0, 100000);
  let records: ScrapedRecord[]; let next: string | undefined;
  const counts: Record<string, number> = {};
  try {
    if (rules.mode === 'metadata') records = metadataRecords(html, url).slice(0, maxItems);
    else {
      $('script, style, iframe, noscript').remove();
      const nodes = $(rules.item).slice(0, maxItems); records = [];
      const find = (node: any, selector: string) => { const root = $(node); return selector ? (root.is(selector) ? root : root.find(selector)).first() : root; };
      nodes.each((_, node) => {
        const titleNode = find(node, rules.title); const link = find(node, rules.link); const date = rules.date ? find(node, rules.date) : null;
        const imageNodes = rules.image ? $(node).find(rules.image).add($(node).filter(rules.image)) : null;
        const summary = rules.summary ? find(node, rules.summary) : null;
        records.push({ title: titleNode.attr('content') || titleNode.text(), summary: summary?.attr('content') || summary?.text() || '', url: link.attr('href') || link.attr('data-url') || link.attr('content'),
          publishedAt: date?.attr('datetime') || date?.attr('content') || date?.text(), author: rules.author ? find(node, rules.author).text() : '',
          body: rules.body ? find(node, rules.body).text() : '', images: imageNodes?.map((_, image) => $(image).attr('src') || $(image).attr('data-src') || $(image).attr('content')).get() });
      });
      if (rules.next) next = $(rules.next).first().attr('href');
    }
  } catch { throw new SourceFetchError('invalid-selector', 'CSS 选择器无效，请修改规则后预览'); }
  for (const key of ['title', 'summary', 'url', 'publishedAt', 'images', 'body'] as const) counts[key] = records.filter(record => !!record[key]).length;
  const empty = !records.length && /no (?:results|articles|stories|news) (?:found|available)|nothing found|暂无(?:内容|新闻|结果)|没有(?:内容|新闻|结果)/i.test(text);
  if (!empty && (!records.length || !counts.title || !counts.url)) throw new SourceFetchError('structure-invalid', '解析结构未匹配到标题和链接，请检查来源规则；不会自动调用 AI');
  return { records, next: next ? new URL(next, url).href : undefined, counts, empty };
}
export function clippedPageFragment(html: string) {
  const $ = load(html); $('script, style, iframe, form, input, button, nav, footer, aside, noscript').remove();
  $('*').each((_, node) => {
    const element = $(node);
    for (const name of Object.keys(element.attr() || {})) {
      if (!['class', 'id', 'href', 'src', 'datetime', 'itemprop', 'property', 'content', 'data-testid', 'data-qa'].includes(name)) element.removeAttr(name);
      else if (name === 'href' || name === 'src') { try { const value = new URL(element.attr(name)!, 'https://example.invalid'); element.attr(name, value.origin === 'https://example.invalid' ? value.pathname : value.origin + value.pathname); } catch { element.removeAttr(name); } }
    }
  });
  const blocks = $('article, [role="article"]').slice(0, 16);
  const fragment = blocks.length ? blocks.map((_, node) => $.html(node)).get().join('\n') : $('main').first().html() || $('body').html() || '';
  return fragment.slice(0, 12000);
}
