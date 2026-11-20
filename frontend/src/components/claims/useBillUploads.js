import { useState } from 'react';

import { reimbursementApi } from '../../services/reimbursementApi';
import { showToast } from '../../store/toastStore';

/*
 * Uploading bills from a claim form: several at once, one after another (the server reads
 * each bill as it arrives, so they can't overlap usefully). Matches the server's rules
 * (reimbursement_service._validate_upload): PDF, JPG, PNG or HEIC, up to 10 MB.
 */

export const BILL_ACCEPT = '.pdf,.jpg,.jpeg,.png,.heic';
const MAX_BYTES = 10 * 1024 * 1024;
const TYPE_BY_EXT = { pdf: 'application/pdf', jpg: 'image/jpeg', jpeg: 'image/jpeg', png: 'image/png', heic: 'image/heic' };

const extOf = (name) => String(name || '').split('.').pop().toLowerCase();

/** Why a file can't be uploaded, or null when it can. */
function fileProblem(file) {
  if (!TYPE_BY_EXT[extOf(file.name)]) return 'use a PDF, JPG, PNG or HEIC file';
  if (!file.size) return 'the file is empty';
  if (file.size > MAX_BYTES) return 'it’s over 10 MB. Try a smaller scan or photo';
  return null;
}

/** Windows browsers often send an iPhone photo (.heic) with no type, which the server refuses,
 * so every file goes up labelled by its extension. */
function labelled(file) {
  const type = TYPE_BY_EXT[extOf(file.name)];
  return file.type === type ? file : new File([file], file.name, { type });
}

/** Why an upload failed, in words: the server's own reason for a refusal, else a retry hint. */
function failureReason(err) {
  const code = err?.response?.status;
  const detail = err?.response?.data?.detail;
  if (code && code < 500 && typeof detail === 'string') return detail;
  if (!err?.response) return 'check your connection and try again';
  return 'something went wrong on our side. Try again';
}

/**
 * { uploading, uploadBills }. `uploading` is { name, pct, index, count } while bills go up
 * (pct null/100 once the server is reading the bill). Each bill is handed to `onUploaded` as soon
 * as it's in; `uploadBills(files)` resolves to all the bills that made it.
 */
export default function useBillUploads({ category, onUploaded }) {
  const [uploading, setUploading] = useState(null);

  const uploadBills = async (fileList) => {
    const files = [];
    for (const file of Array.from(fileList || [])) {
      const problem = fileProblem(file);
      if (problem) showToast(`${file.name}: ${problem}`, 'error');
      else files.push(file);
    }
    const uploaded = [];
    for (let i = 0; i < files.length; i += 1) {
      const file = files[i];
      setUploading({ name: file.name, pct: 0, index: i, count: files.length });
      const formData = new FormData();
      formData.append('file', labelled(file));
      formData.append('reimbursement_category', category);
      try {
        const response = await reimbursementApi.uploadInvoice(formData, {
          onUploadProgress: (e) => setUploading((u) => (u ? { ...u, pct: e.total ? Math.round((e.loaded * 100) / e.total) : null } : u)),
        });
        uploaded.push(response.data);
        onUploaded?.(response.data);
      } catch (err) {
        showToast(`${file.name} couldn’t be uploaded: ${failureReason(err)}`, 'error');
      }
    }
    setUploading(null);
    if (uploaded.length) showToast(uploaded.length === 1 ? 'Bill uploaded' : `${uploaded.length} bills uploaded`, 'success');
    return uploaded;
  };

  return { uploading, uploadBills };
}
