import { APIConnectionError, APIConnectionTimeoutError, APIError } from 'openai';

export const AI_TIMEOUT_MS = 120_000;

export class InvalidAnalysisResponse extends Error {
  constructor(readonly detail: string, readonly requestId?: string | null) { super(detail); }
}
export class ResponsesFailure extends Error {
  constructor(readonly detail: string, readonly retryable: boolean, readonly requestId?: string | null) { super(detail); }
}

const networkDetails: Record<string, string> = {
  ENOTFOUND: '无法解析提供商域名，请检查 Base URL 和 DNS。',
  EAI_AGAIN: '域名解析暂时失败，请检查 DNS 或稍后再试。',
  ECONNREFUSED: '连接被拒绝，请检查提供商服务和端口是否可用。',
  ECONNRESET: '连接被对方或中间代理重置，尚未收到完整响应。',
  ETIMEDOUT: '连接模型服务超时，请检查网络和提供商状态。',
  UND_ERR_CONNECT_TIMEOUT: '建立连接超时，请检查网络和提供商状态。',
  CERT_HAS_EXPIRED: '提供商 HTTPS 证书已过期。',
  UNABLE_TO_VERIFY_LEAF_SIGNATURE: '无法验证提供商的 HTTPS 证书链。',
  DEPTH_ZERO_SELF_SIGNED_CERT: '提供商使用了无法验证的自签名证书。',
  ERR_TLS_CERT_ALTNAME_INVALID: '提供商 HTTPS 证书与访问域名不匹配。',
};
function networkCause(problem: unknown): string | undefined {
  let current = problem as { code?: unknown; cause?: unknown } | null;
  for (let depth = 0; current && depth < 4; depth++) {
    if (typeof current.code === 'string' && Object.hasOwn(networkDetails, current.code)) return current.code;
    current = current.cause as typeof current;
  }
}
function safeRequestId(value: unknown, apiKey: string): string | undefined {
  if (typeof value !== 'string' || !/^[A-Za-z0-9_.:-]{1,160}$/.test(value) || (apiKey && value.includes(apiKey)) || /sk-/i.test(value)) return undefined;
  return value;
}
export function aiTestError(problem: unknown, apiKey: string, timeoutMs = AI_TIMEOUT_MS) {
  const failure = problem as { status?: unknown; request_id?: unknown } | null;
  const status = typeof failure?.status === 'number' ? failure.status : undefined;
  const requestId = safeRequestId(problem instanceof InvalidAnalysisResponse || problem instanceof ResponsesFailure ? problem.requestId : failure?.request_id, apiKey);
  const identifiers = requestId ? { requestId } : {};
  if (problem instanceof InvalidAnalysisResponse) return {
    code: 'invalid-response', errorType: 'InvalidAnalysisResponse',
    message: '接口已响应，但模型输出不符合项目要求。', detail: problem.detail, ...identifiers,
  };
  if (problem instanceof ResponsesFailure) return {
    code: 'response-failed', errorType: 'ResponsesFailure', message: '模型生成未完成。', detail: problem.detail, ...identifiers,
  };
  if (problem instanceof APIConnectionTimeoutError) return {
    code: 'timeout', errorType: 'APIConnectionTimeoutError',
    message: `调用超过 ${timeoutMs / 1000} 秒仍未完成。`,
    detail: '截止超时仍未收到完整响应，提供商可能仍在处理本次请求。', ...identifiers,
  };
  const networkCode = networkCause(problem);
  if (problem instanceof APIConnectionError || (!status && networkCode)) return {
    code: 'connection-error', errorType: 'APIConnectionError',
    message: '与模型服务的连接未完成。',
    detail: networkCode ? networkDetails[networkCode] : '未收到可用的 HTTP 响应，请检查 Base URL、网络、代理和 HTTPS 证书。',
    ...(networkCode ? { networkCode } : {}), ...identifiers,
  };
  if (status) {
    const detail = status === 401 || status === 403 ? '认证或访问被拒绝，请检查 API Key 和模型权限。'
      : status === 404 ? '接口或模型不存在，请检查 Base URL（通常以 /v1 结尾）和模型名称。'
      : status === 429 ? '服务限流或账户额度不足，请检查提供商的用量与余额。'
      : status === 400 || status === 422 ? '服务不接受当前请求，请检查模型是否支持 Responses API、输入消息和 text.format JSON 输出。'
      : status >= 500 ? '提供商服务出错，请用请求 ID 在提供商后台核对错误记录。'
      : '提供商返回非成功 HTTP 状态，请核对提供商的请求记录。';
    return { code: 'http-error', errorType: problem instanceof APIError ? problem.constructor.name : 'APIError', status,
      message: `模型服务返回 HTTP ${status}。`, detail, ...identifiers };
  }
  // Do not return provider messages, response bodies or stacks, which may contain credentials.
  return { code: 'unknown-error', errorType: 'UnknownError', message: 'AI 调用发生未识别异常。',
    detail: '未获得可用的 HTTP 状态或模型结果，请核对提供商的请求记录。', ...identifiers };
}

export function analysisErrorDetail(problem: unknown): string {
  if (problem instanceof SyntaxError) return '模型输出不是有效 JSON。';
  const details: Record<string, string> = {
    'AI JSON too large': '模型输出超过允许的 32000 字符。',
    'AI JSON object required': '模型必须返回一个 JSON 对象。',
    'AI JSON fields invalid': 'JSON 字段缺失或含额外字段，请对照面板中的 JSON 协议。',
    'AI JSON enum invalid': '分类、语言、版本或主题字段不在允许范围内。',
    'AI JSON text invalid': '理由或译文的类型、长度不符合 JSON 协议。',
    'AI JSON text empty': '必须填写的理由或译文为空。',
    'Simplified Chinese must not be translated again': '简体中文原文的 translation 必须为 null。',
    'Translation required': '非简体中文内容缺少 translation 对象。',
    'Translation summary missing': '原文有摘要，但模型没有返回摘要译文。',
  };
  return problem instanceof Error && Object.hasOwn(details, problem.message) ? details[problem.message] : '模型结果不符合 JSON 协议。';
}
