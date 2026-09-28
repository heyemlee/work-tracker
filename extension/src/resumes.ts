import { bytesToBase64 } from '@domain/resumes';
import type { Snapshot } from '@domain/types';
import { downloadResume, loadSnapshot } from './background/outbox';

/**
 * Resume PDFs live on Outbox with their versions; the owner uploads them there. The extension keeps a copy of each
 * one it has attached, in its own IndexedDB (`chrome.storage` is meant for small JSON, and a PDF is bytes), so a PDF
 * isn't downloaded for every application and filling still works offline.
 */

const DB = 'outbox-autofill';
const STORE = 'resumes';

interface Copy {
  /** The version's name on Outbox, for the card when Outbox can't be reached. */
  label: string;
  fileName: string;
  /** Tells whether the copy is still the PDF Outbox holds. */
  uploadedAt: string;
  blob: Blob;
}

function open(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    // Version 1 held PDFs added on the options page, by their own ids; copies are keyed by Outbox's resume id.
    const request = indexedDB.open(DB, 2);
    request.onupgradeneeded = () => {
      const db = request.result;
      if (db.objectStoreNames.contains(STORE)) db.deleteObjectStore(STORE);
      db.createObjectStore(STORE);
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

async function run<T>(mode: IDBTransactionMode, body: (store: IDBObjectStore) => IDBRequest<T>): Promise<T> {
  const db = await open();
  try {
    return await new Promise<T>((resolve, reject) => {
      const request = body(db.transaction(STORE, mode).objectStore(STORE));
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
  } finally {
    db.close();
  }
}

/**
 * The resumes the card offers: Outbox's versions that have a PDF, or, while Outbox can't be reached, the copies
 * kept here.
 */
export async function resumeChoices(snapshot: Snapshot | null): Promise<{ id: string; label: string }[]> {
  if (snapshot)
    return snapshot.resumes.filter((resume) => resume.file).map(({ id, name }) => ({ id, label: name }));
  const [ids, copies] = await Promise.all([
    run('readonly', (store) => store.getAllKeys()),
    run<Copy[]>('readonly', (store) => store.getAll()),
  ]);
  return ids.map((id, at) => ({ id: String(id), label: copies[at]?.label ?? '' }));
}

/**
 * A resume version's PDF as base64, for handing to a content script (messages carry JSON, not Blobs). Downloaded
 * when the copy here is missing or older than Outbox's; offline, the last copy.
 */
export async function readResume(id: string): Promise<{ name: string; type: string; base64: string } | null> {
  const [snapshot, kept] = await Promise.all([
    loadSnapshot().catch(() => null),
    run<Copy | undefined>('readonly', (store) => store.get(id) as IDBRequest<Copy | undefined>),
  ]);
  const version = snapshot?.resumes.find((resume) => resume.id === id);
  let copy = kept;
  if (snapshot && !version?.file) return null;
  if (version?.file && kept?.uploadedAt !== version.file.uploadedAt) {
    try {
      copy = {
        label: version.name,
        fileName: version.file.name,
        uploadedAt: version.file.uploadedAt,
        blob: await downloadResume(id),
      };
      const fresh = copy;
      await run('readwrite', (store) => store.put(fresh, id));
    } catch {
      // Outbox couldn't be reached just now: the last copy, if there is one.
    }
  }
  if (!copy) return null;
  const bytes = new Uint8Array(await copy.blob.arrayBuffer());
  return { name: copy.fileName, type: 'application/pdf', base64: bytesToBase64(bytes) };
}

/** Drops every copy; Outbox keeps the PDFs. */
export async function clearResumeCopies(): Promise<void> {
  await run('readwrite', (store) => store.clear());
}
