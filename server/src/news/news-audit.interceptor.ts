import { CallHandler, ExecutionContext, HttpException, Injectable, NestInterceptor } from '@nestjs/common';
import { catchError, mergeMap } from 'rxjs';
import { NewsLogsService } from './news-logs.service';
@Injectable()
export class NewsAuditInterceptor implements NestInterceptor {
  constructor(private readonly logs: NewsLogsService) {}
  intercept(context: ExecutionContext, next: CallHandler) {
    const req = context.switchToHttp().getRequest();
    if (['GET', 'HEAD', 'OPTIONS'].includes(req.method) || /\/sources\/browser\/[^/]+\/input$/.test(req.path) || !(req.path.includes('/admin/') || req.path.includes('/sources/') || req.path.endsWith('/scan'))) return next.handle();
    const startedAt = new Date(); const route = `${req.method} ${req.route.path}`;
    const kind = /\/(?:test|preview)$/.test(req.path) ? 'preview' : 'admin';
    const record = async (status: string, result?: { savedSourceId?: string; sourceId?: string; item?: { sourceId: string }; rawCount?: number; checkedCount?: number; acceptedCount?: number; code?: string; error?: string; count?: number; action?: string }, error?: unknown) => {
      let sourceId: string | null = null;
      if ((status !== 'failed' || kind === 'preview') && req.path.includes('/sources')) {
        const id = result?.savedSourceId || req.params.id || req.body?.id;
        if (typeof id === 'string' && /^[a-z][a-z0-9_-]{0,63}$/.test(id)) sourceId = id;
      } else if (status !== 'failed' && req.path.includes('/items')) sourceId = result?.sourceId || result?.item?.sourceId || null;
      const httpStatus = error instanceof HttpException ? error.getStatus() : 500;
      const reasons: Record<number, string> = { 400: '参数、配置或内容规则不符合要求', 404: '新闻、来源或任务不存在', 409: '状态已改变或操作正在进行，请刷新后重试' };
      const sourcePreview = req.path.endsWith('/sources/test') ? result : undefined;
      await this.logs.record({ startedAt, kind, route, sourceId, status, elapsedMs: Date.now() - startedAt.getTime(), errorCode: status === 'failed' ? sourcePreview?.code || 'operation-rejected' : null,
        errorReason: status === 'failed' ? sourcePreview?.error || reasons[httpStatus] || '操作未完成，请查看页面错误或关联任务详情' : null,
        ...(req.path.endsWith('/items/batch') && status === 'success' ? { detailsJson: JSON.stringify({ count: result?.count, action: result?.action }) } : {}),
        ...(kind === 'preview' && result?.rawCount !== undefined ? { discovered: result.rawCount, filtered: (result.checkedCount || 0) - (result.acceptedCount || 0) } : {}) });
    };
    return next.handle().pipe(mergeMap(async result => { await record(result?.ok === false ? 'failed' : 'success', result); return result; }),
      catchError(async error => { await record('failed', undefined, error); throw error; }));
  }
}
