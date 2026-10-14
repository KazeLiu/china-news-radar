// Create a missing SQLite file before Prisma 6's config-based db push (including Windows).
require('../server/node_modules/dotenv').config({ path: require('node:path').join(__dirname, '../server/.env'), quiet: true });
const fs = require('node:fs'); const path = require('node:path'); const { spawnSync } = require('node:child_process');
const fingerprint = require('node:crypto').createHash('sha256').update(fs.readFileSync(path.join(__dirname, '../server/prisma/schema.prisma'))).digest('hex');
const url = process.env.DATABASE_URL;
if (!url?.startsWith('file:')) throw new Error('DATABASE_URL must be a SQLite file URL');
const target = path.resolve(__dirname, '../server/prisma', url.slice(5));
fs.mkdirSync(path.dirname(target), { recursive: true });
try { fs.closeSync(fs.openSync(target, 'wx', 0o600)); } catch (error) { if (error.code !== 'EEXIST') throw error; }
async function main() {
  const { PrismaClient } = require('../server/node_modules/@prisma/client');
  const db = new PrismaClient();
  let migrateTelegramTitles = false;
  try {
    const existing = await db.$queryRawUnsafe("SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%'");
    if (existing.some(t => t.name === 'NewsItem')) {
      const columns = await db.$queryRawUnsafe('PRAGMA table_info("NewsItem")');
      migrateTelegramTitles = !columns.some(column => column.name === 'sourceTitlePresent');
    }
    const stored = existing.some(t => t.name === 'Setting') ? await db.setting.findUnique({ where: { key: 'schema-fingerprint' } }) : null;
    const savedConfig = existing.some(t => t.name === 'Setting') ? await db.setting.findUnique({ where: { key: 'news-admin-config-v1' } }) : null;
    const config = savedConfig ? JSON.parse(savedConfig.value) : null;
    if (existing.length && (stored?.value !== fingerprint || (config && config.version !== 2))) {
      const backup = `${target}.backup-${new Date().toISOString().replace(/[:.]/g, '-')}.db`;
      await db.$executeRawUnsafe(`VACUUM INTO '${backup.replaceAll("'", "''")}'`);
      fs.chmodSync(backup, 0o600);
      console.log('已创建升级前 SQLite 一致性备份');
    }
    if (config && config.version !== 2) await db.setting.update({ where: { key: 'news-admin-config-v1' }, data: { value: JSON.stringify({ ...config, version: 2 }) } });
    const tables = await db.$queryRawUnsafe("SELECT name FROM sqlite_master WHERE type='table' AND name='Hotspot'");
    if (tables.length) {
      const columns = await db.$queryRawUnsafe('PRAGMA table_info("Hotspot")');
      const missing = ['newsItemId', 'notifyEligible'].filter(name => !columns.some(column => column.name === name));
      if (missing.length) {
        await db.$transaction(async tx => {
          if (missing.includes('newsItemId')) await tx.$executeRawUnsafe('ALTER TABLE "Hotspot" ADD COLUMN "newsItemId" TEXT REFERENCES "NewsItem"("id") ON DELETE CASCADE ON UPDATE CASCADE');
          if (missing.includes('notifyEligible')) await tx.$executeRawUnsafe('ALTER TABLE "Hotspot" ADD COLUMN "notifyEligible" BOOLEAN NOT NULL DEFAULT false');
          await tx.$executeRawUnsafe('CREATE UNIQUE INDEX IF NOT EXISTS "Hotspot_newsItemId_key" ON "Hotspot"("newsItemId")');
        });
      }
    }
  } finally { await db.$disconnect(); }
  const prismaCli = require.resolve('prisma/build/index.js', { paths: [path.join(__dirname, '../server')] });
  const result = spawnSync(process.execPath, [prismaCli, 'db', 'push', '--skip-generate'], { cwd: path.join(__dirname, '../server'), stdio: 'inherit' });
  process.exitCode = result.status ?? 1;
  if (result.status === 0) {
    const updated = new PrismaClient();
    try {
      if (migrateTelegramTitles) await updated.$executeRawUnsafe('UPDATE "NewsItem" SET "sourceTitlePresent" = false WHERE "acquisitionKind" = \'telegram\'');
      await updated.setting.upsert({ where: { key: 'schema-fingerprint' }, create: { key: 'schema-fingerprint', value: fingerprint }, update: { value: fingerprint } });
    }
    finally { await updated.$disconnect(); }
  }
}
main().catch(() => { console.error('数据库初始化或升级失败；请检查数据库和备份，未自动接受数据丢失'); process.exitCode = 1; });
