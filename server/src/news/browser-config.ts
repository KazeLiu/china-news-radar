import { BadRequestException } from '@nestjs/common';

export interface BrowserConfig { initialWaitSeconds: number; navigationQuietSeconds: number; sessionTimeoutSeconds: number }
export const defaultBrowserConfig = (): BrowserConfig => ({ initialWaitSeconds: 10, navigationQuietSeconds: 3, sessionTimeoutSeconds: 120 });
export function validateBrowserConfig(value: unknown): BrowserConfig {
  const input = value as Partial<BrowserConfig> | null;
  if (!input || typeof input !== 'object' || Array.isArray(input)) throw new BadRequestException('浏览器设置必须是对象');
  const config = defaultBrowserConfig();
  for (const [key, label, min, max] of [
    ['initialWaitSeconds', '初始观察时间', 0, 120],
    ['navigationQuietSeconds', '跳转稳定等待', 1, 30],
    ['sessionTimeoutSeconds', '会话时间上限', 30, 300],
  ] as const) {
    const number = input[key] ?? config[key];
    if (!Number.isInteger(number) || number < min || number > max) throw new BadRequestException(`${label}应为 ${min}–${max} 秒的整数`);
    config[key] = number;
  }
  if (config.initialWaitSeconds + config.navigationQuietSeconds >= config.sessionTimeoutSeconds) throw new BadRequestException('会话上限应大于初始观察与跳转稳定等待之和');
  return config;
}
