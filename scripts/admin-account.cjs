const path = require('node:path');
const { createInterface } = require('node:readline/promises');
require('../server/node_modules/dotenv').config({ path: path.join(__dirname, '../server/.env'), quiet: true });
const { randomBytes, scrypt } = require('node:crypto');
const derive = require('node:util').promisify(scrypt);
async function hashPassword(password) {
  const salt = randomBytes(32).toString('hex');
  const key = await derive(password, salt, 64);
  return `${salt}:${key.toString('hex')}`;
}
const { PrismaClient } = require('../server/node_modules/@prisma/client');
async function password(prompt) {
  if (!process.stdin.isTTY) throw new Error('请在本地交互终端执行，密码不能从脚本参数传入');
  process.stdout.write(prompt);
  process.stdin.setRawMode(true); process.stdin.resume(); process.stdin.setEncoding('utf8');
  return new Promise((resolve, reject) => {
    let value = '';
    const done = () => { process.stdin.off('data', onData); process.stdin.setRawMode(false); process.stdin.pause(); process.stdout.write('\n'); };
    const onData = text => {
      for (const char of text) {
        if (char === '\u0003') { done(); reject(new Error('已取消')); return; }
        if (char === '\r' || char === '\n') { done(); resolve(value); return; }
        if (char === '\u007f' || char === '\b') value = value.slice(0, -1);
        else if (char >= ' ') value += char;
      }
    };
    process.stdin.on('data', onData);
  });
}
async function main() {
  const terminal = createInterface({ input: process.stdin, output: process.stdout });
  const username = (await terminal.question('管理员账号：')).trim(); terminal.close();
  if (!username || username.length > 80) throw new Error('账号长度应为 1 到 80 个字符');
  const secret = await password('密码（至少 12 个字符，不回显）：');
  if (secret.length < 12 || secret.length > 256) throw new Error('密码长度应为 12 到 256 个字符');
  if (secret !== await password('再次输入密码：')) throw new Error('两次密码不一致');
  const db = new PrismaClient();
  try {
    const passwordHash = await hashPassword(secret);
    await db.$transaction([
      db.adminAccount.upsert({ where: { id: 'admin' }, create: { id: 'admin', username, passwordHash }, update: { username, passwordHash } }),
      db.adminSession.deleteMany(), db.adminLoginAttempt.deleteMany(),
    ]);
    console.log('管理员已设置；旧会话已失效。通过 /admin 登录。');
  } finally { await db.$disconnect(); }
}
main().catch(error => { console.error(error.message); process.exitCode = 1; });
