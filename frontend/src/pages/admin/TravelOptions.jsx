import { Mail, X } from 'lucide-react';
import { useEffect, useState } from 'react';

import { Pill } from '../../components/approvals/ApprovalQueueParts';
import { BTN_GHOST, BTN_MAIN, BTN_SM, CARD, CardHead, ErrorNote, FIELD, PolicyHead, Toggle, useCanConfigurePolicy } from '../../components/policy/PolicyAdminParts';
import { useSetPageTitle } from '../../context/PageTitleContext';
import { useAsyncAction } from '../../hooks/useAsyncAction';
import { adminApi } from '../../services/adminApi';

const ADD_LINE = 'flex flex-wrap gap-2 border-t border-slate-100 bg-slate-50 px-4 py-3';

function useOptionUpdate(onChanged) {
  return useAsyncAction(async (option, overrides) => {
    await adminApi.updateTravelOption(option.id, {
      value: option.value,
      label: option.label,
      is_active: option.is_active,
      notify_project_stakeholders: option.notify_project_stakeholders,
      ...overrides,
    });
    await onChanged();
  });
}

/** Inline editor for an option's value (and description, for project codes). */
function EditOption({ option, withLabel, update, onDone }) {
  const [value, setValue] = useState(option.value);
  const [label, setLabel] = useState(option.label || '');
  return (
    <form
      className="flex flex-1 flex-wrap items-center gap-2"
      onSubmit={(e) => {
        e.preventDefault();
        // Purposes have no separate description, so their label simply follows the value.
        update
          .run(option, { value: value.trim(), label: withLabel ? label.trim() || null : value.trim() })
          .then(onDone)
          .catch(() => {});
      }}
    >
      <input aria-label="Value" className={`${FIELD} h-8 w-[180px]`} value={value} onChange={(e) => setValue(e.target.value)} autoFocus />
      {withLabel ? <input aria-label="Description" className={`${FIELD} h-8 min-w-[160px] flex-1`} placeholder="Description (optional)" value={label} onChange={(e) => setLabel(e.target.value)} /> : null}
      <button type="submit" className={`${BTN_MAIN} h-8`} disabled={!value.trim() || update.loading}>
        Save
      </button>
      <button type="button" className={`${BTN_GHOST} h-8`} onClick={onDone}>
        Cancel
      </button>
    </form>
  );
}

function HideButton({ option, update }) {
  return (
    <button
      type="button"
      className={BTN_SM}
      disabled={update.loading}
      title={option.is_active ? 'Hides it from new requests; existing requests keep it' : 'Offer it on new requests again'}
      onClick={() => update.run(option, { is_active: !option.is_active }).catch(() => {})}
    >
      {option.is_active ? 'Hide' : 'Show again'}
    </button>
  );
}

function Purposes({ options, isViewOnly, onChanged }) {
  const update = useOptionUpdate(onChanged);
  const [editing, setEditing] = useState(null);
  const [text, setText] = useState('');
  const add = useAsyncAction(async () => {
    await adminApi.createTravelOption({ option_type: 'TRIP_PURPOSE', value: text.trim(), label: null });
    setText('');
    await onChanged();
  });
  const sorted = [...options].sort((a, b) => Number(b.is_active) - Number(a.is_active));
  return (
    <section aria-label="Trip purposes" className={CARD}>
      <CardHead title="Trip purposes" sub={`${options.filter((o) => o.is_active).length} offered on every travel request`} />
      <ErrorNote error={update.error || add.error} />
      {sorted.map((o) => (
        <div key={o.id} className={`flex flex-wrap items-center gap-3 border-t border-slate-100 px-4 py-2.5 first:border-t-0 ${o.is_active ? '' : 'bg-slate-50/70'}`}>
          <span className={`h-2 w-2 shrink-0 rounded-full ${o.is_active ? 'bg-emerald-600' : 'bg-slate-300'}`} />
          {editing === o.id ? (
            <EditOption option={o} update={update} onDone={() => setEditing(null)} />
          ) : (
            <>
              <b className={`min-w-0 flex-1 text-[13px] ${o.is_active ? 'text-ink' : 'text-slate-500'}`}>
                {o.value} {o.is_active ? null : <Pill>Hidden</Pill>}
              </b>
              <span className="flex flex-wrap items-center gap-1.5">
                {o.is_active ? (
                  <Toggle
                    on={Boolean(o.notify_project_stakeholders)}
                    disabled={isViewOnly || update.loading}
                    title="On a Project-type trip with this purpose, emails that project's recipients once the Travel Desk has booked it"
                    onClick={() => update.run(o, { notify_project_stakeholders: !o.notify_project_stakeholders }).catch(() => {})}
                  >
                    <Mail size={11} className="mr-1 inline -translate-y-px" />
                    {o.notify_project_stakeholders ? 'Notifies project' : 'Notify project?'}
                  </Toggle>
                ) : null}
                {!isViewOnly ? (
                  <>
                    <button type="button" className={BTN_SM} onClick={() => setEditing(o.id)}>
                      Edit
                    </button>
                    <HideButton option={o} update={update} />
                  </>
                ) : null}
              </span>
            </>
          )}
        </div>
      ))}
      {options.length === 0 ? <p className="px-4 py-5 text-center text-[13px] text-slate-500">No trip purposes yet. Travel requests can&apos;t be submitted until one is added.</p> : null}
      {!isViewOnly ? (
        <form
          className={ADD_LINE}
          onSubmit={(e) => {
            e.preventDefault();
            add.run().catch(() => {});
          }}
        >
          <input aria-label="New purpose" className={`${FIELD} min-w-[160px] flex-1`} placeholder="New purpose, e.g. Vendor visit" value={text} onChange={(e) => setText(e.target.value)} />
          <button type="submit" className={BTN_MAIN} disabled={!text.trim() || add.loading}>
            Add
          </button>
        </form>
      ) : null}
    </section>
  );
}

