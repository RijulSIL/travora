import { useEffect, useState } from 'react';

/**
 * One floating tooltip per page for charts: `bind(content)` gives hover handlers for an element,
 * `show(content, event)` opens it from a click/tap, and `node` is rendered once at the end of
 * the page. It follows the pointer, flips away from the window edge, and closes on scroll.
 */
export function useFloatingTip() {
  const [tip, setTip] = useState(null);
  const place = (e) => {
    const x = e.clientX + 14;
    const y = e.clientY + 14;
    return { x: x + 250 > window.innerWidth ? e.clientX - 250 : x, y: y + 110 > window.innerHeight ? e.clientY - 110 : y };
  };
  const bind = (content) => ({
    onMouseEnter: (e) => setTip({ content, ...place(e) }),
    onMouseMove: (e) => setTip({ content, ...place(e) }),
    onMouseLeave: () => setTip(null),
  });
  useEffect(() => {
    if (!tip) return undefined;
    const hide = () => setTip(null);
    window.addEventListener('scroll', hide, true);
    return () => window.removeEventListener('scroll', hide, true);
  }, [tip]);
  const node = tip ? (
    <div
      role="tooltip"
      className="pointer-events-none fixed z-50 max-w-[240px] rounded-[10px] bg-ink px-2.5 py-2 text-xs leading-snug text-white shadow-lg"
      style={{ left: Math.max(8, tip.x), top: Math.max(8, tip.y) }}
    >
      {tip.content}
    </div>
  ) : null;
  return { bind, show: (content, e) => setTip({ content, ...place(e) }), hide: () => setTip(null), node };
}

/** Standard tooltip body: bold title, an amount, a short line, and a muted note. */
export function TipBody({ title, amount, line, note }) {
  return (
    <>
      <b className="block text-[12.5px]">{title}</b>
      {amount ? <span className="font-mono">{amount}</span> : null}
      {line ? `${amount ? ' · ' : ''}${line}` : ''}
      {note ? <span className="block text-slate-300">{note}</span> : null}
    </>
  );
}
