import { BookUser, FileCheck2, FileText, IdCard, UploadCloud } from 'lucide-react';
import { useState } from 'react';

import { reimbursementApi } from '../../services/reimbursementApi';
import { showToast } from '../../store/toastStore';
import { formatDate } from '../../utils/formatters';

/*
 * The traveller's ID on a travel request (travel_id_proof_service on the server): their full name
 * exactly as on the ID, which ID it is, and a copy to open. Shown to the traveller, approvers, the
 * Travel Desk and the travel agent — tickets are issued in this name. Everyone also keeps a meal
 * preference and an ID on their profile (asked for after their first sign-in); requests are filled
 * in from it.
 */

export const ID_TYPES = [
  ['AADHAAR', 'Aadhaar'],
  ['PAN', 'PAN card'],
  ['PASSPORT', 'Passport'],
  ['DRIVING_LICENCE', 'Driving licence'],
  ['VOTER_ID', 'Voter ID'],
  ['OTHER', 'Other ID'],
];
const ID_TYPE_LABEL = Object.fromEntries(ID_TYPES);

export const idTypeLabel = (code) => ID_TYPE_LABEL[code] || code || '';

export const MEAL_PREFERENCES = [
  ['VEG', 'Veg'],
  ['NON_VEG', 'Non-veg'],
];
const MEAL_LABEL = Object.fromEntries(MEAL_PREFERENCES);

export const mealLabel = (code) => MEAL_LABEL[code] || code || '';

export const EMPTY_TRAVELLER_ID = { id_name: '', id_type: '', id_proof_ref: '', id_proof_filename: '' };

export function travellerIdErrors(t) {
  return {
    id_name: t.id_name.trim().length < 2 ? 'Enter your full name exactly as it appears on your ID' : null,
    id_type: t.id_type ? null : 'Choose which ID you are attaching',
    id_proof_ref: t.id_proof_ref ? null : 'Attach a copy of your ID',
  };
}

/** The veg / non-veg mark used on Indian food packs: a square with a dot, green or brown. */
function MealMark({ code }) {
  const veg = code === 'VEG';
  return (
    <span aria-hidden className={`grid h-[15px] w-[15px] shrink-0 place-items-center rounded-[3px] border-[1.5px] bg-white ${veg ? 'border-emerald-600' : 'border-[#8b3a1a]'}`}>
      <span className={`h-[7px] w-[7px] rounded-full ${veg ? 'bg-emerald-600' : 'bg-[#8b3a1a]'}`} />
    </span>
  );
}

/** "Veg" / "Non-veg" with its mark. */
export function MealTag({ code }) {
  if (!code) return null;
  return (
    <span className="inline-flex items-center gap-1.5">
      <MealMark code={code} /> {mealLabel(code)}
    </span>
  );
}

/** Veg / non-veg as two buttons (a radio group). */
export function MealChoice({ value, onChange, invalid = false, large = false, label = 'Meal preference' }) {
  return (
    <div role="radiogroup" aria-label={label} className="grid grid-cols-2 gap-2">
      {MEAL_PREFERENCES.map(([code, text]) => {
        const on = value === code;
        return (
          <button
            key={code}
            type="button"
            role="radio"
            aria-checked={on}
            onClick={() => onChange(code)}
            className={`inline-flex items-center justify-center gap-2 rounded-[10px] border-2 font-bold transition-colors ${large ? 'h-12 text-[15px]' : 'h-[38px] text-[13px]'} ${
              on
                ? 'border-brand bg-brand/[0.06] text-ink'
                : invalid
                  ? 'border-rose-300 bg-rose-50/40 text-slate-600'
                  : 'border-slate-200 bg-white text-slate-600 hover:border-slate-300'
            }`}
          >
            <MealMark code={code} /> {text}
          </button>
        );
      })}
    </div>
  );
}

function FieldError({ children }) {
  return children ? <p className="mt-1 text-[11px] font-bold text-rose-600">{children}</p> : null;
}

/**
 * Name as per ID, ID type and the copy — the first-sign-in setup, My profile and the travel
 * request form. `upload(formData)` stores the file and resolves to { ref, filename };
 * `onUploadingChange` lets the form wait for an upload still going.
 */
