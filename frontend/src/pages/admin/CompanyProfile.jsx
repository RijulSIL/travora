import { Save } from 'lucide-react';
import { useEffect, useState } from 'react';

import PageHeader from '../../components/ui/PageHeader';
import { useSetPageTitle } from '../../context/PageTitleContext';
import { useAsyncAction } from '../../hooks/useAsyncAction';
import { adminApi } from '../../services/adminApi';

export default function CompanyProfile() {
  useSetPageTitle('Company Profile');
  const [form, setForm] = useState({
    company_name: '',
    gstins: '',
    office_locations: '',
    bank_details: { account_name: '', account_number: '', ifsc: '' },
  });
  const [loadError, setLoadError] = useState(null);

  useEffect(() => {
    adminApi.companyProfile()
      .then((response) => {
        if (!response.data) return;
        setForm({
          company_name: response.data.company_name,
          gstins: response.data.gstins.join(', '),
          office_locations: response.data.office_locations.join(', '),
          bank_details: response.data.bank_details || { account_name: '', account_number: '', ifsc: '' },
        });
      })
      .catch((error) => setLoadError(error));
  }, []);

  const saveAction = useAsyncAction(async () => {
    await adminApi.updateCompanyProfile({
      ...form,
      gstins: form.gstins.split(',').map((item) => item.trim()).filter(Boolean),
      office_locations: form.office_locations.split(',').map((item) => item.trim()).filter(Boolean),
    });
  });
  const error = loadError || saveAction.error;

  return (
    <>
      <PageHeader
        title="Company Profile"
        actions={
          <button type="button" className="btn-primary" onClick={saveAction.run} disabled={saveAction.loading}>
            <Save size={16} />
            {saveAction.loading ? 'Saving...' : 'Save Changes'}
          </button>
        }
      />
      {error ? <div className="mb-4 rounded border border-red-200 bg-red-50 p-3 text-sm text-red-700">{error.response?.data?.detail || error.message}</div> : null}
      
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6 w-full">
        <section className="panel rounded-lg p-6">
          <div className="mb-6 border-b border-line pb-4">
            <h2 className="text-lg font-bold text-slate-900">General Information</h2>
            <p className="text-sm text-slate-500 mt-1">Manage primary business details, tax identifiers, and official office locations.</p>
          </div>
          
          <div className="grid gap-6">
            <div>
              <label className="mb-1.5 block text-sm font-semibold text-slate-700">Company Name</label>
              <input className="field w-full text-slate-900" placeholder="Enter official company name" value={form.company_name} onChange={(event) => setForm({ ...form, company_name: event.target.value })} />
            </div>
            <div>
              <label className="mb-1.5 block text-sm font-semibold text-slate-700">GSTINs <span className="font-normal text-slate-400">(Comma separated)</span></label>
              <input className="field w-full text-slate-900" placeholder="e.g. 27AAAAA0000A1Z5" value={form.gstins} onChange={(event) => setForm({ ...form, gstins: event.target.value })} />
            </div>
            <div>
              <label className="mb-1.5 block text-sm font-semibold text-slate-700">Office Locations <span className="font-normal text-slate-400">(Comma separated)</span></label>
              <input className="field w-full text-slate-900" placeholder="e.g. Bengaluru, Mumbai, Delhi" value={form.office_locations} onChange={(event) => setForm({ ...form, office_locations: event.target.value })} />
              <p className="mt-1.5 text-[11px] text-slate-500">These locations will dynamically populate the dropdown menus across the platform.</p>
            </div>
          </div>
        </section>

        <section className="panel rounded-lg p-6">
          <div className="mb-6 border-b border-line pb-4">
            <h2 className="text-lg font-bold text-slate-900">Bank Details</h2>
            <p className="text-sm text-slate-500 mt-1">Primary banking information used for reimbursements and official transfers.</p>
          </div>
          
          <div className="grid gap-6">
            <div>
              <label className="mb-1.5 block text-sm font-semibold text-slate-700">Account Name</label>
              <input className="field w-full text-slate-900" placeholder="Name on account" value={form.bank_details.account_name} onChange={(event) => setForm({ ...form, bank_details: { ...form.bank_details, account_name: event.target.value } })} />
            </div>
            <div>
              <label className="mb-1.5 block text-sm font-semibold text-slate-700">Account Number</label>
              <input className="field w-full font-mono text-sm text-slate-900" placeholder="000000000000" value={form.bank_details.account_number} onChange={(event) => setForm({ ...form, bank_details: { ...form.bank_details, account_number: event.target.value } })} />
            </div>
            <div>
              <label className="mb-1.5 block text-sm font-semibold text-slate-700">IFSC Code</label>
              <input className="field w-full font-mono text-sm uppercase text-slate-900" placeholder="ABCD0001234" value={form.bank_details.ifsc} onChange={(event) => setForm({ ...form, bank_details: { ...form.bank_details, ifsc: event.target.value } })} />
            </div>
          </div>
        </section>
      </div>
    </>
  );
}
