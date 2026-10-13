import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { createFeedHandler } from './bridge.mjs';

const feeds = JSON.parse(await readFile(new URL('./feeds.json', import.meta.url), 'utf8'));
try { process.loadEnvFile(new URL('./.env', import.meta.url)); } catch (error) { if (error.code !== 'ENOENT') throw error; }
const config = { CACHE_TYPE: 'memory', CACHE_EXPIRE: '120', CACHE_CONTENT_EXPIRE: '3600', MEMORY_MAX: '128', REQUEST_RETRY: '0', REQUEST_TIMEOUT: '10000', LOGGER_LEVEL: 'error', NO_LOGFILES: 'true', DEBUG_INFO: 'false',
  ...(process.env.RSSHUB_PROXY_URL ? { PROXY_URI: process.env.RSSHUB_PROXY_URL } : {}) };
// Several RSSHub utilities read configuration when imported, before init().
Object.assign(process.env, config);
const { init, request } = await import('rsshub');
await init(config);
const server = createServer(createFeedHandler({ feeds, request }));
server.listen(Number(process.env.RSSHUB_PORT || 3412), process.env.RSSHUB_HOST || '127.0.0.1', () => console.log('Radar RSSHub ready'));
function shutdown() { server.close(() => process.exit(0)); setTimeout(() => process.exit(0), 5000).unref(); }
process.on('SIGTERM', shutdown); process.on('SIGINT', shutdown);