/** Who gets emailed about a project: chips you can edit or remove, plus an add line. */
function Recipients({ code, isViewOnly }) {
  const [rows, setRows] = useState([]);
  const [error, setError] = useState(null);
  const [editing, setEditing] = useState(null);
  const [form, setForm] = useState({ email: '', display_name: '' });
  const load = async () => {
    try {
      setError(null);
      setRows((await adminApi.projectRecipients(code)).data);
    } catch (err) {
      setError(err);
    }
  };
  useEffect(() => {
    load();
  }, [code]);

  const add = useAsyncAction(async () => {
    await adminApi.createProjectRecipient({ project_code: code, email: form.email.trim(), display_name: form.display_name.trim() || null });
    setForm({ email: '', display_name: '' });
    await load();
  });
  const save = useAsyncAction(async (row, draft) => {
    await adminApi.updateProjectRecipient(row.id, { email: draft.email.trim(), display_name: draft.display_name.trim() || null });
    setEditing(null);
    await load();
  });
  const remove = useAsyncAction(async (id) => {
    await adminApi.deleteProjectRecipient(id);
    await load();
  });
  const editRow = rows.find((r) => r.id === editing?.id);

  return (
    <div className="mt-1.5">
      <p className="text-xs text-slate-500">Emailed when a trip with a &ldquo;notify&rdquo; purpose is booked:</p>
      <ErrorNote error={error || add.error || save.error || remove.error} />
      <div className="mt-1.5 flex flex-wrap items-center gap-1.5">
        {rows.map((r) => (
          <span key={r.id} className="inline-flex items-center gap-1 rounded-full bg-slate-100 py-0.5 pl-2.5 pr-1 text-[11.5px] font-semibold text-slate-700">
            <button type="button" disabled={isViewOnly} title={isViewOnly ? undefined : 'Edit'} onClick={() => setEditing({ id: r.id, email: r.email, display_name: r.display_name || '' })} className="text-left disabled:cursor-default">
              {r.display_name ? <b className="text-ink">{r.display_name} </b> : null}
              {r.email}
            </button>
            {!isViewOnly ? (
              <button type="button" aria-label={`Remove ${r.email}`} disabled={remove.loading} onClick={() => remove.run(r.id).catch(() => {})} className="grid h-[18px] w-[18px] place-items-center rounded-full bg-white text-slate-500 hover:text-rose-600">
                <X size={10} />
              </button>
            ) : null}
          </span>
        ))}
        {rows.length === 0 ? <span className="text-xs text-slate-400">Nobody yet</span> : null}
      </div>
      {!isViewOnly ? (
        <form
          className="mt-2 flex flex-wrap items-center gap-1.5"
          onSubmit={(e) => {
            e.preventDefault();
            if (editRow) save.run(editRow, editing).catch(() => {});
            else add.run().catch(() => {});
          }}
        >
          <input
            aria-label={`Email for ${code}`}
            type="email"
            className={`${FIELD} h-8 w-[210px] text-xs`}
            placeholder="name@company.com"
            value={editRow ? editing.email : form.email}
            onChange={(e) => (editRow ? setEditing({ ...editing, email: e.target.value }) : setForm({ ...form, email: e.target.value }))}
          />
          <input
            aria-label={`Name for ${code}`}
            className={`${FIELD} h-8 w-[150px] text-xs`}
            placeholder="Name (optional)"
            value={editRow ? editing.display_name : form.display_name}
            onChange={(e) => (editRow ? setEditing({ ...editing, display_name: e.target.value }) : setForm({ ...form, display_name: e.target.value }))}
          />
          <button type="submit" className={BTN_SM} disabled={!(editRow ? editing.email : form.email).trim() || add.loading || save.loading}>
            {editRow ? 'Save' : 'Add'}
          </button>
          {editRow ? (
            <button type="button" className={BTN_SM} onClick={() => setEditing(null)}>
              Cancel
            </button>
          ) : null}
        </form>
      ) : null}
    </div>
  );
}

