import { useEffect, useRef, useState } from 'react';

// pdf.js is only fetched the first time a PDF is shown (its own chunk), never on page load.
let pdfjsPromise = null;
function loadPdfjs() {
  if (!pdfjsPromise) {
    pdfjsPromise = Promise.all([import('pdfjs-dist'), import('pdfjs-dist/build/pdf.worker.min.mjs?url')]).then(
      ([pdfjs, worker]) => {
        pdfjs.GlobalWorkerOptions.workerSrc = worker.default;
        return pdfjs;
      },
    );
  }
  return pdfjsPromise;
}

const PAGE_GAP = 16;
const PADDING = 20;

/**
 * Draws every page of a PDF as a clean white page on the surrounding background — no browser
 * viewer chrome. `zoom` is a percentage, or null to fit the page width to the space available.
 * Calls `onPageCount` once the document has loaded, `onFitZoom` with the percentage "fit to width"
 * works out to (so zoom steps can start from it), and `onError` if it can't be read (callers can
 * fall back to the browser's own viewer).
 */
export default function PdfPages({ blob, zoom = null, onPageCount, onFitZoom, onError }) {
  const scrollRef = useRef(null);
  const pagesRef = useRef(null);
  const [doc, setDoc] = useState(null);
  const [width, setWidth] = useState(0);

  // Load the document.
  useEffect(() => {
    let cancelled = false;
    let loaded = null;
    setDoc(null);
    if (!blob) return undefined;
    (async () => {
      try {
        const pdfjs = await loadPdfjs();
        const data = new Uint8Array(await blob.arrayBuffer());
        loaded = await pdfjs.getDocument({ data }).promise;
        if (cancelled) {
          loaded.destroy();
          return;
        }
        setDoc(loaded);
        onPageCount?.(loaded.numPages);
      } catch (err) {
        if (!cancelled) onError?.(err);
      }
    })();
    return () => {
      cancelled = true;
      if (loaded) loaded.destroy();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [blob]);

  // Track the available width (fit-to-width re-renders when the window is resized).
  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return undefined;
    const update = () => setWidth(el.clientWidth);
    update();
    const ro = new ResizeObserver(update);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  // Draw the pages.
  useEffect(() => {
    const host = pagesRef.current;
    if (!doc || !host || !width) return undefined;
    let cancelled = false;
    const tasks = [];
    (async () => {
      const ratio = window.devicePixelRatio || 1;
      const canvases = [];
      for (let n = 1; n <= doc.numPages; n += 1) {
        const page = await doc.getPage(n);
        if (cancelled) return;
        const base = page.getViewport({ scale: 1 });
        const fitScale = Math.max(0.25, (width - PADDING * 2) / base.width);
        if (n === 1) onFitZoom?.(Math.round(fitScale * 100));
        const scale = zoom == null ? fitScale : zoom / 100;
        const viewport = page.getViewport({ scale });
        const canvas = document.createElement('canvas');
        canvas.width = Math.floor(viewport.width * ratio);
        canvas.height = Math.floor(viewport.height * ratio);
        canvas.style.width = `${Math.floor(viewport.width)}px`;
        canvas.style.height = `${Math.floor(viewport.height)}px`;
        canvas.className = 'mx-auto block rounded-[3px] bg-white shadow-[0_1px_2px_rgba(15,23,42,.08),0_10px_30px_rgba(15,23,42,.10)]';
        const task = page.render({
          canvasContext: canvas.getContext('2d'),
          viewport,
          transform: ratio !== 1 ? [ratio, 0, 0, ratio, 0, 0] : undefined,
        });
        tasks.push(task);
        canvases.push({ canvas, task });
      }
      if (cancelled) return;
      host.replaceChildren(...canvases.map((c) => c.canvas));
      await Promise.all(canvases.map((c) => c.task.promise.catch(() => {})));
    })().catch((err) => {
      if (!cancelled) onError?.(err);
    });
    return () => {
      cancelled = true;
      tasks.forEach((t) => t.cancel());
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [doc, zoom, width]);

  return (
    <div ref={scrollRef} className="h-full w-full overflow-auto">
      {!doc ? (
        <div className="flex h-full flex-col items-center justify-center gap-2 text-slate-400">
          <div className="h-8 w-8 animate-spin rounded-full border-2 border-brand border-t-transparent" />
          <span className="mt-2 text-sm font-medium">Loading the PDF…</span>
        </div>
      ) : null}
      <div
        ref={pagesRef}
        className="flex min-w-fit flex-col items-center"
        style={{ gap: PAGE_GAP, padding: PADDING }}
        aria-label="PDF pages"
      />
    </div>
  );
}
