"""Optional personal Telegram reader. Requires an existing, authorized session."""
import asyncio
import json
import logging
import os
from datetime import datetime, timedelta, timezone
from pathlib import Path
from urllib.error import HTTPError, URLError
from urllib.request import Request, urlopen
from dotenv import load_dotenv
from telethon import TelegramClient, events
from telethon.errors import FloodWaitError
from common import CHANNELS, Outbox, message_payload

load_dotenv()
os.umask(0o077)
logging.basicConfig(level=logging.INFO, format='%(levelname)s %(message)s')
logging.getLogger('telethon').setLevel(logging.WARNING)


def deliver(url, token, payload):
    request = Request(url, data=json.dumps(payload).encode(), headers={'Content-Type': 'application/json', 'Authorization': f'Bearer {token}'}, method='POST')
    with urlopen(request, timeout=15) as response:
        return json.load(response)


async def main():
    if os.environ.get('TELEGRAM_ENABLED') != 'true' or os.environ.get('TG_USE_CONFIRMED') != 'true':
        raise SystemExit('Telegram 接入默认关闭。阅读使用说明并配置后再启用。')
    api_id, api_hash, token = (os.environ.get(k) for k in ('TG_API_ID', 'TG_API_HASH', 'COLLECTOR_TOKEN'))
    if not api_id or not api_hash or not token or len(token) < 32:
        raise SystemExit('Telegram API 配置或内部采集令牌缺失。')
    state = Path(os.environ.get('TG_STATE_DIR', './state'))
    state.mkdir(parents=True, exist_ok=True)
    session = Path(os.environ.get('TG_SESSION', str(state / 'reader')))
    if not Path(f'{session}.session').exists():
        raise SystemExit('缺少 session。先在自己的交互终端运行 login.py。')
    client = TelegramClient(str(session), int(api_id), api_hash, flood_sleep_threshold=60)
    await client.connect()
    if not await client.is_user_authorized():
        await client.disconnect()
        raise SystemExit('session 已失效，请重新运行 login.py。')
    dialogs = {dialog.entity.id: dialog.entity async for dialog in client.iter_dialogs()}
    subscribed = {}
    for channel in CHANNELS:
        entity = next((value for value in dialogs.values() if (getattr(value, 'username', None) or '').lower() == channel.lower()), None)
        if entity:
            subscribed[entity.id] = channel
        else:
            logging.warning('@%s 尚未订阅，本轮跳过；订阅后重启 worker。', channel)
    if not subscribed:
        await client.disconnect()
        raise SystemExit('没有已订阅的目标频道。')
    outbox = Outbox(state / 'outbox.db')
    url = os.environ.get('RADAR_INGEST_URL', 'http://server:3001/api/news/telegram')

    @client.on(events.NewMessage(chats=[dialogs[channel_id] for channel_id in subscribed]))
    @client.on(events.MessageEdited(chats=[dialogs[channel_id] for channel_id in subscribed]))
    async def receive(event):
        payload = message_payload(subscribed[event.message.peer_id.channel_id], event.message)
        if payload:
            outbox.put(payload)

    async def sender():
        while True:
            record = outbox.next()
            if not record:
                await asyncio.sleep(1)
                continue
            key, payload, attempts = record
            try:
                await asyncio.to_thread(deliver, url, token, payload)
                outbox.acknowledge(key, payload)
            except HTTPError as error:
                if error.code in (401, 403):
                    raise RuntimeError('内部令牌被拒绝，请检查配置；不会输出令牌。') from None
                outbox.retry(key, attempts)
                logging.warning('入库返回 HTTP %s，稍后重试。', error.code)
            except (URLError, TimeoutError, OSError, json.JSONDecodeError):
                outbox.retry(key, attempts)
                logging.warning('入库暂时失败，消息已保存在本地队列。')

    async def backfill():
        cutoff = datetime.now(timezone.utc) - timedelta(days=1)
        for channel_id, channel in subscribed.items():
            try:
                async for message in client.iter_messages(dialogs[channel_id], limit=25):
                    if message.date < cutoff:
                        break
                    payload = message_payload(channel, message)
                    if payload:
                        outbox.put(payload)
                await asyncio.sleep(2)
            except FloodWaitError as error:
                logging.warning('Telegram 要求等待 %s 秒，已停止补抓。', error.seconds)
                await asyncio.sleep(error.seconds)
                break
    logging.info('已监听 %s 个已订阅频道；新闻交给本站统一处理。', len(subscribed))
    try:
        await asyncio.gather(sender(), backfill(), client.run_until_disconnected())
    finally:
        await client.disconnect()
        outbox.db.close()


if __name__ == '__main__':
    asyncio.run(main())
