import { Body, Controller, Get, Global, Module, Param, Put } from '@nestjs/common';
import { PrismaModule } from '../prisma/prisma.module';
import { AiRuntimeService } from './ai-runtime.service';
@Controller('api/news/admin/ai')
class AiTasksController {
  constructor(private readonly ai: AiRuntimeService) {}
  @Get('tasks/:id') task(@Param('id') id: string) { return this.ai.task(id); }
  @Get('queue') queue() { return this.ai.queueStatus(); }
  @Put('queue') pause(@Body() body: { paused?: unknown }) { return this.ai.pause(body.paused); }
}
@Global()
@Module({ imports: [PrismaModule], controllers: [AiTasksController], providers: [AiRuntimeService], exports: [AiRuntimeService] })
export class AiRuntimeModule {}
