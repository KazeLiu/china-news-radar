import { Controller, Get, Post, HttpCode, Optional, Req } from '@nestjs/common';
import { HotspotScheduler } from './scheduler/hotspot.scheduler';
import { NewsService } from './news/news.service';
import { AdminRequest, requireAdminMutation } from './news/admin-access';

@Controller('api')
export class AppController {
  constructor(@Optional() private scheduler?: HotspotScheduler, @Optional() private news?: NewsService) {}

  @Get('health')
  health() {
    return { status: 'ok', timestamp: new Date().toISOString() };
  }

  /** Fire-and-forget: returns immediately, scan continues in the background. */
  @Post('check-hotspots')
  @HttpCode(202)
  async checkHotspots(@Req() req: AdminRequest) {
    if (this.news) { requireAdminMutation(req); const result = await this.news.scan(); return { message: '涉华采集已完成', ...result }; }
    const result = this.scheduler!.triggerScan();
    if (!result.started) {
      return { message: 'Scan already in progress', ...this.scheduler!.getScanStatus() };
    }
    return { message: 'Hotspot check started', ...this.scheduler!.getScanStatus() };
  }

  @Get('scan-status')
  scanStatus() {
    if (this.news) return this.news.status().then(status => ({ isScanning: status.scanning, lastScanStartedAt: null, lastScanFinishedAt: status.latestDiscoveryAt, lastScanError: null }));
    return this.scheduler!.getScanStatus();
  }
}
