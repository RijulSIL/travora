import { Mail, RotateCcw, Save, Trash } from 'lucide-react';
import { useEffect, useState } from 'react';

import { useSetPageTitle } from '../../context/PageTitleContext';
import { useAsyncAction } from '../../hooks/useAsyncAction';
import { adminApi } from '../../services/adminApi';
import { hasPermission } from '../../services/permissions';
import { useAuthStore } from '../../store/authStore';

const SECTIONS = [
  {
    type: 'PROJECT_CODE',
    title: 'Project Codes',
    description: 'Offered in the Project Code dropdown when a traveler picks Project as the travel type.',
    valueLabel: 'Project Code',
    valuePlaceholder: 'e.g. PRJ-1024',
    labelLabel: 'Description (optional)',
    labelPlaceholder: 'e.g. Plant expansion — Phase 2',
    empty: 'No project codes configured yet. Project travel can’t be requested until at least one is added.',
  },
  {
    type: 'TRIP_PURPOSE',
    title: 'Trip Purposes',
    description: 'Offered in the Trip Purpose dropdown on every travel request.',
    valueLabel: 'Purpose',
    valuePlaceholder: 'e.g. Client Meeting',
    labelLabel: null,
    labelPlaceholder: '',
    empty: 'No trip purposes configured yet. Travel requests can’t be submitted until at least one is added.',
  },
];

