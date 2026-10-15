import { Worker } from 'node:worker_threads';

export const MAX_FILE_BYTES = 5 * 1024 * 1024;
export const MAX_TEXT_CHARS = 60_000;
export type ExtractedResume = {
  format: 'pdf' | 'docx';
  text: string;
  pages: number | null;
  warnings: string[];
};

/** Parsing runs off the web server's event loop and can be terminated on timeout. No files are saved. */
export function extractResume(buffer: Uint8Array, filename: string): Promise<ExtractedResume> {
  if (!buffer.length || buffer.length > MAX_FILE_BYTES) throw new Error('文件应大于 0，且不超过 5 MB。');
  const format = filename.toLowerCase().endsWith('.pdf')
    ? 'pdf'
    : filename.toLowerCase().endsWith('.docx')
      ? 'docx'
      : null;
  if (!format) throw new Error('请选择 PDF 或 DOCX 文件。');
  const magic = Buffer.from(buffer.subarray(0, 5));
  if (
    magic.length < 5 ||
    (format === 'pdf' && magic.toString() !== '%PDF-') ||
    (format === 'docx' && magic.readUInt16LE(0) !== 0x4b50)
  )
    throw new Error('文件内容与扩展名不符。');
  return new Promise((resolve, reject) => {
    // Node's built-in TS stripping is used only by source-level tests; production runs the compiled .js worker.
    const worker = new Worker(
      new URL(import.meta.url.endsWith('.ts') ? './read-worker.ts' : './read-worker.js', import.meta.url),
      {
        workerData: { buffer, format, maxChars: MAX_TEXT_CHARS },
        resourceLimits: { maxOldGenerationSizeMb: 256 },
        stdout: true,
        stderr: true,
      },
    );
    const timer = setTimeout(() => {
      void worker.terminate();
      reject(new Error('读取超时，请使用更简单的文件或导出为文字版 PDF。'));
    }, 15_000);
    const done = () => {
      clearTimeout(timer);
      void worker.terminate();
    };
    worker.once('message', (message: { result?: ExtractedResume; error?: string }) => {
      done();
      if (message.result) resolve(message.result);
      else reject(new Error(message.error ?? '文件读取失败。'));
    });
    worker.once('error', () => {
      done();
      reject(new Error('文件读取失败，请检查文件是否损坏。'));
    });
    worker.once('exit', () => {
      clearTimeout(timer);
      reject(new Error('文件读取中断，请检查文件是否损坏。'));
    });
  });
}