function ProjectCodes({ options, isViewOnly, onChanged }) {
  const update = useOptionUpdate(onChanged);
  const [editing, setEditing] = useState(null);
  const [form, setForm] = useState({ value: '', label: '' });
  const add = useAsyncAction(async () => {
    await adminApi.createTravelOption({ option_type: 'PROJECT_CODE', value: form.value.trim(), label: form.label.trim() || null });
    setForm({ value: '', label: '' });
    await onChanged();
  });
  const sorted = [...options].sort((a, b) => Number(b.is_active) - Number(a.is_active));
  return (
    <section aria-label="Project codes" className={CARD}>
      <CardHead title="Project codes" sub="Offered when someone picks Project as the travel type" />
      <ErrorNote error={update.error || add.error} />
      {sorted.map((o) => (
        <div key={o.id} className={`border-t border-slate-100 px-4 py-3 first:border-t-0 ${o.is_active ? '' : 'bg-slate-50/70'}`}>
          {editing === o.id ? (
            <EditOption option={o} withLabel update={update} onDone={() => setEditing(null)} />
          ) : (
            <div className="flex flex-wrap items-start justify-between gap-2">
              <div className="flex min-w-0 flex-wrap items-center gap-[7px] text-[13.5px] font-bold text-ink">
                <span className={`h-2 w-2 shrink-0 rounded-full ${o.is_active ? 'bg-emerald-600' : 'bg-slate-300'}`} />
                {o.value}
                {o.label && o.label !== o.value ? <span className="text-xs font-semibold text-slate-500">{o.label}</span> : null}
                {o.is_active ? null : <Pill>Hidden</Pill>}
              </div>
              {!isViewOnly ? (
                <span className="flex gap-1.5">
                  <button type="button" className={BTN_SM} onClick={() => setEditing(o.id)}>
                    Edit
                  </button>
                  <HideButton option={o} update={update} />
                </span>
              ) : null}
            </div>
          )}
          {o.is_active ? <Recipients code={o.value} isViewOnly={isViewOnly} /> : null}
        </div>
      ))}
      {options.length === 0 ? <p className="px-4 py-5 text-center text-[13px] text-slate-500">No project codes yet. Project travel can&apos;t be requested until one is added.</p> : null}
      {!isViewOnly ? (
        <form
          className={ADD_LINE}
          onSubmit={(e) => {
            e.preventDefault();
            add.run().catch(() => {});
          }}
        >
          <input aria-label="New project code" className={`${FIELD} min-w-[120px] flex-1`} placeholder="Code, e.g. PRJ-1024" value={form.value} onChange={(e) => setForm({ ...form, value: e.target.value })} />
          <input aria-label="New project description" className={`${FIELD} min-w-[160px] flex-[2]`} placeholder="Description (optional)" value={form.label} onChange={(e) => setForm({ ...form, label: e.target.value })} />
          <button type="submit" className={BTN_MAIN} disabled={!form.value.trim() || add.loading}>
            Add
          </button>
        </form>
      ) : null}
    </section>
  );
}

export default function TravelOptions() {
  useSetPageTitle('Travel Options');
  const isViewOnly = !useCanConfigurePolicy();
  const [options, setOptions] = useState([]);
  const [loadError, setLoadError] = useState(null);

  const load = async () => {
    try {
      setLoadError(null);
      setOptions((await adminApi.travelOptions()).data);
    } catch (error) {
      setLoadError(error);
    }
  };
  useEffect(() => {
    load();
  }, []);

  return (
    <section className="flex flex-col gap-3.5">
      <PolicyHead title="Travel options" sub="The choices people see on a travel request: trip purposes, and project codes for project travel, with who gets emailed about each project." />
      <ErrorNote error={loadError} />
      <div className="grid items-start gap-3.5 lg:grid-cols-2">
        <Purposes options={options.filter((o) => o.option_type === 'TRIP_PURPOSE')} isViewOnly={isViewOnly} onChanged={load} />
        <ProjectCodes options={options.filter((o) => o.option_type === 'PROJECT_CODE')} isViewOnly={isViewOnly} onChanged={load} />
      </div>
    </section>
  );
}
