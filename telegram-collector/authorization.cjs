const { RPCError } = require('teleproto/errors');
const { CollectorError, backendRequest, requireCredentials, failure, createClient, saveSession } = require('./account.cjs');

class Authorization {
  constructor(workerId, id, current) {
    this.workerId = workerId; this.id = id; this.current = current;
    this.step = '连接 Telegram / 申请验证码';
    this.controller = new AbortController();
  }
  report(phase, detail = {}) { return backendRequest('auth/report', { workerId: this.workerId, id: this.id, phase, ...detail }); }
  deliver(auth) {
    if (this.waiter && auth?.id === this.id && auth.promptId === this.waiter.promptId && auth.input !== undefined) {
      const waiter = this.waiter; this.waiter = undefined; waiter.resolve(auth.input);
      auth.input = undefined;
    }
  }
  cancel() {
    this.controller.abort();
    if (this.waiter) { this.waiter.reject(new CollectorError('login-cancelled', '授权已取消，请重新开始登录。')); this.waiter = undefined; }
    return this.close();
  }
  close() { return this.closing ??= this.client?.destroy() ?? Promise.resolve(); }
  async input(phase, delivery) {
    this.step = phase === 'password' ? '验证两步验证密码' : '验证登录验证码';
    this.controller.signal.throwIfAborted();
    const { promptId } = await this.report(phase, { delivery, ...(this.inputError ? { error: this.inputError } : {}) });
    this.controller.signal.throwIfAborted(); this.inputError = undefined;
    let value = await new Promise((resolve, reject) => { this.waiter = { promptId, resolve, reject }; });
    this.controller.signal.throwIfAborted();
    await this.report('verifying');
    const submitted = value; value = undefined; return submitted;
  }
  async run() {
    try {
      await this.report('connecting');
      this.controller.signal.throwIfAborted();
      if (!this.current.phone) throw new CollectorError('phone-missing', '请先在账号配置中保存 Telegram 注册手机号。');
      this.client = createClient(requireCredentials(this.current), '');
      await this.client.start({
        phoneNumber: this.current.phone,
        phoneCode: (_viaApp, info) => this.input('code', info.type),
        password: () => this.input('password'),
        firstAndLastNames: async () => { throw new CollectorError('account-not-found', '此手机号没有可登录的 Telegram 账号，请先在官方客户端确认；采集器不会注册新账号。'); },
        onError: error => {
          if (this.controller.signal.aborted) throw error;
          if (error instanceof RPCError && ['PHONE_CODE_INVALID', 'PASSWORD_HASH_INVALID'].includes(error.errorMessage)) { this.inputError = failure(error); return false; }
          throw error;
        },
      });
      this.controller.signal.throwIfAborted();
      // Check cancellation/config changes once more before replacing the persistent session.
      const latest = await backendRequest('control', { workerId: this.workerId });
      if (latest.auth?.id !== this.id || latest.credentials.revision !== this.current.revision || latest.credentials.proxyUrl !== this.current.proxyUrl) throw new CollectorError('login-cancelled', '授权期间配置已变化，请重新开始登录。');
      this.controller.signal.throwIfAborted(); saveSession(this.client);
      await this.report('authorized');
    } catch (error) {
      if (!this.controller.signal.aborted) {
        const detail = failure(error, this.current);
        detail.message = `授权停止在“${this.step}”步骤。${detail.message}`;
        try { await this.report('failed', { error: detail }); }
        catch (reportError) { if (reportError.status !== 409) this.pendingFailure = detail; }
      }
    } finally { await this.close(); }
  }
}
module.exports = { Authorization };
