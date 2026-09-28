/**
 * The text of a PDF, read in the browser, page by page. Loaded only when a resume is read, so the app's own bundle
 * doesn't carry pdf.js. Empty for a scanned PDF with no text layer.
 */
export async function pdfText(file: Blob): Promise<string> {
  const [pdfjs, { default: workerSrc }] = await Promise.all([
    import('pdfjs-dist'),
    import('pdfjs-dist/build/pdf.worker.min.mjs?url'),
  ]);
  pdfjs.GlobalWorkerOptions.workerSrc = workerSrc;
  const task = pdfjs.getDocument({ data: new Uint8Array(await file.arrayBuffer()) });
  const document = await task.promise;
  const pages: string[] = [];
  for (let number = 1; number <= document.numPages; number++) {
    const content = await (await document.getPage(number)).getTextContent();
    pages.push(
      content.items
        .map((item) => ('str' in item ? item.str + (item.hasEOL ? '\n' : '') : ''))
        .join('')
        .replace(/[ \t]+\n/g, '\n')
        .trim(),
    );
  }
  // Ends the pdf.js worker too.
  await task.destroy();
  return pages.filter(Boolean).join('\n\n');
}
