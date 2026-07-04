import { Injectable, BadRequestException, ForbiddenException } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { RedisService } from '../../redis/redis.service';
import { AnalyticsService } from '../analytics/analytics.service';

const GIVE_COST = 1;       // actor loses 1
const GIVE_REWARD = 1;     // each target gains 1
const TAKE_REWARD = 1;     // actor gains 1
const TAKE_COST = 1;       // each target loses 1
const DEFAULT_TARGETS_PER_ACTION = 5;
const DEBUG_REQUIRE_FULL_POD_START_KEY = 'debug:requireFullPodToStart';
const DEBUG_PLAYERS_PER_ACTION_KEY = 'debug:playersPerGiveTakeAction';

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
export class GameplayService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly redis: RedisService,
    private readonly analytics: AnalyticsService,
  ) {}

  /** Select up to N random eligible targets (not the actor, not eliminated) */
  private selectTargets(
    allStates: { playerId: string; eliminatedAt: Date | null }[],
    actorId: string,
    n: number,
  ): string[] {
    const eligible = allStates
      .filter((s) => s.playerId !== actorId && !s.eliminatedAt)
      .map((s) => s.playerId);

    // Fisher-Yates shuffle then take n
    for (let i = eligible.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [eligible[i], eligible[j]] = [eligible[j], eligible[i]];
    }
    return eligible.slice(0, n);
  }

  async processAction(
    playerId: string,
    podId: string,
    action: 'GIVE' | 'TAKE',
    requestId: string,
  ) {
    // Idempotency: return existing result if requestId already processed
    const existing = await this.prisma.actionEvent.findUnique({
      where: { podId_requestId: { podId, requestId } },
    });
    if (existing) return { idempotent: true, event: existing };

    // Validate pod is active, or allow debug bypass while full-pod-start is disabled.
    const [pod, requireFullPodToStartRaw, playersPerActionRaw] = await Promise.all([
      this.prisma.pod.findUnique({ where: { id: podId } }),
      this.redis.get(DEBUG_REQUIRE_FULL_POD_START_KEY),
      this.redis.get(DEBUG_PLAYERS_PER_ACTION_KEY),
    ]);
    const requireFullPodToStart = parseBoolean(requireFullPodToStartRaw, false);
    const playersPerAction = clampInt(playersPerActionRaw, DEFAULT_TARGETS_PER_ACTION, 1, 1_000);
    const podPlayable = !!pod && (pod.status === 'ACTIVE' || (!requireFullPodToStart && pod.status === 'FILLING'));
    if (!podPlayable) {
      throw new BadRequestException('Pod is not active');
    }

    // Load player state
    const state = await this.prisma.podPlayerState.findUnique({
      where: { podId_playerId: { podId, playerId } },
    });
    if (!state) throw new ForbiddenException('Not a member of this pod');
    if (state.eliminatedAt) throw new ForbiddenException('You have been eliminated');

    // Cooldown check
    const now = new Date();
    if (state.nextActionAt && state.nextActionAt > now) {
      const wait = Math.ceil((state.nextActionAt.getTime() - now.getTime()) / 1000);
      throw new BadRequestException(`Cooldown: wait ${wait}s`);
    }

    // Validate GIVE cost
    if (action === 'GIVE' && state.currentGems < GIVE_COST) {
      throw new BadRequestException('Not enough gems to GIVE');
    }

    // Load all player states for target selection
    const allStates = await this.prisma.podPlayerState.findMany({
      where: { podId },
      select: { playerId: true, currentGems: true, eliminatedAt: true },
    });

    const targets = this.selectTargets(allStates, playerId, playersPerAction);
    if (targets.length === 0) {
      throw new BadRequestException('No eligible players left to target');
    }

    const cooldownMs = Math.max(0, pod.actionCooldownSeconds) * 1000;
    const nextActionAt = cooldownMs === 0 ? null : new Date(now.getTime() + cooldownMs);

    // Build ledger deltas
    const deltas: { targetId: string; delta: number }[] = [];
    let actorDelta: number;

    if (action === 'GIVE') {
      actorDelta = -GIVE_COST;
      targets.forEach((id) => deltas.push({ targetId: id, delta: GIVE_REWARD }));
    } else {
      actorDelta = TAKE_REWARD;
      targets.forEach((id) => deltas.push({ targetId: id, delta: -TAKE_COST }));
    }

    // Execute in one transaction
    const result = await this.prisma.$transaction(async (tx) => {
      // Write action event
      const event = await tx.actionEvent.create({
        data: {
          podId, playerId, requestId,
          actionType: action,
          payload: { targets, actorDelta, deltas },
        },
      });

      // Update actor state
      const newActorGems = state.currentGems + actorDelta;
      await tx.podPlayerState.update({
        where: { podId_playerId: { podId, playerId } },
        data: {
          currentGems: newActorGems,
          nextActionAt,
          totalGiveCount: action === 'GIVE' ? { increment: 1 } : undefined,
          totalTakeCount: action === 'TAKE' ? { increment: 1 } : undefined,
        },
      });

      // Write actor ledger row
      await tx.gemLedger.create({
        data: {
          podId, playerId,
          sourceEventId: event.id,
          delta: actorDelta,
          balanceAfter: newActorGems,
          reason: action === 'GIVE' ? 'give_cost' : 'take_reward',
        },
      });

      // Update targets
      const eliminatedIds: string[] = [];
      for (const { targetId, delta } of deltas) {
        const targetState = allStates.find((s) => s.playerId === targetId)!;
        const newGems = Math.max(0, targetState.currentGems + delta);
        const isEliminated = newGems === 0;

        await tx.podPlayerState.update({
          where: { podId_playerId: { podId, playerId: targetId } },
          data: {
            currentGems: newGems,
            ...(isEliminated ? { eliminatedAt: now } : {}),
          },
        });

        await tx.gemLedger.create({
          data: {
            podId, playerId: targetId,
            sourceEventId: event.id,
            delta,
            balanceAfter: newGems,
            reason: action === 'GIVE' ? 'give_received' : 'take_received',
            counterpartyPlayerId: playerId,
          },
        });

        if (isEliminated) {
          eliminatedIds.push(targetId);
          await tx.podMembership.updateMany({
            where: { podId, playerId: targetId },
            data: { membershipStatus: 'ELIMINATED' },
          });
          await tx.feedMessage.create({
            data: {
              podId, messageType: 'ELIMINATION',
              body: `Player was eliminated.`,
              playerId: targetId,
            },
          });
        }
      }

      // Append feed message
      await tx.feedMessage.create({
        data: {
          podId, playerId, messageType: 'ACTION',
          body: action === 'GIVE'
            ? `GAVE ${GIVE_COST} gem to ${targets.length} players`
            : `TOOK from ${targets.length} players`,
        },
      });

      return { event, actorDelta, newActorGems, nextActionAt, targets, eliminatedIds };
    });

    // Check for pod completion (1 player left)
    await this.checkPodCompletion(podId);

    // Emit analytics async  
    void this.analytics.track(podId, playerId, action === 'GIVE' ? 'action_give' : 'action_take', {
      targets: targets.length,
      actorDelta,
    });

    return result;
  }

  private async checkPodCompletion(podId: string) {
    const [living, totalPlayers] = await Promise.all([
      this.prisma.podPlayerState.count({ where: { podId, eliminatedAt: null } }),
      this.prisma.podPlayerState.count({ where: { podId } }),
    ]);

    // Solo Quickstart/demo pods should stay playable. Real completion only matters once
    // at least two players have participated.
    if (totalPlayers >= 2 && living <= 1) {
      await this.prisma.pod.update({
        where: { id: podId },
        data: { status: 'COMPLETED', endedAt: new Date() },
      });
    }
  }

  async getPlayerState(podId: string, playerId: string) {
    const state = await this.prisma.podPlayerState.findUnique({
      where: { podId_playerId: { podId, playerId } },
    });
    if (!state) {
      throw new ForbiddenException('Not a member of this pod');
    }
    return state;
  }
}
