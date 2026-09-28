import type { Repository } from '../domain/repository';
import { base64ToBytes, bytesToBase64, MAX_RESUME_BYTES, versionName } from '../domain/resumes';
import type { Id } from '../domain/types';

/** Why a file can't be stored as a resume, or null when it can. */
export async function resumeProblem(file: File): Promise<'notPdf' | 'tooLarge' | null> {
  if ((await file.slice(0, 5).text()) !== '%PDF-') return 'notPdf';
  if (file.size > MAX_RESUME_BYTES) return 'tooLarge';
  return null;
}

/**
 * Stores a PDF as a new resume version named after the file, or as the PDF of `replace`. Returns the version's id.
 * Check the file with `resumeProblem` first.
 */
export async function uploadResume(repo: Repository, file: File, replace?: Id): Promise<Id> {
  const data = bytesToBase64(new Uint8Array(await file.arrayBuffer()));
  const id = replace ?? (await repo.saveResume({ name: versionName(file.name) }));
  try {
    await repo.saveResumeFile(id, { name: file.name, data });
  } catch (error) {
    // A new version without its PDF would only be clutter.
    if (!replace) await repo.deleteResume(id).catch(() => undefined);
    throw error;
  }
  return id;
}

/** A stored resume's PDF as a file, as if the owner had picked it; null when the version has none. */
export async function loadResumePdf(repo: Repository, id: Id): Promise<File | null> {
  const file = await repo.loadResumeFile(id);
  return file && new File([base64ToBytes(file.data)], file.name, { type: 'application/pdf' });
}

/** "118 KB", "1.2 MB". */
export function formatSize(bytes: number): string {
  return bytes < 1_000_000
    ? `${Math.max(1, Math.round(bytes / 1000))} KB`
    : `${(bytes / 1_000_000).toFixed(1)} MB`;
}
