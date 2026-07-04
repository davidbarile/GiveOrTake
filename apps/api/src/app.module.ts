import { Module } from '@nestjs/common';
import { ThrottlerModule } from '@nestjs/throttler';
import { PrismaModule } from './prisma/prisma.module';
import { RedisModule } from './redis/redis.module';
import { IdentityModule } from './modules/identity/identity.module';
import { PodsModule } from './modules/pods/pods.module';
import { GameplayModule } from './modules/gameplay/gameplay.module';
import { FeedModule } from './modules/feed/feed.module';
import { ModerationModule } from './modules/moderation/moderation.module';
import { AnalyticsModule } from './modules/analytics/analytics.module';
import { RealtimeModule } from './modules/realtime/realtime.module';
import { LeaderboardsModule } from './modules/leaderboards/leaderboards.module';
import { NotificationsModule } from './modules/notifications/notifications.module';

@Module({
  imports: [
    ThrottlerModule.forRoot([{ ttl: 60_000, limit: 120 }]),
    PrismaModule,
    RedisModule,
    IdentityModule,
    PodsModule,
    GameplayModule,
    FeedModule,
    ModerationModule,
    AnalyticsModule,
    RealtimeModule,
    LeaderboardsModule,
    NotificationsModule,
  ],
})
export class AppModule {}
