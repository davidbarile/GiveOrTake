import { Module } from '@nestjs/common';
import { RealtimeGateway } from './realtime.gateway';
import { IdentityModule } from '../identity/identity.module';

@Module({
  imports: [IdentityModule],
  providers: [RealtimeGateway],
  exports: [RealtimeGateway],
})
export class RealtimeModule {}
