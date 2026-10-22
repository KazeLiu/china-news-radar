const fs = require('node:fs');
const path = require('node:path');
const http = require('node:http');
const https = require('node:https');
const { TelegramClient } = require('teleproto');
const { StringSession } = require('teleproto/sessions');
const { Logger, LogLevel } = require('teleproto/extensions/Logger');
const { RPCError, FloodWaitError } = require('teleproto/errors');
const { httpProxySocket, TelegramProxyError } = require('./proxy.cjs');

const envFile = path.join(__dirname, '.env');
if (fs.existsSync(envFile)) process.loadEnvFile(envFile);
process.umask(0o077);
const state = path.resolve(process.env.TG_STATE_DIR || path.join(__dirname, 'state'));
const sessionFile = process.env.TG_NODE_SESSION || path.join(state, 'reader.node-session');

class CollectorError extends Error {
  constructor(code, message, status) { super(message); this.code = code; this.status = status; }
}

async function backendRequest(route = '', payload) {
  const token = process.env.COLLECTOR_TOKEN || '';
  if (token.length < 32) throw new CollectorError('collector-auth-failed', '内部通信令牌缺失或无效，请核对 COLLECTOR_TOKEN。');
  const base = (process.env.RADAR_INGEST_URL || 'http://server:3001/api/news/telegram').replace(/\/$/, '');
  let response;
  try {
    const url = new URL(`${base}${route ? `/${route}` : ''}`);
    const body = payload === undefined ? undefined : JSON.stringify(payload);
    // Node fetch adds Sec-Fetch headers, which the private collector endpoint rejects.
    response = await new Promise((resolve, reject) => {
      const request = (url.protocol === 'https:' ? https : http).request(url, {
        method: body === undefined ? 'GET' : 'POST', signal: AbortSignal.timeout(15_000),
        headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json', 'Cache-Control': 'no-store',
          ...(body === undefined ? {} : { 'Content-Length': Buffer.byteLength(body) }) },
      }, incoming => {
        const chunks = [];
        incoming.on('data', chunk => chunks.push(chunk));
        incoming.once('error', reject);
        incoming.once('end', () => resolve({ status: incoming.statusCode, body: Buffer.concat(chunks).toString('utf8') }));
      });
      request.once('error', reject);
      request.end(body);
    });
  } catch {
    throw new CollectorError('backend-unreachable', '无法连接本站后端，请确认服务正在运行，并核对 RADAR_INGEST_URL。');
  }
  if (response.status === 401) throw new CollectorError('collector-auth-failed', '本站后端拒绝了采集令牌（HTTP 401）。本地预览请重启预览；独立部署请核对双方的 COLLECTOR_TOKEN。', 401);
  if (response.status === 403) throw new CollectorError('collector-auth-failed', '本站后端拒绝此请求方式（HTTP 403），请使用采集器专用接口，不要经网页代理转发。', 403);
  if (response.status === 409) throw new CollectorError(route === 'control' ? 'collector-already-running' : 'authorization-changed', route === 'control' ? '已有采集器在线，请停止重复实例后再启动。' : '本次授权已取消、过期或步骤改变，请在账号页重新开始登录。', 409);
  if (response.status < 200 || response.status >= 300) throw new CollectorError('backend-http', `本站接口返回 HTTP ${response.status}，请检查后端接收开关和来源配置。`, response.status);
  try { return JSON.parse(response.body); }
  catch { throw new CollectorError('backend-response-invalid', '本站后端返回了无效响应，请核对采集接口地址。'); }
}

async function credentials(allowEnvironment = true) {
  let saved = {};
  if (process.env.COLLECTOR_TOKEN) {
    try { saved = await backendRequest('credentials'); }
    catch (error) {
      if (!allowEnvironment || error.code === 'collector-auth-failed' || !process.env.TG_API_ID || !process.env.TG_API_HASH) throw error;
    }
  }
  return requireCredentials({ apiId: saved.apiId || process.env.TG_API_ID || '', apiHash: saved.apiHash || process.env.TG_API_HASH || '',
    phone: saved.phone || '', revision: saved.revision || 'environment', proxyUrl: saved.proxyUrl || '' });
}

function requireCredentials(current) {
  if (!/^[1-9]\d{0,9}$/.test(current.apiId) || Number(current.apiId) > 2147483647 || !/^[a-f\d]{32}$/i.test(current.apiHash)) throw new CollectorError('credentials-missing', '请在后台保存有效的 Telegram API ID 和 API Hash。');
  return current;
}

