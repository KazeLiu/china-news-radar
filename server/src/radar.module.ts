import { Global, Module } from '@nestjs/common';
import { PrismaModule } from './prisma/prisma.module';
import { NewsController } from './news/news.controller';
import { NewsService } from './news/news.service';
import { GatewayModule } from './gateway/gateway.module';
import { NewsBridgeService } from './news/news-bridge.service';
import { AiRuntimeService } from './news/ai-runtime.service';
import { NewsEditorialService } from './news/news-editorial.service';
import { EmailService } from './services/email.service';

@Global()
@Module({ imports: [PrismaModule, GatewayModule], controllers: [NewsController], providers: [NewsService, NewsBridgeService, AiRuntimeService, NewsEditorialService, EmailService], exports: [NewsService, NewsBridgeService, AiRuntimeService, NewsEditorialService] })
export class RadarModule {}
