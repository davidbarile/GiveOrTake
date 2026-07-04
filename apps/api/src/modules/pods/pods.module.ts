import { Module } from '@nestjs/common';
import { PodsService } from './pods.service';
import { PodsController } from './pods.controller';
import { IdentityModule } from '../identity/identity.module';
import { GameplayModule } from '../gameplay/gameplay.module';

@Module({
  imports: [IdentityModule, GameplayModule],
  providers: [PodsService],
  controllers: [PodsController],
  exports: [PodsService],
})
export class PodsModule {}
