import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';

@Injectable()
export class AnalyticsService {
  constructor(private readonly prisma: PrismaService) {}

  async track(podId: string | null, playerId: string | null, eventType: string, payload: object) {
    // Fire-and-forget — don't await in hot paths
    void this.prisma.analyticsEvent
      .create({ data: { podId, playerId, eventType, payload } })
      .catch((e) => console.error('analytics track error', e));
  }

  async snapshot(podId: string) {
    const states = await this.prisma.podPlayerState.findMany({
      where: { podId },
      select: { currentGems: true, totalGiveCount: true, totalTakeCount: true, eliminatedAt: true },
    });

    const living = states.filter((s) => !s.eliminatedAt);
    const totalGems = living.reduce((acc, s) => acc + s.currentGems, 0);
    const totalGive = states.reduce((a, s) => a + s.totalGiveCount, 0);
    const totalTake = states.reduce((a, s) => a + s.totalTakeCount, 0);
    const totalActions = totalGive + totalTake || 1;
    const eliminationCount = states.length - living.length;

    // Gini coefficient
    const sorted = living.map((s) => s.currentGems).sort((a, b) => a - b);
    const n = sorted.length || 1;
    const mean = totalGems / n;
    let gini = 0;
    if (mean > 0) {
      let diffSum = 0;
      for (let i = 0; i < n; i++)
        for (let j = 0; j < n; j++)
          diffSum += Math.abs(sorted[i] - sorted[j]);
      gini = diffSum / (2 * n * n * mean);
    }

    // Top-10% share
    const top10Idx = Math.max(0, Math.floor(n * 0.9));
    const top10Sum = sorted.slice(top10Idx).reduce((a, v) => a + v, 0);
    const top10Share = totalGems > 0 ? top10Sum / totalGems : 0;

    await this.prisma.podAnalyticsSnapshot.create({
      data: {
        podId,
        livingPlayers: living.length,
        totalGems,
        giveRate: totalGive / totalActions,
        takeRate: totalTake / totalActions,
        giniCoefficient: gini,
        top10Share,
        eliminationCount,
      },
    });
  }
}
