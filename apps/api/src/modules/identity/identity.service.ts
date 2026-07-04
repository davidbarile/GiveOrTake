import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { RedisService } from '../../redis/redis.service';
import * as bcrypt from 'bcryptjs';
import { createId } from '@paralleldrive/cuid2';

/** Adjective–noun pairs for auto-generated usernames */
const ADJECTIVES = [
  'Amber','Azure','Brave','Bright','Calm','Clever','Cool','Crisp','Cyan',
  'Daring','Dawn','Deep','Eager','Ember','Fair','Fierce','Frosty','Gentle',
  'Gold','Grand','Green','Keen','Kind','Lively','Lunar','Mellow','Midnight',
  'Mint','Mystic','Noble','Ocean','Olive','Prism','Quick','Quiet','Rustic',
  'Sage','Scarlet','Sharp','Silver','Sleek','Solar','Stark','Steel','Storm',
  'Swift','Teal','Velvet','Vivid','Warm','Wild','Winter','Wise','Zesty',
];
const NOUNS = [
  'Bear','Bolt','Buck','Cedar','Cloud','Comet','Coyote','Crane','Crystal',
  'Dusk','Eagle','Falcon','Flame','Flash','Fox','Glacier','Hawk','Heron',
  'Horizon','Jaguar','Kite','Lark','Leopard','Lynx','Maple','Mist','Moon',
  'Moth','Otter','Owl','Peak','Pine','Pixel','Puma','Quartz','Raven','Ridge',
  'River','Robin','Sage','Signal','Spark','Spirit','Stone','Storm','Summit',
  'Tiger','Tide','Torch','Trail','Vapor','Viper','Volt','Wave','Wren',
];

function randomWord(list: string[]): string {
  return list[Math.floor(Math.random() * list.length)];
}

function generateUsername(): string {
  const adj = randomWord(ADJECTIVES);
  const noun = randomWord(NOUNS);
  const num = Math.floor(Math.random() * 90) + 10; // 10–99
  return `${adj}${noun}${num}`;
}

