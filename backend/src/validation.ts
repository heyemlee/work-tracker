import { BadRequestException } from '@nestjs/common';
import { z } from 'zod';

export function validate<T extends z.ZodType>(schema: T, input: unknown): z.output<T> {
  const parsed = schema.safeParse(input);
  if (!parsed.success)
    throw new BadRequestException({
      message: '请求内容不正确',
      issues: parsed.error.issues.map(({ path, message }) => ({ path: path.join('.'), message })),
    });
  return parsed.data;
}
export const providerSchema = z.enum(['greenhouse', 'lever', 'ashby']);
export const boardSchema = z
  .object({
    provider: providerSchema,
    slug: z.string().regex(/^[a-zA-Z0-9_-]{1,100}$/),
    company: z.string().trim().min(1).max(200),
  })
  .strict();
export const addCompanySchema = z
  .object({ company: z.string().trim().min(1).max(200), url: z.url() })
  .strict();
export const jobQuerySchema = z
  .object({
    q: z.string().trim().max(200).default(''),
    location: z.string().trim().max(200).default(''),
    boardId: z.uuid().optional(),
    remote: z.enum(['true', 'false']).optional(),
    page: z.coerce.number().int().min(1).max(10000).default(1),
    limit: z.coerce.number().int().min(1).max(100).default(25),
    active: z.enum(['true', 'false']).default('true'),
  })
  .strict();

/** Outbound requests use a connector's fixed public API host, never the supplied URL itself. */
export function boardFromUrl(value: string) {
  const url = new URL(value);
  if (url.protocol !== 'https:' || url.username || url.password || url.port)
    throw new BadRequestException('请使用公司的 HTTPS 招聘页链接。');
  let provider: z.output<typeof providerSchema>;
  if (url.hostname === 'boards.greenhouse.io' || url.hostname === 'job-boards.greenhouse.io')
    provider = 'greenhouse';
  else if (url.hostname === 'jobs.lever.co') provider = 'lever';
  else if (url.hostname === 'jobs.ashbyhq.com') provider = 'ashby';
  else throw new BadRequestException('目前支持 Greenhouse、Lever 和 Ashby 的招聘页链接。');
  return validate(boardSchema.pick({ provider: true, slug: true }), {
    provider,
    slug: url.pathname.split('/')[1] ?? '',
  });
}
