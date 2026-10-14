"""Run only in your own interactive terminal. Credentials never belong in chat or Git."""
import asyncio
import os
from pathlib import Path
from dotenv import load_dotenv
from telethon import TelegramClient
from account import credentials, report_status

load_dotenv()
os.umask(0o077)


async def main():
    current = await asyncio.to_thread(credentials)
    session = Path(os.environ.get('TG_SESSION', './state/reader'))
    session.parent.mkdir(parents=True, exist_ok=True)
    client = TelegramClient(str(session), int(current['apiId']), current['apiHash'])
    try:
        await client.start()  # Telethon prompts locally for phone, verification code and optional 2FA.
        if os.environ.get('COLLECTOR_TOKEN'):
            try:
                await asyncio.to_thread(report_status, 'authorized', current['revision'])
            except OSError:
                print('登录已完成，暂时无法向后台上报状态。')
        print('登录已完成。请在官方客户端订阅公开频道，并在后台填写来源名称、公开用户名后启用来源。')
        print('采集器每 60 秒匹配频道，无需重启项目；来源名称不参与频道匹配。')
        print('session 文件相当于登录凭据，请妥善保管。此脚本不会自动加入频道。')
    finally:
        await client.disconnect()


if __name__ == '__main__':
    asyncio.run(main())
