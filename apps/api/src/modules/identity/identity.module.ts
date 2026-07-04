import { Module } from '@nestjs/common';
import { IdentityService } from './identity.service';
import { IdentityController, ProfileController } from './identity.controller';

@Module({
  providers: [IdentityService],
  controllers: [IdentityController, ProfileController],
  exports: [IdentityService],
})
export class IdentityModule {}
