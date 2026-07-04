import { Injectable, OnModuleInit, OnModuleDestroy } from '@nestjs/common';
import { Redis } from 'ioredis';

@Injectable()
export class RedisService extends Redis implements OnModuleInit, OnModuleDestroy {
  constructor() {
    super(process.env.REDIS_URL || 'redis://localhost:6379');
  }

  async onModuleInit() {
    // connection is lazy; ping to warm
    await this.ping();
  }

  async onModuleDestroy() {
    await this.quit();
  }
}
