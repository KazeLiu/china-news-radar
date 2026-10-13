import { Controller, Get, Post, Param, Query, Req } from '@nestjs/common';
import { DigestService } from './digest.service';
import { AdminRequest, requireAdminMutation } from '../news/admin-access';
import { newsMode } from '../news/radar-content';

@Controller('api/digest')
export class DigestController {
  constructor(private readonly digestService: DigestService) {}

  @Get('today')
  getToday() {
    return this.digestService.getTodayDigest();
  }

  /** Manually generate digest. date defaults to today (Beijing time). */
  @Post('generate')
  async generate(@Req() req: AdminRequest, @Query('date') date?: string) {
    if (newsMode()) requireAdminMutation(req);
    const target = date || this.digestService.getBeijingDatePublic();
    const task = await this.digestService.generateDigest(target);
    return { message: `日报任务已提交：${target}`, ...(task || {}) };
  }

  @Get('recent')
  getRecent() {
    return this.digestService.getRecentDigests();
  }

  @Get(':date')
  getByDate(@Param('date') date: string) {
    return this.digestService.getDigestByDate(date);
  }
}
