import { useEffect, useMemo, useState } from 'react';
import { createPortal } from 'react-dom';
import { Download, X, ExternalLink, FileText, ZoomIn, ZoomOut, RotateCcw } from 'lucide-react';
import useBodyScrollLock from '../../hooks/useBodyScrollLock';

function detectKind(contentType, filename) {
  const ct = (contentType || '').toLowerCase();
  if (ct.includes('pdf')) return 'pdf';
  if (ct.startsWith('image/')) return 'image';
  const name = (filename || '').toLowerCase();
  if (name.endsWith('.pdf')) return 'pdf';
  if (/\.(jpe?g|png|gif|webp|heic)$/.test(name)) return 'image';
  return 'other';
}

/**
 * Centered modal to preview a travel ticket (PDF or image) from a blob URL.
 * Includes Zoom controls for images, download, and external view options.
 */
export default function TicketPreviewDrawer({ open, onClose, title, blob, contentType, filename }) {
  const [url, setUrl] = useState(null);
  const [zoom, setZoom] = useState(1);
  useBodyScrollLock(open);

  useEffect(() => {
    if (!open || !blob) {
      setUrl((prev) => {
        if (prev) URL.revokeObjectURL(prev);
        return null;
      });
      setZoom(1);
      return undefined;
    }
    const u = URL.createObjectURL(blob);
    setUrl(u);
    return () => {
      URL.revokeObjectURL(u);
    };
  }, [open, blob]);

  const kind = useMemo(() => detectKind(contentType, filename), [contentType, filename]);

  if (!open) return null;

  const handleZoomIn = () => setZoom(prev => Math.min(prev + 0.25, 3));
  const handleZoomOut = () => setZoom(prev => Math.max(prev - 0.25, 0.5));
  const handleResetZoom = () => setZoom(1);

  return createPortal(
    <div className="fixed inset-0 z-[1000] flex items-center justify-center p-4 md:p-6" role="dialog" aria-modal="true" aria-label="Ticket preview">
      {/* Backdrop */}
      <button 
        type="button" 
        className="absolute inset-0 cursor-default bg-slate-900/60 backdrop-blur-sm transition-opacity duration-300" 
        aria-label="Close" 
        onClick={onClose} 
      />
      
      {/* Modal Container */}
      <div className="relative z-10 flex h-full max-h-[85vh] w-full max-w-4xl flex-col rounded-2xl border border-slate-100 bg-white shadow-2xl animate-in fade-in zoom-in-95 duration-200">
        
        {/* Header */}
        <div className="flex items-center justify-between border-b border-slate-100 px-5 py-4">
          <div className="flex items-center gap-3 min-w-0">
            <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-brand/10 text-brand">
              <FileText size={20} />
            </div>
            <div className="min-w-0">
              <h2 className="text-sm font-semibold text-slate-800 truncate">{title || 'Ticket Preview'}</h2>
              {filename && (
                <p className="text-xs text-slate-400 truncate mt-0.5">{filename}</p>
              )}
            </div>
          </div>

          {/* Action Toolbar */}
          <div className="flex items-center gap-2">
            {kind === 'image' && url && (
              <div className="hidden sm:flex items-center border border-slate-200 rounded-lg p-0.5 mr-2">
                <button
                  type="button"
                  className="p-1.5 hover:bg-slate-50 text-slate-500 hover:text-slate-800 rounded transition-colors"
                  onClick={handleZoomOut}
                  title="Zoom Out"
                >
                  <ZoomOut size={16} />
                </button>
                <span className="text-[11px] font-semibold text-slate-500 w-12 text-center">
                  {Math.round(zoom * 100)}%
                </span>
                <button
                  type="button"
                  className="p-1.5 hover:bg-slate-50 text-slate-500 hover:text-slate-800 rounded transition-colors"
                  onClick={handleZoomIn}
                  title="Zoom In"
                >
                  <ZoomIn size={16} />
                </button>
                <button
                  type="button"
                  className="p-1.5 hover:bg-slate-50 text-slate-500 hover:text-slate-800 rounded transition-colors border-l border-slate-150 ml-0.5"
                  onClick={handleResetZoom}
                  title="Reset Zoom"
                >
                  <RotateCcw size={14} />
                </button>
              </div>
            )}

            {url && (
              <>
                <a
                  className="btn-secondary h-9 px-3 text-xs gap-1.5 font-medium flex items-center"
                  href={url}
                  target="_blank"
                  rel="noopener noreferrer"
                  title="Open in new tab"
                >
                  <ExternalLink size={14} />
                  <span className="hidden sm:inline">Open</span>
                </a>
                <a
                  className="btn-secondary h-9 px-3 text-xs gap-1.5 font-medium flex items-center"
                  href={url}
                  download={filename || 'ticket'}
                  onClick={(e) => e.stopPropagation()}
                  title="Download file"
                >
                  <Download size={14} />
                  <span className="hidden sm:inline">Download</span>
                </a>
              </>
            )}
            
            <div className="h-6 w-px bg-slate-200 mx-1 hidden sm:block" />

            <button 
              type="button" 
              className="flex h-9 w-9 items-center justify-center rounded-lg text-slate-400 hover:bg-slate-50 hover:text-slate-700 transition-colors" 
              onClick={onClose}
              title="Close modal"
            >
              <X size={20} />
            </button>
          </div>
        </div>

        {/* Content Body */}
        <div className="min-h-0 flex-1 overflow-hidden bg-slate-50/70 p-5 flex items-center justify-center">
          {!blob || !url ? (
            <div className="flex flex-col items-center gap-2 text-slate-400">
              <div className="animate-spin rounded-full h-8 w-8 border-2 border-brand border-t-transparent" />
              <span className="text-sm font-medium mt-2">Loading preview…</span>
            </div>
          ) : kind === 'pdf' ? (
            <iframe 
              title="Ticket PDF" 
              src={url} 
              className="h-full w-full rounded-xl border border-slate-200/80 bg-white shadow-sm" 
            />
          ) : kind === 'image' ? (
            <div className="h-full w-full overflow-auto flex p-2 scrollbar-hide">
              <div
                style={{
                  width: `${zoom * 100}%`,
                  height: `${zoom * 100}%`,
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  margin: 'auto',
                  minWidth: '100%',
                  minHeight: '100%',
                }}
                className="transition-all duration-200"
              >
                <img 
                  src={url} 
                  alt="Ticket Preview" 
                  className="max-h-full max-w-full object-contain rounded-xl border border-slate-200/60 shadow-lg bg-white" 
                />
              </div>
            </div>
          ) : (
            <div className="max-w-md text-center p-8 bg-white rounded-2xl border border-slate-200/60 shadow-sm">
              <div className="flex h-12 w-12 items-center justify-center rounded-full bg-amber-50 text-amber-500 mx-auto mb-3">
                <FileText size={24} />
              </div>
              <h3 className="text-sm font-semibold text-slate-800">Preview Unavailable</h3>
              <p className="text-xs text-slate-500 mt-1 mb-4 leading-relaxed">
                We couldn&apos;t generate a live preview for this file type ({contentType || 'unknown'}). Please download the file to view it locally.
              </p>
              <a
                className="btn-primary h-9 px-4 text-xs inline-flex"
                href={url}
                download={filename || 'ticket'}
              >
                Download Ticket
              </a>
            </div>
          )}
        </div>
      </div>
    </div>,
    document.body
  );
}
