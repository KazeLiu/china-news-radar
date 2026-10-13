import { describe, expect, it } from 'vitest';
import { canonicalUrl, eventKey, isDomesticUrl, plainText, publisherForUrl, relevantToChina, retryAfterMs, safePublishedAt, shouldDisplay, topicFor, withinNewsWindow } from './rules';

describe('news relevance and attribution', () => {
  it('includes China, cross-strait policy, Chinese companies and Chinese text', () => {
    for (const title of ['Beijing weighs new property measures', 'US tariff policy targets China', 'Taiwan says military drills threaten security', 'Huawei faces fresh US export restrictions', '中国政府考虑调整政策']) expect(relevantToChina(title)).toBe(true);
  });
  it('excludes unrelated global news and routine sports but retains policy surrounding sport', () => {
    expect(relevantToChina('OpenAI launches a new model')).toBe(false);
    expect(relevantToChina('Medvedev wins China Open tennis match')).toBe(false);
    expect(relevantToChina('China bans foreign football broadcasts under new policy')).toBe(true);
  });
  it('accepts publisher subdomains, never lookalike hosts or domestic sources', () => {
    expect(publisherForUrl('https://cn.nikkei.com/report')).toBe('Nikkei Asia');
    expect(publisherForUrl('https://reuters.com.attacker.example/report')).toBeNull();
    expect(isDomesticUrl('https://www.cls.cn/report')).toBe(true);
    expect(isDomesticUrl('https://cn.nikkei.com/report')).toBe(false);
  });
  it('classifies relevant headlines without asserting truth', () => {
    expect(topicFor('China military exercises around Taiwan')).toBe('security');
    expect(topicFor('EU tariff deal with China')).toBe('economy');
    expect(topicFor('Huawei chip export rules')).toBe('technology');
    expect(topicFor('EU halves Chinese hybrid vehicle exports')).toBe('economy');
    expect(topicFor('Taiwan boosting its defences is not provocation')).toBe('security');
  });
  it('filters culture, stock quote pages and opinion while preserving hard news', () => {
    expect(relevantToChina('Check out China Holdings stock price in real time')).toBe(false);
    expect(relevantToChina('Hurkacz hands Djokovic early Shanghai exit')).toBe(false);
    expect(shouldDisplay('Chinese dancer releases memoir', '', 'https://theguardian.com/books/story')).toBe(false);
    expect(shouldDisplay('China bans foreign books under new policy', '', 'https://theguardian.com/books/story')).toBe(true);
    expect(shouldDisplay('China trade war', '', 'https://theguardian.com/commentisfree/story')).toBe(false);
  });
  it('does not confuse bands with bans when filtering music features', () => {
    const title = 'As punk turns 50, bands from China to Greenland explain their lives';
    expect(shouldDisplay(title, 'Musicians describe punk on the frontline in Ukraine.', 'https://theguardian.com/music/story')).toBe(false);
    expect(topicFor(title)).toBe('society');
    for (const headline of ['China bans foreign concerts', 'China banned foreign concerts', 'China is banning foreign concerts']) {
      expect(shouldDisplay(headline, '', 'https://theguardian.com/music/story')).toBe(true);
      expect(topicFor(headline)).toBe('policy');
    }
  });
});

describe('news URL, deduplication and time', () => {
  it('drops tracking and fragments while preserving meaningful query parameters', () => {
    expect(canonicalUrl('https://example.org/news?id=9&utm_source=tg#top')).toBe('https://example.org/news?id=9');
    expect(canonicalUrl('javascript:alert(1)')).toBeNull();
    expect(canonicalUrl('https://user:secret@example.org')).toBeNull();
  });
  it('merges only identical normalized headlines, not unrelated word overlap', () => {
    expect(eventKey('China announces policy — Reuters')).toBe(eventKey('China announces policy'));
    expect(eventKey('China announces trade policy')).not.toBe(eventKey('China announces visa policy'));
  });
  it('rejects malformed or future dates and keeps missing publication time explicit', () => {
    const now = new Date('2026-10-10T12:00:00Z');
    expect(safePublishedAt('garbage', now)).toBeNull();
    expect(safePublishedAt('2026-10-11T12:00:00Z', now)).toBeNull();
    expect(safePublishedAt(undefined, now)).toBeNull();
    expect(withinNewsWindow(new Date('2026-09-01'), now)).toBe(false);
    expect(withinNewsWindow(null, now)).toBe(true);
  });
  it('honors rate-limit delay with bounded sensible defaults', () => {
    expect(retryAfterMs('120')).toBe(120_000);
    expect(retryAfterMs(undefined)).toBe(300_000);
    expect(retryAfterMs('0')).toBe(60_000);
  });
  it('strips markup and scripts before storing excerpts', () => {
    expect(plainText('<p>China <b>policy</b></p><script>alert(1)</script>')).toBe('China policy');
  });
});
