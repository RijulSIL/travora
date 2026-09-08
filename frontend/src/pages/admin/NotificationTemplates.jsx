import { Fragment, useCallback, useEffect, useState } from 'react';

import PageHeader from '../../components/ui/PageHeader';
import { useSetPageTitle } from '../../context/PageTitleContext';
import { useAsyncAction } from '../../hooks/useAsyncAction';
import { adminApi } from '../../services/adminApi';
import { selectResolvedRole, useAuthStore } from '../../store/authStore';

export default function NotificationTemplates() {
  useSetPageTitle('Notification Templates');
  const role = useAuthStore(selectResolvedRole);
  const canEdit = role === 'IT_ADMIN';
  const [templates, setTemplates] = useState([]);
  const [editingId, setEditingId] = useState(null);
  const [editForm, setEditForm] = useState({ subject: '', body_text: '' });
  const [loadError, setLoadError] = useState(null);

  const load = useCallback(async () => {
    try {
      setLoadError(null);
      const res = await adminApi.notificationTemplates();
      setTemplates(res.data || []);
    } catch (error) {
      setLoadError(error);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  const saveAction = useAsyncAction(async () => {
    await adminApi.updateNotificationTemplate(editingId, editForm);
    setEditingId(null);
    await load();
  });

  const error = loadError;

  return (
    <>
      <PageHeader title="" />
      {error ? (
        <div className="mb-4 rounded border border-red-200 bg-red-50 p-3 text-sm text-red-700">
          {error.response?.data?.detail || error.message}
        </div>
      ) : null}
      <section className="panel table-contain mt-4 overflow-hidden rounded">
        <table className="w-full text-left text-sm">
          <thead className="bg-slate-50 text-[11px] font-bold uppercase tracking-wider text-slate-500">
            <tr>
              <th className="px-4 py-3">Key</th>
              <th className="px-4 py-3">Channel</th>
              <th className="px-4 py-3">Subject</th>
              <th className="px-4 py-3">Body Preview</th>
              <th className="px-4 py-3">Updated</th>
              <th className="px-4 py-3 text-right">Actions</th>
            </tr>
          </thead>
          <tbody>
            {templates.map((template) => (
              <Fragment key={template.id}>
                <tr className="border-t border-line hover:bg-slate-50/50 transition-colors">
                  <td className="px-4 py-3 font-semibold text-slate-700">{template.template_key}</td>
                  <td className="px-4 py-3">
                    <span className="inline-flex items-center rounded-full bg-slate-100 px-2 py-0.5 text-[11px] font-bold text-slate-600 ring-1 ring-inset ring-slate-500/20">{template.channel}</span>
                  </td>
                  <td className="max-w-[240px] px-4 py-3 text-slate-600 truncate" title={template.subject}>
                    {template.subject || '—'}
                  </td>
                  <td className="max-w-[320px] px-4 py-3 text-slate-600 truncate" title={template.body_text}>
                    {template.body_text || '—'}
                  </td>
                  <td className="px-4 py-3 text-slate-500 text-xs">
                    {template.updated_at
                      ? new Date(template.updated_at).toLocaleDateString()
                      : '—'}
                  </td>
                  <td className="px-4 py-3 text-right">
                    {canEdit && (
                      <button
                        type="button"
                        className="inline-flex items-center justify-center rounded bg-white px-2.5 py-1.5 text-xs font-semibold text-slate-700 shadow-sm ring-1 ring-inset ring-slate-300 hover:bg-slate-50 transition-all"
                        onClick={() => {
                          setEditingId(template.id);
                          setEditForm({ subject: template.subject, body_text: template.body_text });
                        }}
                      >
                        Edit
                      </button>
                    )}
                  </td>
                </tr>
                {editingId === template.id ? (
                  <tr className="border-t border-line bg-slate-50/80">
                    <td colSpan={6} className="p-4">
                      <div className="bg-white p-4 rounded-lg border border-slate-200 shadow-sm">
                        <div className="mb-4 pb-3 border-b border-slate-100 flex items-center justify-between">
                          <h4 className="font-semibold text-slate-800 text-sm">Editing <span className="text-brand">{template.template_key}</span></h4>
                        </div>
                        <div className="grid gap-4 md:grid-cols-3">
                          <label className="text-sm md:col-span-1">
                            <span className="mb-1.5 block font-medium text-slate-700">Subject</span>
                            <input
                              className="field w-full"
                              value={editForm.subject}
                              onChange={(e) => setEditForm({ ...editForm, subject: e.target.value })}
                            />
                          </label>
                          <label className="text-sm md:col-span-2">
                            <span className="mb-1.5 block font-medium text-slate-700">Body text</span>
                            <textarea
                              className="field w-full min-h-[8rem] resize-y"
                              value={editForm.body_text}
                              onChange={(e) => setEditForm({ ...editForm, body_text: e.target.value })}
                            />
                          </label>
                        </div>
                        <div className="mt-4 flex items-center gap-2 justify-end">
                          <button
                            type="button"
                            className="btn-secondary px-4 py-1.5 text-sm"
                            onClick={() => setEditingId(null)}
                          >
                            Cancel
                          </button>
                          <button
                            type="button"
                            className="btn-primary px-4 py-1.5 text-sm"
                            onClick={saveAction.run}
                            disabled={saveAction.loading}
                          >
                            {saveAction.loading ? 'Saving…' : 'Save Template'}
                          </button>
                        </div>
                        {saveAction.error ? (
                          <div className="mt-3 text-sm text-red-700 p-2 bg-red-50 rounded border border-red-100">
                            {saveAction.error.response?.data?.detail || saveAction.error.message}
                          </div>
                        ) : null}
                      </div>
                    </td>
                  </tr>
                ) : null}
              </Fragment>
            ))}
          </tbody>
        </table>
      </section>
    </>
  );
}
