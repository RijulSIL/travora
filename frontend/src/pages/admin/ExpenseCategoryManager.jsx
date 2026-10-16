import { ChevronRight, CornerDownRight, Plus } from 'lucide-react';
import { useEffect, useState } from 'react';

import { Pill } from '../../components/approvals/ApprovalQueueParts';
import {
  BTN_MAIN,
  BTN_NO,
  CARD,
  Check,
  ChipInput,
  ErrorNote,
  FIELD,
  LABEL,
  PolicyHead,
  Sheet,
  VersionBar,
  useCanConfigurePolicy,
  usePolicyVersions,
} from '../../components/policy/PolicyAdminParts';
import { useSetPageTitle } from '../../context/PageTitleContext';
import { useAsyncAction } from '../../hooks/useAsyncAction';
import { adminApi } from '../../services/adminApi';

const emptyForm = { name: '', parent_category_id: '', bill_mandatory: false, gst_invoice_required: false, blacklisted_items: [], notes: '' };

function flatten(categories, depth = 0) {
  return categories.flatMap((category) => [{ ...category, depth }, ...flatten(category.children || [], depth + 1)]);
}

/** A category and everything under it, so it can't be moved under itself. */
function subtreeIds(rows, id) {
  const ids = new Set([id]);
  let grew = true;
  while (grew) {
    grew = false;
    rows.forEach((r) => {
      if (r.parent_category_id && ids.has(r.parent_category_id) && !ids.has(r.id)) {
        ids.add(r.id);
        grew = true;
      }
    });
  }
  return ids;
}

function CategorySheet({ category, rows, versionId, versionNumber, readOnly, onSaved, onClose }) {
  const [form, setForm] = useState(emptyForm);
  useEffect(() => {
    setForm(
      category
        ? { name: category.name, parent_category_id: category.parent_category_id || '', bill_mandatory: category.bill_mandatory, gst_invoice_required: category.gst_invoice_required, blacklisted_items: category.blacklisted_items || [], notes: category.notes || '' }
        : emptyForm,
    );
  }, [category]);
  const set = (patch) => setForm((f) => ({ ...f, ...patch }));
  const blocked = category ? subtreeIds(rows, category.id) : new Set();

  const saveAction = useAsyncAction(async () => {
    const payload = {
      ...form,
      name: form.name.trim(),
      parent_category_id: form.parent_category_id ? Number(form.parent_category_id) : null,
      policy_version_id: versionId,
      notes: form.notes.trim() || null,
    };
    if (category) await adminApi.updateExpenseCategory(category.id, payload);
    else await adminApi.createExpenseCategory(payload);
    await onSaved(category ? category.id : null);
  });
  const offAction = useAsyncAction(async () => {
    await adminApi.deactivateExpenseCategory(category.id);
    await onSaved(null);
  });

  return (
    <Sheet
      label="Category details"
      title={category ? `${readOnly ? '' : 'Edit '}${category.name}` : 'Add a category'}
      sub={readOnly ? 'Read-only in this version' : `In draft ${versionNumber}`}
      onClose={category ? onClose : null}
      footer={
        readOnly ? null : (
          <>
            {category ? (
              <button type="button" className={BTN_NO} disabled={offAction.loading} title="People can no longer claim under it in this version" onClick={() => offAction.run().catch(() => {})}>
                Turn off
              </button>
            ) : null}
            <button type="button" className={BTN_MAIN} disabled={!form.name.trim() || saveAction.loading} onClick={() => saveAction.run().catch(() => {})}>
              {saveAction.loading ? 'Saving…' : category ? 'Save category' : 'Add category'}
            </button>
          </>
        )
      }
    >
      <ErrorNote error={saveAction.error || offAction.error} />
      <div>
        <label className={LABEL} htmlFor="cat-name">
          Name
        </label>
        <input id="cat-name" className={FIELD} readOnly={readOnly} placeholder="e.g. Parking" value={form.name} onChange={(e) => set({ name: e.target.value })} />
      </div>
      <div>
        <label className={LABEL} htmlFor="cat-parent">
          Sits under
        </label>
        <select id="cat-parent" className={FIELD} disabled={readOnly} value={form.parent_category_id} onChange={(e) => set({ parent_category_id: e.target.value })}>
          <option value="">Nothing (top level)</option>
          {rows
            .filter((r) => !blocked.has(r.id))
            .map((r) => (
              <option key={r.id} value={r.id}>
                {`${'— '.repeat(r.depth)}${r.name}`}
              </option>
            ))}
        </select>
      </div>
      <Check checked={form.bill_mandatory} onChange={(v) => set({ bill_mandatory: v })} disabled={readOnly} title="Bill needed" hint="A receipt or invoice must be attached" />
      <Check checked={form.gst_invoice_required} onChange={(v) => set({ gst_invoice_required: v })} disabled={readOnly} title="GST invoice needed" hint="The bill must be a GST invoice" />
      <div>
        <span className={LABEL}>
          Never allowed <small className="font-medium text-slate-400">(blocked items)</small>
        </span>
        <ChipInput label="Add a blocked item" items={form.blacklisted_items} onChange={(items) => set({ blacklisted_items: items })} disabled={readOnly} placeholder="Add, then Enter" />
      </div>
      <div>
        <label className={LABEL} htmlFor="cat-notes">
          Note for employees <small className="font-medium text-slate-400">(optional)</small>
        </label>
        <input id="cat-notes" className={FIELD} readOnly={readOnly} placeholder="e.g. Book at least 7 days ahead" value={form.notes} onChange={(e) => set({ notes: e.target.value })} />
      </div>
    </Sheet>
  );
}

