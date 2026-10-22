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
from common import Outbox, message_payload
from account import credentials, backend_request, report_status, BackendAccessError
from diagnostics import failure

load_dotenv()
os.umask(0o077)
logging.basicConfig(level=logging.INFO, format='%(levelname)s %(message)s')
logging.getLogger('telethon').setLevel(logging.WARNING)


def deliver(url, token, payload):
    request = Request(url, data=json.dumps(payload).encode(), headers={'Content-Type': 'application/json', 'Authorization': f'Bearer {token}'}, method='POST')
    with urlopen(request, timeout=15) as response:
        return json.load(response)


class CredentialsChanged(Exception):
    pass


async def main():
    if os.environ.get('TELEGRAM_ENABLED') != 'true' or os.environ.get('TG_USE_CONFIRMED') != 'true':
        raise SystemExit('Telegram 接入默认关闭。阅读使用说明并配置后再启用。')
    token = os.environ.get('COLLECTOR_TOKEN', '')
    if len(token) < 32:
        raise SystemExit('内部采集令牌缺失。')
    state = Path(os.environ.get('TG_STATE_DIR', './state'))
    state.mkdir(parents=True, exist_ok=True)
    session = Path(os.environ.get('TG_SESSION', str(state / 'reader')))
    while True:
        current = await asyncio.to_thread(credentials)
        try:
            await run_collector(state, session, token, current)
            return
        except CredentialsChanged:
            logging.info('Telegram API 配置已更新，重新连接采集器。')


async def run_collector(state, session, token, current):
    matches = []
    async def report(session_status, channels=None, phase=None, error=None):
        try:
            await asyncio.to_thread(report_status, session_status, current['revision'], matches if channels is None else channels, session_status == 'authorized', phase, error)
        except OSError:
            logging.warning('暂时无法上报采集器状态。')
    if not Path(f'{session}.session').exists():
        await report('missing', phase='failed', error={'code': 'session-missing', 'message': '尚未找到登录凭据，请打开授权终端完成 Telegram 登录。'})
        raise SystemExit('缺少 session。先在自己的交互终端运行 login.py。')
    client = TelegramClient(str(session), int(current['apiId']), current['apiHash'], flood_sleep_threshold=60)
    url = os.environ.get('RADAR_INGEST_URL', 'http://server:3001/api/news/telegram')
    dialogs = {}
    subscribed = {}
    async def refresh_sources():
        sources = await asyncio.to_thread(backend_request, 'sources')
        refreshed = {dialog.entity.id: dialog.entity async for dialog in client.iter_dialogs()
                     if dialog.is_channel and getattr(dialog.entity, 'broadcast', False) and getattr(dialog.entity, 'username', None)}
        selected = {}
        matches.clear()
        for source in sources:
            channel = source['channel']
            entity = next((value for value in refreshed.values() if (getattr(value, 'username', None) or '').lower() == channel.lower()), None)
            matches.append({'sourceId': source['sourceId'], 'channel': channel, 'subscribed': entity is not None})
            if entity:
                selected[entity.id] = channel
            else:
                logging.warning('@%s 尚未订阅，本轮跳过。', channel)
        dialogs.clear()
        dialogs.update(refreshed)
        subscribed.clear()
        subscribed.update(selected)
        await report('authorized', phase='listening')
    outbox = Outbox(state / 'outbox.db')

    @client.on(events.NewMessage())
    @client.on(events.MessageEdited())
    async def receive(event):
        channel_id = getattr(event.message.peer_id, 'channel_id', None)
        if channel_id not in subscribed:
            return
        payload = message_payload(subscribed[channel_id], event.message)
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
                await report('authorized', phase='listening')
            except HTTPError as error:
                if error.code in (401, 403):
                    raise BackendAccessError('内部令牌被拒绝，请检查配置；不会输出令牌。') from None
                outbox.retry(key, attempts)
                await report('authorized', phase='listening', error={'code': 'delivery-failed', 'message': f'新闻入库返回 HTTP {error.code}，消息已留在本地队列。请检查后端 Telegram 接收开关和来源配置。'})
                logging.warning('入库返回 HTTP %s，稍后重试。', error.code)
            except (URLError, TimeoutError, OSError, json.JSONDecodeError):
                outbox.retry(key, attempts)
                await report('authorized', phase='listening', error={'code': 'backend-unreachable', 'message': '暂时无法连接本站后端，消息已留在本地队列，连接恢复后继续投递。'})
                logging.warning('入库暂时失败，消息已保存在本地队列。')

    async def backfill():
        cutoff = datetime.now(timezone.utc) - timedelta(days=1)
        for channel_id, channel in list(subscribed.items()):
            try:
                async for message in client.iter_messages(dialogs[channel_id], limit=25):
                    if message.date < cutoff:
                        break
                    payload = message_payload(channel, message)
                    if payload:
                        payload['backfill'] = True
                        outbox.put(payload)
                await asyncio.sleep(2)
            except FloodWaitError as error:
                await report('authorized', phase='listening', error=failure(error))
                logging.warning('Telegram 要求等待 %s 秒，已停止补抓。', error.seconds)
                await asyncio.sleep(error.seconds)
                break
    async def source_updates():
        while True:
            await asyncio.sleep(60)
            try:
                latest = await asyncio.to_thread(credentials, False)
                if latest != current:
                    raise CredentialsChanged()
                await refresh_sources()
            except HTTPError as error:
                if error.code in (401, 403):
                    raise BackendAccessError('来源配置读取被拒绝，请核对内部令牌。') from None
                logging.warning('来源配置暂时不可读，保留当前监听列表。')
                await report('authorized', phase='listening', error={'code': 'sources-unavailable', 'message': '暂时无法读取本站来源配置，正在保留上次的频道监听列表。'})
            except (URLError, TimeoutError, OSError, json.JSONDecodeError):
                logging.warning('来源配置暂时不可读，保留当前监听列表。')
                await report('authorized', phase='listening', error={'code': 'sources-unavailable', 'message': '暂时无法读取本站来源配置，正在保留上次的频道监听列表。'})
    tasks = []
    error_detail = None
    authorization_failed = False
    try:
        await report('connecting', phase='connecting')
        await asyncio.wait_for(client.connect(), timeout=30)
        if not await asyncio.wait_for(client.is_user_authorized(), timeout=30):
            authorization_failed = True
            await report('unauthorized', phase='failed', error={'code': 'session-invalid', 'message': 'Telegram 登录凭据已失效，请重新打开授权终端登录。'})
            raise SystemExit(1)
        await report('authorized', phase='matching')
        await refresh_sources()
        logging.info('已监听 %s 个已订阅频道；新闻交给本站统一处理。', len(subscribed))
        tasks = [asyncio.create_task(work) for work in (sender(), backfill(), source_updates(), client.run_until_disconnected())]
        await asyncio.gather(*tasks)
    except CredentialsChanged:
        raise
    except Exception as error:
        error_detail = failure(error)
        print(f"RADAR_FAILURE {error_detail['message']}", flush=True)
        logging.error('%s: %s', error_detail['code'], error_detail['message'])
        raise SystemExit(1) from None
    finally:
        for task in tasks:
            task.cancel()
        await asyncio.gather(*tasks, return_exceptions=True)
        await client.disconnect()
        outbox.db.close()
        if error_detail:
            await report('disconnected', phase='failed', error=error_detail)
        elif not authorization_failed:
            await report('disconnected', phase='stopped')


if __name__ == '__main__':
    try:
        asyncio.run(main())
    except Exception as error:
        detail = failure(error)
        print(f"RADAR_FAILURE {detail['message']}", flush=True)
        raise SystemExit(1) from None
