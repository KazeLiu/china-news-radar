import { Module } from '@nestjs/common';
import { ScheduleModule } from '@nestjs/schedule';
import { AppController } from './app.controller';
import { PrismaModule } from './prisma/prisma.module';
import { GatewayModule } from './gateway/gateway.module';
import { ServicesModule } from './services/services.module';
import { KeywordsModule } from './keywords/keywords.module';
import { HotspotsModule } from './hotspots/hotspots.module';
import { NotificationsModule } from './notifications/notifications.module';
import { SettingsModule } from './settings/settings.module';
import { SchedulerModule } from './scheduler/scheduler.module';
import { CuratedModule } from './curated/curated.module';
import { DigestModule } from './digest/digest.module';
import { ChatModule } from './chat/chat.module';
import { AgentModule } from './agent/agent.module';
import { EntitiesModule } from './entities/entities.module';
import { RadarModule } from './radar.module';

@Module({
  imports: [
    ScheduleModule.forRoot(),
    PrismaModule,
    GatewayModule,
    ServicesModule,
    KeywordsModule,
    HotspotsModule,
    NotificationsModule,
    ...(process.env.RADAR_MODE === 'legacy' ? [SchedulerModule, SettingsModule, ChatModule] : [RadarModule]),
    CuratedModule,
    DigestModule,
    AgentModule,
    EntitiesModule,
  ],
  controllers: [AppController],
})
export class AppModule {}
