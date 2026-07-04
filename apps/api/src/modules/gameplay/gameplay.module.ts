import { Module } from '@nestjs/common';
import { GameplayService } from './gameplay.service';
import { GameplayController } from './gameplay.controller';
import { PodLifecycleService } from './pod-lifecycle.service';
import { IdentityModule } from '../identity/identity.module';
import { AnalyticsModule } from '../analytics/analytics.module';

@Module({
  imports: [IdentityModule, AnalyticsModule],
  providers: [GameplayService, PodLifecycleService],
  controllers: [GameplayController],
  exports: [GameplayService, PodLifecycleService],
})
export class GameplayModule {}
