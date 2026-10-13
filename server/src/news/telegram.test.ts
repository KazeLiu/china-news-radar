import { describe, expect, it } from 'vitest';
import { telegramItem } from './telegram';
import { validCollectorToken } from './news.controller';
const input = { channel: 'xhqcankao', messageId: 123, text: '中国宣布新的贸易政策', publishedAt: new Date().toISOString(), links: ['https://www.reuters.com/world/china/story'] };
describe('Telegram personal reader boundaries', () => {
  it('records the channel link and distinguishes original publisher from forwarding channel', () => {
    const result = telegramItem(input)!;
    expect(result.sourceId).toBe('tg-xhqcankao'); expect(result.item.originalPublisher).toBe('Reuters');
    expect(result.item.url).toBe('https://t.me/xhqcankao/123');
  });
  it('rejects unconfigured channels, invalid IDs and oversized messages', () => {
    expect(() => telegramItem({ ...input, channel: 'unknown' })).toThrow();
    expect(() => telegramItem({ ...input, messageId: '123' })).toThrow();
    expect(() => telegramItem({ ...input, text: 'x'.repeat(20001) })).toThrow();
  });
  it('filters domestic sources and retains unattributed messages as clues only', () => {
    expect(telegramItem({ ...input, links: ['https://www.cls.cn/news'] })).toBeNull();
    expect(telegramItem({ ...input, links: ['https://reuters.com.attacker.test'] })?.item.originalPublisher).toBeNull();
    expect(telegramItem({ ...input, text: 'Unrelated football match' })).toBeNull();
  });
  it('lets AI decide non-keyword channel news while retaining domestic source exclusions', () => {
    expect(telegramItem({ ...input, text: 'Officials consider new restrictions' }, false)?.item.title).toContain('Officials');
    expect(telegramItem({ ...input, links: ['https://www.cls.cn/news'] }, false)).toBeNull();
    expect(telegramItem({ ...input, text: '' }, false)).toBeNull();
  });
  it('fails closed without a strong configured token and rejects incorrect values', () => {
    expect(validCollectorToken(undefined, undefined)).toBe(false);
    expect(validCollectorToken('Bearer short', 'short')).toBe(false);
    expect(validCollectorToken(`Bearer ${'a'.repeat(32)}`, 'b'.repeat(32))).toBe(false);
    expect(validCollectorToken(`Bearer ${'a'.repeat(32)}`, 'a'.repeat(32))).toBe(true);
  });
});
