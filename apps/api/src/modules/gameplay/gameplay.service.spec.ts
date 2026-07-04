import { BadRequestException } from '@nestjs/common';
import { GameplayService } from './gameplay.service';

describe('GameplayService', () => {
  it('rejects give/take when there are no eligible targets left', async () => {
    const prisma = {
      actionEvent: { findUnique: jest.fn().mockResolvedValue(null) },
      pod: { findUnique: jest.fn().mockResolvedValue({ id: 'pod-1', status: 'ACTIVE', actionCooldownSeconds: 10 }) },
      podPlayerState: {
        findUnique: jest.fn().mockResolvedValue({
          podId: 'pod-1',
          playerId: 'player-1',
          currentGems: 10,
          eliminatedAt: null,
          nextActionAt: null,
        }),
        findMany: jest.fn().mockResolvedValue([
          { playerId: 'player-1', currentGems: 10, eliminatedAt: null },
          { playerId: 'player-2', currentGems: 0, eliminatedAt: new Date('2026-01-01T00:00:00Z') },
        ]),
      },
      $transaction: jest.fn(),
    } as any;

    const redis = {
      get: jest.fn().mockResolvedValue(null),
    } as any;

    const analytics = {
      track: jest.fn(),
    } as any;

    const service = new GameplayService(prisma, redis, analytics);

    await expect(service.processAction('player-1', 'pod-1', 'GIVE', 'req-1')).rejects.toThrow(
      new BadRequestException('No eligible players left to target'),
    );

    expect(prisma.$transaction).not.toHaveBeenCalled();
  });
});
