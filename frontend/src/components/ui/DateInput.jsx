import { CalendarDays } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';

import { formatDate } from '../../utils/formatters';

const ISO_DAY = /^\d{4}-\d{2}-\d{2}$/;
// Classes that place the field in its parent's layout (grid cells, flex sizing). They belong on the
// wrapper, which is what the parent lays out now, not on the inner text box.
const LAYOUT_CLASS = /^(?:[a-z0-9-]+:)*(?:col-|row-|order-|self-|justify-self-|place-self-|flex-1$|flex-auto$|flex-none$|grow|shrink)/;

/** What's typed, shaped as DD/MM/YYYY while typing: slashes added, a one-digit day or month padded. */
function shape(raw) {
  const iso = /^\s*(\d{4})-(\d{2})-(\d{2})\s*$/.exec(raw);
  if (iso) return `${iso[3]}/${iso[2]}/${iso[1]}`;
  const parts = raw.replace(/[.\-\s]/g, '/').replace(/[^\d/]/g, '').split('/');
  let digits = '';
  parts.forEach((part, i) => {
    // "4/" is day 04, "04/3/" is month 03.
    digits += i < parts.length - 1 && part.length === 1 && digits.length < 4 ? `0${part}` : part;
  });
  digits = digits.slice(0, 8);
  let out = digits.slice(0, 2);
  if (digits.length > 2) out += `/${digits.slice(2, 4)}`;
  if (digits.length > 4) out += `/${digits.slice(4)}`;
  if (raw.endsWith('/') && (digits.length === 2 || digits.length === 4)) out += '/';
  return out;
}

/** 'YYYY-MM-DD' for a complete DD/MM/YYYY that is a real day; null otherwise. */
function toIso(text) {
  const m = /^(\d{2})\/(\d{2})\/(\d{4})$/.exec(text);
  if (!m) return null;
  const [d, mo, y] = [Number(m[1]), Number(m[2]), Number(m[3])];
  const date = new Date(y, mo - 1, d);
  const real = y >= 1900 && y <= 2200 && date.getFullYear() === y && date.getMonth() === mo - 1 && date.getDate() === d;
  return real ? `${m[3]}-${m[2]}-${m[1]}` : null;
}

/** What the box shows for a value: DD/MM/YYYY, or the raw text when it isn't a date at all. */
const shown = (value) => (value ? formatDate(value) || String(value) : '');

/**
 * A date field that always shows and takes DD/MM/YYYY, whatever the browser's language (the
 * browser's own date box follows that, so a US browser shows MM/DD/YYYY).
 *
 * A drop-in for <input type="date">: `value` is 'YYYY-MM-DD' (or ''), and `onChange` gets an
 * event-like { target: { value } } holding 'YYYY-MM-DD' — or '' while the typed date is incomplete
 * or not a real day, just like the browser's box. The calendar button opens the browser's own
 * picker, which keeps `min` / `max`. Every other prop (id, aria-label, required, onBlur…) goes on
 * the text box; layout classes (col-span-*, flex-1…) go on the wrapper.
 */
export default function DateInput({
  value,
  onChange,
  min,
  max,
  className = '',
  wrapperClassName,
  disabled = false,
  readOnly = false,
  name,
  id,
  placeholder = 'DD/MM/YYYY',
  ...rest
}) {
  const textRef = useRef(null);
  const pickerRef = useRef(null);
  const current = value ?? '';
  const [text, setText] = useState(() => shown(current));
  // The last value this field reported. A `value` that differs came from outside (a reset, a
  // prefill), so the text follows it; one that matches is our own echo and mustn't wipe a
  // half-typed date.
  const reported = useRef(current);

  useEffect(() => {
    if (current !== reported.current) {
      reported.current = current;
      setText(shown(current));
    }
  }, [current]);

  const iso = toIso(text);
  // The same rules the browser's box enforces, so a form still won't submit a bad date.
  useEffect(() => {
    let message = '';
    if (text && !iso) message = 'Enter the date as DD/MM/YYYY';
    else if (iso && min && iso < String(min).slice(0, 10)) message = `Choose ${formatDate(min)} or later`;
    else if (iso && max && iso > String(max).slice(0, 10)) message = `Choose ${formatDate(max)} or earlier`;
    textRef.current?.setCustomValidity(message);
  }, [text, iso, min, max]);

  const report = (next) => {
    reported.current = next;
    if (next !== current) onChange?.({ target: { value: next, name, id }, currentTarget: { value: next, name, id } });
  };

  const handleType = (event) => {
    const next = shape(event.target.value);
    setText(next);
    report(next ? toIso(next) ?? '' : '');
  };

  const handlePick = (event) => {
    const picked = event.target.value;
    setText(shown(picked));
    report(picked);
    textRef.current?.focus();
  };

  const openPicker = () => {
    const picker = pickerRef.current;
    if (!picker) return;
    try {
      if (typeof picker.showPicker === 'function') {
        picker.showPicker();
        return;
      }
    } catch {
      // Not allowed here: fall back to focusing the box, which opens the picker in most browsers.
    }
    picker.focus();
    picker.click();
  };

  const classes = className.split(/\s+/).filter(Boolean);
  const layout = classes.filter((c) => LAYOUT_CLASS.test(c));
  const own = classes.filter((c) => !LAYOUT_CLASS.test(c));
  const fullWidth = own.includes('w-full');
  const hasWidth = own.some((c) => /^(?:[a-z0-9-]+:)*w-/.test(c));
  const locked = disabled || readOnly;

  return (
    <span
      className={
        wrapperClassName ??
        `relative ${fullWidth ? 'flex w-full' : 'inline-flex'} min-w-0 items-center ${layout.join(' ')}`
      }
    >
      <input
        {...rest}
        ref={textRef}
        id={id}
        name={name}
        type="text"
        inputMode="numeric"
        autoComplete="off"
        maxLength={10}
        placeholder={placeholder}
        disabled={disabled}
        readOnly={readOnly}
        value={text}
        onChange={handleType}
        className={`${own.join(' ')} ${hasWidth ? '' : 'w-[8.75rem]'} ${locked ? '' : 'pr-8'} tabular-nums`}
      />
      {locked ? null : (
        <button
          type="button"
          onClick={openPicker}
          aria-label="Open calendar"
          title="Open calendar"
          className="absolute right-1 top-1/2 flex h-7 w-7 -translate-y-1/2 items-center justify-center rounded-md text-slate-400 transition-colors hover:bg-slate-100 hover:text-brand"
        >
          <CalendarDays size={15} />
        </button>
      )}
      {/* The browser's picker, opened by the button. Invisible and out of the tab order; it only
          supplies the calendar. */}
      <input
        ref={pickerRef}
        type="date"
        tabIndex={-1}
        aria-hidden="true"
        className="pointer-events-none absolute inset-0 h-full w-full opacity-0"
        value={ISO_DAY.test(current) ? current : ''}
        min={min || undefined}
        max={max || undefined}
        disabled={locked}
        onChange={handlePick}
      />
    </span>
  );
}
