import { load } from 'cheerio';
import { ScrapedRecord } from './source-adapter.service';
import { WebRules } from './sources';
import { SourceFetchError } from './public-network';
import { isIP } from 'node:net';

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
export function dataDomeAccessError(text: string, status?: number) {
  if (!/Access is temporarily restricted/i.test(text) || !/unusual activity from your device or network/i.test(text)) return;
  const ip = /\bIP\s+([\da-f:.]+)/i.exec(text)?.[1];
  const id = /\bID:\s*([\da-f-]{20,80})\b/i.exec(text)?.[1];
  const detail = [ip && isIP(ip) ? `出口 IP ${ip}` : '', id ? `拦截 ID ${id}` : ''].filter(Boolean).join('；');
  return new SourceFetchError('access-denied', `网站已通过 DataDome 明确限制当前浏览器或网络访问${detail ? `（${detail}）` : ''}。已停止本次加载；持续受限时请向网站反馈拦截 ID`, status);
}
export function checkPageAccess(html: string) {
  const $ = load(html);
  const title = $('title').text();
  const content = $('body').clone(); content.find('script, style, noscript, template, [hidden], [aria-hidden="true"]').remove();
  content.find('[style]').each((_, node) => {
    if (/(?:^|;)\s*(?:display\s*:\s*none|visibility\s*:\s*(?:hidden|collapse))(?:\s*!important)?\s*(?:;|$)/i.test($(node).attr('style') || '')) $(node).remove();
  });
  if (/access is temporarily restricted|you have been blocked/i.test(title)
    || content.find('h1, h2, [role="heading"]').toArray().some(node => /^\s*Access is temporarily restricted\s*$/i.test($(node).text()))) {
    const denied = dataDomeAccessError(`${title} ${content.text()}`);
    if (denied) throw denied;
  }
  const verificationText = `${title} ${content.find('h1, [role="alert"], [role="dialog"], [id*="captcha"], form[action*="captcha"]').text()}`;
  const verificationPrompt = /verify\s+(?:you are|that you are|you're)\s+(?:a\s+)?human|(?:complete|solve|enter)\s+(?:the\s+)?(?:captcha|security check)|checking\s+your\s+browser|(?:请|需要|完成).{0,12}(?:人机验证|验证码|安全验证)/i;
  // Normal pages keep CAPTCHA widgets installed; an idle widget is not an access restriction.
  const activeChallengeFrame = content.find('iframe[src*="/recaptcha/"][src*="/bframe"], iframe[src*="hcaptcha.com"][src*="frame=challenge"], iframe[src*="captcha-delivery.com"][src*="/captcha/"]').length > 0;
  const deviceChallenge = /captcha-delivery\.com|datadome/i.test(html) && /please enable (?:javascript|js)|device check|verify (?:your|this) device|验证设备/i.test(`${title} ${content.text()}`);
  const browserChallenge = /cdn-cgi\/challenge-platform|cf-chl-/i.test(html) && /just a moment|checking your browser|verifying (?:your browser|you are human|that you are human)|enable javascript and cookies/i.test(verificationText);
  if (deviceChallenge || browserChallenge || verificationPrompt.test(verificationText) || activeChallengeFrame || /captcha|人机验证|验证码/i.test(title)) throw new SourceFetchError('captcha', '页面要求人机或设备验证，当前不能自动采集；不会绕过验证');
  if ($('input[type="password"]').length && !$('#article, article').length) throw new SourceFetchError('login-required', '页面要求登录，未使用账号或登录资料');
  if ($('[class*="paywall"], [data-testid*="paywall"]').length && $('article').text().trim().length < 100) throw new SourceFetchError('paywall', '页面存在付费阅读限制');
  if ($('script[type="application/ld+json"]').toArray().some(node => /"isAccessibleForFree"\s*:\s*(?:false|"false")/i.test($(node).text()))) throw new SourceFetchError('paywall', '文章元数据标明需付费访问');
}
export function extractPage(html: string, url: string, rules: WebRules, maxItems: number) {
  checkPageAccess(html);
  const $ = load(html); const text = $('body').text().slice(0, 100000);
  let records: ScrapedRecord[]; let next: string | undefined; let matched: number;
  const counts: Record<string, number> = {};
  try {
    if (rules.mode === 'metadata') { const all = metadataRecords(html, url); matched = all.length; records = all.slice(0, maxItems); }
    else {
      $('script, style, iframe, noscript').remove();
      const all = $(rules.item); matched = all.length;
      const nodes = all.slice(0, maxItems); records = [];
      const find = (node: any, selector: string) => { const root = $(node); return selector ? (root.is(selector) ? root : root.find(selector)).first() : root; };
      nodes.each((_, node) => {
        const titleNode = rules.title ? find(node, rules.title) : null; const link = find(node, rules.link); const date = rules.date ? find(node, rules.date) : null;
        const imageNodes = rules.image ? $(node).find(rules.image).add($(node).filter(rules.image)) : null;
        const summary = rules.summary ? find(node, rules.summary) : null;
        records.push({ title: titleNode?.attr('content') || titleNode?.text(), summary: summary?.attr('content') || summary?.text() || '', url: link.attr('href') || link.attr('data-url') || link.attr('content'),
          publishedAt: date?.attr('datetime') || date?.attr('content') || date?.text(), author: rules.author ? find(node, rules.author).text() : '',
          body: rules.body ? find(node, rules.body).text() : '', images: imageNodes?.map((_, image) => $(image).attr('src') || $(image).attr('data-src') || $(image).attr('content')).get() });
      });
      if (rules.next) next = $(rules.next).first().attr('href');
    }
  } catch { throw new SourceFetchError('invalid-selector', 'CSS 选择器无效，请修改规则后预览'); }
  for (const key of ['title', 'summary', 'url', 'publishedAt', 'images', 'body'] as const) counts[key] = records.filter(record => !!record[key]).length;
  const empty = !records.length && /no (?:results|articles|stories|news) (?:found|available)|nothing found|暂无(?:内容|新闻|结果)|没有(?:内容|新闻|结果)/i.test(text);
  if (!empty && (!records.length || (!counts.title && !counts.body) || !counts.url)) throw new SourceFetchError('structure-invalid', '解析结构未匹配到标题或正文及链接，请检查来源规则；不会自动调用 AI');
  return { records, next: next ? new URL(next, url).href : undefined, counts, empty, matched, limited: matched > records.length };
}
export function clippedPageFragment(html: string, limit = 12000) {
  const $ = load(html);
  $('script, style, link:not([itemprop]), iframe, form, input, button, nav, footer, noscript, svg, canvas, [role="navigation"], [role="dialog"]').remove();
  $('*').each((_, node) => {
    const element = $(node);
    for (const name of Object.keys(element.attr() || {})) {
      if (['src', 'srcset', 'data-src', 'data-srcset'].includes(name)) element.attr(name, '');
      else if (!['class', 'id', 'href', 'datetime', 'itemprop', 'property', 'content', 'role', 'data-testid', 'data-qa'].includes(name)) element.removeAttr(name);
      else if (name === 'href') { try { const value = new URL(element.attr(name)!, 'https://example.invalid'); element.attr(name, (value.origin === 'https://example.invalid' ? value.pathname : value.origin + value.pathname).slice(0, 200)); } catch { element.removeAttr(name); } }
    }
    if (element.is('meta') && /image|video|audio/i.test(element.attr('property') || element.attr('itemprop') || '')) element.attr('content', '');
    element.contents().each((_, child) => {
      if (child.type === 'comment') $(child).remove();
      else if (child.type === 'text') child.data = child.data.replace(/\s+/g, ' ').trim().slice(0, 160);
    });
  });
  // Only the AI copy is reduced; extraction still reads the unchanged page snapshot.
  for (const parent of $('*').toArray().reverse()) {
    const groups = new Map<string, (typeof parent)[]>();
    $(parent).children().each((_, node) => {
      const element = $(node);
      const shape = JSON.stringify([node.tagName, element.attr('class'), element.attr('id'), element.attr('role'),
        element.children().map((_, child) => `${child.tagName}.${$(child).attr('class') || ''}`).get(), !!element.find('img').length, !!element.find('time').length]);
      const group = groups.get(shape) || []; group.push(node); groups.set(shape, group);
    });
    for (const group of groups.values()) if (group.length > 3) group.forEach((node, index) => {
      if (index !== 0 && index !== Math.floor(group.length / 2) && index !== group.length - 1) $(node).remove();
    });
  }
  const fragment = $('body').html() || '';
  if (fragment.length <= limit) return fragment;
  const size = Math.floor((limit - 600) / 6);
  return Array.from({ length: 6 }, (_, index) => {
    const position = Math.floor((fragment.length - size) * index / 5);
    const start = fragment.indexOf('<', position);
    const end = fragment.lastIndexOf('>', position + size) + 1;
    return `<!-- 页面结构样本 ${index + 1}/6 -->\n${start >= 0 && end > start ? fragment.slice(start, end) : ''}`;
  }).join('\n');
}
