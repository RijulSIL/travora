import { useState, useEffect } from 'react';
import { Link } from 'react-router-dom';
import { Users, Search, Calendar, Trash2, Plus, AlertCircle, Shield, Lock, KeyRound, Eye, EyeOff, Check } from 'lucide-react';
import { format } from 'date-fns';

import { useAuthStore } from '../store/authStore';
import { useSetPageTitle } from '../context/PageTitleContext';
import { reimbursementApi } from '../services/reimbursementApi';
import api from '../services/api';
import useToast from '../hooks/useToast';
import { formatRole } from '../utils/formatters';



function validatePasswordComplexity(pwd) {
  if (pwd.length < 8) return 'Password must be at least 8 characters long';
  if (!/[A-Z]/.test(pwd)) return 'Password must contain at least one uppercase letter';
  if (!/[a-z]/.test(pwd)) return 'Password must contain at least one lowercase letter';
  if (!/[0-9]/.test(pwd)) return 'Password must contain at least one number';
  if (!/[!@#$%^&*()_+={}[\]|\\:;"'<>,.?/~`-]/.test(pwd)) return 'Password must contain at least one special character';
  return null;
}

export default function ProfilePage() {
  useSetPageTitle('My Profile');
  const profile = useAuthStore((s) => s.profile);
  const user = useAuthStore((s) => s.user);
  const addToast = useToast();
  const { showToast } = useToast();

  const [delegations, setDelegations] = useState([]);
  const [loading, setLoading] = useState(true);

  // Form state
  const [searchQuery, setSearchQuery] = useState('');
  const [searchResults, setSearchResults] = useState([]);
  const [selectedUser, setSelectedUser] = useState(null);
  const [startDate, setStartDate] = useState('');
  const [endDate, setEndDate] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);

  // Change password state
  const [pwStep, setPwStep] = useState('idle'); // 'idle' | 'otp-sent'
  const [currentPassword, setCurrentPassword] = useState('');
  const [otpCode, setOtpCode] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [confirmNewPassword, setConfirmNewPassword] = useState('');
  const [showPw, setShowPw] = useState(false);
  const [pwLoading, setPwLoading] = useState(false);
  const [pwError, setPwError] = useState(null);

  const resetPasswordForm = () => {
    setPwStep('idle');
    setCurrentPassword('');
    setOtpCode('');
    setNewPassword('');
    setConfirmNewPassword('');
    setPwError(null);
  };

  const handleRequestPasswordOtp = async (e) => {
    e.preventDefault();
    if (!currentPassword) return;

    setPwError(null);
    setPwLoading(true);
    try {
      await api.post('/auth/change-password/request-otp', { current_password: currentPassword });
      setPwStep('otp-sent');
      showToast('OTP sent to your email', 'success');
    } catch (err) {
      setPwError(err.response?.data?.detail || 'Failed to send OTP');
    } finally {
      setPwLoading(false);
    }
  };

  const handleConfirmPasswordChange = async (e) => {
    e.preventDefault();

    if (newPassword !== confirmNewPassword) {
      setPwError('Passwords do not match');
      return;
    }
    const complexityError = validatePasswordComplexity(newPassword);
    if (complexityError) {
      setPwError(complexityError);
      return;
    }

    setPwError(null);
    setPwLoading(true);
    try {
      await api.post('/auth/change-password/confirm', { otp_code: otpCode, new_password: newPassword });
      showToast('Password changed successfully', 'success');
      resetPasswordForm();
    } catch (err) {
      setPwError(err.response?.data?.detail || 'Failed to change password. The OTP may be expired or invalid.');
    } finally {
      setPwLoading(false);
    }
  };

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
                {formatRole(profile?.role || user?.role || 'EMPLOYEE')}
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

      {/* Change Password Section */}
      <div className="bg-white rounded-xl shadow-sm border border-slate-200 overflow-hidden">
        <div className="p-6 border-b border-slate-200">
          <h2 className="text-lg font-semibold text-ink flex items-center gap-2">
            <Lock className="h-5 w-5 text-brand" />
            Change Password
          </h2>
          <p className="text-sm text-slate-500 mt-1">
            {pwStep === 'idle'
              ? 'Confirm your current password to receive a one-time code by email.'
              : `Enter the code sent to ${user?.email || 'your email'} along with your new password.`}
          </p>
        </div>

        <div className="p-6">
          {pwError && (
            <div className="mb-4 rounded-lg border border-rose-200 bg-rose-50 p-3 flex items-start gap-2 text-rose-700 text-sm font-medium">
              <AlertCircle size={16} className="shrink-0 mt-0.5" />
              <span>{pwError}</span>
            </div>
          )}

          {pwStep === 'idle' ? (
            <form onSubmit={handleRequestPasswordOtp} className="max-w-sm space-y-5">
              <div className="space-y-1.5">
                <div className="flex items-center justify-between">
                  <label className="block text-xs font-bold text-slate-700">Current Password</label>
                  <Link
                    to="/forgot-password"
                    className="text-xs font-semibold text-brand hover:text-brand-dark underline underline-offset-2 decoration-brand/40 hover:decoration-brand-dark"
                  >
                    Forgot your password?
                  </Link>
                </div>
                <div className="relative">
                  <div className="absolute inset-y-0 left-0 pl-3 flex items-center pointer-events-none text-slate-400">
                    <Lock size={16} />
                  </div>
                  <input
                    type={showPw ? 'text' : 'password'}
                    required
                    className="w-full pl-9 pr-10 py-2 border border-slate-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-brand focus:border-brand shadow-sm text-sm h-11"
                    placeholder="••••••••"
                    value={currentPassword}
                    onChange={(e) => setCurrentPassword(e.target.value)}
                    disabled={pwLoading}
                  />
                  <button
                    type="button"
                    className="absolute inset-y-0 right-0 pr-3 flex items-center text-slate-400 hover:text-slate-600"
                    onClick={() => setShowPw((v) => !v)}
                  >
                    {showPw ? <EyeOff size={16} /> : <Eye size={16} />}
                  </button>
                </div>
              </div>
              <button
                type="submit"
                disabled={!currentPassword || pwLoading}
                className="inline-flex items-center justify-center gap-2 w-full sm:w-auto px-5 h-11 bg-brand text-white text-sm font-semibold rounded-lg shadow-sm hover:bg-brand-dark hover:shadow-md transition-all disabled:opacity-50 disabled:shadow-none"
              >
                {pwLoading ? (
                  <div className="w-4 h-4 border-2 border-white/20 border-t-white rounded-full animate-spin" />
                ) : (
                  <KeyRound className="h-4 w-4" />
                )}
                Send OTP
              </button>
            </form>
          ) : (
            <form onSubmit={handleConfirmPasswordChange} className="max-w-sm space-y-4">
              <div className="space-y-1.5">
                <label className="block text-xs font-bold text-slate-700">OTP Code</label>
                <input
                  type="text"
                  required
                  maxLength={6}
                  className="w-full px-3 py-2 border border-slate-300 rounded-md focus:outline-none focus:ring-2 focus:ring-brand focus:border-brand shadow-sm text-sm h-[38px] font-mono tracking-[0.3em] text-center uppercase"
                  placeholder="------"
                  value={otpCode}
                  onChange={(e) => {
                    setOtpCode(e.target.value.toUpperCase());
                    if (pwError) setPwError(null);
                  }}
                  disabled={pwLoading}
                />
              </div>

              <div className="space-y-1.5">
                <label className="block text-xs font-bold text-slate-700">New Password</label>
                <div className="relative">
                  <input
                    type={showPw ? 'text' : 'password'}
                    required
                    className="w-full pl-3 pr-10 py-2 border border-slate-300 rounded-md focus:outline-none focus:ring-2 focus:ring-brand focus:border-brand shadow-sm text-sm h-[38px]"
                    placeholder="••••••••"
                    value={newPassword}
                    onChange={(e) => {
                      setNewPassword(e.target.value);
                      if (pwError) setPwError(null);
                    }}
                    disabled={pwLoading}
                  />
                  <button
                    type="button"
                    className="absolute inset-y-0 right-0 pr-3 flex items-center text-slate-400 hover:text-slate-600"
                    onClick={() => setShowPw((v) => !v)}
                  >
                    {showPw ? <EyeOff size={16} /> : <Eye size={16} />}
                  </button>
                </div>
              </div>

              <div className="space-y-1.5">
                <label className="block text-xs font-bold text-slate-700">Confirm New Password</label>
                <input
                  type={showPw ? 'text' : 'password'}
                  required
                  className="w-full px-3 py-2 border border-slate-300 rounded-md focus:outline-none focus:ring-2 focus:ring-brand focus:border-brand shadow-sm text-sm h-[38px]"
                  placeholder="••••••••"
                  value={confirmNewPassword}
                  onChange={(e) => {
                    setConfirmNewPassword(e.target.value);
                    if (pwError) setPwError(null);
                  }}
                  disabled={pwLoading}
                />
              </div>

              <div className="rounded-lg border border-slate-200 bg-slate-50/50 p-3 text-[11px] font-medium text-slate-500 space-y-1.5">
                <div className={`flex items-center gap-2 ${newPassword.length >= 8 ? 'text-emerald-600' : 'text-rose-500'}`}>
                  {newPassword.length >= 8 ? <Check size={13} strokeWidth={3} /> : <div className="h-1.5 w-1.5 rounded-full bg-rose-400 ml-1 mr-0.5" />}
                  <span>At least 8 characters</span>
                </div>
                <div className={`flex items-center gap-2 ${/[A-Z]/.test(newPassword) ? 'text-emerald-600' : 'text-rose-500'}`}>
                  {/[A-Z]/.test(newPassword) ? <Check size={13} strokeWidth={3} /> : <div className="h-1.5 w-1.5 rounded-full bg-rose-400 ml-1 mr-0.5" />}
                  <span>At least 1 uppercase letter</span>
                </div>
                <div className={`flex items-center gap-2 ${/[a-z]/.test(newPassword) ? 'text-emerald-600' : 'text-rose-500'}`}>
                  {/[a-z]/.test(newPassword) ? <Check size={13} strokeWidth={3} /> : <div className="h-1.5 w-1.5 rounded-full bg-rose-400 ml-1 mr-0.5" />}
                  <span>At least 1 lowercase letter</span>
                </div>
                <div className={`flex items-center gap-2 ${/[0-9]/.test(newPassword) ? 'text-emerald-600' : 'text-rose-500'}`}>
                  {/[0-9]/.test(newPassword) ? <Check size={13} strokeWidth={3} /> : <div className="h-1.5 w-1.5 rounded-full bg-rose-400 ml-1 mr-0.5" />}
                  <span>At least 1 number</span>
                </div>
                <div className={`flex items-center gap-2 ${/[!@#$%^&*()_+={}[\]|\\:;"'<>,.?/~`-]/.test(newPassword) ? 'text-emerald-600' : 'text-rose-500'}`}>
                  {/[!@#$%^&*()_+={}[\]|\\:;"'<>,.?/~`-]/.test(newPassword) ? <Check size={13} strokeWidth={3} /> : <div className="h-1.5 w-1.5 rounded-full bg-rose-400 ml-1 mr-0.5" />}
                  <span>At least 1 special character</span>
                </div>
              </div>

              <div className="flex items-center gap-3">
                <button
                  type="submit"
                  disabled={!otpCode || !newPassword || !confirmNewPassword || pwLoading}
                  className="inline-flex items-center gap-2 px-4 py-2 bg-brand text-white text-sm font-medium rounded-md hover:bg-brand-dark disabled:opacity-50"
                >
                  {pwLoading ? (
                    <div className="w-4 h-4 border-2 border-white/20 border-t-white rounded-full animate-spin" />
                  ) : (
                    <Lock className="h-4 w-4" />
                  )}
                  Change Password
                </button>
                <button
                  type="button"
                  onClick={resetPasswordForm}
                  disabled={pwLoading}
                  className="text-sm font-medium text-slate-500 hover:text-slate-700"
                >
                  Cancel
                </button>
              </div>
            </form>
          )}
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