export default function ExpenseCategoryManager() {
  useSetPageTitle('Expense Categories');
  const canConfigure = useCanConfigurePolicy();
  const { versions, version, versionId, setVersionId, error: versionsError } = usePolicyVersions();
  const [categories, setCategories] = useState([]);
  const [loadError, setLoadError] = useState(null);
  const [selected, setSelected] = useState(null);
  const readOnly = !canConfigure || version?.status !== 'DRAFT';

  const load = async () => {
    if (!versionId) return;
    try {
      setLoadError(null);
      setCategories((await adminApi.expenseCategories({ policy_version_id: versionId })).data);
    } catch (error) {
      setLoadError(error);
    }
  };
  useEffect(() => {
    setSelected(null);
    load();
  }, [versionId]);

  const rows = flatten(categories).filter((c) => c.policy_version_id === versionId);
  const category = rows.find((c) => c.id === selected) || null;

  return (
    <section className="flex flex-col gap-3.5">
      <PolicyHead title="Expense categories" sub="What people can claim, what proof each needs, and what's never allowed in it. Sub-categories sit under their parent.">
        {!readOnly ? (
          <button type="button" className={BTN_MAIN} onClick={() => setSelected(null)}>
            <Plus size={15} />
            Add category
          </button>
        ) : null}
      </PolicyHead>
      <VersionBar versions={versions} versionId={versionId} onSelect={setVersionId} canConfigure={canConfigure} />
      <ErrorNote error={versionsError || loadError} />
      <div className="grid items-start gap-3.5 lg:grid-cols-[minmax(0,1fr)_380px]">
        <section aria-label="Categories" className={CARD}>
          {rows.map((c) => {
            const on = c.id === selected;
            return (
              <button
                key={c.id}
                type="button"
                aria-pressed={on}
                onClick={() => setSelected(c.id)}
                className={`grid w-full grid-cols-[minmax(0,1fr)_16px] items-center gap-3 border-t border-slate-100 px-4 py-[11px] text-left first:border-t-0 hover:bg-[#fbfdfc] ${on ? 'bg-[#f4faf7] shadow-[inset_3px_0_0] shadow-brand' : ''}`}
              >
                <span className="min-w-0" style={{ paddingLeft: `${c.depth * 22}px` }}>
                  <b className="flex items-center gap-1.5 text-[13.5px] text-ink">
                    {c.depth ? <CornerDownRight size={13} className="text-slate-400" /> : null}
                    {c.name}
                  </b>
                  <span className="mt-[5px] flex flex-wrap items-center gap-[5px]">
                    {c.bill_mandatory ? <Pill tone="sky">Bill needed</Pill> : <Pill>No bill needed</Pill>}
                    {c.gst_invoice_required ? <Pill tone="violet">GST invoice</Pill> : null}
                    {(c.blacklisted_items || []).map((b) => (
                      <Pill key={b} tone="rose">
                        ✕ {b}
                      </Pill>
                    ))}
                    {c.notes ? <span className="text-xs text-slate-500">{c.notes}</span> : null}
                  </span>
                </span>
                <ChevronRight size={15} className="text-slate-400" />
              </button>
            );
          })}
          {versionId && rows.length === 0 && !loadError ? <p className="px-4 py-6 text-center text-[13px] text-slate-500">No categories in this version yet.</p> : null}
        </section>
        {readOnly && !category ? (
          <aside className={`${CARD} px-4 py-6 text-center text-[13px] text-slate-500`}>Pick a category to see what it needs.</aside>
        ) : (
          <CategorySheet
            category={category}
            rows={rows}
            versionId={versionId}
            versionNumber={version?.version_number}
            readOnly={readOnly}
            onClose={() => setSelected(null)}
            onSaved={async (id) => {
              await load();
              setSelected(id);
            }}
          />
        )}
      </div>
    </section>
  );
}
