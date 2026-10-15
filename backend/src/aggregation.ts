import { Inject, Injectable, Logger } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import type { Board } from '../generated/prisma/client.js';
import { Db } from './db.js';
import { fetchListings, type Listing } from './providers.js';
import { providerSchema } from './validation.js';

interface SyncResult {
  board: string;
  company: string;
  fetched?: number;
  closed?: number;
  skipped?: boolean;
  error?: string;
}
interface Progress {
  running: boolean;
  total: number;
  completed: number;
  startedAt: string | null;
  finishedAt: string | null;
  results: SyncResult[];
  error: string | null;
}
@Injectable()
export class Aggregation {
  private running: Promise<SyncResult[]> | null = null;
  private progress: Progress = {
    running: false,
    total: 0,
    completed: 0,
    startedAt: null,
    finishedAt: null,
    results: [],
    error: null,
  };
  private logger = new Logger(Aggregation.name);
  constructor(@Inject(Db) private db: Db) {}
  status() {
    return this.progress;
  }
  start() {
    if (!this.running)
      void this.syncAll().catch((error: unknown) =>
        this.logger.error(error instanceof Error ? error.message : 'Sync failed'),
      );
    return this.status();
  }
  @Cron('0 0 4 * * *', { timeZone: 'America/Los_Angeles' })
  async daily() {
    if (process.env.ENABLE_SYNC === 'true') this.start();
  }
  async importBoard(board: Board, listings: Listing[]) {
    return this.db.$transaction(
      async (tx) => {
        // Selection changes and imports share a row lock. Deselected boards are skipped after fetching.
        const rows = await tx.$queryRaw<
          { enabled: boolean }[]
        >`SELECT enabled FROM "Board" WHERE id = ${board.id}::uuid FOR UPDATE`;
        if (!rows[0]?.enabled) return { board: board.slug, company: board.company, skipped: true };
        const seenAt = new Date();
        for (const listing of listings)
          await tx.job.upsert({
            where: { boardId_externalId: { boardId: board.id, externalId: listing.externalId } },
            create: { ...listing, boardId: board.id, company: board.company, seenAt },
            update: { ...listing, company: board.company, active: true, seenAt },
          });
        const ids = [...new Set(listings.map((listing) => listing.externalId))];
        const closed = await tx.job.updateMany({
          where: { boardId: board.id, active: true, ...(ids.length ? { externalId: { notIn: ids } } : {}) },
          data: { active: false },
        });
        await tx.board.update({ where: { id: board.id }, data: { syncedAt: seenAt, lastError: null } });
        return { board: board.slug, company: board.company, fetched: listings.length, closed: closed.count };
      },
      { timeout: 120000 },
    );
  }
  async syncAll(fetcher: typeof fetchListings = fetchListings): Promise<SyncResult[]> {
    if (this.running) return this.running;
    this.progress = {
      running: true,
      total: 0,
      completed: 0,
      startedAt: new Date().toISOString(),
      finishedAt: null,
      results: [],
      error: null,
    };
    this.running = this.run(fetcher);
    try {
      return await this.running;
    } catch (error) {
      this.progress.error = error instanceof Error ? error.message : 'Sync failed';
      throw error;
    } finally {
      this.progress.running = false;
      this.progress.finishedAt = new Date().toISOString();
      this.running = null;
    }
  }
  private async run(fetcher: typeof fetchListings) {
    const boards = await this.db.board.findMany({ where: { enabled: true }, orderBy: { company: 'asc' } });
    this.progress.total = boards.length;
    for (const board of boards) {
      let result: SyncResult;
      try {
        result = await this.importBoard(
          board,
          await fetcher(providerSchema.parse(board.provider), board.slug),
        );
      } catch (error) {
        const message = error instanceof Error ? error.message.slice(0, 500) : 'Sync failed';
        await this.db.board.update({ where: { id: board.id }, data: { lastError: message } });
        this.logger.warn(`${board.provider}/${board.slug}: ${message}`);
        result = { board: board.slug, company: board.company, error: message };
      }
      this.progress.results.push(result);
      this.progress.completed++;
    }
    return this.progress.results;
  }
  async onModuleDestroy() {
    await this.running?.catch(() => undefined);
  }
}
