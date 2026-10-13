import { Controller, Get, Post, Put, Patch, Delete, Param, Body, HttpCode, Req } from '@nestjs/common';
import { KeywordsService } from './keywords.service';
import { AdminRequest, requireAdminMutation } from '../news/admin-access';
import { newsMode } from '../news/radar-content';

@Controller('api/keywords')
export class KeywordsController {
  constructor(private readonly keywordsService: KeywordsService) {}

  @Get()
  findAll() {
    return this.keywordsService.findAll();
  }

  @Get(':id')
  findOne(@Param('id') id: string) {
    return this.keywordsService.findOne(id);
  }

  @Post()
  create(@Body() body: { text: string; category?: string }, @Req() req: AdminRequest) {
    if (newsMode()) requireAdminMutation(req);
    return this.keywordsService.create(body);
  }

  @Put(':id')
  update(@Param('id') id: string, @Body() body: { text?: string; category?: string; isActive?: boolean }, @Req() req: AdminRequest) {
    if (newsMode()) requireAdminMutation(req);
    return this.keywordsService.update(id, body);
  }

  @Patch(':id/toggle')
  toggle(@Param('id') id: string, @Req() req: AdminRequest) {
    if (newsMode()) requireAdminMutation(req);
    return this.keywordsService.toggle(id);
  }

  @Delete(':id')
  @HttpCode(204)
  remove(@Param('id') id: string, @Req() req: AdminRequest) {
    if (newsMode()) requireAdminMutation(req);
    return this.keywordsService.remove(id);
  }
}
