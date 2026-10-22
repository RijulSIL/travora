import { useCallback, useEffect, useRef, useState } from 'react';

import { Pill } from '../../components/approvals/ApprovalQueueParts';
import { BTN_GHOST, BTN_MAIN, CARD, EYEBROW, ErrorNote, FIELD, LABEL, PolicyHead } from '../../components/policy/PolicyAdminParts';
import Skeleton from '../../components/ui/Skeleton';
import { useSetPageTitle } from '../../context/PageTitleContext';
import useToast from '../../hooks/useToast';
import { adminApi } from '../../services/adminApi';
import { hasPermission } from '../../services/permissions';
import { useAuthStore } from '../../store/authStore';

/*
 * The wording of the emails Travora sends. Each template says when it's sent and to whom, and
 * editing shows its placeholders (click to insert) and a live preview with example values.
 * Templates the app doesn't send yet (claim_submitted, payment_confirmed — those emails still use
 * fixed wording in the code) aren't shown, since editing them would change nothing.
 */
const NOT_SENT = new Set(['claim_submitted', 'payment_confirmed']);
const INFO = {
  user_welcome: {
    name: 'Welcome email',
    when: 'Sent to a new person when they’re added (Add user or CSV import), and when you click Resend.',
    extra: 'Their sign-in details (email, temporary password, role, department, manager) and a Sign in button are always added below your message.',
    to: 'rohan.malhotra@example.com',
    vars: {
      name: 'Rohan Malhotra',
      first_name: 'Rohan',
      email: 'rohan.malhotra@example.com',
      temporary_password: 'Welcome@123',
      role: 'Employee',
      department: 'Human Resources',
      manager: 'Ishita Kapoor',
      company_name: 'Simon India Limited',
      login_link: 'https://travora.example.com/login',
    },
  },
  project_site_visit: {
    name: 'Project site visit',
    when: 'Sent to a project’s contacts (set in Travel options) once a project trip is booked, for trip purposes marked to notify them.',
    to: 'site.contact@example.com',
    vars: {
      employee_name: 'Rijul Narang',
      project_code: 'PRJ-204',
      from_city: 'Delhi',
      to_city: 'Mumbai',
      start_date: '2026-11-03',
      end_date: '2026-11-05',
      purpose: 'Project Site Visit',
    },
  },
};
const infoOf = (t) => INFO[t.template_key] || { name: t.template_key, when: '', to: 'someone@example.com', vars: null };
const reducedMotion = () => window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;

