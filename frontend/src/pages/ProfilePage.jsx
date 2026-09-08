import { useState, useEffect } from 'react';
import { Users, Search, Calendar, Trash2, Plus, AlertCircle, Shield } from 'lucide-react';
import { format } from 'date-fns';

import { useAuthStore } from '../store/authStore';
import { useSetPageTitle } from '../context/PageTitleContext';
import { reimbursementApi } from '../services/reimbursementApi';
import api from '../services/api';
import useToast from '../hooks/useToast';



export default function ProfilePage() {
  useSetPageTitle('My Profile');
  const profile = useAuthStore((s) => s.profile);
  const user = useAuthStore((s) => s.user);
  const addToast = useToast();

  const [delegations, setDelegations] = useState([]);
  const [loading, setLoading] = useState(true);

  // Form state
  const [searchQuery, setSearchQuery] = useState('');
  const [searchResults, setSearchResults] = useState([]);
  const [selectedUser, setSelectedUser] = useState(null);
  const [startDate, setStartDate] = useState('');
  const [endDate, setEndDate] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);

  useEffect(() => {
    fetchDelegations();
  }, []);

  const fetchDelegations = async () => {
    try {
      const res = await reimbursementApi.getDelegations();
      setDelegations(res.data);
    } catch (err) {
      addToast('Failed to load delegations', 'error');
    } finally {
      setLoading(false);
    }
  };

  const handleSearch = async (e) => {
    const q = e.target.value;
    setSearchQuery(q);
    if (q.length < 2) {
      setSearchResults([]);
      return;
    }
    try {
      const res = await api.get('/me/users-search', { params: { q } });
      setSearchResults(res.data);
    } catch (err) {
      // ignore
    }
  };

  const selectUser = (u) => {
    setSelectedUser(u);
    setSearchQuery('');
    setSearchResults([]);
  };

  const createDelegation = async (e) => {
    e.preventDefault();
    if (!selectedUser || !startDate || !endDate) return;
    
    setIsSubmitting(true);
    try {
      const res = await reimbursementApi.createDelegation({
        delegatee_id: selectedUser.id,
        start_date: new Date(startDate).toISOString(),
        end_date: new Date(endDate).toISOString(),
      });
      setDelegations([res.data, ...delegations]);
      addToast('Delegation created successfully', 'success');
      setSelectedUser(null);
      setStartDate('');
      setEndDate('');
    } catch (err) {
      addToast(err.response?.data?.detail || 'Failed to create delegation', 'error');
    } finally {
      setIsSubmitting(false);
    }
  };

  const deleteDelegation = async (id) => {
    if (!window.confirm('Are you sure you want to remove this delegation?')) return;
    try {
      await reimbursementApi.deleteDelegation(id);
      setDelegations(delegations.filter((d) => d.id !== id));
      addToast('Delegation removed', 'success');
    } catch (err) {
      addToast('Failed to remove delegation', 'error');
    }
  };

  return (
    <div className="max-w-4xl mx-auto p-4 space-y-6">
      {/* Profile Summary */}
      <div className="bg-white rounded-xl shadow-sm p-6 border border-slate-200">
        <div className="flex items-start gap-4">
          <div className="h-16 w-16 bg-brand/10 text-brand rounded-full flex items-center justify-center text-2xl font-semibold">
            {(profile?.full_name || user?.email || 'U')[0].toUpperCase()}
          </div>
          <div>
            <h1 className="text-2xl font-bold text-ink">{profile?.full_name || 'User'}</h1>
            <p className="text-slate-500">{user?.email}</p>
            <div className="mt-2 flex items-center gap-2">
              <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-medium bg-slate-100 text-slate-700">
                <Shield className="h-3.5 w-3.5 text-slate-400" />
                {profile?.role || user?.role || 'EMPLOYEE'}
              </span>
              {profile?.impact_level_code && (
                <span className="inline-flex items-center px-2.5 py-1 rounded-full text-xs font-medium bg-brand/10 text-brand">
                  Level: {profile.impact_level_code}
                </span>
              )}
            </div>
          </div>
        </div>
      </div>

      {/* Delegation / Out of Office Section */}
      <div className="bg-white rounded-xl shadow-sm border border-slate-200 overflow-hidden">
        <div className="p-6 border-b border-slate-200">
          <h2 className="text-lg font-semibold text-ink flex items-center gap-2">
            <Users className="h-5 w-5 text-brand" />
            Delegation / Out of Office
          </h2>
          <p className="text-sm text-slate-500 mt-1">
            Temporarily assign your approval responsibilities to another employee while you are away.
          </p>
        </div>

        <div className="p-6 bg-slate-50 border-b border-slate-200">
          <form onSubmit={createDelegation} className="space-y-4">
            <h3 className="text-sm font-medium text-ink">Create New Delegation</h3>
            
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4 items-start">
              <div className="relative space-y-1.5">
                <label className="block text-xs font-bold text-slate-700">Delegate To</label>
                {!selectedUser ? (
                  <>
                    <div className="relative">
                      <Search className="absolute left-3 top-2.5 h-5 w-5 text-slate-400" />
                      <input
                        type="text"
                        className="w-full pl-10 pr-3 py-2 border border-slate-300 rounded-md focus:outline-none focus:ring-2 focus:ring-brand focus:border-brand shadow-sm text-sm"
                        placeholder="Search employee by name or email..."
                        value={searchQuery}
                        onChange={handleSearch}
                      />
                    </div>
                    {searchResults.length > 0 && (
                      <div className="absolute z-10 w-full mt-1 bg-white rounded-md shadow-lg border border-slate-200 max-h-48 overflow-y-auto">
                        {searchResults.map((su) => (
                          <div
                            key={su.id}
                            className="px-4 py-2 hover:bg-slate-50 cursor-pointer"
                            onClick={() => selectUser(su)}
                          >
                            <div className="text-sm font-medium text-ink">{su.full_name}</div>
                            <div className="text-xs text-slate-500">{su.email}</div>
                          </div>
                        ))}
                      </div>
                    )}
                  </>
                ) : (
                  <div className="flex items-center justify-between py-1.5 px-3 border border-brand/30 bg-brand/5 rounded-md shadow-sm h-[38px]">
                    <div className="flex items-center gap-2 truncate">
                      <div className="text-sm font-bold text-brand truncate">{selectedUser.full_name}</div>
                      <div className="text-[10px] text-brand/70 truncate pt-0.5">{selectedUser.email}</div>
                    </div>
                    <button
                      type="button"
                      onClick={() => setSelectedUser(null)}
                      className="text-xs text-slate-500 hover:text-red-500"
                    >
                      Clear
                    </button>
                  </div>
                )}
              </div>

              <div className="grid grid-cols-2 gap-4">
                <div className="space-y-1.5">
                  <label className="block text-xs font-bold text-slate-700">Start Date</label>
                  <input
                    type="date"
                    required
                    value={startDate}
                    onChange={(e) => setStartDate(e.target.value)}
                    className="w-full border-slate-300 rounded-md shadow-sm focus:border-brand focus:ring-brand px-3 py-1.5 text-sm h-[38px]"
                  />
                </div>
                <div className="space-y-1.5">
                  <label className="block text-xs font-bold text-slate-700">End Date</label>
                  <input
                    type="date"
                    required
                    value={endDate}
                    onChange={(e) => setEndDate(e.target.value)}
                    className="w-full border-slate-300 rounded-md shadow-sm focus:border-brand focus:ring-brand px-3 py-1.5 text-sm h-[38px]"
                  />
                </div>
              </div>
            </div>

            <div className="flex justify-end">
              <button
                type="submit"
                disabled={!selectedUser || !startDate || !endDate || isSubmitting}
                className="inline-flex items-center gap-2 px-4 py-2 bg-brand text-white text-sm font-medium rounded-md hover:bg-brand-dark disabled:opacity-50"
              >
                {isSubmitting ? (
                  <div className="w-4 h-4 border-2 border-white/20 border-t-white rounded-full animate-spin" />
                ) : (
                  <Plus className="h-4 w-4" />
                )}
                Add Delegation
              </button>
            </div>
          </form>
        </div>

        <div className="p-6">
          <h3 className="text-sm font-medium text-ink mb-4">Active & Past Delegations</h3>
          {loading ? (
            <div className="text-center py-4 text-slate-500">Loading...</div>
          ) : delegations.length === 0 ? (
            <div className="text-center py-8 bg-slate-50 rounded-lg border border-dashed border-slate-300">
              <AlertCircle className="h-8 w-8 text-slate-400 mx-auto mb-2" />
              <p className="text-slate-500 text-sm">No delegations configured.</p>
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm text-left">
                <thead className="text-xs text-slate-500 uppercase bg-slate-50">
                  <tr>
                    <th className="px-4 py-3 font-medium">Delegatee</th>
                    <th className="px-4 py-3 font-medium">Duration</th>
                    <th className="px-4 py-3 font-medium">Status</th>
                    <th className="px-4 py-3 font-medium text-right">Actions</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-200">
                  {delegations.map((del) => {
                    const isCurrentlyActive =
                      del.is_active &&
                      new Date(del.start_date) <= new Date() &&
                      new Date(del.end_date) >= new Date();

                    return (
                      <tr key={del.id} className="hover:bg-slate-50/50">
                        <td className="px-4 py-3">
                          <div className="font-medium text-ink">{del.delegatee_name || 'Unknown'}</div>
                          <div className="text-xs text-slate-500">{del.delegatee_email}</div>
                        </td>
                        <td className="px-4 py-3">
                          <div className="flex items-center gap-1.5 text-slate-600">
                            <Calendar className="h-3.5 w-3.5" />
                            {format(new Date(del.start_date), 'MMM d, yyyy')} -{' '}
                            {format(new Date(del.end_date), 'MMM d, yyyy')}
                          </div>
                        </td>
                        <td className="px-4 py-3">
                          {isCurrentlyActive ? (
                            <span className="inline-flex items-center px-2 py-0.5 rounded text-xs font-medium bg-green-100 text-green-800">
                              Active
                            </span>
                          ) : (
                            <span className="inline-flex items-center px-2 py-0.5 rounded text-xs font-medium bg-slate-100 text-slate-600">
                              Inactive
                            </span>
                          )}
                        </td>
                        <td className="px-4 py-3 text-right">
                          <button
                            onClick={() => deleteDelegation(del.id)}
                            className="p-1.5 text-slate-400 hover:text-red-600 hover:bg-red-50 rounded"
                            title="Remove Delegation"
                          >
                            <Trash2 className="h-4 w-4" />
                          </button>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}