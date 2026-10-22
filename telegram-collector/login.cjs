const { createInterface } = require('node:readline/promises');
const { Writable } = require('node:stream');
const { credentials, CollectorError, failure, reportStatus, createClient, saveSession } = require('./account.cjs');

async function main() {
  if (!process.stdin.isTTY) throw new CollectorError('terminal-required', '请在自己的交互终端完成 Telegram 授权。');
  process.title = 'Telegram 账号授权';
  const controller = new AbortController();
  let muted = false;
  const output = new Writable({ write(chunk, encoding, done) { if (!muted) process.stdout.write(chunk, encoding); done(); } });
  const terminal = createInterface({ input: process.stdin, output, terminal: true });
  terminal.on('SIGINT', () => controller.abort());
  terminal.on('close', () => controller.abort());
  async function ask(prompt, secret = false) {
    process.stdout.write(prompt);
    muted = secret;
    try { const value = await terminal.question('', { signal: controller.signal }); return secret ? value : value.trim(); }
    finally { muted = false; if (secret) process.stdout.write('\n'); }
  }
  let current; let client; let phase = 'credentials';
  async function progress(next) { phase = next; await reportStatus(next === 'connecting' ? 'connecting' : 'authorizing', current, { phase: next }); }
  try {
    current = await credentials();
    console.log(`Telegram 连接方式：${current.proxyUrl ? '共享 HTTP(S) 代理' : '直连'}。`);
    console.log('独立终端登录：请先停止后台采集服务，避免同时使用同一 session。');
    client = createClient(current, '');
    await progress('connecting');
    await client.start({
      phoneNumber: async () => {
        await progress('phone');
        return current.phone || await ask('Telegram 注册手机号（+国家区号和完整号码，不是 API ID）：');
      },
      phoneCode: async () => { await progress('code'); return ask('Telegram 登录验证码：', true); },
      password: async () => { await progress('password'); console.log('Telegram 已要求此账号输入两步验证密码；空密码不能跳过。'); return ask('Telegram 两步验证密码：', true); },
      firstAndLastNames: async () => { throw new CollectorError('account-not-found', '此工具只登录已有 Telegram 账号，不会创建新账号。'); },
      acceptTermsOfService: async () => false,
      onError: error => { throw error; },
    });
    saveSession(client);
    await reportStatus('authorized', current, { phase: 'authorized' });
    console.log('账号授权成功。请在 Telegram 客户端订阅目标公开频道，再返回后台启动采集器。');
    console.log('登录凭据已保存在本机，不要公开或发送 session 文件。');
  } catch (error) {
    const detail = failure(error, current);
    const step = { credentials: '读取 API 凭据', connecting: '连接 Telegram', phone: '提交账号手机号', code: '验证登录验证码', password: '验证两步验证密码' }[phase];
    detail.message = `授权停止在“${step}”步骤。${detail.message}`;
    if (current) await reportStatus('disconnected', current, { phase: 'failed', error: detail });
    console.error(`${detail.code}: ${detail.message}`);
    process.exitCode = 1;
  } finally {
    if (client) await client.destroy();
    if (process.argv.includes('--pause') && !controller.signal.aborted) await ask('按回车关闭授权窗口，然后返回网页查看结果。');
    terminal.close();
  }
}

main().catch(error => { console.error(failure(error).message); process.exitCode = 1; });