function failure(error, current) {
  if (error instanceof CollectorError) return { code: error.code, message: error.message };
  if (error instanceof TelegramProxyError) return { code: 'proxy-connection-failed', message: error.message };
  if (error instanceof FloodWaitError) return { code: 'rate-limited', message: `Telegram 要求等待 ${error.seconds} 秒，请等待后再操作。` };
  if (error instanceof RPCError) {
    const messages = {
      API_ID_INVALID: ['api-invalid', 'Telegram 拒绝了 API ID / Hash，请核对后台保存的应用凭据。'],
      PHONE_NUMBER_INVALID: ['phone-invalid', 'Telegram 未接受该手机号，请核对注册账号使用的完整号码和国家区号，不要填写 TG_API_ID。'],
      PHONE_NUMBER_BANNED: ['phone-banned', 'Telegram 已限制此手机号登录，请在官方客户端确认账号状态。'],
      PHONE_CODE_INVALID: ['code-invalid', '登录验证码错误，请重新输入本次收到的验证码。'],
      PHONE_CODE_EXPIRED: ['code-expired', '登录验证码已过期，请重新授权获取验证码。'],
      PASSWORD_HASH_INVALID: ['password-invalid', '两步验证密码错误，请重新输入。它不是登录验证码或手机锁屏密码。'],
      AUTH_KEY_UNREGISTERED: ['session-invalid', 'Telegram 登录凭据已失效，请重新授权。'],
      SESSION_REVOKED: ['session-revoked', 'Telegram 登录已被撤销，请重新授权。'],
      AUTH_KEY_DUPLICATED: ['session-duplicated', '同一登录凭据被重复使用，请停止另一采集器后重新授权。'],
    };
    const result = messages[error.errorMessage];
    if (result) return { code: result[0], message: result[1] };
    return { code: 'telegram-rejected', message: 'Telegram 拒绝了当前操作，请确认账号状态及频道访问权限。' };
  }
  if (error?.code === 'ABORT_ERR') return { code: 'login-cancelled', message: '操作已取消，请在账号配置中重新开始登录。' };
  if (error?.message === 'Password is empty' || error?.message === 'Account has 2FA enabled.') return { code: 'password-required', message: 'Telegram 要求输入此账号的两步验证密码，不能留空跳过。请在官方客户端的“隐私与安全 → 两步验证”中确认。' };
  if (error?.message === 'Not a valid string') return { code: 'session-invalid', message: '持久 session 格式无效，请在账号页重新登录。' };
  if (error?.message?.startsWith('Telegram requires a login email') || error?.message?.startsWith('Telegram sent the login code to the account email')) return { code: 'email-login-required', message: 'Telegram 要求通过邮箱验证登录，此入口暂不支持。请先在官方客户端确认账号的登录方式。' };
  if (error?.message?.startsWith('Telegram requires a payment')) return { code: 'official-app-required', message: 'Telegram 要求通过官方客户端完成付费短信验证，请先在官方客户端确认账号状态。' };
  if (['EACCES', 'EPERM', 'ENOSPC', 'EROFS'].includes(error?.code)) return { code: 'state-write-failed', message: '无法写入采集器持久目录，请检查 state 目录权限与剩余空间。' };
  if (error?.message === 'TIMEOUT' || ['ETIMEDOUT', 'ECONNREFUSED', 'ECONNRESET', 'ENETUNREACH', 'EHOSTUNREACH'].includes(error?.code)) return { code: 'connection-failed', message: current?.proxyUrl ? '通过共享代理连接 Telegram 失败，请检查代理服务、地址和端口，以及代理是否允许 Telegram 流量。' : '直连 Telegram 失败。需要代理时，请到“代理设置”启用共享代理，并勾选“Telegram 账号使用代理”。' };
  return { code: 'telegram-failed', message: `Telegram 操作未完成（${current?.proxyUrl ? '共享代理' : '直连'}），请检查账号、网络连接和本机 state 目录的读写权限。` };
}

async function reportStatus(session, current, { phase, channels = [], error } = {}) {
  if (!process.env.COLLECTOR_TOKEN) return;
  try {
    await backendRequest('status', { session, revision: current.revision, credentialsConfigured: !!current.apiId && !!current.apiHash, proxyEnabled: !!current.proxyUrl, running: session === 'authorized' && ['matching', 'listening'].includes(phase),
      channels, ...(phase ? { phase } : {}), ...(error ? { error } : {}) });
  } catch (error) {
    if (!(error instanceof CollectorError)) throw error;
    console.error(failure(error).message);
  }
}

function createClient(current, savedSession) {
  const client = new TelegramClient(new StringSession(savedSession), Number(current.apiId), current.apiHash, { timeout: 30, floodSleepThreshold: 60, baseLogger: new Logger(LogLevel.NONE),
    ...(current.proxyUrl ? { networkSocket: httpProxySocket(current.proxyUrl) } : {}) });
  client.setLogLevel('none');
  return client;
}

function saveSession(client) {
  fs.mkdirSync(path.dirname(sessionFile), { recursive: true });
  fs.writeFileSync(`${sessionFile}.tmp`, client.session.save(), { mode: 0o600 });
  fs.renameSync(`${sessionFile}.tmp`, sessionFile);
}

module.exports = { state, sessionFile, CollectorError, backendRequest, credentials, requireCredentials, failure, reportStatus, createClient, saveSession };
