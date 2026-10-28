import { BadRequestException } from '@nestjs/common';
import { createCipheriv, createDecipheriv, randomBytes, scrypt } from 'node:crypto';
import { AdminConfig, restoreConfig } from './admin-config';

export const MIGRATION_LIMIT = 32 * 1024 * 1024;
const MAGIC = Buffer.from('RDRCFG01');
const KDF = { N: 16384, r: 8, p: 1, maxmem: 64 * 1024 * 1024 };
function derive(password: string, salt: Buffer) {
  return new Promise<Buffer>((resolve, reject) => {
    scrypt(password, salt, 32, KDF, (error, key) => error ? reject(error) : resolve(key));
  });
}
export interface TelegramSnapshot { session: string; pending: { key: string; payload: string; retryAt: number; attempts: number }[] }
export interface MigrationDocument {
  format: 'china-radar-migration'; version: 1; exportedAt: string;
  config: AdminConfig;
  telegram: { apiId: string; apiHash: string; phone: string; enabled: boolean; state: TelegramSnapshot };
  follows: { password: string; sessionHours: number };
  keywords: { text: string; category: string | null; isActive: boolean; profile: { data: string; generatedAt: string } | null;
    card: { name: string; type: string | null; summary: string | null; relatedData: string | null; lastRefresh: string } | null }[];
  logos: { name: string; data: string }[];
  aiPaused: boolean;
  aiUsage: { day: string; used: number };
}
const invalid = () => new BadRequestException('迁移包格式无效、版本不支持或内容超过限制');
function record(value: unknown): Record<string, unknown> { if (!value || typeof value !== 'object' || Array.isArray(value)) throw invalid(); return value as Record<string, unknown>; }
function str(value: unknown, max: number) { if (typeof value !== 'string' || value.length > max) throw invalid(); return value; }
function bool(value: unknown) { if (typeof value !== 'boolean') throw invalid(); return value; }
function date(value: unknown) { const text = str(value, 40); if (!Number.isFinite(Date.parse(text))) throw invalid(); return text; }
function nullable(value: unknown, max: number) { return value === null ? null : str(value, max); }
function profileData(value: string) {
  const data = record(JSON.parse(value));
  for (const key of ['aliases', 'relatedCountries', 'relatedOrganizations', 'relatedCompanies', 'relatedPeople', 'relatedModels', 'relatedProducts', 'competesWith', 'tags']) {
    const list = data[key];
    if (list !== undefined && (!Array.isArray(list) || list.length > 200 || list.some(item => typeof item !== 'string' || item.length > 500))) throw invalid();
  }
  for (const key of ['summary', 'type', 'generationStatus']) if (data[key] !== undefined) str(data[key], key === 'summary' ? 20_000 : 100);
}
export function validateTelegramSnapshot(raw: unknown): TelegramSnapshot {
  const input = record(raw); const session = str(input.session, 10_000);
  if (session && !/^1[A-Za-z0-9+/=]{100,9999}$/.test(session)) throw invalid();
  if (!Array.isArray(input.pending) || input.pending.length > 10_000) throw invalid();
  const keys = new Set<string>();
  const pending = input.pending.map(value => {
    const row = record(value); const key = str(row.key, 160); const payload = str(row.payload, 100_000);
    const message = record(JSON.parse(payload));
    if (typeof message.channel !== 'string' || !/^[a-z][a-z\d_]{3,99}$/i.test(message.channel) || !Number.isSafeInteger(message.messageId) || Number(message.messageId) < 1 ||
      key !== `${message.channel}:${message.messageId}` || keys.has(key) || typeof message.text !== 'string' || !message.text || message.text.length > 20_000 ||
      typeof message.publishedAt !== 'string' || !Number.isFinite(Date.parse(message.publishedAt)) || !Array.isArray(message.links) || message.links.length > 30 ||
      message.links.some(link => typeof link !== 'string' || link.length > 4000) || (message.backfill !== undefined && typeof message.backfill !== 'boolean') ||
      typeof row.retryAt !== 'number' || !Number.isFinite(row.retryAt) || row.retryAt < 0 || !Number.isSafeInteger(row.attempts) || Number(row.attempts) < 0) throw invalid();
    keys.add(key);
    return { key, payload: JSON.stringify({ channel: message.channel, messageId: message.messageId, text: message.text, publishedAt: message.publishedAt, links: message.links, ...(message.backfill === undefined ? {} : { backfill: message.backfill }) }), retryAt: row.retryAt, attempts: Number(row.attempts) };
  });
  return { session, pending };
}
export function validateMigration(raw: unknown): MigrationDocument {
  const input = record(raw);
  if (input.format !== 'china-radar-migration' || input.version !== 1 || typeof input.exportedAt !== 'string' || !Number.isFinite(Date.parse(input.exportedAt))) throw invalid();
  const config = restoreConfig(JSON.stringify(input.config));
  const rawSources = record(input.config).sources as Record<string, unknown>[];
  config.sources = config.sources.map((source, index) => ({ ...source, enabled: bool(rawSources[index].enabled) }));
  const channels = config.sources.filter(source => source.kind === 'telegram').map(source => source.channel!.toLowerCase());
  if (new Set(channels).size !== channels.length) throw invalid();
  if (!config.network || !config.browser) throw invalid();
  const tg = record(input.telegram); const apiId = str(tg.apiId, 10); const apiHash = str(tg.apiHash, 32); const phone = str(tg.phone, 16);
  if (apiId && (!/^[1-9]\d{0,9}$/.test(apiId) || Number(apiId) > 2147483647) || apiHash && !/^[a-f\d]{32}$/i.test(apiHash) || phone && !/^\+[1-9]\d{1,14}$/.test(phone)) throw invalid();
  const state = validateTelegramSnapshot(tg.state);
  if (state.session && (!apiId || !apiHash)) throw new BadRequestException('Telegram session 缺少配套 API 凭据');
  const follows = record(input.follows); const password = str(follows.password, 256);
  if (password && (password.length < 12 || !password.trim()) || !Number.isInteger(follows.sessionHours) || Number(follows.sessionHours) < 1 || Number(follows.sessionHours) > 720) throw invalid();
  if (!Array.isArray(input.keywords) || input.keywords.length > 1000 || !Array.isArray(input.logos) || input.logos.length > 100) throw invalid();
  const terms = new Set<string>();
  const keywords = input.keywords.map(raw => {
    const row = record(raw); const text = str(row.text, 200).trim();
    if (!text || terms.has(text)) throw invalid(); terms.add(text);
    const savedProfile = row.profile === null ? null : record(row.profile);
    const profile = savedProfile ? { data: str(savedProfile.data, 100_000), generatedAt: date(savedProfile.generatedAt) } : null;
    if (profile) profileData(profile.data);
    const savedCard = row.card === null ? null : record(row.card);
    const card = savedCard ? { name: str(savedCard.name, 200), type: nullable(savedCard.type, 100), summary: nullable(savedCard.summary, 20_000), relatedData: nullable(savedCard.relatedData, 100_000), lastRefresh: date(savedCard.lastRefresh) } : null;
    if (card?.relatedData) profileData(card.relatedData);
    return { text, category: nullable(row.category, 100), isActive: bool(row.isActive), profile, card };
  });
  const names = new Set<string>();
  const logos = input.logos.map(raw => {
    const row = record(raw); const name = str(row.name, 50); const data = str(row.data, 1_400_000);
    if (!/^[a-f0-9-]{36}\.(png|jpg|webp)$/.test(name) || names.has(name) || !/^[A-Za-z0-9+/]+={0,2}$/.test(data)) throw invalid();
    const bytes = Buffer.from(data, 'base64');
    const valid = name.endsWith('.png') ? bytes.subarray(0, 8).toString('hex') === '89504e470d0a1a0a' : name.endsWith('.jpg') ? bytes.subarray(0, 3).toString('hex') === 'ffd8ff' : bytes.subarray(0, 4).toString() === 'RIFF' && bytes.subarray(8, 12).toString() === 'WEBP';
    if (!valid || bytes.length > 1_048_576) throw invalid(); names.add(name); return { name, data };
  });
  for (const source of config.sources) if (source.logo?.startsWith('/api/news/logos/') && !names.has(source.logo.slice('/api/news/logos/'.length))) throw new BadRequestException('迁移包缺少来源 Logo 文件');
  const usage = record(input.aiUsage);
  if (typeof usage.day !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(usage.day) || !Number.isSafeInteger(usage.used) || Number(usage.used) < 0) throw invalid();
  return { format: 'china-radar-migration', version: 1, exportedAt: input.exportedAt, config, telegram: { apiId, apiHash, phone, enabled: bool(tg.enabled), state }, follows: { password, sessionHours: Number(follows.sessionHours) }, keywords, logos, aiPaused: bool(input.aiPaused), aiUsage: { day: usage.day, used: Number(usage.used) } };
}
function checkPassword(password: unknown): asserts password is string {
  if (typeof password !== 'string' || password.length < 12 || password.length > 256 || !password.trim()) throw new BadRequestException('迁移密码须为 12–256 个字符');
}
export async function encryptMigration(document: MigrationDocument, password: unknown) {
  checkPassword(password);
  const plain = Buffer.from(JSON.stringify(document));
  if (plain.length > MIGRATION_LIMIT - 52) { plain.fill(0); throw new BadRequestException('完整迁移包超过 32 MiB，未截断任何数据'); }
  const salt = randomBytes(16); const iv = randomBytes(12); const key = await derive(password, salt);
  try {
    const cipher = createCipheriv('aes-256-gcm', key, iv); cipher.setAAD(MAGIC);
    const encrypted = Buffer.concat([cipher.update(plain), cipher.final()]);
    return Buffer.concat([MAGIC, salt, iv, cipher.getAuthTag(), encrypted]);
  } finally { key.fill(0); plain.fill(0); }
}
export async function decryptMigration(file: Buffer, password: unknown) {
  checkPassword(password);
  if (file.length < 53 || file.length > MIGRATION_LIMIT || !file.subarray(0, 8).equals(MAGIC)) throw invalid();
  const key = await derive(password, file.subarray(8, 24));
  let plain: Buffer | undefined;
  try {
    const decipher = createDecipheriv('aes-256-gcm', key, file.subarray(24, 36)); decipher.setAAD(MAGIC); decipher.setAuthTag(file.subarray(36, 52));
    plain = Buffer.concat([decipher.update(file.subarray(52)), decipher.final()]);
    return validateMigration(JSON.parse(plain.toString('utf8')));
  } catch { throw new BadRequestException('无法读取迁移包：密码错误、文件损坏或内容不符合当前版本'); }
  finally { key.fill(0); plain?.fill(0); }
}
