import { Check, Download, FileSpreadsheet, Upload, X } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';

import { BTN_GHOST, BTN_MAIN, BTN_SM } from '../policy/PolicyAdminParts';
import { adminApi } from '../../services/adminApi';
import { formatRole } from '../../utils/formatters';

const COLUMNS = ['employee_id', 'full_name', 'email', 'role', 'is_manager', 'department', 'office_location', 'impact_level_id', 'reporting_manager_id'];
// The server rejects the whole file without these headers (is_manager, impact_level_id and reporting_manager_id are optional).
const REQUIRED_HEADERS = ['employee_id', 'full_name', 'email', 'role', 'department', 'office_location'];
const TEMPLATE =
  'employee_id,full_name,email,role,is_manager,department,office_location,impact_level_id,reporting_manager_id\n' +
  'EMP001,Sample User,sample@company.com,EMPLOYEE,no,Engineering,Bengaluru,L5B,MGR001\n';
const yes = (value) => ['yes', 'y', 'true', '1'].includes(String(value || '').trim().toLowerCase());
const BLANK_LABEL = { full_name: 'name', department: 'department', office_location: 'office', impact_level_id: 'level' };

/** Splits CSV text into rows of cells, honouring quoted cells (commas and "" inside quotes). */
function parseCsv(text) {
  const rows = [];
  let row = [];
  let cell = '';
  let quoted = false;
  for (let i = 0; i < text.length; i += 1) {
    const ch = text[i];
    if (quoted) {
      if (ch === '"' && text[i + 1] === '"') {
        cell += '"';
        i += 1;
      } else if (ch === '"') quoted = false;
      else cell += ch;
    } else if (ch === '"') quoted = true;
    else if (ch === ',') {
      row.push(cell);
      cell = '';
    } else if (ch === '\n' || ch === '\r') {
      if (ch === '\r' && text[i + 1] === '\n') i += 1;
      row.push(cell);
      rows.push(row);
      row = [];
      cell = '';
    } else cell += ch;
  }
  if (cell || row.length) {
    row.push(cell);
    rows.push(row);
  }
  return rows.filter((r) => r.some((c) => c.trim()));
}

/**
 * Checks each row with the same rules the server uses: a row is skipped when it has no email, an
 * unknown role, or an email / employee ID already in use (including earlier in the same file).
 * Anything else is added, with blank details left blank.
 */
// Department names are matched ignoring capitals and extra spaces (same as the server).
const deptKey = (name) => String(name || '').trim().replace(/\s+/g, ' ').toLowerCase();
const deptClean = (name) => String(name || '').trim().replace(/\s+/g, ' ');

