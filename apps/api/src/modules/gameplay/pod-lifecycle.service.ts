import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';

/** Handles pod lifecycle: filling → countdown → active → completed */
@Injectable()
export class PodLifecycleService {
  constructor(private readonly prisma: PrismaService) {}

  /** Called after every player join to check if pod should start countdown */
  async onPlayerJoined(podId: string) {
    const pod = await this.prisma.pod.findUnique({ where: { id: podId } });
    if (!pod || pod.status !== 'FILLING') return null;

    if (pod.currentPlayerCount >= pod.sizeLimit) {
      return this.startCountdown(podId);
    }
    return null;
  }

  async startCountdown(podId: string, countdownSeconds = 10) {
    const now = new Date();
    await this.prisma.pod.update({
      where: { id: podId },
      data: { status: 'COUNTDOWN', countdownStartedAt: now },
    });
    // Schedule activation after countdown (simple timeout for MVP, use BullMQ in production)
    setTimeout(() => void this.activatePod(podId), countdownSeconds * 1000);
    return { countdownSeconds, startsAt: new Date(now.getTime() + countdownSeconds * 1000) };
  }

  async activatePod(podId: string) {
    const pod = await this.prisma.pod.findUnique({ where: { id: podId } });
    if (!pod || pod.status !== 'COUNTDOWN') return;

    await this.prisma.$transaction([
      this.prisma.pod.update({
        where: { id: podId },
        data: { status: 'ACTIVE', startedAt: new Date() },
      }),
      this.prisma.podMembership.updateMany({
        where: { podId, membershipStatus: 'JOINED' },
        data: { membershipStatus: 'ACTIVE' },
      }),
      this.prisma.feedMessage.create({
        data: { podId, messageType: 'SYSTEM', body: 'Pod is now active. Good luck!' },
      }),
    ]);
  }

  async completePod(podId: string) {
    await this.prisma.$transaction([
      this.prisma.pod.update({
        where: { id: podId },
        data: { status: 'COMPLETED', endedAt: new Date() },
      }),
      this.prisma.podMembership.updateMany({
        where: { podId, membershipStatus: { in: ['JOINED', 'ACTIVE'] as any } },
        data: { membershipStatus: 'COMPLETED' },
      }),
      this.prisma.feedMessage.create({
        data: { podId, messageType: 'SYSTEM', body: 'Pod has ended.' },
      }),
    ]);
  }
}
