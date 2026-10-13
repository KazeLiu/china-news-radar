import { describe, expect, it } from 'vitest';
import { analysisKey, parseAnalysis } from './analysis';

const v1 = { version: 1, relation: 'related', topics: ['policy'], type: 'report', language: 'zh-Hans', reason: '涉及中国政策', translation: null };
describe('compatible editorial analysis', () => {
  it('accepts a scored response and preserves completed version-one responses', () => {
    const scoring = { relevance: 8, novelty: 7, audience: 8, quality: 7, importance: 'high', tags: ['贸易'] };
    expect(parseAnalysis(JSON.stringify({ ...v1, version: 2, scoring }))).toMatchObject({ version: 2, scoring });
    expect(parseAnalysis(JSON.stringify(v1))).toEqual(v1);
  });
  it('rejects invalid scoring without accepting a partial translation', () => {
    expect(() => parseAnalysis(JSON.stringify({ ...v1, version: 2, scoring: { relevance: 11 } }))).toThrow();
  });
  it('keeps version-one keys available while new analysis uses a separate protocol key', () => {
    const input = { title: '中国政策', summary: '贸易政策发布' };
    expect(analysisKey(input)).not.toBe(analysisKey(input, 1));
  });
});