function checkFile(text, users, roles, managerIds, levels, levelsInForce, departments = []) {
  const [header = [], ...body] = parseCsv(text.replace(/^\uFEFF/, ''));
  const names = header.map((h) => h.trim());
  const missingHeaders = REQUIRED_HEADERS.filter((h) => !names.includes(h));
  const emails = new Set(users.map((u) => (u.email || '').toLowerCase()));
  const empIds = new Set(users.map((u) => u.employee_id).filter(Boolean));
  const rows = body.map((cells, index) => {
    const row = Object.fromEntries(names.map((name, i) => [name, (cells[i] || '').trim()]));
    const email = (row.email || '').toLowerCase();
    const role = (row.role || '').toUpperCase();
    let skip = '';
    if (!email) skip = 'No email';
    else if (!roles.includes(role)) skip = `Unknown role "${row.role}"`;
    else if (emails.has(email)) skip = 'Email already in use';
    else if (row.employee_id && empIds.has(row.employee_id)) skip = 'Employee ID already in use';
    if (!skip) {
      emails.add(email);
      if (row.employee_id) empIds.add(row.employee_id);
    }
    const blank = Object.keys(BLANK_LABEL).filter((k) => !row[k]).map((k) => BLANK_LABEL[k]);
    // The level can be its ID number or its code (e.g. L5B); a code means that level in the policy in force.
    const levelRaw = row.impact_level_id || '';
    const level = /^\d+$/.test(levelRaw)
      ? levels.find((l) => l.id === Number(levelRaw))
      : levelRaw && levelsInForce.find((l) => l.level_code.toUpperCase() === levelRaw.toUpperCase());
    const levelIssue = levelRaw && !level ? `impact level ${levelRaw} not found` : '';
    // is_manager yes / no (blank = no). REPORTING_MANAGER (older files) is read as Employee +
    // Manager, and the CEO is always a manager — same as the server.
    const legacyManager = role === 'REPORTING_MANAGER';
    const manager = legacyManager || role === 'CEO' || yes(row.is_manager);
    const shownRole = legacyManager ? 'EMPLOYEE' : role;
    // The department on the company's list this means, if any; others are decided on the check screen.
    const deptRaw = deptClean(row.department);
    const deptMatch = deptRaw ? departments.find((d) => deptKey(d) === deptKey(deptRaw)) || null : null;
    return { line: index + 2, row, role: shownRole, manager, skip, blank, level: level || null, levelIssue, deptRaw, deptMatch };
  });
  // A reporting manager must have the Manager setting: already in Travora, or set to yes in this
  // file. Managers are linked after every row is in (like the server), so one further down still counts.
  const managers = new Set(managerIds);
  const fileRowOf = new Map();
  rows.forEach((r) => {
    if (r.skip || !r.row.employee_id) return;
    fileRowOf.set(r.row.employee_id, r);
    if (r.manager) managers.add(r.row.employee_id);
  });
  rows.forEach((r) => {
    const id = r.row.reporting_manager_id;
    if (r.skip) return;
    // The CEO normally has nobody above them, so a blank manager isn't worth flagging there.
    if (!id) {
      if (r.role !== 'CEO') r.blank.push('manager');
    }
    else if (!r.row.employee_id) r.managerIssue = "no employee_id, so a manager can't be set";
    else if (id === r.row.employee_id) r.managerIssue = "can't be their own manager";
    else if (!managers.has(id)) {
      const inFile = fileRowOf.get(id);
      const existing = users.find((u) => u.employee_id === id);
      if (inFile) r.managerIssue = `${inFile.row.full_name || id} isn't a manager — set is_manager to yes on row ${inFile.line}`;
      else if (existing) r.managerIssue = `${existing.full_name || id} isn't a manager — you can make them one in a click after importing`;
      else r.managerIssue = `manager ${id} not found`;
    } else {
      const existing = users.find((u) => u.employee_id === id);
      if (existing && !existing.is_active) r.managerIssue = `${existing.full_name || id} is deactivated`;
    }
  });
  return { missingHeaders, rows };
}

