const fs = require('node:fs');
const path = require('node:path');
const root = path.resolve(__dirname, '..');
const server = path.join(root, 'server');
const role = process.argv[2];

if (role === 'server') {
  require(path.join(server, 'node_modules/dotenv')).config({ path: path.join(server, '.env'), quiet: true });
  const localFile = path.join(root, 'preview.local');
  const local = fs.existsSync(localFile) ? JSON.parse(fs.readFileSync(localFile, 'utf8')) : {};
  const url = local.databaseUrl || process.env.DATABASE_URL;
  if (!url?.startsWith('file:')) throw new Error('请先在 preview.local 或 server/.env 配置 SQLite DATABASE_URL');
  const database = path.resolve(server, 'prisma', url.slice(5));
  if (!fs.existsSync(database)) throw new Error('预览数据库不存在，不会自动创建空库。请核对配置或先按接续文档准备数据库。');
  Object.assign(process.env, {
    DATABASE_URL: `file:${database.replaceAll('\\', '/')}`,
    PORT: '3421', HOST: '127.0.0.1', CLIENT_URL: 'http://localhost:3420', PUBLIC_SITE_URL: 'http://localhost:3420',
    RADAR_MODE: 'news', COLLECTOR_ENABLED: 'true', AI_ANALYSIS_ENABLED: 'false', SMTP_HOST: '', NOTIFY_EMAIL: '',
    RADAR_LOCAL_PREVIEW: 'true',
  });
  if (!process.env.COLLECTOR_TOKEN) process.env.COLLECTOR_TOKEN = require('node:crypto').randomBytes(32).toString('hex');
  process.chdir(server);
  require(path.join(server, 'node_modules/ts-node')).register({ transpileOnly: true, project: path.join(server, 'tsconfig.json') });
  require(path.join(server, 'src/main.ts'));
} else if (role === 'client') {
  const client = path.join(root, 'client-next');
  process.env.INTERNAL_API_URL = 'http://127.0.0.1:3421';
  process.chdir(client);
  const cli = path.join(client, 'node_modules/next/dist/bin/next');
  process.argv = [process.execPath, cli, 'dev', '--hostname', '127.0.0.1', '--port', '3420'];
  require(cli);
} else {
  throw new Error('预览进程必须指定 server 或 client');
}
