import { HEADERS_METADATA } from '@nestjs/common/constants';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { NewsController } from './news.controller';
import { NewsService } from './news.service';
import { PrismaService } from '../prisma/prisma.service';

afterEach(() => vi.unstubAllEnvs());
describe('saved administrator AI key', () => {
  it('returns the saved key only after administrator authentication and disables response caching', () => {
    const token = 'test-only-admin-token-32-characters'; vi.stubEnv('ADMIN_TOKEN', token);
    const service = { adminAiKey: vi.fn(() => ({ apiKey: 'test-only-saved-key' })) };
    const controller = new NewsController(service as unknown as NewsService);
    const request = { headers: { host: 'localhost:3411' }, socket: { remoteAddress: '127.0.0.1' } };
    expect(() => controller.aiKey(request)).toThrow();
    expect(() => controller.aiKey({ ...request, headers: { ...request.headers, 'x-admin-token': 'wrong-token' } })).toThrow();
    expect(service.adminAiKey).not.toHaveBeenCalled();
    expect(controller.aiKey({ ...request, headers: { ...request.headers, 'x-admin-token': token } })).toEqual({ apiKey: 'test-only-saved-key' });
    expect(Reflect.getMetadata(HEADERS_METADATA, NewsController.prototype.aiKey)).toContainEqual({ name: 'Cache-Control', value: 'no-store' });
  });
  it('rejects remote visitors when no administrator token is configured', () => {
    vi.stubEnv('ADMIN_TOKEN', '');
    const service = { adminAiKey: vi.fn() }; const controller = new NewsController(service as unknown as NewsService);
    expect(() => controller.aiKey({ headers: { host: 'localhost:3411' }, socket: { remoteAddress: '203.0.113.10' } })).toThrow();
    expect(service.adminAiKey).not.toHaveBeenCalled();
  });
  it('reads the in-memory saved value without changing settings or invoking a model', () => {
    vi.stubEnv('AI_ANALYSIS_ENABLED', 'false'); vi.stubEnv('OPENAI_API_KEY', 'test-only-saved-key');
    const service = new NewsService({} as PrismaService);
    expect(service.adminAiKey()).toEqual({ apiKey: 'test-only-saved-key' });
    service['config'].ai.apiKey = 'replacement-fixture';
    expect(service.adminAiKey()).toEqual({ apiKey: 'replacement-fixture' });
    expect(service['ai']).toBeNull();
  });
});
