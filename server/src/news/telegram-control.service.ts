import { BadRequestException, ConflictException, Injectable, OnModuleDestroy } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import { TelegramAccountService } from './telegram-account.service';

type Phase = 'requested' | 'connecting' | 'code' | 'password' | 'verifying' | 'authorized' | 'failed' | 'cancelled';
type Detail = { code: string; message: string };
interface Authorization {
  id: string; owner: string; workerId: string; revision: string; proxyUrl: string; phase: Phase; expiresAt: number;
  promptId?: string; delivery?: string; error?: Detail; input?: string;
}
const active = (auth: Authorization) => !['authorized', 'failed', 'cancelled'].includes(auth.phase);

@Injectable()
export class TelegramControlService implements OnModuleDestroy {
  private worker?: { id: string; checkedAt: number; migration: boolean };
  private auth?: Authorization;
  private timer?: ReturnType<typeof setTimeout>;
  private collectionRevision = 0;
  private transfer?: { id: string; workerId: string; command?: { id: string; action: 'snapshot' | 'prepare'; data?: unknown }; resolve?: (value: unknown) => void; reject?: (error: Error) => void; timer?: ReturnType<typeof setTimeout> };
  constructor(private readonly account: TelegramAccountService) {}

  private expire() {
    if (this.auth && active(this.auth) && (this.auth.expiresAt <= Date.now() || !this.worker || Date.now() - this.worker.checkedAt > 30_000)) {
      this.finish('failed', { code: 'authorization-expired', message: '授权已超时或采集器连接中断，请重新开始登录。' });
    }
  }
  private finish(phase: 'failed' | 'cancelled' | 'authorized', error?: Detail) {
    if (!this.auth) return;
    this.auth.phase = phase; this.auth.input = undefined; this.auth.promptId = undefined; this.auth.error = error;
    clearTimeout(this.timer);
  }
  status(owner?: string) {
    this.expire();
    const auth = this.auth;
    return { flow: 'headless' as const, workerOnline: !!this.worker && Date.now() - this.worker.checkedAt < 30_000,
      auth: auth ? { id: auth.id, phase: auth.phase, expiresAt: new Date(auth.expiresAt).toISOString(), promptId: auth.promptId,
        delivery: auth.delivery, error: auth.error, inputPending: auth.input !== undefined, canSubmit: auth.owner === owner } : null };
  }
  async start(owner: string) {
    if (this.transfer) throw new ConflictException('正在迁移 Telegram 状态，请稍后再登录');
    this.expire();
    const current = await this.account.credentials();
    if (this.auth && active(this.auth)) throw new ConflictException('账号正在授权，请完成或取消当前登录。');
    if (!current.apiId || !current.apiHash || !current.phone) throw new BadRequestException('请先保存完整的 API 凭据和 Telegram 注册手机号。');
    if (!this.status().workerOnline) throw new ConflictException('采集服务尚未连接。Windows 预览请稍等片刻；Linux 请先启动 telegram 服务，再点击开始登录。');
    const auth = this.auth = { id: randomUUID(), owner, workerId: this.worker!.id, revision: current.revision, proxyUrl: current.proxyUrl,
      phase: 'requested' as Phase, expiresAt: Date.now() + 10 * 60_000 };
    this.timer = setTimeout(() => { if (this.auth === auth && active(auth)) this.finish('failed', { code: 'authorization-expired', message: '本次授权已过期，请重新开始登录。' }); }, 10 * 60_000);
  }
  submit(owner: string, body: { id?: unknown; promptId?: unknown; value?: unknown }) {
    this.expire();
    const auth = this.auth;
    if (!auth || auth.id !== body?.id || auth.owner !== owner || auth.promptId !== body.promptId || !['code', 'password'].includes(auth.phase)) throw new ConflictException('授权步骤已变化或不属于当前会话，请刷新后重试。');
    if (auth.input !== undefined) throw new ConflictException('正在验证上次提交，请等待结果。');
    if (typeof body.value !== 'string' || !body.value.length || body.value.length > (auth.phase === 'password' ? 256 : 128)) throw new BadRequestException(auth.phase === 'password' ? 'Telegram 已要求此账号输入两步验证密码，不能用空密码跳过。' : '请输入本次收到的登录验证码。');
    const value = auth.phase === 'code' ? body.value.trim() : body.value;
    if (!value) throw new BadRequestException('验证码不能为空。');
    auth.input = value; auth.error = undefined;
  }
  cancel(owner?: string) {
    if (owner && this.auth && this.auth.owner !== owner && active(this.auth)) throw new ConflictException('当前授权属于另一个管理员会话。');
    if (this.auth && active(this.auth)) this.finish('cancelled');
  }
  restartCollection() { this.collectionRevision++; }
  clearFinishedAuthorization() { if (this.auth && !active(this.auth)) this.auth = undefined; }
  completionFailed(id: unknown) {
    if (this.auth && this.auth.id === id && this.auth.phase === 'authorized') this.finish('failed', { code: 'configuration-save-failed', message: 'Telegram 已验证登录，但无法保存采集开关。请检查后端数据库写入权限，再点击“启动采集”复用已保存的 session。' });
  }
  async poll(body: { workerId?: unknown; migrationVersion?: unknown }) {
    if (typeof body?.workerId !== 'string' || !/^[a-f0-9-]{36}$/.test(body.workerId)) throw new BadRequestException('采集器实例无效');
    if (this.transfer && this.transfer.workerId !== body.workerId) throw new ConflictException('另一采集器正在保存迁移状态，请等待完成');
    this.expire();
    if (this.worker && this.worker.id !== body.workerId && Date.now() - this.worker.checkedAt < 30_000) throw new ConflictException('已有采集器实例在线，请停止重复实例。');
    if (this.worker && this.worker.id !== body.workerId && this.auth && active(this.auth)) this.finish('failed', { code: 'collector-restarted', message: '采集服务已重启，请重新开始登录。' });
    this.worker = { id: body.workerId, checkedAt: Date.now(), migration: body.migrationVersion === 1 };
    this.expire();
    if (this.transfer) return { migration: { id: this.transfer.id }, auth: null };
    const pendingMigration = await this.account.migrationPending();
    if (pendingMigration) return { pendingMigration: true, auth: null };
    const credentials = await this.account.credentials();
    if (this.auth && active(this.auth) && (this.auth.revision !== credentials.revision || this.auth.proxyUrl !== credentials.proxyUrl)) this.finish('cancelled', { code: 'configuration-changed', message: '账号或代理配置已修改，请重新开始登录。' });
    const auth = this.auth;
    return { credentials, collectionRevision: this.collectionRevision, auth: auth && active(auth) && auth.workerId === body.workerId ? { id: auth.id, phase: auth.phase, promptId: auth.promptId, input: auth.input } : null };
  }
  migrationReady() { return this.status().workerOnline && !!this.worker?.migration && !(this.auth && active(this.auth)); }
  migrationActive(id: string) { return this.transfer?.id === id; }
  beginMigration(id: string) {
    if (this.transfer) throw new ConflictException('采集器正在迁移');
    if (!this.migrationReady()) throw new ConflictException('完整迁移需要新版 Telegram 采集器在线，且没有正在进行的登录；请先更新并启动采集器');
    this.transfer = { id, workerId: this.worker!.id };
  }
  migrationCommand(action: 'snapshot' | 'prepare', data?: unknown): Promise<unknown> {
    const transfer = this.transfer;
    if (!transfer || transfer.command) throw new ConflictException('迁移状态已变化');
    transfer.command = { id: randomUUID(), action, data };
    return new Promise((resolve, reject) => {
      transfer.resolve = resolve; transfer.reject = reject;
      transfer.timer = setTimeout(() => { transfer.command = undefined; transfer.resolve = undefined; transfer.reject = undefined; reject(new ConflictException('采集器状态保存超时；原状态和备份已保留，请检查采集器后重试')); }, 120_000);
    });
  }
  migrationPoll(body: { workerId?: unknown; id?: unknown }) {
    const transfer = this.transfer;
    if (!transfer || transfer.id !== body?.id || transfer.workerId !== body.workerId) return { released: true };
    if (this.worker?.id === body.workerId) this.worker.checkedAt = Date.now();
    return { released: false, command: transfer.command || null };
  }
  migrationReport(body: { workerId?: unknown; id?: unknown; commandId?: unknown; ok?: unknown; data?: unknown; errorCode?: unknown }) {
    const transfer = this.transfer;
    if (!transfer || transfer.id !== body?.id || transfer.workerId !== body.workerId || transfer.command?.id !== body.commandId) return { accepted: false };
    if (typeof body.ok !== 'boolean') throw new BadRequestException('迁移结果无效');
    clearTimeout(transfer.timer);
    const resolve = transfer.resolve; const reject = transfer.reject;
    transfer.command = undefined; transfer.resolve = undefined; transfer.reject = undefined;
    if (body.ok) resolve?.(body.data); else reject?.(new ConflictException(body.errorCode === 'migration-queue-conflict' ? '本站存在不同账号或相同消息内容冲突的未投递队列，已拒绝合并；请先处理原队列，未删除任何消息' : '采集器无法保存迁移状态，请检查状态目录权限、空间和队列格式；原状态已保留'));
    return { accepted: true };
  }
  endMigration() {
    if (this.transfer) { clearTimeout(this.transfer.timer); this.transfer.reject?.(new ConflictException('迁移已结束')); this.transfer = undefined; }
    this.restartCollection();
  }
  report(body: { workerId?: unknown; id?: unknown; phase?: unknown; delivery?: unknown; error?: Detail }) {
    this.expire();
    const auth = this.auth;
    if (!auth || !active(auth) || auth.id !== body?.id || auth.workerId !== body.workerId || this.worker?.id !== body.workerId) throw new ConflictException('授权已取消、过期或采集器已改变');
    const phases = ['connecting', 'code', 'password', 'verifying', 'authorized', 'failed'] as const;
    if (!phases.includes(body.phase as typeof phases[number])) throw new BadRequestException('授权步骤无效');
    const transitions: Record<string, string[]> = { requested: ['connecting'], connecting: ['code', 'password', 'authorized'], code: ['verifying'], password: ['verifying'], verifying: ['code', 'password', 'authorized'] };
    if (body.phase !== 'failed' && !transitions[auth.phase]?.includes(String(body.phase))) throw new ConflictException('授权步骤已变化');
    if (body.error && (typeof body.error.code !== 'string' || !/^[a-z-]{1,60}$/.test(body.error.code) || typeof body.error.message !== 'string' || body.error.message.length > 400)) throw new BadRequestException('授权错误格式无效');
    if (body.phase === 'authorized' || body.phase === 'failed') this.finish(body.phase, body.error);
    else {
      auth.phase = body.phase as Phase; auth.input = undefined; auth.error = body.error;
      auth.promptId = ['code', 'password'].includes(auth.phase) ? randomUUID() : undefined;
      auth.delivery = ['app', 'sms', 'call', 'email', 'flashCall', 'missedCall', 'fragment', 'smsWord', 'smsPhrase'].includes(String(body.delivery)) ? String(body.delivery) : undefined;
    }
    return { promptId: auth.promptId };
  }
  onModuleDestroy() { this.endMigration(); clearTimeout(this.timer); if (this.auth) this.auth.input = undefined; }
}
