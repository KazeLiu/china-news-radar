export async function requestJson<T>(url: string, options: RequestInit = {}, allowEmpty = false): Promise<T> {
  const headers = new Headers(options.headers);
  if (!headers.has('Content-Type')) headers.set('Content-Type', 'application/json');
  let response: Response;
  try {
    response = await fetch(url, { cache: 'no-store', ...options, headers });
  } catch (cause) {
    throw new Error('未收到服务响应，请检查服务状态和网络连接。', { cause });
  }
  if (!response.ok) {
    const body = await response.json().catch(() => null);
    const message = body?.message ?? body?.error;
    const detail = typeof message === 'string' ? message
      : Array.isArray(message) && message.every(value => typeof value === 'string') ? message.join('；')
      : [502, 504].includes(response.status) ? '代理未收到后台的完整响应，请检查后台状态和代理等待时间。' : '服务请求失败。';
    const reason = typeof body?.detail === 'string' ? ` ${body.detail}` : '';
    const requestId = typeof body?.requestId === 'string' && /^[A-Za-z0-9_.:-]{1,160}$/.test(body.requestId) ? ` 请求 ID：${body.requestId}` : '';
    throw new Error(`HTTP ${response.status}：${detail}${reason}${requestId}`);
  }
  if (response.status === 204) return undefined as T;
  const text = await response.text();
  if (allowEmpty && !text.trim()) return null as T;
  try { return JSON.parse(text) as T; }
  catch (cause) { throw new Error(`HTTP ${response.status}：服务返回的响应不是有效 JSON，请检查服务和代理配置。`, { cause }); }
}
