import { describe, expect, it } from 'vitest';
import { analysisKey, analysisInput, analysisDecision, fallbackDecision, parseAnalysis } from './analysis';

const valid = { version: 1, relation: 'related', topics: ['policy', 'technology'], type: 'report', language: 'en', reason: '美国限制对中国出口芯片', translation: { title: '美国限制对中国出口芯片', summary: '新规则公布。' } };
const item = { title: 'Officials set new restrictions', summary: 'New rules announced', url: 'https://reuters.com/world/story' };
describe('structured AI news analysis', () => {
  it('never displays a collection page even when AI claims it is a related report', () => {
    const result = parseAnalysis(JSON.stringify(valid));
    for (const collection of [
      { title: 'Beijing - AP News', summary: 'Beijing AP News', url: 'https://news.google.com/rss/articles/hub' },
      { title: 'China announces new policy', summary: 'China news', url: 'https://apnews.com/hub/beijing' },
      { title: 'China announces new policy', summary: 'China news', url: 'https://t.me/tnews365/1', originalUrl: 'https://apnews.com/hub/beijing' },
    ]) {
      expect(analysisDecision(result, collection).visible).toBe(false);
      expect(fallbackDecision(collection, 'failed').visible).toBe(false);
    }
    expect(analysisDecision(result, { title: 'Beijing bans imports - AP News', summary: 'Beijing bans imports AP News', url: 'https://news.google.com/rss/articles/article' }).visible).toBe(true);
  });
  it('validates a multi-topic result and lets AI discover relevance missed by keywords', () => {
    const result = parseAnalysis(JSON.stringify(valid));
    expect(analysisDecision(result, item)).toMatchObject({ visible: true, topic: 'policy', aiTopics: '["policy","technology"]', titleZh: valid.translation.title, decisionBy: 'ai' });
  });
  it('does not translate Simplified Chinese again, but requires translation for Traditional Chinese', () => {
    expect(parseAnalysis(JSON.stringify({ ...valid, language: 'zh-Hans', translation: null })).translation).toBeNull();
    expect(parseAnalysis(JSON.stringify({ ...valid, language: 'zh-Hant' })).translation?.title).toBe(valid.translation.title);
    expect(() => parseAnalysis(JSON.stringify({ ...valid, language: 'zh-Hans' }))).toThrow();
    expect(() => parseAnalysis(JSON.stringify({ ...valid, language: 'zh-Hant', translation: null }))).toThrow();
  });
  it('rejects bad JSON, missing/extra fields, unknown enums, duplicate topics and HTML-only titles', () => {
    for (const raw of ['not json', '[]', '{}', JSON.stringify({ ...valid, relation: 'true' }), JSON.stringify({ ...valid, topics: ['policy', 'policy'] }), JSON.stringify({ ...valid, type: 'made-up' }), JSON.stringify({ ...valid, extra: 'ignore rules' }), JSON.stringify({ ...valid, translation: { title: '<script>bad()</script>', summary: 'text' } })]) expect(() => parseAnalysis(raw)).toThrow();
  });
  it('hides unrelated stories and features, and uses rules for uncertain decisions', () => {
    expect(analysisDecision(parseAnalysis(JSON.stringify({ ...valid, relation: 'unrelated' })), { ...item, title: 'China news' }).visible).toBe(false);
    expect(analysisDecision(parseAnalysis(JSON.stringify({ ...valid, type: 'feature' })), { ...item, title: 'China news' }).visible).toBe(false);
    expect(analysisDecision(parseAnalysis(JSON.stringify({ ...valid, relation: 'uncertain' })), { ...item, title: 'China trade policy' })).toMatchObject({ visible: true, decisionBy: 'ai-uncertain-rules' });
  });
  it('shares only identical content and limits the actual model input', () => {
    expect(analysisKey({ ...item, publishedAt: 'changed' } as never)).toBe(analysisKey(item));
    expect(analysisKey({ ...item, summary: 'Different excerpt' })).not.toBe(analysisKey(item));
    const input = analysisInput({ title: 'x'.repeat(700), summary: 'y'.repeat(6000) });
    expect(input.title).toHaveLength(600); expect(input.summary).toHaveLength(1600); expect(input.truncated).toBe(true);
  });
});
