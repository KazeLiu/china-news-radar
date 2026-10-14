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

  /** News collection returns its result; the legacy scheduler returns a scan ticket. */
  @Post('check-hotspots')
  @HttpCode(202)
  async checkHotspots(@Req() req: AdminRequest) {
    if (this.news) {
      requireAdminMutation(req); const result = await this.news.scan();
      const message = !result.started ? '采集正在进行' : !result.sourcesChecked ? '当前没有到期的来源，失败来源仍遵守退避' : result.sourcesFailed ? '采集已完成，部分来源失败，请查看后台详情' : '涉华采集已完成';
      return { message, isScanning: result.scanning, ...result };
    }
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
