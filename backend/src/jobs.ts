import { Inject, Injectable, NotFoundException } from '@nestjs/common';
import { z } from 'zod';
import { Prisma } from '../generated/prisma/client.js';
import { Db } from './db.js';
import { jobQuerySchema } from './validation.js';

@Injectable()
export class Jobs {
  constructor(@Inject(Db) private db: Db) {}
  async list(query: z.output<typeof jobQuerySchema>) {
    const filters = [Prisma.sql`b.enabled = true`, Prisma.sql`j.active = ${query.active === 'true'}`];
    if (query.q)
      filters.push(
        Prisma.sql`to_tsvector('english', j.title || ' ' || j.company || ' ' || j.location || ' ' || j.description) @@ websearch_to_tsquery('english', ${query.q})`,
      );
    if (query.location) filters.push(Prisma.sql`position(lower(${query.location}) in lower(j.location)) > 0`);
    if (query.boardId) filters.push(Prisma.sql`j."boardId" = ${query.boardId}::uuid`);
    if (query.remote) filters.push(Prisma.sql`j.remote = ${query.remote === 'true'}`);
    const rows = await this.db.$queryRaw<Record<string, unknown>[]>(Prisma.sql`
      SELECT j.id, j.title, j.company, j.location, j.department, j.url, j.remote,
        j."publishedAt", j."seenAt", j.active, b.provider
      FROM "Job" j JOIN "Board" b ON b.id = j."boardId"
      WHERE ${Prisma.join(filters, ' AND ')}
      ORDER BY j."publishedAt" DESC NULLS LAST, j.id DESC
      LIMIT ${query.limit + 1} OFFSET ${(query.page - 1) * query.limit}
    `);
    return { items: rows.slice(0, query.limit), hasMore: rows.length > query.limit, page: query.page };
  }
  async detail(id: string) {
    const job = await this.db.job.findFirst({
      where: { id, board: { enabled: true } },
      include: { board: { select: { provider: true } } },
    });
    if (!job) throw new NotFoundException('未找到这个岗位。');
    return job;
  }
}
