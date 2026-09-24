import { z } from 'zod';
import { ACCOUNT_COLORS, STAGES } from '../src/domain/types';

// Request bodies, validated before they reach the repository. Unknown keys are stripped.

const id = z.string().min(1).max(64);
const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Expected a YYYY-MM-DD date');
const title = z.string().trim().max(200);
const somethingToUpdate = (patch: Record<string, unknown>) =>
  Object.values(patch).some((value) => value !== undefined);

export const quickAdd = z.object({
  companyName: z.string().trim().min(1).max(120),
  title: title.nullable(),
  jobId: id.nullable(),
  accountIds: z.array(id).max(20),
  channelId: id.nullable(),
  resumeId: id.nullable(),
  appliedAt: isoDate,
});

export const quickAddResult = z.object({
  jobId: id,
  createdJobId: id.nullable(),
  createdCompanyId: id.nullable(),
  applicationIds: z.array(id).max(20),
});

export const newApplication = z.object({
  jobId: id,
  accountId: id,
  channelId: id.nullable(),
  resumeId: id.nullable(),
  appliedAt: isoDate,
});

export const applicationPatch = z
  .object({
    stage: z.enum(STAGES).optional(),
    rejected: z.boolean().optional(),
    channelId: id.nullable().optional(),
    resumeId: id.nullable().optional(),
    appliedAt: isoDate.optional(),
  })
  .refine(somethingToUpdate, 'Nothing to update');

export const jobPatch = z
  .object({
    title: title.nullable().optional(),
    notes: z.string().max(20_000).optional(),
  })
  .refine(somethingToUpdate, 'Nothing to update');

export const account = z.object({
  label: z.string().trim().min(1).max(24),
  email: z
    .string()
    .trim()
    .max(254)
    .refine((value) => value === '' || z.email().safeParse(value).success, 'Invalid email'),
  color: z.enum(ACCOUNT_COLORS),
});

export const named = z.object({ name: z.string().trim().min(1).max(60) });
