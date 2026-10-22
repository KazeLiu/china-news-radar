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

const months = ['january', 'february', 'march', 'april', 'may', 'june', 'july', 'august', 'september', 'october', 'november', 'december'];
export function webPublicationTime(value: unknown, timeZone = 'UTC', collectedAt = new Date()) {
  const text = typeof value === 'string' ? value.trim().replace(/\s+/g, ' ') : '';
  const iso = /^(?:(\d{4})-)?(\d{1,2})-(\d{1,2})$/.exec(text);
  const english = /^([a-z]+)\.? (\d{1,2})(?:st|nd|rd|th)?(?:,? (\d{4}))?$/i.exec(text);
  const reversed = /^(\d{1,2})(?:st|nd|rd|th)? ([a-z]+)\.?(?:,? (\d{4}))?$/i.exec(text);
  const chinese = /^(?:(\d{4})年)?(\d{1,2})月(\d{1,2})日?$/.exec(text);
  if (iso || english || reversed || chinese) {
    const current = Object.fromEntries(new Intl.DateTimeFormat('en-GB', { timeZone, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit', hourCycle: 'h23' }).formatToParts(collectedAt).map(part => [part.type, part.value]));
    const namedMonth = english?.[1] || reversed?.[2];
    const month = namedMonth ? months.findIndex(name => name === namedMonth.toLowerCase() || name.slice(0, 3) === namedMonth.toLowerCase()) + 1 : Number(iso?.[2] || chinese?.[2]);
    const year = iso?.[1] || english?.[3] || reversed?.[3] || chinese?.[1] || current.year;
    const day = iso?.[3] || english?.[2] || reversed?.[1] || chinese?.[3];
    const date = sourcePublishedAt(`${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}T${current.hour}:${current.minute}:${current.second}`, timeZone, collectedAt);
    return { publishedAt: date || new Date(collectedAt), estimated: true };
  }
  // Yearless free-form strings must not acquire the JavaScript parser's implicit year.
  const incomplete = typeof value === 'string' && (!/(?:^|\D)\d{4}(?:\D|$)/.test(text) || /^\d{4}(?:-\d{1,2})?$/.test(text) || /^[a-z]+\.? \d{4}$/i.test(text));
  const date = incomplete ? null : sourcePublishedAt(value, timeZone, collectedAt);
  return { publishedAt: date || new Date(collectedAt), estimated: !date };
}