@Injectable()
export class IdentityService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly redis: RedisService,
  ) {}

  private async createSessionForPlayer(playerId: string, deviceFingerprint?: string): Promise<string> {
    const sessionToken = createId() + createId();
    const tokenHash = await bcrypt.hash(sessionToken, 4);
    const expiresAt = new Date(Date.now() + 90 * 24 * 60 * 60 * 1000);

    await this.prisma.deviceSession.create({
      data: { playerId, sessionTokenHash: tokenHash, deviceFingerprint, expiresAt },
    });

    await this.redis.set(`session:${tokenHash}`, playerId, 'EX', 90 * 24 * 60 * 60);
    return sessionToken;
  }

  /** Generate a username that is not already taken */
  async generateUniqueUsername(): Promise<string> {
    for (let i = 0; i < 20; i++) {
      const candidate = generateUsername();
      const existing = await this.prisma.player.findUnique({
        where: { username: candidate },
      });
      if (!existing) return candidate;
    }
    // fallback: append cuid2 suffix
    return `Player${createId().slice(0, 6)}`;
  }

  /** Bootstrap a brand-new guest player and return a session token */
  async bootstrapGuest(deviceFingerprint?: string): Promise<{
    player: { id: string; username: string; isGuest: boolean };
    sessionToken: string;
  }> {
    const username = await this.generateUniqueUsername();

    const player = await this.prisma.player.create({
      data: {
        username,
        isGuest: true,
      },
      select: { id: true, username: true, isGuest: true },
    });

    const sessionToken = await this.createSessionForPlayer(player.id, deviceFingerprint);
    return { player, sessionToken };
  }

  /** Resolve a session token to its player or null if invalid/expired */
  async resolveSession(sessionToken: string): Promise<string | null> {
    // We must check all hashes; but for MVP we do a DB lookup by matching
    const sessions = await this.prisma.deviceSession.findMany({
      where: { expiresAt: { gt: new Date() } },
      select: { id: true, sessionTokenHash: true, playerId: true, lastSeenAt: true },
      take: 1000, // reasonable cap — replace with token-based lookup in production
    });
    for (const s of sessions) {
      const match = await bcrypt.compare(sessionToken, s.sessionTokenHash);
      if (match) {
        // bump lastSeenAt async
        void this.prisma.deviceSession
          .update({ where: { id: s.id }, data: { lastSeenAt: new Date() } })
          .catch(() => {});
        return s.playerId;
      }
    }
    return null;
  }

  /** Claim an account: attach email + password to a guest player */
  async claimAccount(
    playerId: string,
    email: string,
    password: string,
  ): Promise<{ id: string; username: string; email: string; isGuest: boolean }> {
    const existing = await this.prisma.player.findUnique({ where: { email } });
    if (existing) throw new Error('EMAIL_TAKEN');

    const passwordHash = await bcrypt.hash(password, 10);
    const player = await this.prisma.player.update({
      where: { id: playerId },
      data: { email, passwordHash, isGuest: false, claimedAt: new Date() },
      select: { id: true, username: true, email: true, isGuest: true },
    });
    return player as any;
  }

  /** Log in with email + password — returns sessionToken */
  async login(
    email: string,
    password: string,
    deviceFingerprint?: string,
  ): Promise<{
    player: { id: string; username: string; isGuest: boolean };
    sessionToken: string;
  }> {
    const player = await this.prisma.player.findUnique({ where: { email } });
    if (!player || !player.passwordHash) throw new Error('INVALID_CREDENTIALS');

    const valid = await bcrypt.compare(password, player.passwordHash);
    if (!valid) throw new Error('INVALID_CREDENTIALS');

    const sessionToken = await this.createSessionForPlayer(player.id, deviceFingerprint);

    return {
      player: { id: player.id, username: player.username, isGuest: player.isGuest },
      sessionToken,
    };
  }

  /** Change username (anyone can call this once per session) */
  async changeUsername(playerId: string, newUsername: string): Promise<string> {
    if (!/^[A-Za-z0-9_]{3,24}$/.test(newUsername)) throw new Error('INVALID_USERNAME');
    const existing = await this.prisma.player.findUnique({ where: { username: newUsername } });
    if (existing) throw new Error('USERNAME_TAKEN');
    await this.prisma.player.update({ where: { id: playerId }, data: { username: newUsername } });
    return newUsername;
  }

  async getPlayer(playerId: string) {
    const player = await this.prisma.player.findUnique({
      where: { id: playerId },
      select: { id: true, username: true, email: true, isGuest: true, ownedPodSlots: true, extraSlotsPurchased: true, createdAt: true },
    });
    if (!player) return null;

    const currentOwnedPodCount = await this.prisma.pod.count({
      where: { creatorId: playerId, status: { not: 'COMPLETED' as any } },
    });

    return {
      ...player,
      currentOwnedPodCount,
      maxOwnedPods: player.ownedPodSlots + player.extraSlotsPurchased,
    };
  }

  async addDebugUser(deviceFingerprint?: string): Promise<{
    player: { id: string; username: string; isGuest: boolean };
    sessionToken: string;
  }> {
    return this.bootstrapGuest(deviceFingerprint);
  }

  async deleteAllUsersAndBootstrap(deviceFingerprint?: string): Promise<{
    player: { id: string; username: string; isGuest: boolean };
    sessionToken: string;
  }> {
    await this.prisma.player.deleteMany({});
    return this.bootstrapGuest(deviceFingerprint);
  }

  async listDebugUsers() {
    return this.prisma.player.findMany({
      orderBy: { createdAt: 'desc' },
      select: {
        id: true,
        username: true,
        email: true,
        isGuest: true,
        createdAt: true,
        _count: {
          select: {
            memberships: true,
            createdPods: true,
            sessions: true,
          },
        },
      },
    });
  }

  async switchDebugUser(playerId: string, deviceFingerprint?: string): Promise<{
    player: { id: string; username: string; isGuest: boolean };
    sessionToken: string;
  }> {
    const player = await this.prisma.player.findUnique({
      where: { id: playerId },
      select: { id: true, username: true, isGuest: true },
    });
    if (!player) throw new Error('PLAYER_NOT_FOUND');

    const sessionToken = await this.createSessionForPlayer(player.id, deviceFingerprint);
    return { player, sessionToken };
  }
}