const PLACEHOLDER = /\{\{\s*(\w+)\s*\}\}/g;
const day = (v) => (v ? new Date(v).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' }) : '—');
const errorText = (err, fallback) => {
  const detail = err?.response?.data?.detail;
  return typeof detail === 'string' ? detail : fallback;
};

/** Text with its placeholders filled from `vars`; unknown ones are highlighted as they'd go out. */
function Filled({ text, vars }) {
  const parts = [];
  let last = 0;
  for (const m of text.matchAll(PLACEHOLDER)) {
    parts.push(text.slice(last, m.index));
    const known = vars && m[1] in vars;
    parts.push(
      known ? (
        vars[m[1]]
      ) : (
        <mark key={m.index} className="rounded bg-amber-100 px-0.5 text-amber-800">
          {m[0]}
        </mark>
      ),
    );
    last = m.index + m[0].length;
  }
  parts.push(text.slice(last));
  return <>{parts}</>;
}

export default function NotificationTemplates() {
  useSetPageTitle('Notification Templates');
  const { showToast } = useToast();
  const permissions = useAuthStore((s) => s.profile?.permissions);
  const canEdit = hasPermission(permissions, 'edit_notification_templates');
  const [templates, setTemplates] = useState(null);
  const [loadError, setLoadError] = useState(null);
  const [selectedId, setSelectedId] = useState(null);
  const [draft, setDraft] = useState(null); // { subject, body_text } while editing
  const [saving, setSaving] = useState(false);
  const [savedNote, setSavedNote] = useState(false);
  const focused = useRef('body_text');
  const subjectRef = useRef(null);
  const bodyRef = useRef(null);
  const panelRef = useRef(null);
  // 'enter' (slide in) the first time the panel shows, 'swap' after that.
  const [panelAnim, setPanelAnim] = useState(() => (reducedMotion() ? 'swap' : 'enter'));

  const load = useCallback(async () => {
    try {
      setLoadError(null);
      const res = await adminApi.notificationTemplates();
      // Only templates the app actually sends, newest first.
      const rows = (res.data || []).filter((t) => !NOT_SENT.has(t.template_key)).sort((a, b) => b.id - a.id);
      setTemplates(rows);
      setSelectedId((current) => current ?? rows[0]?.id ?? null);
    } catch (error) {
      setLoadError(error);
      setTemplates((t) => t || []);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  const selected = (templates || []).find((t) => t.id === selectedId) || null;
  const info = selected ? infoOf(selected) : null;
  const subject = draft ? draft.subject : selected?.subject || '';
  const body = draft ? draft.body_text : selected?.body_text || '';
  const unknown = info?.vars ? [...new Set([...`${subject} ${body}`.matchAll(PLACEHOLDER)].map((m) => m[1]).filter((k) => !(k in info.vars)))] : [];
  const changed = Boolean(draft && selected && (draft.subject !== selected.subject || draft.body_text !== selected.body_text));

  const choose = (t) => {
    if (t.id !== selectedId) setPanelAnim('swap');
    setSelectedId(t.id);
    setDraft(null);
    setSavedNote(false);
    // On narrow screens the panel sits below the list: bring it into view.
    requestAnimationFrame(() => {
      const el = panelRef.current;
      if (el && el.getBoundingClientRect().top > window.innerHeight - 120) el.scrollIntoView({ behavior: 'smooth', block: 'start' });
    });
  };

  const insert = (name) => {
    const field = focused.current;
    const el = field === 'subject' ? subjectRef.current : bodyRef.current;
    const token = `{{${name}}}`;
    const value = draft[field];
    const start = el?.selectionStart ?? value.length;
    const end = el?.selectionEnd ?? start;
    setDraft({ ...draft, [field]: value.slice(0, start) + token + value.slice(end) });
    requestAnimationFrame(() => {
      el?.focus();
      el?.setSelectionRange(start + token.length, start + token.length);
    });
  };

  const save = async () => {
    setSaving(true);
    try {
      await adminApi.updateNotificationTemplate(selected.id, { subject: draft.subject, body_text: draft.body_text });
      await load();
      setDraft(null);
      setSavedNote(true);
      showToast(`${info.name} saved.`, 'success');
    } catch (err) {
      showToast(errorText(err, 'Could not save the template.'), 'error');
    } finally {
      setSaving(false);
    }
  };

  return (
    <section className="flex flex-col gap-3.5">
      <PolicyHead title="Notification templates" sub="The wording of the emails Travora sends. Changes apply to the next email sent." />
      <ErrorNote error={loadError} />

      {templates === null ? (
        <div className={`${CARD} p-4`}>
          <Skeleton variant="table" rows={4} columns={1} />
        </div>
      ) : !templates.length ? (
        <p className={`${CARD} px-4 py-8 text-center text-[13px] text-slate-500`}>No templates yet.</p>
      ) : (
        <div className="grid items-start gap-3.5 lg:grid-cols-[minmax(0,0.85fr)_minmax(0,1.15fr)]">
          <div className="flex flex-col gap-2.5" aria-label="Templates">
            {templates.map((t) => {
              const ti = infoOf(t);
              const on = t.id === selectedId;
              return (
                <button
                  key={t.id}
                  type="button"
                  aria-current={on || undefined}
                  onClick={() => choose(t)}
                  className={`flex w-full flex-col gap-2 rounded-[14px] border border-l-[3px] px-4 py-[13px] text-left ${
                    on ? 'border-slate-200 border-l-brand bg-[#f4faf7]' : 'border-slate-200 border-l-transparent bg-white hover:bg-slate-50'
                  }`}
                >
                  <span>
                    <b className="text-sm text-ink">{ti.name}</b>
                    <code className="ml-1.5 font-mono text-[11px] text-slate-400">{t.template_key}</code>
                  </span>
                  {ti.when ? <span className="text-xs leading-relaxed text-slate-500">{ti.when}</span> : null}
                  <span className="text-[12.5px] font-semibold text-ink">{t.subject || '—'}</span>
                  <span className="truncate text-xs text-slate-500">{(t.body_text || '').replace(/\s+/g, ' ')}</span>
                  <span className="text-[11.5px] text-slate-400">
                    {t.channel === 'EMAIL' ? 'Email' : t.channel} · last changed {day(t.updated_at)}
                  </span>
                </button>
              );
            })}
          </div>

          {selected ? (
            <aside
              // A new key per template / mode replays the animation: slide in the first time,
              // a quick swap when switching template or starting an edit.
              key={`${selected.id}-${draft ? 'edit' : 'view'}`}
              ref={panelRef}
              aria-label={`${info.name} template`}
              className={`${CARD} scroll-mt-20 origin-top motion-reduce:animate-none lg:sticky lg:top-[calc(var(--app-nav-h,56px)+12px)] lg:origin-right ${
                panelAnim === 'swap' ? 'animate-sheet-swap' : 'animate-sheet-up lg:animate-sheet-in'
              }`}
            >
              <div className="border-b border-slate-100 px-4 py-3">
                <b className="block text-sm text-ink">
                  {draft ? 'Edit ' : ''}
                  {info.name}
                </b>
                {info.when ? <span className="block text-xs text-slate-500">{info.when}</span> : null}
              </div>
              <div className="flex flex-col gap-3 px-4 py-3.5">
                {draft ? (
                  <>
                    <label className="block">
                      <span className={LABEL}>Subject</span>
                      <input
                        ref={subjectRef}
                        className={FIELD}
                        value={draft.subject}
                        onFocus={() => (focused.current = 'subject')}
                        onChange={(e) => setDraft({ ...draft, subject: e.target.value })}
                      />
                    </label>
                    <label className="block">
                      <span className={LABEL}>Message</span>
                      <textarea
                        ref={bodyRef}
                        className={`${FIELD} h-auto min-h-[190px] resize-y py-2 leading-relaxed`}
                        value={draft.body_text}
                        onFocus={() => (focused.current = 'body_text')}
                        onChange={(e) => setDraft({ ...draft, body_text: e.target.value })}
                      />
                    </label>
                    {info.vars ? (
                      <div>
                        <span className="text-[11.5px] text-slate-500">Placeholders — click to add where your cursor is:</span>
                        <div className="mt-1.5 flex flex-wrap gap-[5px]">
                          {Object.keys(info.vars).map((k) => (
                            <button
                              key={k}
                              type="button"
                              onMouseDown={(e) => e.preventDefault()}
                              onClick={() => insert(k)}
                              className="rounded-md bg-brand/10 px-[7px] py-[3px] font-mono text-[11px] font-semibold text-brand hover:bg-brand/15"
                            >
                              {`{{${k}}}`}
                            </button>
                          ))}
                        </div>
                      </div>
                    ) : null}
                    {unknown.length ? (
                      <div role="alert" className="rounded-[10px] border border-amber-300 bg-amber-50 px-3 py-2 text-xs leading-relaxed text-amber-900">
                        {unknown.map((u, i) => (
                          <span key={u}>
                            {i ? ', ' : ''}
                            <span className="font-mono">{`{{${u}}}`}</span>
                          </span>
                        ))}{' '}
                        {unknown.length === 1 ? 'isn’t a placeholder' : 'aren’t placeholders'} for this email — {unknown.length === 1 ? 'it' : 'they'}’d go out exactly as
                        typed. Check the spelling against the list above.
                      </div>
                    ) : null}
                  </>
                ) : null}

                <div>
                  <div className={`${EYEBROW} mb-1.5`}>Preview{info.vars ? ' · example values' : ''}</div>
                  <div className="overflow-hidden rounded-xl border border-slate-200">
                    <div className="grid grid-cols-[56px_minmax(0,1fr)] gap-x-2 gap-y-0.5 border-b border-slate-200 bg-slate-50 px-3 py-2 text-xs">
                      <span className="text-slate-400">To</span>
                      <b className="truncate font-bold text-ink">{info.to}</b>
                      <span className="text-slate-400">Subject</span>
                      <b className="font-bold text-ink">
                        <Filled text={subject} vars={info.vars} />
                      </b>
                    </div>
                    <div className="whitespace-pre-wrap px-3.5 py-3 font-[Arial,Helvetica,sans-serif] text-[13px] leading-relaxed text-slate-700">
                      <Filled text={body} vars={info.vars} />
                    </div>
                    {info.extra ? (
                      <div className="mx-3.5 mb-3 rounded-lg border border-dashed border-slate-200 px-2.5 py-2 text-[11.5px] text-slate-500">{info.extra}</div>
                    ) : null}
                  </div>
                </div>
                {savedNote && !draft ? (
                  <div className="rounded-[10px] border border-emerald-200 bg-emerald-50 px-3 py-2 text-xs text-emerald-800">✓ Saved. The next email uses this wording.</div>
                ) : null}
              </div>
              <div className="flex flex-wrap items-center justify-between gap-2 border-t border-slate-100 bg-slate-50 px-4 py-[11px]">
                {draft ? (
                  <>
                    <span className="text-xs text-slate-500">{changed ? 'Unsaved changes' : 'No changes yet'}</span>
                    <span className="flex gap-2">
                      <button type="button" className={BTN_GHOST} onClick={() => setDraft(null)} disabled={saving}>
                        Cancel
                      </button>
                      <button type="button" className={BTN_MAIN} onClick={save} disabled={!changed || unknown.length > 0 || saving}>
                        {saving ? 'Saving…' : 'Save template'}
                      </button>
                    </span>
                  </>
                ) : (
                  <>
                    <span className="text-xs text-slate-500">Last changed {day(selected.updated_at)}</span>
                    {canEdit ? (
                      <button
                        type="button"
                        className={BTN_MAIN}
                        onClick={() => {
                          setPanelAnim('swap');
                          setDraft({ subject: selected.subject || '', body_text: selected.body_text || '' });
                          setSavedNote(false);
                        }}
                      >
                        Edit
                      </button>
                    ) : (
                      <Pill tone="slate">View only</Pill>
                    )}
                  </>
                )}
              </div>
            </aside>
          ) : null}
        </div>
      )}
    </section>
  );
}
