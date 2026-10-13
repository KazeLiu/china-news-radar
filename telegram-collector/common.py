"""Public channel message parsing and durable delivery queue. No AI integration."""
import json
import re
import sqlite3
import time

CHANNELS = ('FakeNewsCN', 'zaihuapd', 'xhqcankao', 'landiansub', 'tnews365', 'kejiqu', 'Trump_TS')


def message_payload(channel, message):
    text = message.raw_text or ''
    if not text or len(text) > 20000:
        return None
    links = re.findall(r'https?://[^\s<>]+', text)
    utf16 = text.encode('utf-16-le')
    for entity in message.entities or []:
        if getattr(entity, 'url', None):
            links.append(entity.url)
        elif type(entity).__name__ == 'MessageEntityUrl':
            links.append(utf16[entity.offset * 2:(entity.offset + entity.length) * 2].decode('utf-16-le', errors='replace'))
    return {'channel': channel, 'messageId': message.id, 'text': text,
            'publishedAt': message.date.isoformat(), 'links': list(dict.fromkeys(links))[:30]}


class Outbox:
    def __init__(self, path):
        self.db = sqlite3.connect(path)
        self.db.execute('CREATE TABLE IF NOT EXISTS pending (key TEXT PRIMARY KEY, payload TEXT NOT NULL, retry_at REAL NOT NULL DEFAULT 0, attempts INTEGER NOT NULL DEFAULT 0)')
        self.db.commit()

    def put(self, payload):
        key = f"{payload['channel']}:{payload['messageId']}"
        self.db.execute('INSERT INTO pending(key,payload) VALUES (?,?) ON CONFLICT(key) DO UPDATE SET payload=excluded.payload,retry_at=0,attempts=0', (key, json.dumps(payload, ensure_ascii=False)))
        self.db.commit()

    def next(self):
        row = self.db.execute('SELECT key,payload,attempts FROM pending WHERE retry_at<=? ORDER BY retry_at,key LIMIT 1', (time.time(),)).fetchone()
        return (row[0], json.loads(row[1]), row[2]) if row else None

    def acknowledge(self, key, payload):
        # An edit arriving during delivery must remain queued.
        self.db.execute('DELETE FROM pending WHERE key=? AND payload=?', (key, json.dumps(payload, ensure_ascii=False)))
        self.db.commit()

    def retry(self, key, attempts):
        delay = min(300, 5 * 2 ** min(attempts, 6))
        self.db.execute('UPDATE pending SET retry_at=?,attempts=? WHERE key=?', (time.time() + delay, attempts + 1, key))
        self.db.commit()