export function TravellerIdFields({ value, onChange, upload, showErrors = false, idPrefix = 'tid', fieldClass, labelClass, large = false, onUploadingChange }) {
  const [uploading, setUploading] = useState(false);
  const errors = travellerIdErrors(value);
  const setBusy = (busy) => {
    setUploading(busy);
    onUploadingChange?.(busy);
  };
  const pickFile = () => {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = '.pdf,.jpg,.jpeg,.png,.heic';
    input.onchange = async () => {
      const file = input.files?.[0];
      if (!file) return;
      if (file.size > 10 * 1024 * 1024) {
        showToast('The ID file can be up to 10 MB', 'error');
        return;
      }
      const fd = new FormData();
      fd.append('file', file);
      setBusy(true);
      try {
        const r = await upload(fd);
        onChange({ ...value, id_proof_ref: r.data.ref, id_proof_filename: r.data.filename });
      } catch (err) {
        const detail = err?.response?.data?.detail;
        showToast(typeof detail === 'string' ? detail : 'Could not upload the ID', 'error');
      } finally {
        setBusy(false);
      }
    };
    input.click();
  };

  return (
    <>
      <div className="grid gap-3 sm:grid-cols-2">
        <div>
          <label htmlFor={`${idPrefix}-type`} className={labelClass}>
            ID type
          </label>
          <select
            id={`${idPrefix}-type`}
            className={fieldClass}
            value={value.id_type}
            onChange={(e) => onChange({ ...value, id_type: e.target.value })}
            aria-invalid={Boolean(showErrors && errors.id_type)}
            required
          >
            <option value="">Select ID type</option>
            {ID_TYPES.map(([code, text]) => (
              <option key={code} value={code}>
                {text}
              </option>
            ))}
          </select>
          {showErrors ? <FieldError>{errors.id_type}</FieldError> : null}
        </div>
        <div>
          <label htmlFor={`${idPrefix}-name`} className={labelClass}>
            Full name as per ID
          </label>
          <input
            id={`${idPrefix}-name`}
            className={fieldClass}
            placeholder="Exactly as printed on the ID"
            maxLength={255}
            autoComplete="name"
            value={value.id_name}
            onChange={(e) => onChange({ ...value, id_name: e.target.value })}
            aria-invalid={Boolean(showErrors && errors.id_name)}
            required
          />
          {showErrors ? <FieldError>{errors.id_name}</FieldError> : null}
        </div>
      </div>
      <div>
        <span className={labelClass}>ID proof</span>
        <button
          type="button"
          onClick={pickFile}
          disabled={uploading}
          className={`w-full rounded-[10px] border-2 px-3 text-center font-semibold transition-colors ${large ? 'py-4 text-[13px]' : 'py-3 text-xs'} ${
            value.id_proof_ref
              ? 'border-solid border-emerald-200 bg-emerald-50 text-emerald-800'
              : showErrors
                ? 'border-dashed border-rose-300 bg-rose-50/40 text-rose-700'
                : 'border-dashed border-slate-200 bg-slate-50/60 text-slate-500 hover:border-brand/40'
          }`}
        >
          {uploading ? (
            'Uploading…'
          ) : value.id_proof_ref ? (
            <span className="inline-flex items-center gap-1.5">
              <FileCheck2 size={15} className="shrink-0" /> <span className="break-all">{value.id_proof_filename || 'ID attached'}</span> (click to replace)
            </span>
          ) : (
            <span className="inline-flex items-center gap-1.5">
              <UploadCloud size={15} className="shrink-0" /> Attach your ID: PDF, JPG, PNG or HEIC, up to 10 MB
            </span>
          )}
        </button>
        {showErrors ? <FieldError>{errors.id_proof_ref}</FieldError> : null}
      </div>
    </>
  );
}

/** Opens a travel request's ID copy in a new tab. */
export async function openTravellerId(requestId) {
  try {
    const res = await reimbursementApi.travelIdProofBlob(requestId);
    window.open(URL.createObjectURL(res.data), '_blank', 'noopener');
  } catch {
    showToast('Could not open the ID', 'error');
  }
}

/**
 * "Name as per ID: … · Passport · View ID", then the meal preference and passport when the request
 * has them. Nothing for requests made before the ID was asked for.
 */
export default function TravellerId({ request, compact = false }) {
  const [opening, setOpening] = useState(false);
  if (!request?.id_name) return null;
  const open = async () => {
    setOpening(true);
    await openTravellerId(request.id);
    setOpening(false);
  };
  const extras = request.meal_preference || request.passport_number;
  return (
    <div className={`rounded-[10px] bg-slate-50 ${compact ? 'px-2.5 py-2' : 'px-3 py-2.5'}`}>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex min-w-0 items-center gap-2">
          <IdCard size={16} className="shrink-0 text-brand" />
          <div className="min-w-0">
            <div className="text-[10.5px] font-semibold text-slate-500">Name as per ID{request.id_type ? ` · ${idTypeLabel(request.id_type)}` : ''}</div>
            <div className="break-words text-[13.5px] font-extrabold text-ink">{request.id_name}</div>
          </div>
        </div>
        {request.has_id_proof ? (
          <button
            type="button"
            onClick={open}
            disabled={opening}
            className="inline-flex shrink-0 items-center gap-1.5 rounded-lg border border-slate-200 bg-white px-2.5 py-1.5 text-[12px] font-bold text-ink hover:bg-slate-50 disabled:opacity-60"
          >
            <FileText size={13} /> {opening ? 'Opening…' : 'View ID'}
          </button>
        ) : null}
      </div>
      {extras ? (
        <div className="mt-2 flex flex-wrap gap-x-4 gap-y-1 border-t border-slate-200/70 pt-2 text-[12px] text-slate-600">
          {request.meal_preference ? (
            <span className="inline-flex items-center gap-1.5">
              <span className="font-semibold text-slate-500">Meal</span>
              <b className="text-ink">
                <MealTag code={request.meal_preference} />
              </b>
            </span>
          ) : null}
          {request.passport_number ? (
            <span className="inline-flex items-center gap-1.5">
              <BookUser size={13} className="text-slate-400" />
              <span className="font-semibold text-slate-500">Passport</span>
              <b className="font-mono text-ink">{request.passport_number}</b>
              {request.passport_expiry ? <span className="text-slate-500">· valid till {formatDate(request.passport_expiry)}</span> : null}
            </span>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}
