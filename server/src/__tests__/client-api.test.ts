import { afterEach, describe, expect, it, vi } from 'vitest';
import { requestJson } from '../../../client-next/services/http';
import { digestApi } from '../../../client-next/services/api';
import { digestJobs } from '../../../client-next/services/digestJobs';
import { fetchCuratedSSR, fetchDigestSSR, fetchHotspotsSSR, fetchRecentDigestsSSR } from '../../../client-next/lib/server-api';

afterEach(() => vi.unstubAllGlobals());
describe('frontend request failure handling', () => {
  it('preserves JSON, no-content responses and request headers', async () => {
    const fetch = vi.fn().mockResolvedValueOnce(new Response('{"ok":true}')).mockResolvedValueOnce(new Response(null, { status: 204 }));
    vi.stubGlobal('fetch', fetch);
    expect(await requestJson('/api/news/status', { headers: new Headers({ 'X-Admin-Token': 'test-token' }) })).toEqual({ ok: true });
    expect(fetch.mock.calls[0][1].headers.get('X-Admin-Token')).toBe('test-token');
    expect(fetch.mock.calls[0][1].headers.get('Content-Type')).toBe('application/json');
    expect(await requestJson('/api/keywords/id', { method: 'DELETE' })).toBeUndefined();
  });
  it('reports Nest validation errors, proxy errors, invalid JSON and connection failures', async () => {
    vi.stubGlobal('fetch', vi.fn()
      .mockResolvedValueOnce(new Response('{"message":["标题为空","参数无效"]}', { status: 400 }))
      .mockResolvedValueOnce(new Response('<html>proxy failed</html>', { status: 504 }))
      .mockResolvedValueOnce(new Response('<html>not JSON</html>'))
      .mockRejectedValueOnce(new TypeError('connection refused')));
    await expect(requestJson('/api/news/status')).rejects.toThrow('HTTP 400：标题为空；参数无效');
    await expect(requestJson('/api/news/status')).rejects.toThrow('HTTP 504');
    await expect(requestJson('/api/news/status')).rejects.toThrow('不是有效 JSON');
    await expect(requestJson('/api/news/status')).rejects.toThrow('未收到服务响应');
  });
  it('treats only a successful empty digest response as an absent record', async () => {
    vi.stubGlobal('fetch', vi.fn()
      .mockResolvedValueOnce(new Response(''))
      .mockResolvedValueOnce(new Response(''))
      .mockResolvedValueOnce(new Response('', { status: 500 }))
      .mockResolvedValueOnce(new Response('', { status: 503 })));
    expect(await digestApi.getByDate('2026-10-12')).toBeNull();
    expect(await fetchDigestSSR('2026-10-12')).toBeNull();
    await expect(digestApi.getByDate('2026-10-12')).rejects.toThrow('HTTP 500');
    await expect(fetchDigestSSR('2026-10-12')).rejects.toThrow('HTTP 503');
  });
  it('does not replace SSR backend failures with empty feeds or empty date lists', async () => {
    vi.stubGlobal('fetch', vi.fn().mockImplementation(async () => new Response('', { status: 503 })));
    await expect(fetchCuratedSSR()).rejects.toThrow('HTTP 503');
    await expect(fetchHotspotsSSR()).rejects.toThrow('HTTP 503');
    await expect(fetchRecentDigestsSSR()).rejects.toThrow('HTTP 503');
  });
  it('deduplicates generation jobs and releases a failed job without hiding the rejection', async () => {
    let reject!: (error: Error) => void;
    const runner = vi.fn(() => new Promise<void>((_, fail) => { reject = fail; }));
    const first = digestJobs.start('2026-10-12', runner);
    expect(digestJobs.start('2026-10-12', runner)).toBe(first);
    expect(digestJobs.isGenerating('2026-10-12')).toBe(true);
    const rejected = expect(first).rejects.toThrow('generation failed');
    reject(new Error('generation failed'));
    await rejected;
    expect(runner).toHaveBeenCalledOnce();
    expect(digestJobs.isGenerating('2026-10-12')).toBe(false);
    await digestJobs.start('2026-10-12', async () => {});
  });
});
