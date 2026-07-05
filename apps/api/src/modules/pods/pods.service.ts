import { Injectable, BadRequestException, NotFoundException, ForbiddenException } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { RedisService } from '../../redis/redis.service';
import { createId } from '@paralleldrive/cuid2';
import { PodStatus, PodVisibility, Prisma } from '@prisma/client';
import { PodLifecycleService } from '../gameplay/pod-lifecycle.service';

const INVITE_CODE_TTL = 90 * 24 * 60 * 60; // 90 days
const DEBUG_DEFAULT_POD_GEMS_KEY = 'debug:defaultPodStartingGems';
const DEBUG_DEFAULT_POD_COOLDOWN_KEY = 'debug:defaultPodActionCooldownSeconds';
const DEBUG_REQUIRE_FULL_POD_START_KEY = 'debug:requireFullPodToStart';
const DEBUG_PLAYERS_PER_ACTION_KEY = 'debug:playersPerGiveTakeAction';
const FALLBACK_STARTING_GEMS = 10;
const FALLBACK_COOLDOWN_SECONDS = 10;
const FALLBACK_REQUIRE_FULL_POD_START = false;
const FALLBACK_PLAYERS_PER_ACTION = 5;

const DEFAULT_PODS = [
  { name: 'Classic Pod', templateType: 'CLASSIC', karmaMode: 'NONE', powerPackage: 'NONE' },
  { name: 'Power Pod', templateType: 'POWER', karmaMode: 'NONE', powerPackage: 'TACTICAL_LIGHT' },
  { name: 'Karma Pod', templateType: 'KARMA', karmaMode: 'DUAL', powerPackage: 'NONE' },
  { name: 'Hybrid Pod', templateType: 'HYBRID', karmaMode: 'DUAL', powerPackage: 'TACTICAL_LIGHT' },
] as const;


function isSystemPlayablePod(pod: { creatorId: string | null; name: string }): boolean {
  return pod.creatorId === null && (
    pod.name === 'Quickstart Classic' || DEFAULT_PODS.some((defaultPod) => defaultPod.name === pod.name)
  );
}

function generateInviteCode(): string {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  return Array.from({ length: 6 }, () => chars[Math.floor(Math.random() * chars.length)]).join('');
}

function clampInt(value: unknown, fallback: number, min: number, max: number): number {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.min(Math.max(Math.trunc(parsed), min), max);
}

function parseBoolean(value: unknown, fallback: boolean): boolean {
  if (typeof value === 'boolean') return value;
  if (typeof value === 'string') {
    const normalized = value.trim().toLowerCase();
    if (['1', 'true', 'yes', 'on'].includes(normalized)) return true;
    if (['0', 'false', 'no', 'off'].includes(normalized)) return false;
  }
  return fallback;
}

