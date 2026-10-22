import { useState } from 'react';
import type { SourceSettings } from './admin-api';
import styles from './admin.module.css';
import telegram from './TelegramConnectionPanel.module.css';

type Detail = { code: string; message: string };
type Auth = { id: string; phase: 'requested' | 'connecting' | 'code' | 'password' | 'verifying' | 'authorized' | 'failed' | 'cancelled'; promptId?: string; delivery?: string; expiresAt: string; error?: Detail; inputPending: boolean; canSubmit: boolean };
type Action = (route: string, body?: object, message?: string) => Promise<boolean>;
export interface TelegramStatus {
  apiIdConfigured: boolean; apiHashConfigured: boolean; phone: string; enabled: boolean;
  collectorOnline: boolean; serverEnabled: boolean; collectorTokenConfigured: boolean; reportFresh: boolean;
  proxyEnabled?: boolean; reportedProxyEnabled?: boolean | null;
  session: string; phase: string | null; checkedAt: string | null; lastError: Detail | null;
  channels: { sourceId: string; channel: string; subscribed: boolean }[];
  sourceResults?: { id: string; lastSuccessAt: string | null; error: string | null }[];
  control?: { flow: 'headless'; workerOnline: boolean; auth: Auth | null };
  local?: { available: boolean; runtime?: string; environment?: { node: string; ready: boolean; error: string | null }; running?: boolean; sessionFilePresent?: boolean; error?: string | null };
}
const phases: Record<Auth['phase'], string> = { requested: '后台已接收登录请求', connecting: '正在连接 Telegram 并申请验证码', code: '请输入 Telegram 登录验证码', password: 'Telegram 要求两步验证密码', verifying: '正在验证，请稍候', authorized: '账号登录成功，正在启动采集', failed: '本次登录失败', cancelled: '本次登录已取消' };
const deliveries: Record<string, string> = { app: '验证码已发送到已登录的 Telegram 客户端，请查看 Telegram 官方通知。', sms: '请查看此手机号收到的短信验证码。', call: '请接听 Telegram 验证电话。', flashCall: 'Telegram 使用来电验证，请按收到的来电提示填写。', missedCall: 'Telegram 使用未接来电验证，请按来电提示填写。', fragment: '请到 Fragment 查看本次验证码。', smsWord: '请输入短信中的验证词。', smsPhrase: '请输入短信中的验证短语。' };

function AuthInput({ auth, busy, onAction }: { auth: Auth; busy: boolean; onAction: Action }) {
  const [value, setValue] = useState('');
  const password = auth.phase === 'password';
  return <form aria-label={password ? 'Telegram 两步验证密码' : 'Telegram 登录验证码'} onSubmit={async event => {
    event.preventDefault(); if (busy || auth.inputPending || !value) return;
    const submitted = value; setValue('');
    await onAction('auth/input', { id: auth.id, promptId: auth.promptId, value: submitted });
  }}>
    <label className={styles.fullField}>{password ? '两步验证密码' : '本次登录验证码'}<input type="password" autoComplete={password ? 'off' : 'one-time-code'} required maxLength={password ? 256 : 128} disabled={busy || auth.inputPending} value={value} onChange={event => setValue(event.target.value)} /></label>
    <p className={styles.hint}>{password ? 'Telegram 已明确要求此账号的云端两步验证密码，不是短信验证码、API Hash 或手机锁屏密码。如果你未设置，请在官方客户端“设置 → 隐私与安全 → 两步验证”中确认，不能用空密码跳过。' : deliveries[auth.delivery || ''] || '请输入本次收到的 Telegram 登录验证码；没有收到时先查看已登录的 Telegram 客户端。'}</p>
    <button type="submit" className={styles.primary} disabled={busy || auth.inputPending || !value}>{auth.inputPending ? '已提交，等待验证…' : password ? '提交两步验证密码' : '提交验证码'}</button>
  </form>;
}

