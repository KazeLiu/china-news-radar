// Create a missing SQLite file before Prisma 6's config-based db push (including Windows).
require('../server/node_modules/dotenv').config({ path: require('node:path').join(__dirname, '../server/.env'), quiet: true });
const fs = require('node:fs'); const path = require('node:path'); const { spawnSync } = require('node:child_process');
const url = process.env.DATABASE_URL;
if (!url?.startsWith('file:')) throw new Error('DATABASE_URL must be a SQLite file URL');
const target = path.resolve(__dirname, '../server/prisma', url.slice(5));
fs.mkdirSync(path.dirname(target), { recursive: true });
try { fs.closeSync(fs.openSync(target, 'wx', 0o600)); } catch (error) { if (error.code !== 'EEXIST') throw error; }
const command = process.platform === 'win32' ? 'pnpm.cmd' : 'pnpm';
const result = spawnSync(command, ['exec', 'prisma', 'db', 'push', '--skip-generate'], { cwd: path.join(__dirname, '../server'), stdio: 'inherit', shell: process.platform === 'win32' });
process.exit(result.status ?? 1);
