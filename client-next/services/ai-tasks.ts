import { requestJson } from './http';
export interface AiTicket { taskId: string; status: string }
export async function waitForAiTask<T>(ticket: AiTicket): Promise<T> {
  for (;;) {
    const task = await requestJson<{ status: string; result: T; error?: { message?: string; detail?: string; requestId?: string } }>(`/api/news/admin/ai/tasks/${encodeURIComponent(ticket.taskId)}`);
    if (task.status === 'done') return task.result;
    if (task.status === 'failed') throw new Error(`${task.error?.message || 'AI 任务失败'} ${task.error?.detail || ''}${task.error?.requestId ? ` 请求 ID：${task.error.requestId}` : ''}`.trim());
    await new Promise(resolve => setTimeout(resolve, 1000));
  }
}
