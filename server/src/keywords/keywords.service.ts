import { Injectable, NotFoundException, ConflictException, BadRequestException, Optional } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { EntitiesService } from '../entities/entities.service';
import { NewsBridgeService } from '../news/news-bridge.service';
import { contentScope, presentHotspot } from '../news/radar-content';

@Injectable()
export class KeywordsService {
  constructor(
    private prisma: PrismaService,
    private entitiesService: EntitiesService,
    @Optional() private bridge?: NewsBridgeService,
  ) {}

  async findAll() {
    const keywords = await this.prisma.keyword.findMany({
      orderBy: { createdAt: 'desc' },
      include: { _count: { select: { hotspots: true } } },
    });
    if (!this.bridge) return keywords;
    return Promise.all(keywords.map(async keyword => ({ ...keyword, _count: { hotspots: await this.prisma.hotspot.count({ where: contentScope({ newsItem: { is: { keywordMatches: { some: { keywordId: keyword.id } } } } }) }) } })));
  }

  async findOne(id: string) {
    const keyword = await this.prisma.keyword.findUnique({
      where: { id },
      include: { hotspots: { where: contentScope(), orderBy: { createdAt: 'desc' }, take: 20 } },
    });
    if (!keyword) throw new NotFoundException('Keyword not found');
    if (this.bridge) {
      const hotspots = await this.prisma.hotspot.findMany({ where: contentScope({ newsItem: { is: { keywordMatches: { some: { keywordId: id } } } } }), include: { newsItem: true }, orderBy: { createdAt: 'desc' }, take: 20 });
      return { ...keyword, hotspots: hotspots.map(presentHotspot) };
    }
    return keyword;
  }

  async create(data: { text: string; category?: string }) {
    if (typeof data.text !== 'string' || data.text.trim().length === 0 || data.text.length > 200) {
      throw new BadRequestException('Keyword text is required');
    }
    let keyword: Awaited<ReturnType<typeof this.prisma.keyword.create>>;
    try {
      keyword = await this.prisma.keyword.create({
        data: { text: data.text.trim(), category: data.category?.trim() || null },
      });
    } catch (error: any) {
      if (error.code === 'P2002') throw new ConflictException('Keyword already exists');
      throw error;
    }
    await this.bridge?.rematchKeyword(keyword.id);
    const task = await this.entitiesService.createForKeyword(keyword.id, keyword.text);
    return { ...keyword, ...(task || {}) };
  }

  async update(id: string, data: { text?: string; category?: string; isActive?: boolean }) {
    if (data.text !== undefined && (typeof data.text !== 'string' || !data.text.trim() || data.text.length > 200)) throw new BadRequestException('关键词应为 1–200 个字符');
    if (data.isActive !== undefined && typeof data.isActive !== 'boolean') throw new BadRequestException('启用状态必须为布尔值');
    try {
      const keyword = await this.prisma.keyword.update({
        where: { id },
        data: {
          ...(data.text && { text: data.text.trim() }),
          ...(data.category !== undefined && { category: data.category?.trim() || null }),
          ...(data.isActive !== undefined && { isActive: data.isActive }),
        },
      });
      if (data.text) await this.prisma.entityCard.updateMany({ where: { keywordId: id }, data: { name: keyword.text } });
      if (data.text !== undefined || data.isActive !== undefined) await this.bridge?.rematchKeyword(id);
      return keyword;
    } catch (error: any) {
      if (error.code === 'P2025') throw new NotFoundException('Keyword not found');
      throw error;
    }
  }

  async toggle(id: string) {
    const keyword = await this.prisma.keyword.findUnique({ where: { id } });
    if (!keyword) throw new NotFoundException('Keyword not found');
    const updated = await this.prisma.keyword.update({ where: { id }, data: { isActive: !keyword.isActive } });
    await this.bridge?.rematchKeyword(id);
    return updated;
  }

  async remove(id: string) {
    try {
      await this.prisma.keyword.delete({ where: { id } });
    } catch (error: any) {
      if (error.code === 'P2025') throw new NotFoundException('Keyword not found');
      throw error;
    }
  }
}
