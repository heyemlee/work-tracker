import { z } from 'zod';

/**
 * Resume PDFs are stored on Outbox with their versions, so the app, every device and the extension share one copy.
 * They travel and rest as base64: D1 hands a blob to the Worker as an array of numbers, which costs more CPU than the
 * free plan allows for a PDF, while text it hands over as is.
 */

/** A resume PDF on its way in or out. */
export interface ResumeUpload {
  /** The file's own name, e.g. `Alex_Chen_Resume.pdf`. */
  name: string;
  /** The PDF, as base64. */
  data: string;
}

/** D1 rows hold at most 2,000,000 bytes, and base64 is a third larger than the file. */
export const MAX_RESUME_BYTES = 1_400_000;

const MAX_RESUME_BASE64 = Math.ceil(MAX_RESUME_BYTES / 3) * 4;

export const resumeUploadSchema = z.object({
  name: z.string().trim().min(1).max(200),
  data: z
    .string()
    .max(MAX_RESUME_BASE64)
    // "%PDF-" as base64, and whole base64 quads. Cheap checks: a full decode would cost the Worker CPU.
    .refine((data) => data.startsWith('JVBERi0') && data.length % 4 === 0, 'Expected a PDF, as base64'),
});

/** The file's size, from its base64. */
export function base64Size(data: string): number {
  const padding = data.endsWith('==') ? 2 : data.endsWith('=') ? 1 : 0;
  return (data.length / 4) * 3 - padding;
}

export function bytesToBase64(bytes: Uint8Array): string {
  let binary = '';
  for (let at = 0; at < bytes.length; at += 0x8000)
    binary += String.fromCharCode(...bytes.subarray(at, at + 0x8000));
  return btoa(binary);
}

export function base64ToBytes(data: string): Uint8Array<ArrayBuffer> {
  const binary = atob(data);
  const bytes = new Uint8Array(binary.length);
  for (let at = 0; at < binary.length; at++) bytes[at] = binary.charCodeAt(at);
  return bytes;
}

/** A new version's name, from its file: `Alex_Chen_Resume.pdf` → `Alex_Chen_Resume`. */
export function versionName(fileName: string): string {
  return (
    fileName
      .replace(/\.pdf$/i, '')
      .trim()
      .slice(0, 60) || 'Resume'
  );
}
