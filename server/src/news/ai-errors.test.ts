import { describe, expect, it } from 'vitest';
import { APIConnectionError, APIConnectionTimeoutError, APIError } from 'openai';
import { aiTestError, analysisErrorDetail, InvalidAnalysisResponse } from './ai-errors';

describe('safe AI diagnostics', () => {
  it('recognizes the actual SDK timeout even though its name is Error', () => {
    const error = new APIConnectionTimeoutError(); expect(error.name).toBe('Error');
    expect(aiTestError(error, '')).toMatchObject({ code: 'timeout', errorType: 'APIConnectionTimeoutError' });
  });
  it.each(['ENOTFOUND', 'ECONNRESET', 'CERT_HAS_EXPIRED', 'UND_ERR_CONNECT_TIMEOUT'])('reads nested network cause %s', code => {
    const cause = Object.assign(new Error('secret'), { cause: { code } });
    const output = aiTestError(new APIConnectionError({ cause }), 'secret');
    expect(output).toMatchObject({ code: 'connection-error', networkCode: code }); expect(JSON.stringify(output)).not.toContain('secret');
  });
  it.each(['contains spaces', 'sk-provider-credential', 'private-key', 'a'.repeat(161)])('omits an unsafe request identifier', requestId => {
    const output = aiTestError(APIError.generate(401, { error: { message: 'private-key' } }, undefined, { 'x-request-id': requestId }), 'private-key');
    expect(output).not.toHaveProperty('requestId'); expect(JSON.stringify(output)).not.toContain('private-key');
  });
  it('does not expose unknown exception messages, stacks or codes', () => {
    const output = aiTestError(Object.assign(new Error('private-key'), { code: 'private-key' }), 'private-key');
    expect(output).toMatchObject({ code: 'unknown-error' }); expect(JSON.stringify(output)).not.toContain('private-key');
  });
  it('returns only known validation reasons and safe request metadata', () => {
    expect(analysisErrorDetail(new SyntaxError('private-key'))).toBe('模型输出不是有效 JSON。');
    expect(analysisErrorDetail(new Error('private-key'))).toBe('模型结果不符合 JSON 协议。');
    expect(aiTestError(new InvalidAnalysisResponse(analysisErrorDetail(new Error('Translation summary missing')), 'req-valid'), 'private-key')).toMatchObject({ code: 'invalid-response', detail: expect.stringContaining('摘要译文'), requestId: 'req-valid' });
  });
});
