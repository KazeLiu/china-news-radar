import { BadRequestException } from '@nestjs/common';

export interface SourceNetworkConfig { mode: 'direct' | 'proxy'; proxyUrl: string; secureDns: boolean; telegramUseProxy?: boolean }
let saved: SourceNetworkConfig | undefined;
export function sourceNetwork(): SourceNetworkConfig {
  if (saved) return saved;
  const proxyUrl = process.env.SOURCE_PROXY_URL || process.env.RSS_PROXY_URL || process.env.HTTPS_PROXY || process.env.https_proxy || '';
  return { mode: proxyUrl ? 'proxy' : 'direct', proxyUrl, secureDns: process.env.SOURCE_DNS_OVER_HTTPS === 'true', telegramUseProxy: false };
}
export function configureSourceNetwork(config?: SourceNetworkConfig) { saved = config; }
export function validateSourceNetwork(value: unknown, previous: SourceNetworkConfig): SourceNetworkConfig {
  const input = value as Partial<SourceNetworkConfig> | null;
  if (!input || !['direct', 'proxy'].includes(String(input.mode)) || typeof input.secureDns !== 'boolean') throw new BadRequestException('采集网络配置无效');
  const proxyUrl = input.proxyUrl === undefined || input.proxyUrl === '' ? previous.proxyUrl : input.proxyUrl;
  if (typeof proxyUrl !== 'string' || proxyUrl.length > 2000 || /[\r\n]/.test(proxyUrl)) throw new BadRequestException('代理地址无效');
  if (proxyUrl) {
    try { const url = new URL(proxyUrl); if (!['http:', 'https:'].includes(url.protocol) || !url.hostname || url.pathname !== '/' || url.search || url.hash) throw new Error(); }
    catch { throw new BadRequestException('请输入 HTTP(S) 代理地址，例如 http://127.0.0.1:7897'); }
  }
  if (input.mode === 'proxy' && !proxyUrl) throw new BadRequestException('代理模式需要填写代理地址');
  const telegramUseProxy = input.telegramUseProxy ?? previous.telegramUseProxy ?? false;
  if (typeof telegramUseProxy !== 'boolean') throw new BadRequestException('Telegram 代理开关无效');
  return { mode: input.mode as SourceNetworkConfig['mode'], proxyUrl, secureDns: input.secureDns, telegramUseProxy };
}
