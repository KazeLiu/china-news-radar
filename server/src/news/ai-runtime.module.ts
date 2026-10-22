import { Body, Controller, Get, Global, Module, Param, Put, Query } from '@nestjs/common';
import { PrismaModule } from '../prisma/prisma.module';
import { AiRuntimeService } from './ai-runtime.service';
import { NewsLogsService } from './news-logs.service';
@Controller('api/news/admin/logs')
class NewsLogsController {
  constructor(private readonly logs: NewsLogsService) {}
  @Get() read(@Query() query: Parameters<NewsLogsService['read']>[0]) { return this.logs.read(query); }
}
@Controller('api/news/admin/ai')
class AiTasksController {
  constructor(private readonly ai: AiRuntimeService) {}
  @Get('tasks/:id') task(@Param('id') id: string) { return this.ai.task(id); }
  @Get('requests') requests(@Query() query: { page?: string }) { return this.ai.requests(query); }
  @Get('requests/:id') request(@Param('id') id: string) { return this.ai.request(id); }
  @Get('queue') queue() { return this.ai.queueStatus(); }
  @Put('queue') pause(@Body() body: { paused?: unknown }) { return this.ai.pause(body.paused); }
}
@Global()
@Module({ imports: [PrismaModule], controllers: [AiTasksController, NewsLogsController], providers: [AiRuntimeService, NewsLogsService], exports: [AiRuntimeService, NewsLogsService] })
export class AiRuntimeModule {}
