import {
  Controller, Post, Get, Patch, Body, Res, Req, UnauthorizedException,
  BadRequestException, ConflictException, NotFoundException, HttpCode, HttpStatus,
} from '@nestjs/common';
import { Response, Request } from 'express';
import { IdentityService } from './identity.service';

const COOKIE_NAME = 'got_session';

function envFlag(name: string, fallback: boolean): boolean {
  const value = process.env[name];
  if (value == null || value === '') return fallback;
  return ['1', 'true', 'yes', 'on'].includes(value.toLowerCase());
}

const COOKIE_OPTS = {
  httpOnly: true,
  sameSite: 'lax' as const,
  secure: envFlag('COOKIE_SECURE', process.env.NODE_ENV === 'production'),
  maxAge: 90 * 24 * 60 * 60 * 1000,
};

function getToken(req: Request): string | undefined {
  return req.cookies?.[COOKIE_NAME];
}

@Controller('session')
export class IdentityController {
  constructor(private readonly identity: IdentityService) {}

  /** Bootstrap a guest — call on first app open */
  @Post('bootstrap')
  @HttpCode(HttpStatus.CREATED)
  async bootstrap(
    @Body() body: { deviceFingerprint?: string },
    @Res({ passthrough: true }) res: Response,
  ) {
    const result = await this.identity.bootstrapGuest(body.deviceFingerprint);
    res.cookie(COOKIE_NAME, result.sessionToken, COOKIE_OPTS);
    return { player: result.player };
  }

  /** Attach email+password to a guest account */
  @Post('claim')
  @HttpCode(HttpStatus.OK)
  async claim(
    @Body() body: { email: string; password: string },
    @Req() req: Request,
  ) {
    const token = getToken(req);
    if (!token) throw new UnauthorizedException();
    const playerId = await this.identity.resolveSession(token);
    if (!playerId) throw new UnauthorizedException();

    try {
      return await this.identity.claimAccount(playerId, body.email, body.password);
    } catch (e: any) {
      if (e.message === 'EMAIL_TAKEN') throw new ConflictException('Email already registered');
      throw e;
    }
  }

  /** Log in with email + password */
  @Post('login')
  @HttpCode(HttpStatus.OK)
  async login(
    @Body() body: { email: string; password: string; deviceFingerprint?: string },
    @Res({ passthrough: true }) res: Response,
  ) {
    try {
      const result = await this.identity.login(body.email, body.password, body.deviceFingerprint);
      res.cookie(COOKIE_NAME, result.sessionToken, COOKIE_OPTS);
      return { player: result.player };
    } catch {
      throw new UnauthorizedException('Invalid credentials');
    }
  }

  /** Log out — clear cookie */
  @Post('logout')
  @HttpCode(HttpStatus.NO_CONTENT)
  logout(@Res({ passthrough: true }) res: Response) {
    res.clearCookie(COOKIE_NAME);
  }

  /** Return current player from session */
  @Get('me')
  async me(@Req() req: Request) {
    const token = getToken(req);
    if (!token) throw new UnauthorizedException();
    const playerId = await this.identity.resolveSession(token);
    if (!playerId) throw new UnauthorizedException();
    const player = await this.identity.getPlayer(playerId);
    if (!player) throw new UnauthorizedException();
    return player;
  }

  @Get('debug/users')
  async listDebugUsers() {
    return this.identity.listDebugUsers();
  }

  @Post('debug/switch-user')
  @HttpCode(HttpStatus.OK)
  async switchDebugUser(
    @Body() body: { playerId?: string; deviceFingerprint?: string },
    @Res({ passthrough: true }) res: Response,
  ) {
    if (!body.playerId) throw new BadRequestException('playerId is required');

    try {
      const result = await this.identity.switchDebugUser(body.playerId, body.deviceFingerprint);
      res.cookie(COOKIE_NAME, result.sessionToken, COOKIE_OPTS);
      return { player: result.player };
    } catch (error: any) {
      if (error.message === 'PLAYER_NOT_FOUND') throw new NotFoundException('Player not found');
      throw error;
    }
  }

  @Post('debug/add-user')
  @HttpCode(HttpStatus.CREATED)
  async addDebugUser(
    @Body() body: { deviceFingerprint?: string },
    @Res({ passthrough: true }) res: Response,
  ) {
    const result = await this.identity.addDebugUser(body.deviceFingerprint);
    res.cookie(COOKIE_NAME, result.sessionToken, COOKIE_OPTS);
    return { player: result.player };
  }

  @Post('debug/delete-all-users')
  @HttpCode(HttpStatus.OK)
  async deleteAllUsers(
    @Body() body: { deviceFingerprint?: string },
    @Res({ passthrough: true }) res: Response,
  ) {
    const result = await this.identity.deleteAllUsersAndBootstrap(body.deviceFingerprint);
    res.cookie(COOKIE_NAME, result.sessionToken, COOKIE_OPTS);
    return { player: result.player };
  }
}

@Controller('profile')
export class ProfileController {
  constructor(private readonly identity: IdentityService) {}

  @Patch('username')
  async changeUsername(
    @Body() body: { username: string },
    @Req() req: Request,
  ) {
    const token = req.cookies?.[COOKIE_NAME];
    if (!token) throw new UnauthorizedException();
    const playerId = await this.identity.resolveSession(token);
    if (!playerId) throw new UnauthorizedException();

    try {
      const username = await this.identity.changeUsername(playerId, body.username);
      return { username };
    } catch (e: any) {
      if (e.message === 'USERNAME_TAKEN') throw new ConflictException('Username already taken');
      if (e.message === 'INVALID_USERNAME')
        throw new BadRequestException('Username must be 3–24 chars, letters/numbers/underscores only');
      throw e;
    }
  }
}