export default function UserImportDialog({ users, roles, managerIds = [], levels = [], levelsInForce = [], departments = [], onClose, onImported }) {
  const [file, setFile] = useState(null);
  const [check, setCheck] = useState(null);
  // What to do with each department in the file that isn't on the list, by its key:
  // { mode: 'add' | 'use' | 'blank', name, use }.
  const [deptChoices, setDeptChoices] = useState({});
  const [sendWelcome, setSendWelcome] = useState(true);
  const [result, setResult] = useState(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [dragging, setDragging] = useState(false);
  // One-click fixes on the result screen, by manager employee ID: 'busy', 'done', or an error message.
  const [fixes, setFixes] = useState({});
  const inputRef = useRef(null);

  useEffect(() => {
    const onKey = (e) => {
      if (e.key === 'Escape' && !busy) onClose();
    };
    document.addEventListener('keydown', onKey);
    document.body.style.overflow = 'hidden';
    return () => {
      document.removeEventListener('keydown', onKey);
      document.body.style.overflow = '';
    };
  }, [busy, onClose]);

  const pick = async (picked) => {
    setError('');
    setResult(null);
    if (!picked) return;
    if (!picked.name.toLowerCase().endsWith('.csv')) {
      setError('Choose a .csv file.');
      return;
    }
    setFile(picked);
    setDeptChoices({});
    setCheck(checkFile(await picked.text(), users, roles, managerIds, levels, levelsInForce, departments));
  };

  const downloadTemplate = () => {
    const url = URL.createObjectURL(new Blob([TEMPLATE], { type: 'text/csv' }));
    const a = document.createElement('a');
    a.href = url;
    a.download = 'users_import_template.csv';
    a.click();
    URL.revokeObjectURL(url);
  };

  // A manager ID's name: someone already in Travora, or someone else in this file.
  const nameOf = (employeeId, fileRows) => {
    const existing = users.find((u) => u.employee_id === employeeId);
    if (existing) return existing.full_name || existing.email;
    const inFile = fileRows.find((r) => !r.skip && r.row.employee_id === employeeId);
    return inFile ? inFile.row.full_name || inFile.row.email : '';
  };
  // Departments in the file that aren't on the list, once each, with the rows using them.
  const unknownDepts = [];
  (check?.rows || []).forEach((r) => {
    if (r.skip || !r.deptRaw || r.deptMatch) return;
    const k = deptKey(r.deptRaw);
    let group = unknownDepts.find((g) => g.key === k);
    if (!group) {
      group = { key: k, raw: r.deptRaw, rows: [] };
      unknownDepts.push(group);
    }
    group.rows.push(r);
  });
  const choiceFor = (k) => deptChoices[k] || { mode: '', name: '', use: '' };
  const setChoice = (k, patch) => setDeptChoices((all) => ({ ...all, [k]: { ...choiceFor(k), ...patch } }));
  const decided = (c) => c.mode === 'blank' || (c.mode === 'add' && deptClean(c.name)) || (c.mode === 'use' && c.use);
  // { name, isNew, undecided } for a row's department after the choices above.
  const deptOf = (r) => {
    if (!r.deptRaw) return { name: '' };
    if (r.deptMatch) return { name: r.deptMatch };
    const c = choiceFor(deptKey(r.deptRaw));
    if (c.mode === 'add' && deptClean(c.name)) {
      const listed = departments.find((d) => deptKey(d) === deptKey(c.name));
      return listed ? { name: listed } : { name: deptClean(c.name), isNew: true };
    }
    if (c.mode === 'use' && c.use) return { name: c.use };
    return { name: '', undecided: c.mode !== 'blank' };
  };
  const newDepts = [...new Set(unknownDepts.map((g) => deptOf(g.rows[0])).filter((d) => d.isNew).map((d) => d.name))];
  const undecidedCount = unknownDepts.filter((g) => !decided(choiceFor(g.key))).length;
  // Details an added person will be left without: blank in the file, or a level / manager / department that didn't match.
  const missingOf = (r) => [
    ...r.blank,
    ...(r.levelIssue ? ['level'] : []),
    ...(r.managerIssue ? ['manager'] : []),
    ...(r.deptRaw && !deptOf(r).name ? ['department'] : []),
  ];
  const adding = check ? check.rows.filter((r) => !r.skip).length : 0;
  const skipping = check ? check.rows.length - adding : 0;
  const canImport = Boolean(file && check && !check.missingHeaders.length && adding);

  const runImport = async () => {
    setBusy(true);
    setError('');
    try {
      const formData = new FormData();
      formData.append('file', file);
      formData.append('send_welcome_emails', sendWelcome ? 'true' : 'false');
      // The decisions about departments that aren't on the list (undecided ones are left blank).
      const choices = {};
      unknownDepts.forEach((g) => {
        const c = choiceFor(g.key);
        if (c.mode === 'add' && deptClean(c.name)) choices[g.key] = { mode: 'add', name: deptClean(c.name) };
        else if (c.mode === 'use' && c.use) choices[g.key] = { mode: 'use', department: c.use };
        else if (c.mode === 'blank') choices[g.key] = { mode: 'blank' };
      });
      if (Object.keys(choices).length) formData.append('department_choices', JSON.stringify(choices));
      const res = await adminApi.bulkImportUsers(formData);
      setResult(res.data);
      onImported();
    } catch (err) {
      const detail = err?.response?.data?.detail;
      setError(typeof detail === 'string' ? detail : 'The import failed. Nothing was added.');
    } finally {
      setBusy(false);
    }
  };

  // Someone named as a manager in the file wasn't one: make them a manager and link their people.
  const linkGroup = async (group) => {
    setFixes((f) => ({ ...f, [group.manager_employee_id]: 'busy' }));
    try {
      await adminApi.addToUserTeam(
        group.manager_user_id,
        group.people.map((p) => p.employee_id),
      );
      setFixes((f) => ({ ...f, [group.manager_employee_id]: 'done' }));
      onImported();
    } catch (err) {
      const detail = err?.response?.data?.detail;
      setFixes((f) => ({ ...f, [group.manager_employee_id]: typeof detail === 'string' ? detail : 'Could not do that. Nothing was changed.' }));
    }
  };

  const chooseAnother = () => {
    setFile(null);
    setCheck(null);
    setError('');
    if (inputRef.current) inputRef.current.value = '';
  };

  let body;
  if (result) {
    const groups = result.unlinked_managers || [];
    // Rows already fixed with the one-click button drop out of "left blank".
    const fixedRows = new Set(groups.filter((g) => fixes[g.manager_employee_id] === 'done').flatMap((g) => g.people.map((p) => p.row)));
    const warnings = (result.warnings || []).filter((w) => !(fixedRows.has(w.row) && w.error.includes("isn't a manager")));
    body = (
      <>
        <div className="flex flex-col items-center gap-1.5 rounded-[14px] border border-emerald-200 bg-emerald-50/50 px-4 py-6 text-center">
          <span className="mb-1 grid h-11 w-11 place-items-center rounded-full border border-emerald-200 bg-white text-emerald-700">
            <Check size={20} />
          </span>
          <b className="text-sm text-ink">
            {result.created} {result.created === 1 ? 'person' : 'people'} added
          </b>
          {result.created ? (
            <p className="text-xs text-slate-500">
              They sign in with <b className="font-mono text-ink">Welcome@123</b> and set their own password the first time.
            </p>
          ) : null}
          {result.welcome_emails_queued ? (
            <p className="rounded-[10px] border border-emerald-200 bg-white px-3 py-1.5 text-xs font-semibold text-emerald-800">
              ✓ Welcome emails are on their way to {result.welcome_emails_queued} {result.welcome_emails_queued === 1 ? 'person' : 'people'}
              <span className="block font-medium text-slate-500">If one can&apos;t be sent, that person&apos;s profile says so, with a Send button.</span>
            </p>
          ) : null}.
          {result.added_departments?.length ? (
            <p className="text-xs font-semibold text-emerald-800">
              Added {result.added_departments.join(', ')} to your departments.
            </p>
          ) : null}
        </div>
        {result.errors?.length ? (
          <div className="rounded-xl border border-slate-200 px-3.5 py-3">
            <b className="text-[13px] text-ink">
              {result.errors.length} row{result.errors.length === 1 ? '' : 's'} skipped
            </b>
            <p className="text-[11.5px] text-slate-500">Fix these in your file and import it again; people already added are skipped, not added twice.</p>
            <ul className="mt-2 flex flex-col">
              {result.errors.map((e) => (
                <li key={e.row} className="flex flex-wrap justify-between gap-2.5 border-t border-slate-100 py-1.5 text-xs">
                  <span>
                    <span className="font-mono text-slate-400">Row {e.row}</span>
                    {e.email ? ` · ${e.email}` : ''}
                  </span>
                  <span className="font-bold text-rose-700">{e.error}</span>
                </li>
              ))}
            </ul>
          </div>
        ) : null}
        {groups.map((g) => {
          const state = fixes[g.manager_employee_id];
          const names = g.people.map((p) => p.full_name || p.employee_id);
          const who = names.length > 2 ? `${names.slice(0, 2).join(', ')} and ${names.length - 2} more` : names.join(' and ');
          const people = `${g.people.length} ${g.people.length === 1 ? 'person' : 'people'}`;
          if (state === 'done') {
            return (
              <div key={g.manager_employee_id} className="rounded-xl border border-emerald-200 bg-emerald-50 px-3.5 py-3 text-xs text-emerald-800">
                ✓ <b>{g.manager_name}</b> is now a manager, and {who} {g.people.length === 1 ? 'reports' : 'report'} to them.
              </div>
            );
          }
          return (
            <div key={g.manager_employee_id} className="flex flex-col gap-2 rounded-xl border border-brand/30 bg-brand/[0.04] px-3.5 py-3">
              <div>
                <b className="text-[13px] text-ink">
                  {people} {g.people.length === 1 ? 'wasn’t' : 'weren’t'} linked because {g.manager_name} isn&apos;t a manager
                </b>
                <p className="mt-0.5 text-[11.5px] text-slate-500">
                  {who} {g.people.length === 1 ? 'was' : 'were'} added without a manager. This turns on Manager for {g.manager_name} (
                  <span className="font-mono">{g.manager_employee_id}</span>) and puts {g.people.length === 1 ? 'them' : 'all of them'} under{' '}
                  {g.manager_name}.
                </p>
              </div>
              {state && state !== 'busy' ? (
                <div role="alert" className="rounded-lg border border-rose-200 bg-rose-50 px-2.5 py-1.5 text-xs text-rose-700">
                  {state}
                </div>
              ) : null}
              <div>
                <button type="button" className={BTN_MAIN} disabled={state === 'busy'} onClick={() => linkGroup(g)}>
                  {state === 'busy' ? 'Linking…' : `Make ${g.manager_name} a manager and link ${g.people.length === 1 ? 'them' : `all ${g.people.length}`}`}
                </button>
              </div>
            </div>
          );
        })}
        {warnings.length ? (
          <div className="rounded-xl border border-amber-200 bg-amber-50/40 px-3.5 py-3">
            <b className="text-[13px] text-ink">
              {warnings.length === 1 ? '1 detail' : `${warnings.length} details`} left blank
            </b>
            <p className="text-[11.5px] text-slate-500">These people were added; set the missing level or manager from their profile in User management.</p>
            <ul className="mt-2 flex flex-col">
              {warnings.map((e) => (
                <li key={`${e.row}-${e.error}`} className="flex flex-wrap justify-between gap-2.5 border-t border-amber-100 py-1.5 text-xs">
                  <span>
                    <span className="font-mono text-slate-400">Row {e.row}</span>
                    {e.email ? ` · ${e.email}` : ''}
                  </span>
                  <span className="font-bold text-amber-700">{e.error}</span>
                </li>
              ))}
            </ul>
          </div>
        ) : null}
      </>
    );
  } else if (file && check) {
    body = (
      <>
        <div className="flex flex-wrap items-center gap-3 rounded-xl border border-slate-200 px-3 py-2.5">
          <span className="grid h-10 w-[34px] flex-none place-items-center rounded-[7px] bg-brand/10 text-brand">
            <FileSpreadsheet size={17} />
          </span>
          <div className="min-w-0 flex-1">
            <b className="block truncate text-[13px] text-ink" title={file.name}>
              {file.name}
            </b>
            <span className="text-xs text-slate-500">
              {check.rows.length} {check.rows.length === 1 ? 'person' : 'people'} · {(file.size / 1024).toFixed(1)} KB
            </span>
          </div>
          <button type="button" className={`${BTN_SM} ml-auto`} onClick={chooseAnother} disabled={busy}>
            Choose another
          </button>
        </div>
        {check.missingHeaders.length ? (
          <div role="alert" className="rounded-[10px] border border-rose-200 bg-rose-50 px-3 py-2.5 text-[12.5px] text-rose-700">
            This file is missing the column{check.missingHeaders.length === 1 ? '' : 's'} <b>{check.missingHeaders.join(', ')}</b>. Use the template so the
            headers match.
          </div>
        ) : (
          <>
            <div className="flex flex-wrap gap-2">
              <span className="inline-flex items-center gap-1.5 rounded-full bg-emerald-50 px-2.5 py-1 text-xs font-bold text-emerald-700">
                <Check size={12} /> {adding} will be added
              </span>
              {skipping ? (
                <span className="inline-flex items-center gap-1.5 rounded-full bg-rose-50 px-2.5 py-1 text-xs font-bold text-rose-700">
                  <X size={12} /> {skipping} will be skipped
                </span>
              ) : null}
            </div>
            {unknownDepts.length ? (
              <div className="flex flex-col gap-2">
                {unknownDepts.map((g) => {
                  const c = choiceFor(g.key);
                  const done = decided(c);
                  const names = g.rows.map((r) => r.row.full_name || r.row.email);
                  const who = names.length > 1 ? `${names.slice(0, -1).join(', ')} and ${names[names.length - 1]}` : names[0];
                  const line =
                    c.mode === 'add' && deptClean(c.name)
                      ? `✓ ${who} will be in a new department, "${deptClean(c.name)}"`
                      : c.mode === 'use' && c.use
                        ? `✓ ${who} will be put in ${c.use}`
                        : c.mode === 'blank'
                          ? `✓ ${who} will be added with no department`
                          : `Not on your list yet (used by ${who}) — choose what to do`;
                  const opt = (mode, label) => (
                    <button
                      type="button"
                      aria-pressed={c.mode === mode}
                      onClick={() => setChoice(g.key, mode === 'add' && !c.name ? { mode, name: g.raw.replace(/^./, (m) => m.toUpperCase()) } : { mode })}
                      className={`rounded-[9px] border px-2.5 py-[5px] text-xs font-bold ${
                        c.mode === mode ? 'border-brand bg-brand text-white' : `bg-white text-slate-700 ${done ? 'border-emerald-200' : 'border-amber-300'}`
                      }`}
                    >
                      {label}
                    </button>
                  );
                  return (
                    <div
                      key={g.key}
                      role="group"
                      aria-label={`Department "${g.raw}"`}
                      className={`flex flex-col gap-2 rounded-xl border px-3 py-2.5 ${done ? 'border-emerald-200 bg-emerald-50/60' : 'border-amber-300 bg-amber-50'}`}
                    >
                      <div className="flex flex-wrap items-baseline justify-between gap-2">
                        <b className="text-[13px] text-ink">
                          &quot;{g.raw}&quot; · {g.rows.length} {g.rows.length === 1 ? 'person' : 'people'}
                        </b>
                        <span className={`text-[11.5px] ${done ? 'text-emerald-800' : 'text-amber-900'}`}>{line}</span>
                      </div>
                      <div className="flex flex-wrap items-center gap-1.5">
                        {opt('add', 'Add as a new department')}
                        {c.mode === 'add' ? (
                          <input
                            aria-label="New department name"
                            className="h-[30px] w-[180px] max-w-full rounded-lg border border-slate-200 bg-white px-2 text-xs text-ink"
                            value={c.name}
                            onChange={(e) => setChoice(g.key, { name: e.target.value })}
                          />
                        ) : null}
                        {opt('use', 'Change to…')}
                        {c.mode === 'use' ? (
                          <select
                            aria-label="Existing department"
                            className="h-[30px] max-w-full rounded-lg border border-slate-200 bg-white px-2 text-xs text-ink"
                            value={c.use}
                            onChange={(e) => setChoice(g.key, { use: e.target.value })}
                          >
                            <option value="">Pick a department</option>
                            {departments.map((d) => (
                              <option key={d} value={d}>
                                {d}
                              </option>
                            ))}
                          </select>
                        ) : null}
                        {opt('blank', 'Leave blank')}
                      </div>
                    </div>
                  );
                })}
                <p className="text-[11.5px] text-slate-500">
                  {undecidedCount
                    ? `${undecidedCount} department${undecidedCount === 1 ? '' : 's'} still to decide — undecided ones are left blank.`
                    : newDepts.length
                      ? `Importing adds ${newDepts.join(', ')} to your departments.`
                      : 'All departments sorted.'}
                </p>
              </div>
            ) : null}
            <div className="max-h-60 overflow-auto rounded-xl border border-slate-200">
              <table className="w-full min-w-[880px] border-collapse text-xs">
                <thead>
                  <tr className="text-left text-[10.5px] font-extrabold uppercase tracking-[0.06em] text-slate-400">
                    {['Row', 'Name', 'Check', 'Role', 'Manager', 'Department', 'Level', 'Reports to', 'Email'].map((h) => (
                      <th key={h} className="sticky top-0 border-b border-slate-200 bg-slate-50 px-2.5 py-[7px]">
                        {h}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {check.rows.map((r) => (
                    <tr key={r.line} className={r.skip ? 'bg-rose-50/60' : ''}>
                      <td className="whitespace-nowrap border-t border-slate-100 px-2.5 py-2 font-mono text-slate-500">{r.line}</td>
                      <td className="whitespace-nowrap border-t border-slate-100 px-2.5 py-2 text-slate-700">{r.row.full_name || '—'}</td>
                      <td className="border-t border-slate-100 px-2.5 py-2 font-bold">
                        {r.skip ? (
                          <span className="text-rose-700">✕ {r.skip}</span>
                        ) : deptOf(r).undecided ? (
                          <span className="whitespace-nowrap text-amber-700">Choose above</span>
                        ) : missingOf(r).length ? (
                          <span className={`text-amber-700 ${missingOf(r).length === 1 ? 'whitespace-nowrap' : ''}`}>Added · no {missingOf(r).join(', ')}</span>
                        ) : (
                          <span className="text-emerald-700">✓ Ready</span>
                        )}
                      </td>
                      <td className="whitespace-nowrap border-t border-slate-100 px-2.5 py-2 text-slate-700">
                        {roles.includes(r.role) ? formatRole(r.role) : r.row.role || '—'}
                      </td>
                      <td className="whitespace-nowrap border-t border-slate-100 px-2.5 py-2">
                        {r.skip ? (
                          <span className="text-slate-400">—</span>
                        ) : r.manager ? (
                          <span className="inline-flex rounded-full border border-emerald-200 bg-emerald-50 px-2 py-0.5 text-[11px] font-bold text-emerald-700">
                            Manager{r.role === 'CEO' ? ' · always' : ''}
                          </span>
                        ) : (
                          <span className="text-slate-400">No</span>
                        )}
                      </td>
                      <td className="whitespace-nowrap border-t border-slate-100 px-2.5 py-2 text-slate-700">
                        {(() => {
                          if (!r.deptRaw) return '—';
                          const d = deptOf(r);
                          const from = d.name && d.name !== r.deptRaw ? <span className="text-slate-400"> · from &quot;{r.deptRaw}&quot;</span> : null;
                          if (d.name)
                            return (
                              <>
                                {d.name}
                                {d.isNew ? <span className="ml-1 rounded-md bg-emerald-50 px-1.5 text-[10.5px] font-bold text-emerald-700">new</span> : null}
                                {from}
                              </>
                            );
                          return (
                            <>
                              {r.deptRaw}
                              {!r.skip ? (
                                <span className="block text-[11px] font-semibold text-amber-700">{d.undecided ? 'Not on your list yet' : 'left blank'}</span>
                              ) : null}
                            </>
                          );
                        })()}
                      </td>
                      <td className="whitespace-nowrap border-t border-slate-100 px-2.5 py-2 text-slate-700">
                        {r.level ? (
                          <>
                            <span className="font-mono">{r.level.level_code}</span>
                            <span className="text-slate-500"> · {r.level.level_name}</span>
                          </>
                        ) : r.row.impact_level_id ? (
                          <>
                            <span className="font-mono">{r.row.impact_level_id}</span>
                            {!r.skip ? <span className="block text-[11px] font-semibold text-amber-700">not found</span> : null}
                          </>
                        ) : (
                          '—'
                        )}
                      </td>
                      <td className="whitespace-nowrap border-t border-slate-100 px-2.5 py-2 text-slate-700">
                        {r.row.reporting_manager_id ? (
                          <>
                            <span className="font-mono">{r.row.reporting_manager_id}</span>
                            {nameOf(r.row.reporting_manager_id, check.rows) ? (
                              <span className="text-slate-500"> · {nameOf(r.row.reporting_manager_id, check.rows)}</span>
                            ) : null}
                            {r.managerIssue && !r.skip ? <span className="block text-[11px] font-semibold text-amber-700">{r.managerIssue}</span> : null}
                          </>
                        ) : (
                          '—'
                        )}
                      </td>
                      <td className="whitespace-nowrap border-t border-slate-100 px-2.5 py-2 text-slate-700">{r.row.email || '—'}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <p className="text-xs text-slate-500">Red rows are skipped. Amber rows are added with that detail left blank; you can fill it in later from their profile.</p>
            {adding ? (
              <label className="flex cursor-pointer items-start gap-2.5 rounded-[10px] border border-slate-200 px-3 py-2.5">
                <input type="checkbox" className="mt-0.5 h-4 w-4 flex-none accent-brand" checked={sendWelcome} onChange={(e) => setSendWelcome(e.target.checked)} />
                <span className="text-[12.5px] font-semibold text-ink">
                  Send each person a welcome email
                  <span className="mt-0.5 block text-[11.5px] font-medium text-slate-500">
                    {adding} {adding === 1 ? 'person' : 'people'} will get their sign-in details by email.
                  </span>
                </span>
              </label>
            ) : null}
          </>
        )}
      </>
    );
  } else {
    body = (
      <>
        <div
          onDragOver={(e) => {
            e.preventDefault();
            setDragging(true);
          }}
          onDragLeave={() => setDragging(false)}
          onDrop={(e) => {
            e.preventDefault();
            setDragging(false);
            pick(e.dataTransfer.files?.[0]);
          }}
          className={`flex flex-col items-center gap-1.5 rounded-[14px] border-[1.5px] border-dashed px-4 py-7 text-center transition-colors ${
            dragging ? 'border-brand bg-brand/5' : 'border-[#b7d3c8] bg-gradient-to-b from-[#f7fbf9] to-white'
          }`}
        >
          <span className="mb-1 grid h-[46px] w-[46px] place-items-center rounded-full border border-[#cfe3db] bg-white text-brand">
            <Upload size={19} />
          </span>
          <b className="text-sm text-ink">Drop your CSV file here</b>
          <p className="max-w-[46ch] text-xs text-slate-500">or pick it from your computer. We check every row and show you what will happen before anything is added.</p>
          <button type="button" className={`${BTN_MAIN} mt-1.5`} onClick={() => inputRef.current?.click()}>
            Choose CSV file
          </button>
          <input ref={inputRef} type="file" accept=".csv" className="hidden" onChange={(e) => pick(e.target.files?.[0])} />
        </div>
        <div className="flex flex-col gap-2.5 rounded-xl border border-slate-200 px-3.5 py-3">
          <div className="flex flex-wrap items-center justify-between gap-2.5">
            <div>
              <b className="text-[13px] text-ink">Use the template</b>
              <span className="block text-[11.5px] text-slate-500">One row per person with these columns. Email and role are required; the rest can be blank.</span>
            </div>
            <button type="button" className={BTN_SM} onClick={downloadTemplate}>
              <Download size={13} /> Download template
            </button>
          </div>
          <div className="flex flex-wrap gap-1.5">
            {COLUMNS.map((c) => (
              <span
                key={c}
                className={`rounded-[7px] px-[7px] py-[3px] font-mono text-[11px] font-semibold ${
                  c === 'email' || c === 'role' ? 'bg-brand/10 text-brand' : c === 'is_manager' ? 'bg-emerald-50 text-emerald-700 ring-1 ring-emerald-300' : 'bg-slate-100 text-slate-600'
                }`}
              >
                {c}
                {c === 'email' || c === 'role' ? ' *' : ''}
              </span>
            ))}
          </div>
          <span className="text-[11.5px] text-slate-500">
            Role is one of {roles.filter((r) => r !== 'REPORTING_MANAGER').join(', ')}. is_manager is yes or no (blank is no; the CEO is always a
            manager). impact_level_id is the level&apos;s code (e.g. L5B) or its ID number. reporting_manager_id is the manager&apos;s employee ID
            (e.g. 002): someone with Manager on, or set to yes in the same file.
          </span>
        </div>
      </>
    );
  }

  return (
    // Above the phone bottom bar (z-60), like ConfirmDialog.
    <div className="fixed inset-0 z-[95] grid grid-cols-[minmax(0,1fr)] place-items-center bg-slate-900/40 p-4" onMouseDown={() => !busy && onClose()}>
      <div
        role="dialog"
        aria-modal="true"
        aria-label="Import users"
        onMouseDown={(e) => e.stopPropagation()}
        className="flex max-h-[calc(100vh-32px)] w-[min(680px,100%)] min-w-0 flex-col overflow-hidden rounded-[14px] border border-slate-200 bg-white shadow-[0_30px_60px_-24px_rgba(15,23,42,0.35)]"
      >
        <div className="flex items-center justify-between gap-2.5 border-b border-slate-100 px-4 py-3">
          <div className="flex items-center gap-3">
            <span className="grid h-[38px] w-[38px] flex-none place-items-center rounded-[11px] bg-brand/10 text-brand">
              <Upload size={17} />
            </span>
            <div>
              <b className="block text-sm text-ink">Import users</b>
              <span className="text-xs text-slate-500">Add many people at once from a CSV file.</span>
            </div>
          </div>
          <button type="button" aria-label="Close" className={BTN_SM} onClick={onClose} disabled={busy}>
            <X size={13} />
          </button>
        </div>
        <div className="flex flex-col gap-3.5 overflow-y-auto px-4 py-3.5">
          {error ? (
            <div role="alert" className="rounded-[10px] border border-rose-200 bg-rose-50 px-3 py-2.5 text-[12.5px] text-rose-700">
              {error}
            </div>
          ) : null}
          {body}
        </div>
        <div className="flex flex-wrap items-center justify-between gap-2 border-t border-slate-100 bg-slate-50 px-4 py-[11px]">
          <span className="text-xs text-slate-500">
            {result
              ? 'Import finished'
              : file && check && !check.missingHeaders.length
                ? `${adding} of ${check.rows.length} will be added`
                : (
                  <>
                    New people start with <span className="font-mono">Welcome@123</span> and set their own at first sign-in
                  </>
                )}
          </span>
          <span className="flex gap-2">
            {result ? (
              <button type="button" className={BTN_MAIN} onClick={onClose}>
                Done
              </button>
            ) : (
              <>
                <button type="button" className={BTN_GHOST} onClick={onClose} disabled={busy}>
                  Cancel
                </button>
                <button type="button" className={BTN_MAIN} onClick={runImport} disabled={!canImport || busy}>
                  {busy ? 'Importing…' : file && check ? `Import ${adding} ${adding === 1 ? 'person' : 'people'}` : 'Import'}
                </button>
              </>
            )}
          </span>
        </div>
      </div>
    </div>
  );
}
