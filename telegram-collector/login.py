"""Run only in your own interactive terminal. Credentials never belong in chat or Git."""
import asyncio
import os
from pathlib import Path
from dotenv import load_dotenv
from telethon import TelegramClient
from common import CHANNELS

load_dotenv()
os.umask(0o077)


async def main():
    api_id = os.environ.get('TG_API_ID')
    api_hash = os.environ.get('TG_API_HASH')
    if not api_id or not api_hash:
        raise SystemExit('请在本机环境配置 TG_API_ID 和 TG_API_HASH。')
    session = Path(os.environ.get('TG_SESSION', './state/reader'))
    session.parent.mkdir(parents=True, exist_ok=True)
    client = TelegramClient(str(session), int(api_id), api_hash)
    await client.start()  # Telethon prompts locally for phone, verification code and optional 2FA.
    print('登录已完成。请在官方客户端订阅以下频道，再启用采集：')
    print('\n'.join(f'https://t.me/{channel}' for channel in CHANNELS))
    print('session 文件相当于登录凭据，请妥善保管。此脚本不会自动加入频道。')
    await client.disconnect()


if __name__ == '__main__':
    asyncio.run(main())
