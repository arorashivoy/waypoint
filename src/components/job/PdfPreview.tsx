'use client';

import { useEffect, useRef, useState } from 'react';
import { ErrorNote } from '../ui';

const MAX_PAGES = 4;

/** The pages of the PDF as canvases, loaded when the preview comes into view. pdf.js loads on the client only. */
export function PdfPreview({ url, rev }: { url: string; rev: number }) {
  const root = useRef<HTMLDivElement>(null);
  const [visible, setVisible] = useState(false);
  const [state, setState] = useState<'loading' | 'ready' | 'failed'>('loading');
  const [attempt, setAttempt] = useState(0);

  // The preview sits in a closed fold or on a hidden screen at first. It loads when it can be seen.
  useEffect(() => {
    const el = root.current;
    if (!el || typeof IntersectionObserver === 'undefined') {
      setVisible(true);
      return;
    }
    const io = new IntersectionObserver((entries) => {
      if (entries.some((e) => e.isIntersecting)) setVisible(true);
    });
    io.observe(el);
    return () => io.disconnect();
  }, []);

  useEffect(() => {
    const el = root.current;
    if (!visible || !el) return;
    let live = true;
    let doc: { destroy: () => Promise<void> } | null = null;
    setState('loading');
    (async () => {
      try {
        const pdfjs = await import('pdfjs-dist');
        pdfjs.GlobalWorkerOptions.workerSrc = '/pdfjs/pdf.worker.min.mjs';
        const task = pdfjs.getDocument({ url });
        const pdf = await task.promise;
        doc = pdf;
        if (!live) return;
        const width = el.clientWidth || 600;
        const ratio = Math.min(window.devicePixelRatio || 1, 2);
        for (let n = 1; n <= Math.min(pdf.numPages, MAX_PAGES); n++) {
          const page = await pdf.getPage(n);
          if (!live) return;
          const fit = width / page.getViewport({ scale: 1 }).width;
          const viewport = page.getViewport({ scale: fit * ratio });
          const canvas = document.createElement('canvas');
          canvas.width = Math.floor(viewport.width);
          canvas.height = Math.floor(viewport.height);
          canvas.setAttribute('role', 'img');
          canvas.setAttribute('aria-label', `Page ${n} of the CV`);
          await page.render({ canvasContext: canvas.getContext('2d')!, viewport }).promise;
          if (!live) return;
          el.querySelector('.jd-pages')?.append(canvas);
        }
        setState('ready');
      } catch {
        if (live) setState('failed');
      }
    })();
    return () => {
      live = false;
      el.querySelector('.jd-pages')?.replaceChildren();
      doc?.destroy().catch(() => {});
    };
  }, [visible, url, rev, attempt]);

  return (
    <div className="jd-preview" ref={root} data-state={state}>
      {state === 'loading' && visible && <p className="jd-hint" role="status">Loading the preview…</p>}
      {state === 'failed' && (
        <ErrorNote what="The preview did not load." fix="Use Open to see the PDF in a new tab." onRetry={() => setAttempt((a) => a + 1)} />
      )}
      <div className="jd-pages" />
    </div>
  );
}
