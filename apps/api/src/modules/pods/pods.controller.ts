import {
  Controller, Get, Post, Body, Param, Query, Req, UnauthorizedException, HttpCode, HttpStatus,
} from '@nestjs/common';
import { Request } from 'express';
import { PodsService } from './pods.service';
import { IdentityService } from '../identity/identity.service';

const COOKIE = 'got_session';

async function requirePlayer(req: Request, identity: IdentityService): Promise<string> {
  const token = req.cookies?.[COOKIE];
  if (!token) throw new UnauthorizedException();
  const id = await identity.resolveSession(token);
  if (!id) throw new UnauthorizedException();
  return id;
}

@Controller('pods')
export class PodsController {
  constructor(
    private readonly pods: PodsService,
    private readonly identity: IdentityService,
  ) {}

  @Get()
  listPods(@Query('template') template?: string, @Query('status') status?: any) {
    return this.pods.listPublicPods({ template, status });
  }

  @Get('my')
  async myPods(@Req() req: Request) {
    const playerId = await requirePlayer(req, this.identity);
    return this.pods.getPlayerMemberships(playerId);
  }

  @Post('quickstart')
  @HttpCode(HttpStatus.OK)
  async quickstart(@Req() req: Request) {
    const playerId = await requirePlayer(req, this.identity);
    return this.pods.quickstart(playerId);
  }

  @Get(':podId/feed')
  getFeed(@Param('podId') podId: string, @Query('limit') limit?: string) {
    return this.pods.getFeed(podId, limit ? Number(limit) : 30);
  }

  @Get(':podId/leaderboard')
  getLeaderboard(@Param('podId') podId: string, @Query('limit') limit?: string) {
    return this.pods.getLeaderboard(podId, limit ? Number(limit) : 20);
  }

  @Get(':podId')
  getPod(@Param('podId') podId: string) {
    return this.pods.getPod(podId);
  }

  @Post()
  @HttpCode(HttpStatus.CREATED)
  async createPod(
    @Body() body: {
      name: string;
      sizeLimit: number;
      templateType: string;
      karmaMode?: string;
      powerPackage?: string;
      visibility?: string;
      startingGems?: number;
      actionCooldownSeconds?: number;
    },
    @Req() req: Request,
  ) {
    const playerId = await requirePlayer(req, this.identity);
    return this.pods.createPod(playerId, body);
  }

  @Post(':podId/join')
  @HttpCode(HttpStatus.OK)
  async joinPod(
    @Param('podId') podId: string,
    @Body() body: { inviteCode?: string },
    @Req() req: Request,
  ) {
    const playerId = await requirePlayer(req, this.identity);
    return this.pods.joinPod(playerId, podId, body.inviteCode);
  }

  @Post('join-by-code')
  @HttpCode(HttpStatus.OK)
  async joinByCode(
    @Body() body: { inviteCode: string },
    @Req() req: Request,
  ) {
    const playerId = await requirePlayer(req, this.identity);
    return this.pods.joinByInviteCode(playerId, body.inviteCode);
  }

  @Post(':podId/leave')
  @HttpCode(HttpStatus.NO_CONTENT)
  async leavePod(
    @Param('podId') podId: string,
    @Req() req: Request,
  ) {
    const playerId = await requirePlayer(req, this.identity);
    await this.pods.leaveQueue(playerId, podId);
  }

  @Get('/debug/settings')
  getDebugSettings() {
    return this.pods.getDebugSettings();
  }

  @Post('/debug/settings')
  @HttpCode(HttpStatus.OK)
  updateDebugSettings(
    @Body() body: {
      defaultPodStartingGems?: number;
      defaultPodActionCooldownSeconds?: number;
      requireFullPodToStart?: boolean;
      playersPerGiveTakeAction?: number;
    },
  ) {
    return this.pods.updateDebugSettings(body);
  }

  @Post('/debug/reset-pods')
  @HttpCode(HttpStatus.OK)
  resetAllPods() {
    return this.pods.resetAllPods();
  }
}