@Injectable()
export class PodsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly redis: RedisService,
    private readonly podLifecycle: PodLifecycleService,
  ) {}

  async listPublicPods(filters?: { template?: string; status?: PodStatus }) {
    await this.ensureDefaultPods();

    return this.prisma.pod.findMany({
      where: {
        visibility: PodVisibility.PUBLIC,
        status: filters?.status ?? { in: [PodStatus.FILLING, PodStatus.COUNTDOWN, PodStatus.ACTIVE] },
        ...(filters?.template ? { templateType: filters.template as any } : {}),
        NOT: { creatorId: null, name: 'Quickstart Classic' },
      },
      orderBy: [{ currentPlayerCount: 'desc' }, { createdAt: 'asc' }],
      take: 50,
      select: {
        id: true, name: true, templateType: true, karmaMode: true, powerPackage: true,
        visibility: true, sizeLimit: true, currentPlayerCount: true, status: true, createdAt: true,
        startingGems: true, actionCooldownSeconds: true,
        creator: { select: { username: true } },
      },
    });
  }

  private async ensureDefaultPods() {
    const debugSettings = await this.getDebugSettings();
    for (const pod of DEFAULT_PODS) {
      const existing = await this.prisma.pod.findFirst({
        where: { creatorId: null, name: pod.name, status: { not: PodStatus.COMPLETED } },
      });
      if (!existing) {
        await this.prisma.pod.create({
          data: {
            name: pod.name,
            creatorId: null,
            templateType: pod.templateType as any,
            karmaMode: pod.karmaMode as any,
            powerPackage: pod.powerPackage as any,
            visibility: PodVisibility.PUBLIC,
            sizeLimit: 25,
            status: PodStatus.FILLING,
            startingGems: debugSettings.defaultPodStartingGems,
            actionCooldownSeconds: debugSettings.defaultPodActionCooldownSeconds,
          },
        });
      }
    }
  }

  async getPod(podId: string) {
    const pod = await this.prisma.pod.findUnique({
      where: { id: podId },
      include: { creator: { select: { id: true, username: true } } },
    });
    if (!pod) throw new NotFoundException('Pod not found');
    return pod;
  }

  async createPod(
    creatorId: string,
    data: {
      name: string;
      sizeLimit: number;
      templateType: string;
      karmaMode?: string;
      powerPackage?: string;
      visibility?: string;
      startingGems?: number;
      actionCooldownSeconds?: number;
    },
  ) {
    // Enforce 1-pod ownership limit for MVP
    const player = await this.prisma.player.findUnique({ where: { id: creatorId } });
    if (!player) throw new NotFoundException('Player not found');
    if (player.isGuest) {
      throw new ForbiddenException('Save progress with a claimed account before creating pods. Guests can join and play immediately.');
    }

    // Count existing owned pods that are not completed
    const ownedCount = await this.prisma.pod.count({
      where: { creatorId, status: { not: PodStatus.COMPLETED } },
    });
    if (ownedCount >= player.ownedPodSlots + player.extraSlotsPurchased) {
      throw new ForbiddenException('Pod creation limit reached. Complete or delete an existing pod first.');
    }

    const activePods = await this.prisma.podMembership.count({
      where: {
        playerId: creatorId,
        membershipStatus: { in: ['JOINED', 'ACTIVE'] as any },
        pod: { status: { in: [PodStatus.FILLING, PodStatus.COUNTDOWN, PodStatus.ACTIVE] } },
      },
    });
    if (activePods >= 3) {
      throw new ForbiddenException('You are already in the maximum number of active pods (3)');
    }

    const isPrivate = data.visibility === 'PRIVATE';
    let inviteCode: string | undefined;
    if (isPrivate) {
      // Generate unique invite code
      for (let i = 0; i < 10; i++) {
        const candidate = generateInviteCode();
        const existing = await this.prisma.pod.findUnique({ where: { inviteCode: candidate } });
        if (!existing) { inviteCode = candidate; break; }
      }
      if (!inviteCode) inviteCode = createId().slice(0, 8).toUpperCase();
    }

    const VALID_SIZES = [10, 25, 50, 100, 200, 500, 1000];
    if (!VALID_SIZES.includes(data.sizeLimit)) {
      throw new BadRequestException(`Invalid size. Choose from: ${VALID_SIZES.join(', ')}`);
    }

    const startingGems = clampInt(data.startingGems, FALLBACK_STARTING_GEMS, 1, 1_000_000);
    const actionCooldownSeconds = clampInt(data.actionCooldownSeconds, FALLBACK_COOLDOWN_SECONDS, 0, 86_400);

    const pod = await this.prisma.$transaction(async (tx) => {
      const createdPod = await tx.pod.create({
        data: {
          name: data.name.trim().slice(0, 40),
          creatorId,
          templateType: data.templateType as any,
          karmaMode: (data.karmaMode ?? 'NONE') as any,
          powerPackage: (data.powerPackage ?? 'NONE') as any,
          visibility: (data.visibility ?? 'PUBLIC') as any,
          inviteCode,
          sizeLimit: data.sizeLimit,
          currentPlayerCount: 1,
          status: PodStatus.FILLING,
          startingGems,
          actionCooldownSeconds,
        },
      });

      await tx.podMembership.create({
        data: { podId: createdPod.id, playerId: creatorId, membershipStatus: 'JOINED' },
      });

      await tx.podPlayerState.create({
        data: { podId: createdPod.id, playerId: creatorId, currentGems: createdPod.startingGems },
      });

      return createdPod;
    });

    if (inviteCode) {
      await this.redis.set(`invite:${inviteCode}`, pod.id, 'EX', INVITE_CODE_TTL);
    }

    return pod;
  }

  async joinPod(playerId: string, podId: string, inviteCode?: string) {
    const [pod, debugSettings] = await Promise.all([
      this.prisma.pod.findUnique({ where: { id: podId } }),
      this.getDebugSettings(),
    ]);
    if (!pod) throw new NotFoundException('Pod not found');

    const systemPlayablePod = isSystemPlayablePod(pod);
    if (pod.status !== PodStatus.FILLING && !(systemPlayablePod && pod.status === PodStatus.ACTIVE)) {
      throw new BadRequestException('Pod is not accepting new players');
    }

    if (pod.visibility === PodVisibility.PRIVATE) {
      if (!inviteCode || inviteCode !== pod.inviteCode) {
        throw new ForbiddenException('Valid invite code required');
      }
    }

    // Check if already a member
    const existing = await this.prisma.podMembership.findUnique({
      where: { podId_playerId: { podId, playerId } },
    });
    if (existing) return { already: true, membership: existing };

    // Check cap simultaneous active pods (max 3 for MVP)
    const activePods = await this.prisma.podMembership.count({
      where: {
        playerId,
        membershipStatus: { in: ['JOINED', 'ACTIVE'] as any },
        pod: { status: { in: [PodStatus.FILLING, PodStatus.COUNTDOWN, PodStatus.ACTIVE] } },
      },
    });
    if (activePods >= 3) {
      throw new ForbiddenException('You are already in the maximum number of active pods (3)');
    }

    const podUpdate: Prisma.PodUpdateArgs = {
      where: { id: podId },
      data: {
        currentPlayerCount: { increment: 1 },
        ...(systemPlayablePod && !debugSettings.requireFullPodToStart ? { status: PodStatus.ACTIVE, startedAt: pod.startedAt ?? new Date() } : {}),
      },
    };

    // Transactionally join and increment count
    const [membership] = await this.prisma.$transaction([
      this.prisma.podMembership.create({
        data: { podId, playerId, membershipStatus: 'JOINED' },
      }),
      this.prisma.podPlayerState.upsert({
        where: { podId_playerId: { podId, playerId } },
        create: { podId, playerId, currentGems: pod.startingGems },
        update: {},
      }),
      this.prisma.pod.update(podUpdate),
    ]);

    await this.podLifecycle.onPlayerJoined(podId);

    return { already: false, membership };
  }

  async joinByInviteCode(playerId: string, inviteCode: string) {
    const pod = await this.prisma.pod.findUnique({ where: { inviteCode } });
    if (!pod) throw new NotFoundException('Invalid invite code');
    return this.joinPod(playerId, pod.id, inviteCode);
  }

  async leaveQueue(playerId: string, podId: string) {
    const membership = await this.prisma.podMembership.findUnique({
      where: { podId_playerId: { podId, playerId } },
    });
    if (!membership || membership.membershipStatus !== 'JOINED') {
      throw new BadRequestException('Not in queue for this pod');
    }
    await this.prisma.$transaction([
      this.prisma.podMembership.update({
        where: { podId_playerId: { podId, playerId } },
        data: { membershipStatus: 'LEFT_QUEUE', leftAt: new Date() },
      }),
      this.prisma.pod.update({
        where: { id: podId },
        data: { currentPlayerCount: { decrement: 1 } },
      }),
    ]);
  }

  async getPlayerMemberships(playerId: string) {
    return this.prisma.podMembership.findMany({
      where: {
        playerId,
        membershipStatus: { in: ['JOINED', 'ACTIVE', 'ELIMINATED', 'COMPLETED'] as any },
      },
      include: {
        pod: {
          select: {
            id: true, name: true, status: true, templateType: true,
            karmaMode: true, powerPackage: true, sizeLimit: true, currentPlayerCount: true,
            startingGems: true, actionCooldownSeconds: true,
            creator: { select: { username: true } },
          },
        },
      },
      orderBy: { joinedAt: 'desc' },
      take: 20,
    });
  }

  /** Guest-friendly quickstart: find/create a system Classic pod, join it, and make it playable. */
  async quickstart(playerId: string) {
    const debugSettings = await this.getDebugSettings();
    const existingMembership = await this.prisma.podMembership.findFirst({
      where: {
        playerId,
        membershipStatus: { in: ['JOINED', 'ACTIVE'] as any },
        pod: {
          creatorId: null,
          name: 'Quickstart Classic',
          status: { in: [PodStatus.FILLING, PodStatus.COUNTDOWN, PodStatus.ACTIVE] },
        },
      },
      include: { pod: true },
      orderBy: { joinedAt: 'desc' },
    });
    if (existingMembership?.pod) {
      return { pod: existingMembership.pod };
    }

    let pod = await this.prisma.pod.findFirst({
      where: {
        creatorId: null,
        name: 'Quickstart Classic',
        visibility: PodVisibility.PUBLIC,
        templateType: 'CLASSIC' as any,
        // Quickstart flips a pod to ACTIVE as soon as the first player joins (see below), so
        // later joiners must still be able to find it here — restricting to FILLING would make
        // every subsequent quickstart create its own separate pod instead of joining this one.
        status: { in: [PodStatus.FILLING, PodStatus.ACTIVE] },
        currentPlayerCount: { lt: 25 },
      },
      orderBy: { createdAt: 'asc' },
    });

    if (!pod) {
      pod = await this.prisma.pod.create({
        data: {
          name: 'Quickstart Classic',
          creatorId: null,
          templateType: 'CLASSIC' as any,
          karmaMode: 'NONE' as any,
          powerPackage: 'NONE' as any,
          visibility: PodVisibility.PUBLIC,
          sizeLimit: 25,
          status: PodStatus.FILLING,
          startingGems: debugSettings.defaultPodStartingGems,
          actionCooldownSeconds: debugSettings.defaultPodActionCooldownSeconds,
        },
      });
    }

    await this.joinPod(playerId, pod.id);

    if (debugSettings.requireFullPodToStart) {
      return { pod: await this.getPod(pod.id) };
    }

    // For the prototype, Quickstart becomes active immediately so a solo tester can exercise the loop.
    // Later, replace this with the real countdown/fill lifecycle.
    const updated = await this.prisma.pod.update({
      where: { id: pod.id },
      data: { status: PodStatus.ACTIVE, startedAt: pod.startedAt ?? new Date() },
    });

    return { pod: updated };
  }

  async getFeed(podId: string, limit = 30) {
    await this.getPod(podId);
    return this.prisma.feedMessage.findMany({
      where: { podId, isRejected: false },
      orderBy: { createdAt: 'desc' },
      take: Math.min(Math.max(limit, 1), 100),
      select: {
        id: true,
        messageType: true,
        body: true,
        createdAt: true,
        player: { select: { id: true, username: true } },
      },
    });
  }

  async getLeaderboard(podId: string, limit = 20) {
    await this.getPod(podId);
    return this.prisma.podPlayerState.findMany({
      where: { podId },
      orderBy: { currentGems: 'desc' },
      take: Math.min(Math.max(limit, 1), 100),
      select: {
        currentGems: true,
        totalGiveCount: true,
        totalTakeCount: true,
        eliminatedAt: true,
        player: { select: { id: true, username: true } },
      },
    });
  }

  async getDebugSettings() {
    const [gems, cooldown, requireFullPodToStart, playersPerGiveTakeAction] = await Promise.all([
      this.redis.get(DEBUG_DEFAULT_POD_GEMS_KEY),
      this.redis.get(DEBUG_DEFAULT_POD_COOLDOWN_KEY),
      this.redis.get(DEBUG_REQUIRE_FULL_POD_START_KEY),
      this.redis.get(DEBUG_PLAYERS_PER_ACTION_KEY),
    ]);
    return {
      defaultPodStartingGems: clampInt(gems, FALLBACK_STARTING_GEMS, 1, 1_000_000),
      defaultPodActionCooldownSeconds: clampInt(cooldown, FALLBACK_COOLDOWN_SECONDS, 0, 86_400),
      requireFullPodToStart: parseBoolean(requireFullPodToStart, FALLBACK_REQUIRE_FULL_POD_START),
      playersPerGiveTakeAction: clampInt(playersPerGiveTakeAction, FALLBACK_PLAYERS_PER_ACTION, 1, 1_000),
    };
  }

  async updateDebugSettings(data: { defaultPodStartingGems?: number; defaultPodActionCooldownSeconds?: number; requireFullPodToStart?: boolean; playersPerGiveTakeAction?: number }) {
    const current = await this.getDebugSettings();
    const next = {
      defaultPodStartingGems: data.defaultPodStartingGems === undefined
        ? current.defaultPodStartingGems
        : clampInt(data.defaultPodStartingGems, current.defaultPodStartingGems, 1, 1_000_000),
      defaultPodActionCooldownSeconds: data.defaultPodActionCooldownSeconds === undefined
        ? current.defaultPodActionCooldownSeconds
        : clampInt(data.defaultPodActionCooldownSeconds, current.defaultPodActionCooldownSeconds, 0, 86_400),
      requireFullPodToStart: data.requireFullPodToStart === undefined
        ? current.requireFullPodToStart
        : Boolean(data.requireFullPodToStart),
      playersPerGiveTakeAction: data.playersPerGiveTakeAction === undefined
        ? current.playersPerGiveTakeAction
        : clampInt(data.playersPerGiveTakeAction, current.playersPerGiveTakeAction, 1, 1_000),
    };

    await Promise.all([
      this.redis.set(DEBUG_DEFAULT_POD_GEMS_KEY, String(next.defaultPodStartingGems)),
      this.redis.set(DEBUG_DEFAULT_POD_COOLDOWN_KEY, String(next.defaultPodActionCooldownSeconds)),
      this.redis.set(DEBUG_REQUIRE_FULL_POD_START_KEY, next.requireFullPodToStart ? 'true' : 'false'),
      this.redis.set(DEBUG_PLAYERS_PER_ACTION_KEY, String(next.playersPerGiveTakeAction)),
    ]);

    await this.prisma.pod.updateMany({
      where: { creatorId: null, status: { not: PodStatus.COMPLETED } },
      data: {
        startingGems: next.defaultPodStartingGems,
        actionCooldownSeconds: next.defaultPodActionCooldownSeconds,
      },
    });

    if (data.defaultPodActionCooldownSeconds !== undefined) {
      const now = new Date();
      await this.prisma.podPlayerState.updateMany({
        where: {
          eliminatedAt: null,
          pod: { creatorId: null, status: { not: PodStatus.COMPLETED } },
        },
        data: {
          nextActionAt: next.defaultPodActionCooldownSeconds === 0
            ? null
            : new Date(now.getTime() + next.defaultPodActionCooldownSeconds * 1000),
        },
      });
    }

    return next;
  }

  async resetAllPods() {
    await this.prisma.pod.deleteMany({});
    await this.ensureDefaultPods();
    return { ok: true };
  }
}
