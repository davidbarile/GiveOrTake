import { Controller, Post, Get, Param, Body, Req, UnauthorizedException } from '@nestjs/common';
import { Request } from 'express';
import { GameplayService } from './gameplay.service';
import { IdentityService } from '../identity/identity.service';

const COOKIE = 'got_session';

@Controller('pods/:podId/game')
export class GameplayController {
  constructor(
    private readonly gameplay: GameplayService,
    private readonly identity: IdentityService,
  ) {}

  @Post('action')
  async action(
    @Param('podId') podId: string,
    @Body() body: { action: 'GIVE' | 'TAKE'; requestId: string },
    @Req() req: Request,
  ) {
    const token = req.cookies?.[COOKIE];
    if (!token) throw new UnauthorizedException();
    const playerId = await this.identity.resolveSession(token);
    if (!playerId) throw new UnauthorizedException();

    return this.gameplay.processAction(playerId, podId, body.action, body.requestId);
  }

  @Get('state')
  async state(
    @Param('podId') podId: string,
    @Req() req: Request,
  ) {
    const token = req.cookies?.[COOKIE];
    if (!token) throw new UnauthorizedException();
    const playerId = await this.identity.resolveSession(token);
    if (!playerId) throw new UnauthorizedException();
    return this.gameplay.getPlayerState(podId, playerId);
  }
}
