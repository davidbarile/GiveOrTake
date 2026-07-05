import { Module } from '@nestjs/common';
import { GameplayService } from './gameplay.service';
import { GameplayController } from './gameplay.controller';
import { PodLifecycleService } from './pod-lifecycle.service';
import { IdentityModule } from '../identity/identity.module';
import { AnalyticsModule } from '../analytics/analytics.module';
import { RealtimeModule } from '../realtime/realtime.module';

@Module({
  imports: [IdentityModule, AnalyticsModule, RealtimeModule],
  providers: [GameplayService, PodLifecycleService],
  controllers: [GameplayController],
  exports: [GameplayService, PodLifecycleService],
})
export class GameplayModule {}
