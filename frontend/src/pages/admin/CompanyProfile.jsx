import { Lock, Plus, X } from 'lucide-react';
import { useEffect, useState } from 'react';

import NameListCard, { UsedIn, nameKey, people } from '../../components/admin/NameListCard';
import { BTN_GHOST, BTN_MAIN, BTN_SM, CARD, CardHead, ErrorNote, FIELD, LABEL, PolicyHead, useCanConfigurePolicy } from '../../components/policy/PolicyAdminParts';
import Skeleton from '../../components/ui/Skeleton';
import { useSetPageTitle } from '../../context/PageTitleContext';
import useToast from '../../hooks/useToast';
import { adminApi } from '../../services/adminApi';

/*
 * Company profile: the company's name, GSTINs, bank account, offices and departments, saved
 * together with one Save bar. Each section says where Travora uses it. GSTINs and the IFSC are
 * checked here and on the server (an invalid one blocks the save); renaming an office or a
 * department moves the people in it (see company_profile.py).
 */

// 2-digit state code, 10-character PAN, entity number, Z, check character — same as the server.
const GSTIN = /^(0[1-9]|[1-3][0-9]|97|99)[A-Z]{5}[0-9]{4}[A-Z][1-9A-Z]Z[0-9A-Z]$/;
const IFSC = /^[A-Z]{4}0[A-Z0-9]{6}$/;
const gstinProblem = (gstin) =>
  gstin.length !== 15
    ? `Not a valid GSTIN: it has ${gstin.length} characters, and a GSTIN has 15.`
    : GSTIN.test(gstin)
      ? null
      : 'Not a valid GSTIN. The pattern is 2 digits, 5 letters, 4 digits, a letter, a digit or letter, Z, then a digit or letter.';
const ifscProblem = (ifsc) =>
  ifsc && !IFSC.test(ifsc) ? 'Not a valid IFSC. An IFSC has 11 characters: 4 letters, a 0, then 6 letters or digits (e.g. HDFC0001234).' : null;

const EMPTY_BANK = { account_name: '', account_number: '', ifsc: '' };
const toItems = (names) => (names || []).map((name) => ({ name, original: name, listed: true }));
const errorText = (err, fallback) => {
  const detail = err?.response?.data?.detail;
  return typeof detail === 'string' ? detail : Array.isArray(detail) ? detail.map((d) => d.msg).join('; ') : fallback;
};

// How many things differ from what was loaded: each added, renamed or removed name counts once.
function listChanges(items, savedNames) {
  const kept = new Set(items.filter((i) => i.listed).map((i) => nameKey(i.original)));
  const added = items.filter((i) => !i.listed).length;
  const renamed = items.filter((i) => i.listed && i.name !== i.original).length;
  const removed = savedNames.filter((n) => !kept.has(nameKey(n))).length;
  return added + renamed + removed;
}
const renamesOf = (items) =>
  Object.fromEntries(items.filter((i) => i.original && i.original !== i.name).map((i) => [i.original, i.name]));

