"""Run only in your own interactive terminal. Credentials never belong in chat or Git."""
import asyncio
import argparse
import os
from getpass import getpass
from pathlib import Path
from dotenv import load_dotenv
from telethon import TelegramClient
from account import credentials, report_status
from diagnostics import failure

load_dotenv()
os.umask(0o077)


async def main():
    current = await asyncio.to_thread(credentials)
    state = Path(os.environ.get('TG_STATE_DIR', './state'))
    session = Path(os.environ.get('TG_SESSION', str(state / 'reader')))
    session.parent.mkdir(parents=True, exist_ok=True)
    client = TelegramClient(str(session), int(current['apiId']), current['apiHash'])
    last_phase = 'connecting'
    async def report(status, phase, error=None):
        nonlocal last_phase
        last_phase = phase
        if os.environ.get('COLLECTOR_TOKEN'):
            try:
                await asyncio.to_thread(report_status, status, current['revision'], phase=phase, error=error)
            except OSError:
                print('暂时无法向后台上报授权进度，请检查本站后端连接。')

    async def phone():
        await report('authorizing', 'phone')
        return input('Telegram 手机号（含国家区号）：')

    async def code():
        await report('authorizing', 'code')
        return input('Telegram 登录验证码：')

    async def password():
        await report('authorizing', 'password')
        return getpass('Telegram 两步验证密码：')

    try:
        await report('connecting', 'connecting')
        await asyncio.wait_for(client.connect(), timeout=30)
        await client.start(phone=phone, code_callback=code, password=password)
        await report('authorized', 'authorized')
        print('登录已完成。请在官方客户端订阅公开频道，并在后台填写来源名称、公开用户名后启用来源。')
        print('采集器每 60 秒匹配频道，无需重启项目；来源名称不参与频道匹配。')
        print('session 文件相当于登录凭据，请妥善保管。此脚本不会自动加入频道。')
    except (Exception, asyncio.CancelledError, KeyboardInterrupt) as error:
        detail = failure(error)
        step = {'connecting': '连接 Telegram', 'phone': '输入手机号', 'code': '验证登录验证码', 'password': '验证两步验证密码'}.get(last_phase, '确认授权结果')
        detail['message'] = f"授权未完成，停止在“{step}”步骤。{detail['message']}"
        await report('disconnected', 'failed', detail)
        raise SystemExit(detail['message']) from None
    finally:
        await client.disconnect()


if __name__ == '__main__':
    parser = argparse.ArgumentParser()
    parser.add_argument('--pause', action='store_true', help='Keep the local login window open until acknowledged.')
    args = parser.parse_args()
    exit_code = 0
    try:
        asyncio.run(main())
    except SystemExit as error:
        print(error)
        exit_code = 1
    except KeyboardInterrupt:
        print('登录已取消。')
        exit_code = 1
    except Exception as error:
        detail = failure(error)
        print(f"{detail['code']}: {detail['message']}")
        exit_code = 1
    finally:
        if args.pause:
            try:
                input('按回车关闭授权窗口，然后返回网页查看结果。')
            except (EOFError, KeyboardInterrupt):
                pass
    raise SystemExit(exit_code)