export function TelegramConnectionPanel({ status, sources, busy, unsaved, onAction }: { status: TelegramStatus | null; sources: SourceSettings[]; busy: boolean; unsaved: boolean; onAction: Action }) {
  if (!status) return <p className={styles.hint}>正在读取账号与后台服务状态…</p>;
  if (!status.control || status.control.flow !== 'headless') return <p className={styles.error} role="alert">后端尚未加载新的网页授权流程。Windows 请双击“重启预览.cmd”，Linux 请更新并重建后端及 telegram 服务，再刷新页面。</p>;
  const auth = status.control.auth;
  const active = !!auth && !['authorized', 'failed', 'cancelled'].includes(auth.phase);
  const online = status.control.workerOnline;
  const connected = online && status.collectorOnline && !active;
  const local = status.local?.available ? status.local : null;
  const ready = status.apiIdConfigured && status.apiHashConfigured && !!status.phone;
  const error = !active ? auth?.error || status.lastError : null;
  let title = '下一步：开始登录'; let detail = '账号配置已保存。点击“开始登录”，在本页输入接下来收到的验证码。';
  if (!status.collectorTokenConfigured) { title = '内部通信令牌未配置'; detail = 'Windows 请重启本地预览；Linux 请给后端与采集器配置相同的 COLLECTOR_TOKEN，至少 32 字符。'; }
  else if (!online) { title = '后台采集服务未连接'; detail = local?.error || local?.environment?.error || (local ? local.running ? '后台服务正在连接本站后端，请稍候。若持续未连接，请查看本地预览后端日志，或双击“重启预览.cmd”。' : '点击“启动后台服务”，等待连接成功后再开始登录。' : '请先在 Linux 部署中启动 telegram 服务，再回到本页登录。命令见下方。'); }
  else if (unsaved || !ready) { title = '先保存账号配置'; detail = '在上方保存 API ID、API Hash 和注册 Telegram 的完整手机号。'; }
  else if (active) { title = phases[auth.phase]; detail = auth.canSubmit ? '请按下方当前步骤操作。取消、服务重启或十分钟超时会结束本次授权。' : '此授权由另一个管理员会话发起，请回到原会话完成或等待其结束。'; }
  else if (error) { title = '需要处理上次错误'; detail = error.message; }
  else if (!status.serverEnabled) { title = '后端尚未允许接收新闻'; detail = '请在后端启用 TELEGRAM_ENABLED=true 并重新创建服务。'; }
  else if (connected) { title = status.phase === 'matching' ? '账号已连接，正在匹配频道' : `正在监听 ${status.channels.filter(row => row.subscribed).length} 个公开频道`; detail = '只读取已启用且此账号已订阅的公开频道。频道匹配每 60 秒更新。'; }
  else if (!status.enabled) { title = '新闻采集已暂停'; detail = '登录 session 会保留，点击“启动采集”即可复用有效登录。'; }
  else if (status.phase === 'connecting') { title = '正在检查登录并连接采集'; detail = '后台正在验证持久 session，成功后匹配频道；失败原因会显示在此处。'; }
  else if (auth?.phase === 'authorized' || status.session === 'authorized') { title = '账号已登录，正在连接采集'; detail = '等待后台匹配频道；失败原因会显示在此处。'; }
  const canOperate = !busy && online && ready && !unsaved && status.collectorTokenConfigured;
  const telegramSources = sources.filter(source => source.kind === 'telegram');
  return <div className={telegram.panel}>
    <div className={telegram.nextStep} role="status" aria-live="polite"><strong>{title}</strong><p>{detail}</p></div>
    {error && <p className={telegram.failure} role="alert">错误代码：{error.code}</p>}
    <p className={styles.hint}>Telegram 连接方式：{status.proxyEnabled ? '共享 HTTP(S) 代理' : '直连'}。<a href="/admin?tab=network">前往代理设置</a>。更改连接方式会中止当前授权，并重新连接采集。</p>
    {local && <div className={telegram.actions}><span>后台服务：{online ? '已连接' : local.running ? '连接中' : '未运行'} · Node.js {local.environment?.node}</span>{!online && <button type="button" disabled={busy || !!local.running} onClick={() => onAction('service/start', {}, '后台服务启动请求已提交，请等待连接状态更新。')}>启动后台服务</button>}</div>}
    <ol className={telegram.steps}>
      <li>
        <div className={telegram.stepHeading}><h3>登录账号</h3><span>{active ? phases[auth.phase] : auth?.phase === 'authorized' ? '本次授权成功' : local?.sessionFilePresent || status.session === 'authorized' ? '已有 session，可直接启动采集' : '等待登录'}</span></div>
        <p>无需弹出窗口。验证码与两步验证密码只用于本次登录，不保存到数据库、浏览器存储或日志；成功后仅保存采集器的 session。</p>
        {auth?.error && active && <p className={telegram.failure} role="alert">{auth.error.message}</p>}
        {active && auth.canSubmit && ['code', 'password'].includes(auth.phase) && <AuthInput key={`${auth.id}:${auth.promptId}`} auth={auth} busy={busy} onAction={onAction} />}
        <div className={telegram.actions}>
          {!active && <button type="button" disabled={!canOperate} className={!local?.sessionFilePresent && status.session !== 'authorized' ? styles.primary : undefined} onClick={() => onAction('auth/start', {}, '登录请求已发送，接下来的步骤会显示在本页。')}>{local?.sessionFilePresent || status.session === 'authorized' ? '重新登录' : '开始登录'}</button>}
          {active && auth.canSubmit && <button type="button" disabled={busy} onClick={() => onAction('auth/cancel', {}, '本次登录已取消。')}>取消登录</button>}
        </div>
      </li>
      <li>
        <div className={telegram.stepHeading}><h3>新闻采集</h3><span>{connected ? '已连接' : status.enabled ? '等待连接' : '已暂停'}</span></div>
        <p>登录成功后自动启动采集；服务重启时复用持久 session，无需重复输入验证码。暂停采集不会退出 Telegram 账号。</p>
        <div className={telegram.actions}>
          <button type="button" disabled={!canOperate || active || connected || !status.serverEnabled || status.session === 'missing' && !local?.sessionFilePresent} onClick={() => onAction('collection', { enabled: true }, '已请求启动采集，正在检查持久登录。')}>启动采集</button>
          <button type="button" disabled={busy || active || !status.enabled} onClick={() => onAction('collection', { enabled: false }, '已请求暂停采集，后台服务仍会待命。')}>暂停采集</button>
        </div>
        {!status.serverEnabled && <p className={telegram.failure}>后端接收未启用：请设置 TELEGRAM_ENABLED=true 并重新创建后端服务。</p>}
        {status.checkedAt && <p className={telegram.timestamp}>最近采集状态：{new Date(status.checkedAt).toLocaleString()}{status.reportFresh ? '' : ' · 上次记录'}</p>}
      </li>
    </ol>
    <div className={telegram.channels}>
      <div className={telegram.stepHeading}><h3>频道匹配与入库结果</h3><a href="/admin?tab=sources">前往来源配置</a></div>
      <p>先在 Telegram 客户端订阅公开频道，再将用户名填入来源并启用。每次连接采集时每频道补抓最近 24 小时最多 25 条，回填不发送新闻通知。不会自动加入频道或读取私聊。</p>
      {!telegramSources.length && <p>尚未添加 Telegram 来源，请到“来源配置”新增。</p>}
      <ul>{telegramSources.map(source => {
        const channel = status.channels.find(row => row.sourceId === source.id && row.channel.toLowerCase() === source.channel?.toLowerCase());
        const result = status.sourceResults?.find(row => row.id === source.id) || source.state;
        const matching = !source.state?.enabled ? '来源未启用' : !connected ? '等待采集连接后匹配' : channel ? channel.subscribed ? '已订阅，正在监听' : '尚未订阅或用户名不匹配' : '等待本轮匹配';
        return <li key={source.id}><strong>{source.name} · @{source.channel}</strong><span>{matching}</span>{result?.lastSuccessAt && <small>最近成功处理：{new Date(result.lastSuccessAt).toLocaleString()}</small>}{result?.error && <small className={telegram.failure}>{result.error}</small>}</li>;
      })}</ul>
    </div>
    {!local && <details className={styles.details} open={!online}><summary>Linux 后台服务启动与诊断</summary><p>部署时启用 TELEGRAM_ENABLED=true、TG_USE_CONFIRMED=true，两边配置相同 COLLECTOR_TOKEN。启动一次后台服务后，在本页完成登录，不需要交互终端。</p><pre>{`docker compose -f compose.arm64.yml --profile telegram up -d telegram\ndocker compose -f compose.arm64.yml logs --tail=40 telegram`}</pre><p>session 和待发送消息保留在 telegram_data 持久卷，请勿删除此卷。同一份 session 只运行一个采集器。</p></details>}
  </div>;
}
