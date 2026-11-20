import { AlertCircle, IdCard, LogOut, Utensils } from 'lucide-react';
import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';

import AuthBrandPanel, { AuthMobileLogo } from '../../components/auth/AuthBrandPanel';
import { EMPTY_TRAVELLER_ID, MealChoice, TravellerIdFields, travellerIdErrors } from '../../components/travel/TravellerId';
import useToast from '../../hooks/useToast';
import api, { currentRefreshToken } from '../../services/api';
import { reimbursementApi } from '../../services/reimbursementApi';
import { clearSession, useAuthStore } from '../../store/authStore';

const LABEL = 'mb-1.5 block text-sm font-semibold text-slate-700';

/*
 * After the first sign-in (and the new password), everyone gives their meal preference and their
 * ID before they can use the app — ProtectedRoute shows this instead of any page until both are
 * saved (/me needs_traveller_profile). Travel requests are filled in from it; it can be changed
 * on My profile. Someone who already raised travel requests starts with the ID from their last one.
 */
export default function TravellerSetupPage() {
  const navigate = useNavigate();
  const { showToast } = useToast();
  const profile = useAuthStore((s) => s.profile);
  const [meal, setMeal] = useState(profile?.meal_preference || '');
  const [ident, setIdent] = useState(EMPTY_TRAVELLER_ID);
  const [uploading, setUploading] = useState(false);
  const [showErrors, setShowErrors] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState(null);

  const firstName = String(profile?.full_name || '').trim().split(/\s+/)[0];

  // Start from what's already known: the profile's meal preference, and the ID on the profile or
  // on their last travel request (only the parts still empty).
  useEffect(() => {
    reimbursementApi
      .lastTravelIdProof()
      .then((r) => {
        const last = r.data || {};
        setMeal((prev) => prev || last.meal_preference || '');
        setIdent((prev) => ({
          id_name: prev.id_name || last.id_name || '',
          id_type: prev.id_type || last.id_type || '',
          id_proof_ref: prev.id_proof_ref || last.id_proof_ref || '',
          id_proof_filename: prev.id_proof_ref ? prev.id_proof_filename : last.id_proof_filename || '',
        }));
      })
      .catch(() => {});
  }, []);

  const ready = Boolean(meal) && !Object.values(travellerIdErrors(ident)).some(Boolean);

  const handleSubmit = async (e) => {
    e.preventDefault();
    if (!ready || uploading) {
      setShowErrors(true);
      return;
    }
    setError(null);
    setSaving(true);
    try {
      const res = await reimbursementApi.saveTravellerProfile({
        meal_preference: meal,
        id_name: ident.id_name.trim(),
        id_type: ident.id_type,
        id_proof_ref: ident.id_proof_ref,
        id_proof_filename: ident.id_proof_filename,
      });
      showToast(`You're all set${firstName ? `, ${firstName}` : ''}. Welcome to Travora!`, 'success');
      // needs_traveller_profile is now false, so ProtectedRoute shows the page that was asked for.
      useAuthStore.getState().setProfile(res.data);
    } catch (err) {
      const detail = err?.response?.data?.detail;
      setError(typeof detail === 'string' ? detail : Array.isArray(detail) ? detail[0]?.msg || 'Could not save your details.' : 'Could not save your details.');
    } finally {
      setSaving(false);
    }
  };

  const signOut = async () => {
    try {
      const token = currentRefreshToken();
      await api.post('/auth/logout', {}, { headers: token ? { 'X-Refresh-Token': token } : {} });
    } catch {
      /* proceed with local sign-out */
    }
    clearSession();
    navigate('/', { replace: true });
  };

  return (
    <div className="flex min-h-screen w-full bg-slate-50">
      {/* Left photo panel with the logo (hidden on mobile) — shared by every sign-in screen */}
      <AuthBrandPanel />

      <div className="relative flex w-full items-center justify-center overflow-hidden bg-white p-6 lg:w-1/2 lg:p-12">
        <div className="pointer-events-none absolute inset-0 overflow-hidden lg:hidden">
          <div className="absolute left-1/4 top-1/4 h-96 w-96 -translate-x-1/2 -translate-y-1/2 rounded-full bg-brand/5 blur-[80px]" />
        </div>

        <div className="relative z-10 w-full max-w-[440px]">
          <div className="mb-7 text-left">
            <AuthMobileLogo />
            <h1 className="text-3xl font-extrabold tracking-tight text-slate-900">Your Travel Details</h1>
            <p className="mt-2 text-sm font-medium text-slate-500">
              Welcome{firstName ? `, ${firstName}` : ''}. One last step before you start: your travel requests are filled in from these, and you can change
              them any time on My profile.
            </p>
          </div>

          {error && (
            <div role="alert" className="mb-6 flex items-start gap-2 rounded-lg border border-red-200 bg-red-50 p-3.5 text-sm font-medium text-red-700 shadow-sm">
              <AlertCircle size={16} className="mt-0.5 shrink-0" />
              <span>{error}</span>
            </div>
          )}

          <form className="space-y-6" onSubmit={handleSubmit} noValidate>
            <section className="space-y-2.5">
              <h2 className="flex items-center gap-2 text-sm font-bold text-slate-800">
                <Utensils size={16} className="text-brand" /> Meal preference
              </h2>
              <MealChoice value={meal} onChange={setMeal} invalid={showErrors && !meal} large />
              {showErrors && !meal ? <p className="text-[11px] font-bold text-rose-600">Choose veg or non-veg</p> : null}
            </section>

            <section className="space-y-3">
              <div>
                <h2 className="flex items-center gap-2 text-sm font-bold text-slate-800">
                  <IdCard size={16} className="text-brand" /> Your ID
                </h2>
                <p className="mt-1 text-xs font-medium text-slate-500">
                  Tickets are booked in the name on your ID. Your approvers, the travel desk and the travel agent see it on your travel requests.
                </p>
              </div>
              <TravellerIdFields
                value={ident}
                onChange={setIdent}
                upload={reimbursementApi.uploadMyIdProof}
                showErrors={showErrors}
                idPrefix="setup-id"
                fieldClass="field h-12"
                labelClass={LABEL}
                large
                onUploadingChange={setUploading}
              />
            </section>

            <button
              type="submit"
              disabled={saving || uploading}
              className="btn-primary h-12 w-full text-[15px] shadow-lg shadow-brand/25 transition-all hover:-translate-y-0.5 hover:shadow-xl hover:shadow-brand/40"
            >
              {saving ? 'Saving…' : 'Save and Continue'}
            </button>
          </form>

          <div className="mt-6 text-center lg:text-left">
            <button
              type="button"
              onClick={signOut}
              className="inline-flex items-center gap-1.5 text-[13px] font-semibold text-slate-400 transition-colors hover:text-slate-600"
            >
              <LogOut size={16} /> Sign out
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
