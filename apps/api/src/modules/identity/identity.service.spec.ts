import { IdentityService } from './identity.service';

describe('IdentityService', () => {
  it('adds a debug user by bootstrapping a fresh guest session', async () => {
    const prisma = {} as any;
    const redis = { set: jest.fn() } as any;

    const service = new IdentityService(prisma, redis);
    const bootstrapSpy = jest.spyOn(service, 'bootstrapGuest').mockResolvedValue({
      player: { id: 'guest-2', username: 'FreshGuest84', isGuest: true },
      sessionToken: 'session-2',
    });

    await expect(service.addDebugUser()).resolves.toEqual({
      player: { id: 'guest-2', username: 'FreshGuest84', isGuest: true },
      sessionToken: 'session-2',
    });

    expect(bootstrapSpy).toHaveBeenCalledTimes(1);
  });

  it('deletes all test users and bootstraps a fresh guest session', async () => {
    const prisma = {
      player: { deleteMany: jest.fn().mockResolvedValue({ count: 4 }) },
    } as any;
    const redis = { set: jest.fn() } as any;

    const service = new IdentityService(prisma, redis);
    const bootstrapSpy = jest.spyOn(service, 'bootstrapGuest').mockResolvedValue({
      player: { id: 'guest-1', username: 'FreshGuest42', isGuest: true },
      sessionToken: 'session-1',
    });

    await expect(service.deleteAllUsersAndBootstrap()).resolves.toEqual({
      player: { id: 'guest-1', username: 'FreshGuest42', isGuest: true },
      sessionToken: 'session-1',
    });

    expect(prisma.player.deleteMany).toHaveBeenCalledTimes(1);
    expect(bootstrapSpy).toHaveBeenCalledTimes(1);
  });
});
