import { resumesItem, type ResumeMeta } from './storage';

/**
 * Resume PDFs, kept in the extension's own IndexedDB: `chrome.storage` is meant for small JSON, and a PDF is
 * bytes. Only the extension's pages and service worker can open this database.
 */

const DB = 'outbox-autofill';
const STORE = 'resumes';

function open(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB, 1);
    request.onupgradeneeded = () => request.result.createObjectStore(STORE);
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

export async function addResume(
  file: File,
  label: string,
  outboxResumeId: string | null,
): Promise<ResumeMeta> {
  const meta: ResumeMeta = {
    id: crypto.randomUUID(),
    fileName: file.name,
    size: file.size,
    outboxResumeId,
    label,
    addedAt: new Date().toISOString(),
  };
  await run('readwrite', (store) => store.put(file, meta.id));
  await resumesItem.setValue([...(await resumesItem.getValue()), meta]);
  return meta;
}

export async function removeResume(id: string): Promise<void> {
  await run('readwrite', (store) => store.delete(id));
  await resumesItem.setValue((await resumesItem.getValue()).filter((meta) => meta.id !== id));
}

export async function updateResume(
  id: string,
  patch: Partial<Pick<ResumeMeta, 'label' | 'outboxResumeId'>>,
): Promise<void> {
  await resumesItem.setValue(
    (await resumesItem.getValue()).map((meta) => (meta.id === id ? { ...meta, ...patch } : meta)),
  );
}

/** The PDF as base64, for handing to a content script (messages carry JSON, not Blobs). */
export async function readResume(id: string): Promise<{ name: string; type: string; base64: string } | null> {
  const meta = (await resumesItem.getValue()).find((item) => item.id === id);
  if (!meta) return null;
  const blob = await run<Blob | undefined>(
    'readonly',
    (store) => store.get(id) as IDBRequest<Blob | undefined>,
  );
  if (!blob) return null;
  const bytes = new Uint8Array(await blob.arrayBuffer());
  let binary = '';
  for (let i = 0; i < bytes.length; i += 0x8000)
    binary += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return { name: meta.fileName, type: blob.type || 'application/pdf', base64: btoa(binary) };
}
