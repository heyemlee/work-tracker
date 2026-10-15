import {
  BadGatewayException,
  Body,
  Controller,
  Get,
  Inject,
  NotFoundException,
  Param,
  Patch,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';
import { z } from 'zod';
import { Db } from './db.js';
import { LocalGuard } from './auth.js';
import { Jobs } from './jobs.js';
import { Aggregation } from './aggregation.js';
import { fetchListings } from './providers.js';
import { addCompanySchema, boardFromUrl, jobQuerySchema, validate } from './validation.js';

@Controller('api')
@UseGuards(LocalGuard)
export class Api {
  constructor(
    @Inject(Db) private db: Db,
    @Inject(Jobs) private jobs: Jobs,
    @Inject(Aggregation) private aggregation: Aggregation,
  ) {}
  @Get('jobs') listJobs(@Query() query: unknown) {
    return this.jobs.list(validate(jobQuerySchema, query));
  }
  @Get('jobs/:id') job(@Param('id') id: string) {
    return this.jobs.detail(validate(z.uuid(), id));
  }
  @Get('boards') boards() {
    return this.db.$queryRaw`SELECT b.*, count(j.id) FILTER (WHERE j.active)::int AS "activeJobs"
      FROM "Board" b LEFT JOIN "Job" j ON j."boardId" = b.id
      GROUP BY b.id ORDER BY lower(b.company), b.provider`;
  }
  @Patch('boards/:id') async selectCompany(@Param('id') rawId: string, @Body() body: unknown) {
    const id = validate(z.uuid(), rawId),
      data = validate(z.object({ enabled: z.boolean() }).strict(), body);
    if (!(await this.db.board.findUnique({ where: { id }, select: { id: true } })))
      throw new NotFoundException('未找到这家公司。');
    return this.db.board.update({ where: { id }, data });
  }
  @Post('boards') async addCompany(@Body() body: unknown) {
    const input = validate(addCompanySchema, body),
      source = boardFromUrl(input.url);
    try {
      await fetchListings(source.provider, source.slug);
    } catch {
      throw new BadGatewayException('暂时无法读取这家公司的招聘源，请检查链接或稍后再试。');
    }
    return this.db.board.upsert({
      where: { provider_slug: source },
      create: { ...source, company: input.company },
      update: { company: input.company },
    });
  }
  @Post('sync') sync() {
    return this.aggregation.start();
  }
  @Get('sync') status() {
    return this.aggregation.status();
  }
}

@Controller('health')
@UseGuards(LocalGuard)
export class Health {
  constructor(@Inject(Db) private db: Db) {}
  @Get() async health() {
    await this.db.$queryRaw`SELECT 1`;
    return { ok: true };
  }
}