function OptionSection({ section, options, isViewOnly, onChanged }) {
  const [form, setForm] = useState({ value: '', label: '' });
  // In-progress edits per option id ({ value, label }), before "Save" is clicked.
  const [drafts, setDrafts] = useState({});
  const hasDescription = Boolean(section.labelLabel);

  const addAction = useAsyncAction(async () => {
    await adminApi.createTravelOption({
      option_type: section.type,
      value: form.value.trim(),
      label: hasDescription ? form.label.trim() || null : null,
    });
    setForm({ value: '', label: '' });
    await onChanged();
  });
  const updateAction = useAsyncAction(async (option, overrides) => {
    await adminApi.updateTravelOption(option.id, {
      value: option.value,
      label: option.label,
      is_active: option.is_active,
      notify_project_stakeholders: option.notify_project_stakeholders,
      ...overrides,
    });
    setDrafts((current) => {
      const next = { ...current };
      delete next[option.id];
      return next;
    });
    await onChanged();
  });

  const error = addAction.error || updateAction.error;
  const active = options.filter((option) => option.is_active);
  const inactive = options.filter((option) => !option.is_active);

  return (
    <section className="panel p-6 mb-6">
      <div className="mb-5 border-b border-line pb-4 flex items-center justify-between gap-3">
        <div>
          <h2 className="text-lg font-bold text-slate-900">{section.title}</h2>
          <p className="text-sm text-slate-500 mt-1">{section.description}</p>
        </div>
        <div className="flex items-center gap-2 shrink-0">
          <span className="inline-flex items-center rounded-full bg-emerald-50 px-2.5 py-1 text-[11px] font-bold text-emerald-700 ring-1 ring-inset ring-emerald-600/20">
            {active.length} active
          </span>
          {isViewOnly ? <span className="inline-flex items-center rounded-full bg-slate-100 px-2.5 py-1 text-xs font-semibold text-slate-700">View Only</span> : null}
        </div>
      </div>

      {error ? <div className="mb-4 rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-700">{error.response?.data?.detail || error.message}</div> : null}

      <div className="space-y-1.5">
        {[...active, ...inactive].map((option) => {
          const draft = drafts[option.id] ?? { value: option.value, label: option.label };
          const patch = (changes) => setDrafts({ ...drafts, [option.id]: { ...draft, ...changes } });
          const dirty =
            draft.value.trim() !== '' &&
            draft.label.trim() !== '' &&
            (draft.value !== option.value || draft.label !== option.label);
          // Purposes have no separate description, so their label simply follows the value.
          const saveEdits = () => updateAction.run(option, {
            value: draft.value.trim(),
            label: hasDescription ? draft.label.trim() : draft.value.trim(),
          });
          return (
            <div
              key={option.id}
              className={`flex flex-wrap items-center gap-3 rounded-xl px-3 py-2.5 transition-colors ${option.is_active ? 'hover:bg-slate-50' : 'bg-slate-50/60'}`}
            >
              <span className={`h-2 w-2 shrink-0 rounded-full ${option.is_active ? 'bg-emerald-500' : 'bg-slate-300'}`} />
              <div className={hasDescription ? 'w-48 shrink-0' : 'w-64 shrink-0'}>
                <input
                  className={`field h-9 text-slate-900 ${option.is_active ? '' : 'text-slate-500'}`}
                  readOnly={isViewOnly}
                  value={draft.value}
                  onChange={(event) => patch({ value: event.target.value, ...(hasDescription ? {} : { label: event.target.value }) })}
                />
              </div>
              {hasDescription ? (
                <div className="flex-1 min-w-48">
                  <input
                    className={`field h-9 text-slate-900 ${option.is_active ? '' : 'text-slate-500'}`}
                    readOnly={isViewOnly}
                    placeholder="Description"
                    value={draft.label}
                    onChange={(event) => patch({ label: event.target.value })}
                  />
                </div>
              ) : (
                <span className="flex-1" />
              )}
              <div className="flex items-center gap-2 shrink-0">
                {section.type === 'TRIP_PURPOSE' && option.is_active ? (
                  <button
                    className={`flex items-center gap-1 rounded-full px-2.5 py-1 text-[11px] font-bold transition-colors ${option.notify_project_stakeholders ? 'bg-indigo-50 text-indigo-700 ring-1 ring-inset ring-indigo-600/20' : 'bg-slate-100 text-slate-500 hover:bg-slate-200'}`}
                    disabled={isViewOnly || updateAction.loading}
                    onClick={() => updateAction.run(option, { notify_project_stakeholders: !option.notify_project_stakeholders })}
                    title="When selected on a Project-type request, emails that project's recipients (see Project Notification Recipients below)"
                  >
                    <Mail size={12} />
                    {option.notify_project_stakeholders ? 'Notifies project' : 'Notify project?'}
                  </button>
                ) : null}
                {dirty && !isViewOnly ? (
                  <button className="btn-secondary h-8 px-3 text-[11px] font-bold" onClick={saveEdits} disabled={updateAction.loading}>
                    <Save size={14} />Save
                  </button>
                ) : null}
                {option.is_active ? (
                  !isViewOnly ? (
                    <button
                      className="flex h-8 w-8 items-center justify-center rounded-lg border border-transparent text-slate-400 transition-all hover:border-red-200 hover:bg-red-50 hover:text-red-600 disabled:opacity-50"
                      onClick={() => updateAction.run(option, { is_active: false })}
                      disabled={updateAction.loading}
                      title="Deactivate — hides it from new requests, existing requests keep it"
                    >
                      <Trash size={16} />
                    </button>
                  ) : null
                ) : (
                  <>
                    <span className="rounded-full bg-slate-100 px-2.5 py-1 text-[11px] font-bold text-slate-500">Inactive</span>
                    {!isViewOnly ? (
                      <button
                        className="flex items-center gap-1 rounded-full bg-slate-100 px-2.5 py-1 text-[11px] font-bold text-slate-500 hover:bg-slate-200 disabled:opacity-50"
                        onClick={() => updateAction.run(option, { is_active: true })}
                        disabled={updateAction.loading}
                      >
                        <RotateCcw size={12} />Reactivate
                      </button>
                    ) : null}
                  </>
                )}
              </div>
            </div>
          );
        })}
        {options.length === 0 ? <div className="py-4 text-center text-sm text-slate-400 italic">{section.empty}</div> : null}
      </div>

      {!isViewOnly ? (
        <div className="mt-5 rounded-xl bg-slate-50/70 border border-slate-200/60 p-4">
          <p className="mb-3 text-[11px] font-bold uppercase tracking-wider text-slate-500">Add New</p>
          <div className="grid gap-3 md:grid-cols-12 items-end">
            <div className={hasDescription ? 'md:col-span-4' : 'md:col-span-9'}>
              <label className="mb-1.5 block text-[12px] font-bold text-slate-600 uppercase tracking-wider">{section.valueLabel}</label>
              <input className="field w-full text-slate-900 bg-white" placeholder={section.valuePlaceholder} value={form.value} onChange={(event) => setForm({ ...form, value: event.target.value })} />
            </div>
            {hasDescription ? (
              <div className="md:col-span-5">
                <label className="mb-1.5 block text-[12px] font-bold text-slate-600 uppercase tracking-wider">{section.labelLabel}</label>
                <input className="field w-full text-slate-900 bg-white" placeholder={section.labelPlaceholder} value={form.label} onChange={(event) => setForm({ ...form, label: event.target.value })} />
              </div>
            ) : null}
            <div className="md:col-span-3">
              <button className="btn-primary w-full justify-center h-10 shadow-sm" onClick={addAction.run} disabled={addAction.loading || !form.value.trim()}>
                {addAction.loading ? 'Adding…' : `Add ${section.valueLabel}`}
              </button>
            </div>
          </div>
        </div>
      ) : null}
    </section>
  );
}

