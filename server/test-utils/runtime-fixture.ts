import { execFileSync } from 'node:child_process';
import { copyFileSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { PrismaService } from '../src/prisma/prisma.service';
import { AiRuntimeService } from '../src/news/ai-runtime.service';
import { NewsService } from '../src/news/news.service';
import { NewsLogsService } from '../src/news/news-logs.service';
import { SourceAdapterService } from '../src/news/source-adapter.service';
import { WebCrawlerService } from '../src/news/web-crawler.service';
import { ADMIN_CONFIG_KEY, AiConfig, defaultConfig } from '../src/news/admin-config';

export function completedResponse(content: string) {
  return { status: 'completed', incomplete_details: null, output_text: content,
    output: [{ type: 'message', role: 'assistant', content: [{ type: 'output_text', text: content, annotations: [] }] }] };
}

export function runtimeFixtures() {
  const server = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
  const work = mkdtempSync(path.join(tmpdir(), 'radar-tests-'));
  const template = path.join(work, 'template.db');
  const instances: Array<{ db: PrismaService; news: NewsService; runtime: AiRuntimeService }> = [];
  return {
    prepare() {
      writeFileSync(template, '');
      execFileSync(process.execPath, [path.join(server, 'node_modules/prisma/build/index.js'), 'db', 'push', '--skip-generate'], {
        cwd: server, env: { ...process.env, DATABASE_URL: `file:${template.replaceAll('\\', '/')}` }, stdio: 'pipe',
      });
    },
    async create(ai: Partial<AiConfig> = {}, usage = '0') {
      const filename = path.join(work, `case-${instances.length}.db`);
      copyFileSync(template, filename);
      const db = new PrismaService({ datasourceUrl: `file:${filename.replaceAll('\\', '/')}` });
      const config = defaultConfig();
      config.sources = config.sources.map(source => ({ ...source, enabled: false }));
      config.ai = { ...config.ai, enabled: true, apiKey: 'test-only-key', model: 'fixture-model', baseUrl: 'https://model.example.invalid/v1', dailyLimit: 100, intervalMs: 0, ...ai };
      await db.setting.create({ data: { key: ADMIN_CONFIG_KEY, value: JSON.stringify(config) } });
      const usageKey = `news-ai-usage-${new Date().toISOString().slice(0, 10)}`;
      await db.setting.create({ data: { key: usageKey, value: usage } });
      const logs = new NewsLogsService(db);
      const runtime = new AiRuntimeService(db, logs);
      const adapters = { configured: () => true } as unknown as SourceAdapterService;
      const crawler = { configureBrowser: () => {} } as unknown as WebCrawlerService;
      const news = new NewsService(db, runtime, adapters, crawler, logs);
      // Register real handlers, then stop automatic timers. Each test drives one queue step explicitly.
      runtime.onModuleInit(); runtime.onModuleDestroy();
      await news.onModuleInit(); news.onModuleDestroy();
      news['stopped'] = false; // Timers stay stopped; tests explicitly drive preparation methods.
      instances.push({ db, news, runtime });
      return { db, service: news, runtime, logs, usageKey, config,
        async saveConfig() { await db.setting.update({ where: { key: ADMIN_CONFIG_KEY }, data: { value: JSON.stringify(config) } }); },
        async run() { runtime['stopped'] = false; const pending = runtime['tick'](); runtime['stopped'] = true; await pending; },
        async usage() { return (await db.setting.findUniqueOrThrow({ where: { key: usageKey } })).value; },
      };
    },
    async close() {
      for (const { db, news, runtime } of instances) { news.onModuleDestroy(); runtime.onModuleDestroy(); await db.$disconnect(); }
      if (!path.resolve(work).startsWith(path.join(tmpdir(), 'radar-tests-'))) throw new Error('Unexpected test directory');
      rmSync(work, { recursive: true, force: true });
    },
  };
}
