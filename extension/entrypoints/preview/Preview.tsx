import { X } from 'lucide-react';
import { getDocument, GlobalWorkerOptions, type PDFDocumentProxy, type RenderTask } from 'pdfjs-dist';
import workerSrc from 'pdfjs-dist/build/pdf.worker.min.mjs?url';
import { useCallback, useEffect, useRef, useState } from 'react';
import { base64ToBytes } from '@domain/resumes';
import { PetDots } from '../../../src/ui/pet/Pet';
import { toBackground, type ResumePreview } from '../../src/messages';
import type { Translate } from '../../src/ui/i18n';

GlobalWorkerOptions.workerSrc = workerSrc;

/** What the service worker answered the page's ticket with. */
export type Entered = ResumePreview | 'refused' | 'unread';

/** A page's size in the PDF's own units: its shape is what the window needs of it. */
interface Size {
  width: number;
  height: number;
}

/**
 * The widest a page is shown, in CSS pixels: a Letter page at its own size, which the window has room for
 * (preview.css). Pages are drawn for this width whatever the window's, so a narrower window shows them scaled down
 * and none is ever stretched.
 */
const WIDEST = 816;

/** A PDF read into its pages; `bad` where pdf.js can't read it. */
function usePdf(base64: string | null): { pdf: PDFDocumentProxy; sizes: Size[] } | 'bad' | null {
  const [read, setRead] = useState<{ pdf: PDFDocumentProxy; sizes: Size[] } | 'bad' | null>(null);
  useEffect(() => {
    if (base64 === null) return undefined;
    let gone = false;
    // The extension's pages run no WebAssembly (their content security policy): pdf.js isn't to try.
    const task = getDocument({ data: base64ToBytes(base64), useWasm: false });
    task.promise
      .then(async (pdf) => {
        const sizes: Size[] = [];
        for (let number = 1; number <= pdf.numPages; number++) {
          const { width, height } = (await pdf.getPage(number)).getViewport({ scale: 1 });
          sizes.push({ width, height });
        }
        if (!gone) setRead({ pdf, sizes });
      })
      .catch(() => {
        if (!gone) setRead('bad');
      });
    return () => {
      gone = true;
      // Ends the pdf.js worker too.
      void task.destroy();
    };
  }, [base64]);
  return read;
}

/**
 * One page, as a sheet of paper: blank and of the page's shape at once, drawn as it nears the window, so a long
 * document doesn't take its whole length in memory.
 */
function Page({
  pdf,
  number,
  size,
  label,
}: {
  pdf: PDFDocumentProxy;
  number: number;
  size: Size;
  label: string;
}) {
  const canvas = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    const sheet = canvas.current;
    if (!sheet) return undefined;
    let drawing: RenderTask | null = null;
    let gone = false;
    const observer = new IntersectionObserver(
      (entries) => {
        if (!entries.some((entry) => entry.isIntersecting)) return;
        observer.disconnect();
        void pdf
          .getPage(number)
          .then((page) => {
            if (gone) return undefined;
            const scale = (WIDEST * Math.max(1, window.devicePixelRatio)) / size.width;
            const viewport = page.getViewport({ scale });
            sheet.width = Math.floor(viewport.width);
            sheet.height = Math.floor(viewport.height);
            drawing = page.render({ canvas: sheet, viewport });
            return drawing.promise;
          })
          // Stopped as the window closed, or a page pdf.js can't draw: the sheet stays blank.
          .catch(() => undefined);
      },
      // Measured against the pages' own scroller, a screenful ahead. Against the browser's window, a frame from
      // another origin gets no margin.
      { root: sheet.parentElement, rootMargin: '100% 0px' },
    );
    observer.observe(sheet);
    return () => {
      gone = true;
      observer.disconnect();
      drawing?.cancel();
    };
  }, [pdf, number, size.width]);
  return (
    <canvas
      ref={canvas}
      className="page"
      role="img"
      aria-label={label}
      style={{ aspectRatio: `${size.width} / ${size.height}` }}
    />
  );
}

/**
 * A resume, looked at before it's sent: its pages one under the other, under the version's name, the name of the
 * file an employer gets and how many pages that is. The whole of the card's window: it closes at its ✕ or Escape,
 * by asking the card to.
 */
export function Preview({ t, dark, entered }: { t: Translate; dark: boolean; entered: Promise<Entered> }) {
  const [reply, setReply] = useState<Entered | null>(null);
  useEffect(() => {
    let gone = false;
    void entered.then((next) => {
      if (!gone) setReply(next);
    });
    return () => {
      gone = true;
    };
  }, [entered]);
  const resume = reply !== null && typeof reply === 'object' ? reply : null;
  const read = usePdf(resume?.file.base64 ?? null);
  const shown = read !== null && read !== 'bad' ? read : null;

  const close = useCallback(() => void toBackground('preview:close', {}).catch(() => undefined), []);
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') close();
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [close]);

  // The arrows, the space bar and Page Down move through the pages from the start.
  const pages = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (shown) pages.current?.focus({ preventScroll: true });
  }, [shown]);

  if (reply === 'refused') return <p className="refused">{t('preview.notHere')}</p>;

  const count = shown?.sizes.length;
  const length =
    count === undefined ? null : count === 1 ? t('preview.page') : t('preview.pages', { n: count });
  return (
    <div className={`pane${dark ? ' dark' : ''}`}>
      <header className="sheet-head">
        <div className="preview-title">
          <h1>{resume ? resume.label : reply === 'unread' ? t('resume') : ''}</h1>
          {resume && (
            <span className="preview-file">{[resume.file.name, length].filter(Boolean).join(' · ')}</span>
          )}
        </div>
        <button className="icon-button" onClick={close} aria-label={t('close')} title={t('close')}>
          <X size={14} />
        </button>
      </header>
      {reply === 'unread' || read === 'bad' ? (
        <p className="preview-note" role="status">
          {t(reply === 'unread' ? 'preview.unread' : 'preview.bad')}
        </p>
      ) : shown && resume ? (
        <div className="pages" ref={pages} tabIndex={0} role="group" aria-label={resume.file.name}>
          {shown.sizes.map((size, at) => (
            <Page
              key={at}
              pdf={shown.pdf}
              number={at + 1}
              size={size}
              label={t('preview.pageAt', { n: at + 1 })}
            />
          ))}
        </div>
      ) : (
        <div className="preview-wait" role="status" aria-label={t('preview.opening')}>
          <PetDots size={28} />
        </div>
      )}
    </div>
  );
}
