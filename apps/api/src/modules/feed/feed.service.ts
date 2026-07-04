import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';

@Injectable()
export class FeedService {
  constructor(private readonly prisma: PrismaService) {}

  async getFeed(podId: string, limit = 30) {
    return this.prisma.feedMessage.findMany({
      where: { podId, isRejected: false },
      orderBy: { createdAt: 'desc' },
      take: limit,
      select: {
        id: true, messageType: true, body: true, createdAt: true,
        player: { select: { id: true, username: true } },
      },
    });
  }
}
