"""Private backend transport. API credentials stay in process memory."""
import json
import os
from urllib.error import HTTPError, URLError
from urllib.request import HTTPRedirectHandler, Request, build_opener


class BackendAccessError(RuntimeError):
    pass


class AccountConfigurationError(RuntimeError):
    pass


class BackendConnectionError(OSError):
    pass


class NoRedirect(HTTPRedirectHandler):
    def redirect_request(self, req, fp, code, msg, headers, newurl):
        return None


def backend_url():
    return os.environ.get('RADAR_INGEST_URL', 'http://server:3001/api/news/telegram').rstrip('/')


def backend_request(path, payload=None):
    token = os.environ.get('COLLECTOR_TOKEN', '')
    if len(token) < 32:
        raise BackendAccessError('缺少有效的 COLLECTOR_TOKEN，不能读取后台 Telegram 配置。')
    request = Request(f'{backend_url()}/{path}', data=None if payload is None else json.dumps(payload).encode(),
                      headers={'Authorization': f'Bearer {token}', 'Content-Type': 'application/json', 'Cache-Control': 'no-store'})
    try:
        with build_opener(NoRedirect()).open(request, timeout=15) as response:
            return json.load(response)
    except HTTPError as error:
        if error.code in (401, 403):
            raise BackendAccessError('采集器认证被拒绝，请核对 COLLECTOR_TOKEN。') from None
        raise BackendConnectionError(f'后台接口返回 HTTP {error.code}。') from None
    except (URLError, TimeoutError, json.JSONDecodeError):
        raise BackendConnectionError('后台连接或响应异常。') from None


def credentials(allow_environment_fallback=True):
    token = os.environ.get('COLLECTOR_TOKEN', '')
    saved = {}
    if token:
        try:
            saved = backend_request('credentials')
        except OSError:
            if not allow_environment_fallback or not (os.environ.get('TG_API_ID') and os.environ.get('TG_API_HASH')):
                raise
    api_id = saved.get('apiId') or os.environ.get('TG_API_ID', '')
    api_hash = saved.get('apiHash') or os.environ.get('TG_API_HASH', '')
    if not api_id.isdigit() or not 0 < int(api_id) <= 2147483647 or len(api_hash) != 32 or any(c not in '0123456789abcdefABCDEF' for c in api_hash):
        raise AccountConfigurationError('Telegram API 凭据未配置或无效，请在后台账号配置或环境变量中设置。')
    return {'apiId': api_id, 'apiHash': api_hash, 'revision': saved.get('revision', 'environment')}


def report_status(session, revision, channels=None, running=False, phase=None, error=None):
    return backend_request('status', {'session': session, 'revision': revision, 'running': running,
                                    'credentialsConfigured': True, 'channels': channels or [],
                                    **({'phase': phase} if phase else {}), **({'error': error} if error else {})})