function ProjectRecipientsSection({ projectCodes, isViewOnly }) {
  const [selectedCode, setSelectedCode] = useState('');
  const [recipients, setRecipients] = useState([]);
  const [loadError, setLoadError] = useState(null);
  const [form, setForm] = useState({ email: '', display_name: '' });
  // In-progress edits per recipient id ({ email, display_name }), before "Save" is clicked.
  const [drafts, setDrafts] = useState({});

  useEffect(() => {
    if (!selectedCode && projectCodes.length > 0) {
      setSelectedCode(projectCodes[0].value);
    }
  }, [projectCodes, selectedCode]);

  const load = async (code) => {
    if (!code) {
      setRecipients([]);
      return;
    }
    try {
      setLoadError(null);
      const res = await adminApi.projectRecipients(code);
      setRecipients(res.data);
    } catch (error) {
      setLoadError(error);
    }
  };
  useEffect(() => {
    load(selectedCode);
  }, [selectedCode]);

  const addAction = useAsyncAction(async () => {
    await adminApi.createProjectRecipient({
      project_code: selectedCode,
      email: form.email.trim(),
      display_name: form.display_name.trim() || null,
    });
    setForm({ email: '', display_name: '' });
    await load(selectedCode);
  });
  const updateAction = useAsyncAction(async (recipient) => {
    const draft = drafts[recipient.id];
    await adminApi.updateProjectRecipient(recipient.id, {
      email: draft.email.trim(),
      display_name: draft.display_name.trim() || null,
    });
    setDrafts((current) => {
      const next = { ...current };
      delete next[recipient.id];
      return next;
    });
    await load(selectedCode);
  });
  const deleteAction = useAsyncAction(async (id) => {
    await adminApi.deleteProjectRecipient(id);
    await load(selectedCode);
  });
  const error = loadError || addAction.error || updateAction.error || deleteAction.error;

  return (
    <section className="panel p-6 mb-6">
      <div className="mb-5 border-b border-line pb-4">
        <h2 className="text-lg font-bold text-slate-900">Project Notification Recipients</h2>
        <p className="text-sm text-slate-500 mt-1">
          When a Project-type request is submitted with a purpose marked &ldquo;Notify project&rdquo; above, everyone
          listed here for that project code gets emailed the traveler and dates — no account on Travora needed.
        </p>
      </div>

      {error ? <div className="mb-4 rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-700">{error.response?.data?.detail || error.message}</div> : null}

      {projectCodes.length === 0 ? (
        <div className="py-4 text-center text-sm text-slate-400 italic">Add a project code above first.</div>
      ) : (
        <>
          <div className="mb-4 max-w-xs">
            <label className="mb-1.5 block text-[12px] font-bold text-slate-600 uppercase tracking-wider">Project Code</label>
            <select className="field w-full text-slate-900" value={selectedCode} onChange={(event) => setSelectedCode(event.target.value)}>
              {projectCodes.map((option) => (
                <option key={option.id} value={option.value}>{option.value}{option.label && option.label !== option.value ? ` — ${option.label}` : ''}</option>
              ))}
            </select>
          </div>

          <div className="space-y-1.5">
            {recipients.map((recipient) => {
              const draft = drafts[recipient.id] ?? { email: recipient.email, display_name: recipient.display_name || '' };
              const patch = (changes) => setDrafts({ ...drafts, [recipient.id]: { ...draft, ...changes } });
              const dirty =
                draft.email.trim() !== '' &&
                (draft.email !== recipient.email || draft.display_name !== (recipient.display_name || ''));
              return (
                <div key={recipient.id} className="flex flex-wrap items-center gap-3 rounded-xl px-3 py-2.5 hover:bg-slate-50 transition-colors">
                  <Mail size={14} className="shrink-0 text-slate-400" />
                  <div className="w-64 shrink-0">
                    <input
                      className="field h-9 text-slate-900"
                      readOnly={isViewOnly}
                      value={draft.email}
                      onChange={(event) => patch({ email: event.target.value })}
                    />
                  </div>
                  <div className="flex-1 min-w-40">
                    <input
                      className="field h-9 text-slate-900"
                      readOnly={isViewOnly}
                      placeholder="Name (optional)"
                      value={draft.display_name}
                      onChange={(event) => patch({ display_name: event.target.value })}
                    />
                  </div>
                  <div className="flex items-center gap-2 shrink-0">
                    {dirty && !isViewOnly ? (
                      <button className="btn-secondary h-8 px-3 text-[11px] font-bold" onClick={() => updateAction.run(recipient)} disabled={updateAction.loading}>
                        <Save size={14} />Save
                      </button>
                    ) : null}
                    {!isViewOnly ? (
                      <button
                        className="flex h-8 w-8 items-center justify-center rounded-lg border border-transparent text-slate-400 transition-all hover:border-red-200 hover:bg-red-50 hover:text-red-600 disabled:opacity-50"
                        onClick={() => deleteAction.run(recipient.id)}
                        disabled={deleteAction.loading}
                        title="Remove"
                      >
                        <Trash size={16} />
                      </button>
                    ) : null}
                  </div>
                </div>
              );
            })}
            {recipients.length === 0 ? (
              <div className="py-4 text-center text-sm text-slate-400 italic">No recipients configured for this project yet.</div>
            ) : null}
          </div>

          {!isViewOnly ? (
            <div className="mt-5 rounded-xl bg-slate-50/70 border border-slate-200/60 p-4">
              <p className="mb-3 text-[11px] font-bold uppercase tracking-wider text-slate-500">Add New</p>
              <div className="grid gap-3 md:grid-cols-12 items-end">
                <div className="md:col-span-4">
                  <label className="mb-1.5 block text-[12px] font-bold text-slate-600 uppercase tracking-wider">Email</label>
                  <input className="field w-full text-slate-900 bg-white" placeholder="e.g. pm@example.com" value={form.email} onChange={(event) => setForm({ ...form, email: event.target.value })} />
                </div>
                <div className="md:col-span-5">
                  <label className="mb-1.5 block text-[12px] font-bold text-slate-600 uppercase tracking-wider">Name (optional)</label>
                  <input className="field w-full text-slate-900 bg-white" placeholder="e.g. Project Manager" value={form.display_name} onChange={(event) => setForm({ ...form, display_name: event.target.value })} />
                </div>
                <div className="md:col-span-3">
                  <button className="btn-primary w-full justify-center h-10 shadow-sm" onClick={addAction.run} disabled={addAction.loading || !form.email.trim()}>
                    {addAction.loading ? 'Adding…' : 'Add Recipient'}
                  </button>
                </div>
              </div>
            </div>
          ) : null}
        </>
      )}
    </section>
  );
}

export default function TravelOptions() {
  useSetPageTitle('Travel Options');
  const [options, setOptions] = useState([]);
  const [loadError, setLoadError] = useState(null);
  // The actual configure_policy permission, not a hardcoded role list — see ImpactLevelMaster.jsx.
  const permissions = useAuthStore((state) => state.profile?.permissions);
  const isViewOnly = !hasPermission(permissions, 'configure_policy');

  const load = async () => {
    try {
      setLoadError(null);
      const response = await adminApi.travelOptions();
      setOptions(response.data);
    } catch (error) {
      setLoadError(error);
    }
  };
  useEffect(() => {
    load();
  }, []);

  return (
    <>
      {loadError ? <div className="mb-4 rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-700">{loadError.response?.data?.detail || loadError.message}</div> : null}
      {SECTIONS.map((section) => (
        <OptionSection
          key={section.type}
          section={section}
          options={options.filter((option) => option.option_type === section.type)}
          isViewOnly={isViewOnly}
          onChanged={load}
        />
      ))}
      <ProjectRecipientsSection
        projectCodes={options.filter((option) => option.option_type === 'PROJECT_CODE' && option.is_active)}
        isViewOnly={isViewOnly}
      />
    </>
  );
}
