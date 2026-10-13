import { Module } from '@nestjs/common';
import { AgentController } from './agent.controller';
import { AgentService } from './agent.service';
import { PrismaModule } from '../prisma/prisma.module';
import { DigestModule } from '../digest/digest.module';
import { CuratedModule } from '../curated/curated.module';

@Module({
  imports: [PrismaModule, DigestModule, CuratedModule],
  controllers: [AgentController],
  providers: [AgentService],
})
export class AgentModule {}
