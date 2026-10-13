import { describe, expect, it } from 'vitest';
import { restoreFailures } from './feed-fetch';

describe('persisted RSS backoff', () => {
  it('preserves valid retry information and accepts an absent initial state', () => {
    const failures = { 'https://example.org/rss': { retryAt: '2026-10-12T00:00:00Z', error: 'HTTP 429', status: 429 } };
    expect(restoreFailures(JSON.stringify(failures))).toEqual(failures);
    expect(restoreFailures()).toEqual({});
    expect(restoreFailures('{}')).toEqual({});
  });
  it.each(['', '{', 'null', '[]', '"bad"', '{"feed":null}', '{"feed":{"retryAt":"bad","error":"HTTP 429","status":429}}', '{"feed":{"retryAt":"2026-10-12","error":"HTTP 429","status":"429"}}'])('does not reset invalid state to an empty backoff: %s', raw => {
    expect(() => restoreFailures(raw)).toThrow('重试状态无效');
  });
});
