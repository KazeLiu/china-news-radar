import { BadRequestException, ForbiddenException, Injectable, OnApplicationBootstrap, OnApplicationShutdown } from '@nestjs/common';
import { ChildProcess, spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import path from 'node:path';

type Environment = { node: string; ready: boolean; error: string | null };

@Injectable()
export class TelegramLocalService implements OnApplicationBootstrap, OnApplicationShutdown {
  private readonly enabled = process.platform === 'win32' && process.env.RADAR_LOCAL_PREVIEW === 'true' && process.env.HOST === '127.0.0.1';
  private readonly directory = path.resolve(__dirname, '../../../telegram-collector');
  private readonly state = path.join(this.directory, 'state');
  private readonly session = path.join(this.state, 'reader.node-session');
  private child?: ChildProcess;
  private error: string | null = null;
  private inspect(): Environment {
    const [major, minor] = process.versions.node.split('.').map(Number);
    if (major < 22 || major === 22 && minor < 15) return { node: process.version, ready: false, error: '采集器需要项目共用的 Node.js 22.15 或更新版本。' };
    try { require.resolve('teleproto', { paths: [this.directory] }); return { node: process.version, ready: true, error: null }; }
    catch { return { node: process.version, ready: false, error: '项目依赖不完整，请在项目根目录执行 pnpm install 后重新启动服务。' }; }
  }
  status() {
    return this.enabled ? { available: true, runtime: 'nodejs', environment: this.inspect(), running: !!this.child,
      sessionFilePresent: existsSync(this.session), error: this.error } : { available: false };
  }
  start() {
    if (!this.enabled) throw new ForbiddenException('Linux 请通过部署配置启动独立 telegram 服务。');
    if (this.child) return;
    const environment = this.inspect();
    if (!environment.ready) throw new BadRequestException(environment.error!);
    if ((process.env.COLLECTOR_TOKEN?.length || 0) < 32) throw new BadRequestException('内部通信令牌无效，请重启本地预览。');
    // The child receives only its own token and runtime paths, never AI or administrator secrets.
    const env: NodeJS.ProcessEnv = {};
    for (const key of ['SystemRoot', 'WINDIR', 'SystemDrive', 'TEMP', 'TMP', 'PATH', 'PATHEXT', 'USERPROFILE', 'LOCALAPPDATA', 'APPDATA', 'PROGRAMDATA']) if (process.env[key]) env[key] = process.env[key];
    Object.assign(env, { TG_STATE_DIR: this.state, TG_NODE_SESSION: this.session, COLLECTOR_TOKEN: process.env.COLLECTOR_TOKEN,
      RADAR_INGEST_URL: `http://127.0.0.1:${process.env.PORT}/api/news/telegram`, TELEGRAM_ENABLED: 'true', TG_USE_CONFIRMED: 'true' });
    process.env.TELEGRAM_ENABLED = 'true';
    this.error = null;
    const child = this.child = spawn(process.execPath, ['main.cjs'], { cwd: this.directory, env, windowsHide: true, stdio: ['ignore', 'pipe', 'ignore', 'ipc'] });
    let output = '';
    child.stdout?.setEncoding('utf8').on('data', (chunk: string) => {
      output += chunk;
      const lines = output.split(/\r?\n/); output = lines.pop()!.slice(-2_000);
      for (const line of lines) {
        if (line.startsWith('RADAR_FAILURE ')) this.error = line.slice(14, 414);
        else if (line === 'RADAR_READY') this.error = null;
      }
    });
    child.once('error', () => { this.error = '无法启动后台采集服务，请检查 Node.js 和项目目录权限。'; });
    child.once('close', code => { if (this.child === child) this.child = undefined; if (code && !this.error) this.error = `后台采集服务已退出（${code}），请点击“启动后台服务”重试。`; });
  }
  onApplicationBootstrap() {
    if (this.enabled) { try { this.start(); } catch (error) { this.error = (error as Error).message; } }
  }
  onApplicationShutdown() { if (this.child?.connected) this.child.send({ type: 'shutdown' }); }
}
