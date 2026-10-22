import { BadRequestException } from '@nestjs/common';
import { defaultApi, defaultWeb, sourceOrdering, validateSource, validateSourceSortOrder, type AdminConfig } from './admin-config';
import { NEWS_SOURCES, type NewsSourceConfig } from './sources';

export interface SourceDocument { format: 'china-radar-sources'; version: 1; sources: Record<string, unknown>[] }
const sourceFields = ['id', 'name', 'englishName', 'kind', 'website', 'feedUrls', 'feedUrl', 'publisherHosts', 'description', 'pollSeconds', 'forceChina', 'useProxy', 'channel', 'logo', 'timeZone', 'target', 'adapter', 'api', 'web', 'sortOrder'];
function object(value: unknown, fields: string[], label: string): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new BadRequestException(`${label}必须是对象`);
  if (Object.keys(value).some(key => !fields.includes(key))) throw new BadRequestException(`${label}包含不支持的字段，请参照导出格式`);
  return value as Record<string, unknown>;
}
export function exportSource(source: NewsSourceConfig, sortOrder: number) {
  const { notes, api, web, enabled, feedUrl, logo, useProxy, ...publicFields } = source;
  return { ...publicFields, sortOrder, ...(logo && !logo.startsWith('/api/news/logos/') ? { logo } : {}),
    ...(source.kind === 'telegram' || useProxy === undefined ? {} : { useProxy }),
    ...(api ? { api: { method: api.method, auth: { type: api.auth.type, header: api.auth.header }, mapping: api.mapping } } : {}),
    ...(web ? { web: { ...web, previousRules: undefined } } : {}) };
}
export function sourceDocument(sources: Array<{ source: NewsSourceConfig; order: { sortOrder: number } }>): SourceDocument {
  return { format: 'china-radar-sources', version: 1, sources: sources.map(({ source, order }) => exportSource(source, order.sortOrder)) };
}
export function planSourceImport(value: unknown, config: AdminConfig) {
  const document = object(value, ['format', 'version', 'sources'], '导入文件');
  if (document.format !== 'china-radar-sources' || document.version !== 1) throw new BadRequestException('只支持 china-radar-sources 第一版 JSON');
  if (Buffer.byteLength(JSON.stringify(document), 'utf8') > 1_048_576) throw new BadRequestException('来源 JSON 最大为 1 MiB');
  if (!Array.isArray(document.sources) || !document.sources.length || document.sources.length > 100) throw new BadRequestException('每次导入 1–100 个来源');
  const seen = new Set<string>(); const ordering = sourceOrdering(config);
  const entries = document.sources.map((value, index) => {
    try {
      const input = { ...object(value, sourceFields, '来源') };
      if (typeof input.id === 'string') input.id = input.id.trim();
      const previous = config.sources.find(source => source.id === input.id);
      const warnings: string[] = [];
      const kind = input.kind ?? previous?.kind ?? 'rss';
      const apiInput: Record<string, unknown> = input.api === undefined ? {} : object(input.api, ['method', 'auth', 'mapping', 'body'], 'API 配置');
      const auth = apiInput.auth === undefined ? {} : object(apiInput.auth, ['type', 'header'], 'API 鉴权配置（不接收密钥）');
      const web = input.web === undefined ? {} : object(input.web, Object.keys(defaultWeb()).concat('parseInstructions'), '网页配置');
      const baseApi = previous?.api || defaultApi();
      const api = { ...baseApi, ...apiInput, auth: { ...baseApi.auth, ...auth, value: '' } };
      const source = validateSource({ pollSeconds: 900, description: '', ...previous, ...input, kind,
        ...(input.feedUrl !== undefined && input.feedUrls === undefined ? { feedUrls: [input.feedUrl] } : {}),
        ...(input.channel !== undefined && input.target === undefined ? { target: input.channel } : {}),
        ...(kind === 'api' ? { api } : {}),
        ...(kind === 'web' ? { web: { ...(previous?.web || defaultWeb()), ...web } } : {}),
      }, previous || NEWS_SOURCES.find(source => source.id === input.id && source.kind === 'reserved'));
      if (seen.has(source.id)) throw new BadRequestException('同一文件中的来源 ID 不能重复');
      seen.add(source.id);
      source.enabled = false;
      if (source.kind === 'telegram' && input.useProxy !== undefined) {
        delete source.useProxy;
        warnings.push('Telegram 代理由此服务器的账号统一设置，不随频道导入');
      }
      if (source.api) {
        const sameCredentials = previous?.kind === 'api' && (previous.adapter || 'generic') === source.adapter && previous.target === source.target
          && previous.api?.auth.type === source.api.auth.type && previous.api.auth.header === source.api.auth.header;
        source.api.auth.value = sameCredentials ? previous.api!.auth.value : '';
        if (source.api.auth.type !== 'none' && !source.api.auth.value) warnings.push('需在此服务器填写鉴权值');
        if (!sameCredentials && source.api.method === 'POST' && apiInput.body === undefined) source.api.body = '';
        if (source.api.method === 'POST' && !source.api.body) warnings.push('POST 请求正文需另行填写');
      }
      if (typeof input.logo === 'string' && input.logo.startsWith('/api/news/logos/') && input.logo !== previous?.logo) {
        source.logo = previous?.logo || ''; warnings.push('站内 Logo 文件需在此服务器重新上传');
      }
      const sortOrder = validateSourceSortOrder(input.sortOrder ?? ordering.find(order => order.id === source.id)?.sortOrder ?? 0);
      return { source, previous, sortOrder, warnings, input: { ...input, id: source.id } };
    } catch (error) {
      if (error instanceof BadRequestException) throw new BadRequestException(`第 ${index + 1} 个来源：${error.message}`);
      throw error;
    }
  });
  const added = entries.filter(entry => !entry.previous).length;
  if (config.sources.length + added > 100) throw new BadRequestException('合并后超过 100 个来源');
  const changed = new Map(entries.map(entry => [entry.source.id, entry.source]));
  const sources = [...config.sources.map(source => changed.get(source.id) || source), ...entries.filter(entry => !entry.previous).map(entry => entry.source)];
  const channels = new Set<string>();
  for (const source of sources.filter(source => source.kind === 'telegram')) {
    const channel = source.channel!.toLowerCase();
    if (channels.has(channel)) throw new BadRequestException('合并后存在重复 Telegram 频道，请使用原来源 ID 更新');
    channels.add(channel);
  }
  const editedAt = new Date().toISOString();
  return { entries, added, updated: entries.length - added,
    document: { format: 'china-radar-sources', version: 1, sources: entries.map(entry => entry.input) } satisfies SourceDocument,
    config: { ...config, sources, sourceOrder: [...ordering.filter(order => !changed.has(order.id)), ...entries.map(entry => ({ id: entry.source.id, sortOrder: entry.sortOrder, editedAt }))],
      removedSourceIds: config.removedSourceIds.filter(id => !changed.has(id)) } };
}
