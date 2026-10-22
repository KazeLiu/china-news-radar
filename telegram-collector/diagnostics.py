"""Safe operational failures. Never return Telegram exception bodies or login input."""
import asyncio
from telethon import errors
from account import BackendAccessError, AccountConfigurationError, BackendConnectionError


def failure(error):
    if isinstance(error, BackendAccessError):
        return {'code': 'collector-auth-failed', 'message': '采集器的内部通信认证失败，请核对后端与采集器的 COLLECTOR_TOKEN；本地预览请重启后再启动采集器。'}
    if isinstance(error, AccountConfigurationError):
        return {'code': 'credentials-missing', 'message': 'Telegram API 凭据未配置或格式无效，请在后台保存 API ID 和 API Hash。'}
    if isinstance(error, BackendConnectionError):
        return {'code': 'backend-unreachable', 'message': '无法读取本站后台的 Telegram 配置，请确认后端正在运行，并核对采集器的 RADAR_INGEST_URL。'}
    known = (
        (errors.ApiIdInvalidError, 'api-invalid', 'Telegram 拒绝了 API ID / Hash，请重新核对后台保存的两项应用凭据。'),
        (errors.PhoneNumberInvalidError, 'phone-invalid', '手机号无效，请使用带国家区号的 Telegram 账号手机号重新授权。'),
        (errors.PhoneNumberBannedError, 'phone-banned', 'Telegram 已限制此手机号登录，请在官方客户端确认账号状态。'),
        (errors.PhoneCodeInvalidError, 'code-invalid', '登录验证码错误，请重新打开授权终端登录。'),
        (errors.PhoneCodeExpiredError, 'code-expired', '登录验证码已过期，请重新打开授权终端获取验证码。'),
        (errors.PasswordHashInvalidError, 'password-invalid', '两步验证密码错误，请重新打开授权终端登录。'),
        (errors.AuthKeyUnregisteredError, 'session-invalid', 'Telegram 登录凭据已失效，请重新打开授权终端登录。'),
        (errors.SessionRevokedError, 'session-revoked', 'Telegram 登录已被撤销，请重新打开授权终端登录。'),
    )
    for kind, code, message in known:
        if isinstance(error, kind):
            return {'code': code, 'message': message}
    if isinstance(error, (EOFError, KeyboardInterrupt, asyncio.CancelledError)):
        return {'code': 'login-cancelled', 'message': '授权终端已取消或关闭，请重新打开后完成登录。'}
    if isinstance(error, (OSError, asyncio.TimeoutError, ConnectionError)):
        return {'code': 'connection-failed', 'message': '无法连接 Telegram，请检查本机网络是否能访问 Telegram。采集器不会自动使用浏览器或后台的 HTTP 代理设置。'}
    if isinstance(error, errors.FloodWaitError):
        return {'code': 'rate-limited', 'message': f'Telegram 要求等待 {error.seconds} 秒，请等待后再操作。'}
    return {'code': 'telegram-failed', 'message': 'Telegram 操作未完成，请检查账号状态、网络连接及后台配置后重试。'}
