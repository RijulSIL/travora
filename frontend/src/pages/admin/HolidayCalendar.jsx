import { Save, Trash2 } from 'lucide-react';
import { useCallback, useEffect, useState } from 'react';

import PageHeader from '../../components/ui/PageHeader';
import { useSetPageTitle } from '../../context/PageTitleContext';
import { useAsyncAction } from '../../hooks/useAsyncAction';
import { adminApi } from '../../services/adminApi';

const emptyForm = { holiday_date: '', name: '' };

function formatApiError(err) {
  if (!err) return '';
  const d = err.response?.data?.detail;
  if (typeof d === 'string') return d;
  if (Array.isArray(d)) return d.map((x) => x?.msg || JSON.stringify(x)).join('; ') || err.message;
  return err.message;
}

export default function HolidayCalendar() {
  useSetPageTitle('Holiday Calendar');
  const [rows, setRows] = useState([]);
  const [form, setForm] = useState(emptyForm);
  const [editingId, setEditingId] = useState(null);
  const [loadError, setLoadError] = useState(null);

  const load = useCallback(async () => {
    try {
      setLoadError(null);
      const res = await adminApi.holidays();
      setRows(res.data || []);
    } catch (err) {
      setLoadError(err);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  const saveAction = useAsyncAction(async () => {
    const name = String(form.name || '').trim();
    if (!form.holiday_date || !name) {
      throw new Error('Date and name are required');
    }
    if (editingId != null) {
      await adminApi.updateHoliday(editingId, { holiday_date: form.holiday_date, name });
    } else {
      await adminApi.createHoliday({ holiday_date: form.holiday_date, name });
    }
    setForm(emptyForm);
    setEditingId(null);
    await load();
  });

  const deleteAction = useAsyncAction(async (id) => {
    await adminApi.deleteHoliday(id);
    if (editingId === id) {
      setEditingId(null);
      setForm(emptyForm);
    }
    await load();
  });

  const displayError = loadError || saveAction.error || deleteAction.error;

  return (
    <>
      <PageHeader
        title=""
        actions={
          <button
            type="button"
            className="btn-primary"
            onClick={() => saveAction.run()}
            disabled={saveAction.loading}
          >
            <Save size={17} />
            {editingId != null ? (saveAction.loading ? 'Saving…' : 'Save holiday') : saveAction.loading ? 'Adding…' : 'Add holiday'}
          </button>
        }
      />
      {displayError ? (
        <div className="mb-4 rounded border border-red-200 bg-red-50 p-3 text-sm text-red-700">
          {formatApiError(displayError)}
        </div>
      ) : null}

      <section className="panel rounded p-5">
        <div className="mb-4 pb-3 border-b border-slate-100 flex items-center justify-between">
          <h2 className="text-base font-semibold text-slate-800">{editingId != null ? 'Edit Holiday' : 'Add New Holiday'}</h2>
          {editingId != null && (
            <button
              type="button"
              className="text-xs font-medium text-slate-500 hover:text-slate-800 transition-colors"
              onClick={() => {
                setEditingId(null);
                setForm(emptyForm);
              }}
            >
              Cancel Edit
            </button>
          )}
        </div>
        <div className="grid gap-4 md:grid-cols-3 items-end">
          <label className="text-sm">
            <span className="mb-1.5 block font-medium text-slate-700">Date</span>
            <input
              className="field w-full py-2"
              type="date"
              value={form.holiday_date}
              onChange={(e) => setForm({ ...form, holiday_date: e.target.value })}
            />
          </label>
          <label className="text-sm md:col-span-2">
            <span className="mb-1.5 block font-medium text-slate-700">Holiday Name</span>
            <input
              className="field w-full py-2"
              value={form.name}
              onChange={(e) => setForm({ ...form, name: e.target.value })}
              placeholder="e.g. Republic Day"
            />
          </label>
        </div>
      </section>

      <section className="panel mt-4 rounded p-4">
        <h2 className="mb-4 text-base font-semibold text-ink">Scheduled Holidays</h2>
        <div className="overflow-hidden rounded border border-slate-200">
          <table className="w-full text-sm">
            <thead className="bg-slate-50 text-[11px] font-bold uppercase tracking-wider text-slate-500">
              <tr>
                <th className="px-4 py-3 text-left">Date</th>
                <th className="px-4 py-3 text-left">Name</th>
                <th className="px-4 py-3 text-right">Actions</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((row) => (
                <tr key={row.id} className="border-t border-line hover:bg-slate-50/50 transition-colors group">
                  <td className="px-4 py-3 text-slate-600">{new Date(row.holiday_date).toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' })}</td>
                  <td className="px-4 py-3 font-semibold text-slate-800">{row.name}</td>
                  <td className="px-4 py-3">
                    <div className="flex items-center justify-end gap-1.5 opacity-0 group-hover:opacity-100 transition-opacity">
                      <button
                        type="button"
                        className="inline-flex items-center justify-center rounded bg-white px-2.5 py-1.5 text-xs font-semibold text-slate-700 shadow-sm ring-1 ring-inset ring-slate-300 hover:bg-slate-50 transition-all"
                        title="Edit Holiday"
                        onClick={() => {
                          setEditingId(row.id);
                          setForm({ holiday_date: row.holiday_date, name: row.name });
                        }}
                      >
                        Edit
                      </button>
                      <button
                        type="button"
                        className="inline-flex items-center justify-center rounded bg-white p-1.5 text-slate-400 shadow-sm ring-1 ring-inset ring-slate-300 hover:bg-red-50 hover:text-red-600 disabled:opacity-50 transition-all"
                        disabled={deleteAction.loading}
                        title="Delete Holiday"
                        onClick={() => deleteAction.run(row.id)}
                      >
                        <Trash2 size={15} />
                      </button>
                    </div>
                  </td>
                </tr>
              ))}
              {rows.length === 0 ? (
                <tr>
                  <td colSpan={3} className="px-4 py-8 text-center text-slate-500">
                    No holidays defined yet.
                  </td>
                </tr>
              ) : null}
            </tbody>
          </table>
        </div>
      </section>
    </>
  );
}
