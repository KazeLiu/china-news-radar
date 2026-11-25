import { Body, Controller, Get, Header, Param, Patch, Post, Query, Req, UseInterceptors } from '@nestjs/common';
import { AdminRequest, requireAdmin } from './admin-access';
import { NewsAuditInterceptor } from './news-audit.interceptor';
import { NewsComparisonService } from './news-comparison.service';

@Controller('api/news')
@UseInterceptors(NewsAuditInterceptor)
export class NewsComparisonController {
  constructor(private readonly comparisons: NewsComparisonService) {}

  @Get('comparisons')
  @Header('Cache-Control', 'no-store')
  read(@Query('event') event?: string, @Query('article') article?: string) {
    return this.comparisons.read(event, article);
  }

  @Post('admin/comparisons')
  queue(@Body() body: unknown, @Req() req: AdminRequest) {
    requireAdmin(req);
    return this.comparisons.queue(body);
  }

  @Get('admin/comparisons')
  adminList(@Req() req: AdminRequest) {
    requireAdmin(req);
    return this.comparisons.adminList();
  }

  @Patch('admin/comparisons/:id/withdraw')
  withdraw(@Param('id') id: string, @Req() req: AdminRequest) {
    requireAdmin(req);
    return this.comparisons.withdraw(id);
  }
}
