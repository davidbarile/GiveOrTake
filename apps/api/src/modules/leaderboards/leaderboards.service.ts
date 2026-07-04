import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';

@Injectable()
export class LeaderboardsService {
  constructor(private readonly prisma: PrismaService) {}

  async getLeaderboard(podId: string, limit = 20) {
    return this.prisma.podPlayerState.findMany({
      where: { podId },
      orderBy: { currentGems: 'desc' },
      take: limit,
      select: {
        currentGems: true,
        totalGiveCount: true,
        totalTakeCount: true,
        eliminatedAt: true,
        player: { select: { id: true, username: true } },
      },
    });
  }
}
