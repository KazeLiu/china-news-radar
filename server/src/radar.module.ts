import { Global, Module } from '@nestjs/common';
import { PrismaModule } from './prisma/prisma.module';
import { NewsController } from './news/news.controller';
import { NewsService } from './news/news.service';
import { GatewayModule } from './gateway/gateway.module';
import { NewsBridgeService } from './news/news-bridge.service';
import { NewsEditorialService } from './news/news-editorial.service';
import { EmailService } from './services/email.service';
import { ServicesModule } from './services/services.module';
import { SourceAdapterService } from './news/source-adapter.service';
import { SourceLogoController } from './news/source-logo.controller';
import { WebCrawlerService } from './news/web-crawler.service';
import { NewsAuditInterceptor } from './news/news-audit.interceptor';
import { NewsTrashService } from './news/news-trash.service';

@Global()
@Module({ imports: [PrismaModule, GatewayModule, ServicesModule], controllers: [NewsController, SourceLogoController], providers: [NewsService, NewsBridgeService, NewsEditorialService, EmailService, SourceAdapterService, WebCrawlerService, NewsAuditInterceptor, NewsTrashService], exports: [NewsService, NewsBridgeService, NewsEditorialService] })
export class RadarModule {}
