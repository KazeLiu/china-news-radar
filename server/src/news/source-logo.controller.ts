import { BadRequestException, Body, Controller, Get, NotFoundException, Param, Post, Res, UseInterceptors } from '@nestjs/common';
import { NewsAuditInterceptor } from './news-audit.interceptor';
import { randomUUID } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
function mediaDirectory() {
  const database = path.resolve(__dirname, '../../prisma', (process.env.DATABASE_URL || 'file:radar.db').slice(5));
  return process.env.MEDIA_DIR || path.join(path.dirname(database), 'media');
}
@Controller('api/news')
@UseInterceptors(NewsAuditInterceptor)
export class SourceLogoController {
  @Post('admin/sources/logo') async upload(@Body() body: { data?: unknown }) {
    if (typeof body.data !== 'string' || body.data.length > 1_400_000) throw new BadRequestException('Logo 最大为 1 MiB');
    const matched = /^data:image\/(png|jpeg|webp);base64,([A-Za-z0-9+/]+={0,2})$/.exec(body.data);
    if (!matched) throw new BadRequestException('Logo 仅支持 PNG、JPEG、WebP');
    const buffer = Buffer.from(matched[2], 'base64');
    const valid = matched[1] === 'png' ? buffer.subarray(0, 8).equals(Buffer.from('89504e470d0a1a0a', 'hex')) : matched[1] === 'jpeg' ? buffer.subarray(0, 3).equals(Buffer.from('ffd8ff', 'hex')) : buffer.subarray(0, 4).toString() === 'RIFF' && buffer.subarray(8, 12).toString() === 'WEBP';
    if (!valid || buffer.length > 1_048_576) throw new BadRequestException('图片格式无效或超过 1 MiB');
    const filename = `${randomUUID()}.${matched[1] === 'jpeg' ? 'jpg' : matched[1]}`;
    const directory = mediaDirectory(); await mkdir(directory, { recursive: true });
    await writeFile(path.join(directory, filename), buffer, { flag: 'wx', mode: 0o600 });
    return { logo: `/api/news/logos/${filename}` };
  }
  @Get('logos/:id') async logo(@Param('id') id: string, @Res() res: { setHeader(name: string, value: string): void; send(body: Buffer): void }) {
    if (!/^[a-f0-9-]{36}\.(png|jpg|webp)$/.test(id)) throw new NotFoundException('Logo 不存在');
    let buffer: Buffer;
    try { buffer = await readFile(path.join(mediaDirectory(), id)); } catch (error) { if ((error as { code?: string }).code === 'ENOENT') throw new NotFoundException('Logo 不存在'); throw error; }
    res.setHeader('Content-Type', id.endsWith('.png') ? 'image/png' : id.endsWith('.jpg') ? 'image/jpeg' : 'image/webp');
    res.setHeader('X-Content-Type-Options', 'nosniff'); res.setHeader('Cache-Control', 'public, max-age=2592000, immutable');
    res.send(buffer);
  }
}
