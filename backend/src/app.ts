import 'reflect-metadata';
import { Module } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { ScheduleModule } from '@nestjs/schedule';
import { Db } from './db.js';
import { LocalGuard } from './auth.js';
import { Api, Health } from './api.js';
import { Jobs } from './jobs.js';
import { Aggregation } from './aggregation.js';
import { Page } from './page.js';
import type { NestExpressApplication } from '@nestjs/platform-express';

@Module({
  imports: [ScheduleModule.forRoot()],
  controllers: [Api, Health, Page],
  providers: [Db, LocalGuard, Jobs, Aggregation],
})
export class AppModule {}

export async function createApp() {
  const app = await NestFactory.create<NestExpressApplication>(AppModule, { bodyParser: true });
  app.useBodyParser('json', { limit: '512kb' });
  app.enableShutdownHooks();
  return app;
}
