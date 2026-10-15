import { Injectable } from '@nestjs/common';
import { PrismaPg } from '@prisma/adapter-pg';
import { PrismaClient } from '../generated/prisma/client.js';

export const databaseUrl = () =>
  process.env.DATABASE_URL ?? 'postgresql://outbox:outbox@localhost:55432/outbox';

@Injectable()
export class Db extends PrismaClient {
  constructor() {
    super({ adapter: new PrismaPg({ connectionString: databaseUrl(), max: 10 }) });
  }
  async onModuleInit() {
    await this.$connect();
  }
  async onModuleDestroy() {
    await this.$disconnect();
  }
}
