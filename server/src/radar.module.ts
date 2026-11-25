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
import { TelegramAccountController } from './news/telegram-account.controller';
import { TelegramAccountService } from './news/telegram-account.service';
import { TelegramLocalService } from './news/telegram-local.service';
import { TelegramControlService } from './news/telegram-control.service';
import { ConfigMigrationService } from './news/config-migration.service';
import { ConfigMigrationController } from './news/config-migration.controller';
import { NewsComparisonService } from './news/news-comparison.service';
import { NewsComparisonController } from './news/news-comparison.controller';

@Global()
@Module({ imports: [PrismaModule, GatewayModule, ServicesModule], controllers: [NewsController, SourceLogoController, TelegramAccountController, ConfigMigrationController, NewsComparisonController], providers: [NewsService, NewsBridgeService, NewsEditorialService, NewsComparisonService, EmailService, SourceAdapterService, WebCrawlerService, NewsAuditInterceptor, NewsTrashService, TelegramAccountService, TelegramLocalService, TelegramControlService, ConfigMigrationService], exports: [NewsService, NewsBridgeService, NewsEditorialService] })
export class RadarModule {}
