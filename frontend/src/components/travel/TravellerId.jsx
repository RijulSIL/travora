import { FileText, IdCard } from 'lucide-react';
import { useState } from 'react';

import { reimbursementApi } from '../../services/reimbursementApi';
import { showToast } from '../../store/toastStore';

/*
 * The traveller's ID on a travel request (travel_id_proof_service on the server): their full name
 * exactly as on the ID, which ID it is, and a copy to open. Shown to the traveller, approvers, the
 * Travel Desk and the travel agent — tickets are issued in this name.
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

/** Opens a travel request's ID copy in a new tab. */
export async function openTravellerId(requestId) {
  try {
    const res = await reimbursementApi.travelIdProofBlob(requestId);
    window.open(URL.createObjectURL(res.data), '_blank', 'noopener');
  } catch {
    showToast('Could not open the ID', 'error');
  }
}

/** "Name as per ID: … · Passport · View ID". Nothing for requests made before the ID was asked for. */
export default function TravellerId({ request, compact = false }) {
  const [opening, setOpening] = useState(false);
  if (!request?.id_name) return null;
  const open = async () => {
    setOpening(true);
    await openTravellerId(request.id);
    setOpening(false);
  };
  return (
    <div className={`flex flex-wrap items-center justify-between gap-2 rounded-[10px] bg-slate-50 ${compact ? 'px-2.5 py-2' : 'px-3 py-2.5'}`}>
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
  );
}
