import { safePublishedAt } from './rules';
export function sourcePublishedAt(value: unknown, timeZone = 'UTC', now = new Date()) {
  if (typeof value === 'number' && Number.isFinite(value) && value > 0) return safePublishedAt(new Date(value < 1e12 ? value * 1000 : value), now);
  if (typeof value !== 'string') return safePublishedAt(value, now);
  const naive = /^(\d{4})-(\d{2})-(\d{2})[T ](\d{2}):(\d{2})(?::(\d{2}))?(?:\.\d+)?$/.exec(value);
  if (!naive) return safePublishedAt(value, now);
  const components = naive.slice(1).map(v => Number(v || 0));
  const wall = Date.UTC(components[0], components[1] - 1, components[2], components[3], components[4], components[5]);
  const formatter = new Intl.DateTimeFormat('en-GB', { timeZone, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit', hourCycle: 'h23' });
  let timestamp = wall;
  for (let i = 0; i < 2; i++) {
    const parts = Object.fromEntries(formatter.formatToParts(timestamp).map(p => [p.type, p.value]));
    const represented = Date.UTC(Number(parts.year), Number(parts.month) - 1, Number(parts.day), Number(parts.hour), Number(parts.minute), Number(parts.second));
    timestamp += wall - represented;
  }
  const actual = formatter.formatToParts(timestamp); const expected = components;
  if (['year', 'month', 'day', 'hour', 'minute', 'second'].some((key, index) => Number(actual.find(p => p.type === key)?.value) !== expected[index])) return null;
  return safePublishedAt(new Date(timestamp), now);
}
