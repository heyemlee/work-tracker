import { parentPort, workerData } from 'node:worker_threads';
import { unzipSync } from 'fflate';
import mammoth from 'mammoth';

const { buffer, format, maxChars } = workerData as {
  buffer: Uint8Array;
  format: 'pdf' | 'docx';
  maxChars: number;
};
const warnings: string[] = [];
let pages: number | null = null;
function check(text: string) {
  if (text.length > maxChars) throw new Error('文字超过 60,000 字符，请缩短文件后重试。');
  return text;
}
try {
  let text = '';
  if (format === 'docx') {
    let size = 0,
      entries = 0;
    const files = unzipSync(buffer, {
      filter: (file) => {
        size += file.originalSize;
        entries++;
        if (size > 20 * 1024 * 1024 || entries > 500)
          throw new Error('DOCX 解压后过大，请导出一个精简版本。');
        return true;
      },
    });
    if (!files['[Content_Types].xml'] || !files['word/document.xml'])
      throw new Error('文件不是有效的 DOCX 文档。');
    const result = await mammoth.extractRawText({ buffer: Buffer.from(buffer) });
    text = check(result.value);
    if (result.messages.length) warnings.push('文档包含部分无法识别的元素，请核对下方文字是否完整。');
  } else {
    const { getDocument } = await import('pdfjs-dist/legacy/build/pdf.mjs');
    const task = getDocument({
      data: new Uint8Array(buffer),
      useSystemFonts: true,
      disableFontFace: true,
      verbosity: 0,
    });
    try {
      const pdf = await task.promise;
      pages = pdf.numPages;
      if (pages > 30) throw new Error('PDF 超过 30 页，请只保留简历内容。');
      for (let n = 1; n <= pages; n++) {
        const page = await pdf.getPage(n);
        const content = await page.getTextContent();
        const pageText = content.items
          .map((item) => ('str' in item ? item.str + (item.hasEOL ? '\n' : ' ') : ''))
          .join('')
          .trim();
        if (!pageText) warnings.push(`第 ${n} 页没有可读取的文字，可能是扫描图片。`);
        text = check(text + (text ? '\n\n' : '') + pageText);
        page.cleanup();
      }
    } finally {
      await task.destroy();
    }
  }
  text = text.replaceAll('\u0000', '').replace(/\r\n?/g, '\n').trim();
  if (!text) throw new Error('没有读取到文字。扫描版或图片简历需要先进行文字识别（OCR）。');
  warnings.push('请核对文字顺序；多栏排版、页眉和图片中的信息可能无法完整读取。');
  parentPort?.postMessage({ result: { format, text, pages, warnings } });
} catch (error) {
  const known = error instanceof Error && /字符|精简|DOCX 文档|30 页|OCR/.test(error.message);
  parentPort?.postMessage({
    error: known ? (error as Error).message : '文件读取失败，请检查文件是否损坏、加密或格式不正确。',
  });
}