export default function CompanyProfile() {
  useSetPageTitle('Company Profile');
  const { showToast } = useToast();
  const canEdit = useCanConfigurePolicy();
  const [saved, setSaved] = useState(null);
  const [loadError, setLoadError] = useState(null);
  const [form, setForm] = useState({ company_name: '', gstins: [], bank: EMPTY_BANK });
  const [offices, setOffices] = useState([]);
  const [departments, setDepartments] = useState([]);
  const [newGstin, setNewGstin] = useState('');
  const [showAccount, setShowAccount] = useState(false);
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState(null);

  const apply = (data) => {
    const profile = data || { company_name: '', gstins: [], office_locations: [], departments: [], bank_details: null };
    setSaved(profile);
    setForm({
      company_name: profile.company_name || '',
      gstins: profile.gstins || [],
      bank: { ...EMPTY_BANK, ...(profile.bank_details || {}) },
    });
    setOffices(toItems(profile.office_locations));
    setDepartments(toItems(profile.departments));
    setSaveError(null);
  };

  useEffect(() => {
    adminApi
      .companyProfile()
      .then((res) => apply(res.data))
      .catch((err) => setLoadError(err));
  }, []);

  if (!saved) {
    return (
      <section className="flex flex-col gap-3.5">
        <PolicyHead title="Company profile" sub="Your company’s details, offices and departments. Each section says where Travora uses it." />
        <ErrorNote error={loadError} />
        {!loadError ? <Skeleton variant="table" rows={6} columns={2} /> : null}
      </section>
    );
  }

  const savedBank = { ...EMPTY_BANK, ...(saved.bank_details || {}) };
  const changeCount =
    (form.company_name.trim() !== (saved.company_name || '') ? 1 : 0) +
    (JSON.stringify(form.gstins) !== JSON.stringify(saved.gstins || []) ? 1 : 0) +
    (['account_name', 'account_number', 'ifsc'].some((k) => (form.bank[k] || '') !== (savedBank[k] || '')) ? 1 : 0) +
    listChanges(offices, saved.office_locations || []) +
    listChanges(departments, saved.departments || []);

  const badGstins = form.gstins.filter((g) => gstinProblem(g));
  const ifscError = ifscProblem(form.bank.ifsc);
  const blockers = [
    !form.company_name.trim() ? 'Enter the company name' : null,
    badGstins.length ? `Fix or remove ${badGstins.length === 1 ? 'the invalid GSTIN' : `${badGstins.length} invalid GSTINs`}` : null,
    ifscError ? 'Fix the IFSC' : null,
  ].filter(Boolean);

  const officeCounts = saved.office_counts || {};
  const unlisted = Object.entries(officeCounts)
    .filter(([name]) => !offices.some((o) => nameKey(o.name) === nameKey(name) || nameKey(o.original) === nameKey(name)))
    .sort((a, b) => b[1] - a[1]);
  const unlistedPeople = unlisted.reduce((sum, [, n]) => sum + n, 0);
  const addOffices = (names) => setOffices((current) => [...current, ...names.map((name) => ({ name, original: name, listed: false }))]);

  const setBank = (field, value) => setForm((f) => ({ ...f, bank: { ...f.bank, [field]: value } }));
  const addGstin = () => {
    const gstin = newGstin.replace(/\s+/g, '').toUpperCase();
    if (!gstin) return;
    if (!form.gstins.includes(gstin)) setForm((f) => ({ ...f, gstins: [...f.gstins, gstin] }));
    setNewGstin('');
  };

  const discard = () => apply(saved);
  const save = async () => {
    setSaving(true);
    setSaveError(null);
    try {
      const res = await adminApi.updateCompanyProfile({
        company_name: form.company_name.trim(),
        gstins: form.gstins,
        bank_details: form.bank,
        office_locations: offices.map((o) => o.name),
        office_renames: renamesOf(offices),
        departments: departments.map((d) => d.name),
        department_renames: renamesOf(departments),
      });
      apply(res.data);
      showToast('Company profile saved.', 'success');
    } catch (err) {
      setSaveError(err);
      showToast(errorText(err, 'Could not save the company profile.'), 'error');
    } finally {
      setSaving(false);
    }
  };

  return (
    <section className="flex flex-col gap-3.5 pb-24">
      <PolicyHead title="Company profile" sub="Your company’s details, offices and departments. Each section says where Travora uses it." />
      {!canEdit ? (
        <p className="rounded-[10px] border border-slate-200 bg-white px-3 py-2.5 text-[13px] text-slate-600">You can see the company profile, but not change it.</p>
      ) : null}
      <ErrorNote error={saveError} />

      <div className="grid items-start gap-3.5 lg:grid-cols-[minmax(0,0.95fr)_minmax(0,1.05fr)]">
        <div className="flex min-w-0 flex-col gap-3.5">
          <section className={CARD} aria-label="Company">
            <CardHead title="Company" sub="Your company’s name and GST registrations." />
            <fieldset disabled={!canEdit} className="flex min-w-0 flex-col gap-3 px-4 py-3.5">
              <div className="flex flex-col gap-1">
                <label className={LABEL} htmlFor="company-name">
                  Company name
                </label>
                <input
                  id="company-name"
                  className={`${FIELD} ${form.company_name.trim() ? '' : 'border-amber-400 bg-amber-50'}`}
                  value={form.company_name}
                  onChange={(e) => setForm((f) => ({ ...f, company_name: e.target.value }))}
                />
                <UsedIn items={['Welcome emails']} />
              </div>

              <div className="flex flex-col gap-1.5">
                <span className={LABEL}>GSTINs</span>
                {form.gstins.length ? (
                  <ul className="flex flex-col gap-1.5" aria-label="GSTINs">
                    {form.gstins.map((gstin) => {
                      const problem = gstinProblem(gstin);
                      return (
                        <li key={gstin} className={`flex items-center gap-2 rounded-[10px] border px-2.5 py-[7px] ${problem ? 'border-amber-300 bg-amber-50' : 'border-slate-200'}`}>
                          <div className="flex min-w-0 flex-1 flex-col gap-px">
                            <span className="font-mono text-[12.5px] text-ink">{gstin}</span>
                            {problem ? (
                              <span className="text-[11.5px] font-semibold text-amber-800">⚠ {problem}</span>
                            ) : (
                              <span className="text-[11.5px] text-slate-500">✓ Valid format · state code {gstin.slice(0, 2)}</span>
                            )}
                          </div>
                          <button
                            type="button"
                            aria-label={`Remove ${gstin}`}
                            className="grid h-7 w-7 flex-none place-items-center rounded-lg text-slate-400 hover:bg-rose-50 hover:text-rose-700"
                            onClick={() => setForm((f) => ({ ...f, gstins: f.gstins.filter((g) => g !== gstin) }))}
                          >
                            <X size={14} />
                          </button>
                        </li>
                      );
                    })}
                  </ul>
                ) : (
                  <span className="text-[12px] text-slate-400">No GSTINs yet.</span>
                )}
                <div className="flex flex-wrap gap-2">
                  <input
                    aria-label="New GSTIN"
                    className={`${FIELD} min-w-[160px] flex-1 font-mono`}
                    placeholder="Add a GSTIN, e.g. 27AAACS1234F1Z5"
                    maxLength={15}
                    value={newGstin}
                    onChange={(e) => setNewGstin(e.target.value.toUpperCase())}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter') addGstin();
                    }}
                  />
                  <button type="button" className={BTN_GHOST} onClick={addGstin}>
                    <Plus size={15} /> Add
                  </button>
                </div>
                <UsedIn items={[]} note="kept for your records" />
              </div>
            </fieldset>
          </section>

          <section className={CARD} aria-label="Bank account">
            <CardHead title="Bank account" sub="The company’s own account." />
            <fieldset disabled={!canEdit} className="flex min-w-0 flex-col gap-3 px-4 py-3.5">
              <div>
                <label className={LABEL} htmlFor="account-name">
                  Account name
                </label>
                <input id="account-name" className={FIELD} value={form.bank.account_name} onChange={(e) => setBank('account_name', e.target.value)} />
              </div>
              <div className="grid gap-2.5 sm:grid-cols-2">
                <div>
                  <label className={LABEL} htmlFor="account-number">
                    Account number
                  </label>
                  <div className="flex gap-2">
                    <input
                      id="account-number"
                      type={showAccount ? 'text' : 'password'}
                      autoComplete="off"
                      className={`${FIELD} min-w-0 flex-1 font-mono`}
                      value={form.bank.account_number}
                      onChange={(e) => setBank('account_number', e.target.value.replace(/\s/g, ''))}
                    />
                    <button type="button" className={`${BTN_SM} !h-9`} onClick={() => setShowAccount((v) => !v)} aria-pressed={showAccount}>
                      {showAccount ? 'Hide' : 'Show'}
                    </button>
                  </div>
                </div>
                <div>
                  <label className={LABEL} htmlFor="ifsc">
                    IFSC
                  </label>
                  <input
                    id="ifsc"
                    maxLength={11}
                    aria-invalid={Boolean(ifscError)}
                    aria-describedby="ifsc-note"
                    className={`${FIELD} font-mono uppercase ${ifscError ? 'border-amber-400 bg-amber-50' : ''}`}
                    value={form.bank.ifsc}
                    onChange={(e) => setBank('ifsc', e.target.value.toUpperCase().replace(/\s/g, ''))}
                  />
                  <p id="ifsc-note" className={`mt-1 text-[11.5px] ${ifscError ? 'font-semibold text-amber-800' : 'text-slate-500'}`}>
                    {ifscError ? `⚠ ${ifscError}` : form.bank.ifsc ? `✓ Valid format · bank code ${form.bank.ifsc.slice(0, 4)}` : 'e.g. HDFC0001234'}
                  </p>
                </div>
              </div>
              <p className="flex items-center gap-1.5 text-[11.5px] text-slate-500">
                <Lock size={12} /> Stored encrypted. Only people who can see sensitive admin details can open this page.
              </p>
              <UsedIn items={[]} note="kept for your records" />
            </fieldset>
          </section>
        </div>

        <div className="flex min-w-0 flex-col gap-3.5">
          <fieldset disabled={!canEdit} className="min-w-0">
            <NameListCard
              title="Offices"
              sub="Where people work."
              noun="office"
              items={offices}
              onChange={setOffices}
              counts={officeCounts}
              moves={(n) => `the ${people(n)} in it move to the new name`}
              usedIn={['User management', 'CSV import', 'Travel claims · starting office']}
              placeholder="New office, e.g. Gurugram"
            >
              {unlisted.length ? (
                <div className="flex flex-col gap-2 rounded-[11px] border border-amber-300 bg-amber-50 px-3 py-2.5 text-xs leading-relaxed text-amber-900">
                  <span>
                    <b>
                      {people(unlistedPeople)} {unlistedPeople === 1 ? 'is' : 'are'} in {unlisted.length === 1 ? 'an office' : `${unlisted.length} offices`} that{' '}
                      {unlisted.length === 1 ? 'isn’t' : 'aren’t'} on this list.
                    </b>{' '}
                    They don’t show up in the office lists until {unlisted.length === 1 ? 'it’s' : 'they’re'} added.
                  </span>
                  <span className="flex flex-wrap gap-1.5">
                    {unlisted.map(([name, n]) => (
                      <button key={name} type="button" className={BTN_SM} onClick={() => addOffices([name])}>
                        <Plus size={12} /> {name} · {n}
                      </button>
                    ))}
                    {unlisted.length > 1 ? (
                      <button type="button" className={`${BTN_MAIN} !h-7 !rounded-lg !px-2.5 !text-[11.5px]`} onClick={() => addOffices(unlisted.map(([name]) => name))}>
                        Add all {unlisted.length}
                      </button>
                    ) : null}
                  </span>
                </div>
              ) : null}
            </NameListCard>
          </fieldset>

          <fieldset disabled={!canEdit} className="min-w-0">
            <NameListCard
              title="Departments"
              sub="The departments people can be put in."
              noun="department"
              items={departments}
              onChange={setDepartments}
              counts={saved.department_counts || {}}
              moves={(n) => `the ${people(n)} in it, its department head and its team budget move to the new name`}
              usedIn={['User management', 'CSV import', 'Approval matrix · department heads', 'Team budgets']}
              placeholder="New department, e.g. Quality"
            />
          </fieldset>
        </div>
      </div>

      {canEdit && changeCount ? (
        <div
          role="region"
          aria-label="Unsaved changes"
          className="fixed inset-x-0 bottom-[calc(env(safe-area-inset-bottom,0px)+76px)] z-40 mx-auto flex w-[min(720px,calc(100%-32px))] animate-sheet-up flex-wrap items-center justify-between gap-3 rounded-[14px] bg-ink py-2.5 pl-4 pr-3 text-white shadow-[0_20px_40px_-16px_rgba(15,23,42,0.5)] motion-reduce:animate-none md:bottom-4"
        >
          <div className="min-w-0">
            <b className="block text-[13px]">
              {changeCount} unsaved change{changeCount === 1 ? '' : 's'}
            </b>
            <span className={`block text-xs ${blockers.length ? 'text-amber-300' : 'text-slate-300'}`}>
              {blockers.length ? `${blockers.join(' · ')} before saving.` : 'Saved for everyone when you click Save.'}
            </span>
          </div>
          <span className="flex gap-2">
            <button type="button" className={`${BTN_GHOST} border-slate-600 bg-transparent text-slate-200 hover:bg-white/10`} onClick={discard} disabled={saving}>
              Discard
            </button>
            <button
              type="button"
              className="inline-flex h-[34px] items-center justify-center gap-1.5 whitespace-nowrap rounded-[10px] border border-white bg-white px-[13px] text-[12.5px] font-bold text-ink hover:bg-slate-100 disabled:cursor-not-allowed disabled:opacity-45"
              onClick={save}
              disabled={saving || blockers.length > 0}
            >
              {saving ? 'Saving…' : 'Save changes'}
            </button>
          </span>
        </div>
      ) : null}
    </section>
  );
}
