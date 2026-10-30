import api from './api';

/** Must stay aligned with GET in backend `app/api/v1/admin/policy.py` (`/admin/city-groups/resolve`). */
export const ADMIN_CITY_GROUP_RESOLVE_PATH = 'admin/city-groups/resolve';

export const reimbursementApi = {
  me: () => api.get('me'),
  updateAutoApproveThreshold: (threshold) => api.patch('me/auto-approve-threshold', { threshold }),
  getDelegations: () => api.get('me/delegations'),
  myPolicyLimits: () => api.get('me/policy-limits'),
  createDelegation: (payload) => api.post('me/delegations', payload),
  deleteDelegation: (id) => api.delete(`me/delegations/${id}`),
  bookingTripsMy: (params) => api.get('booking/trips/my', { params }),
  travelRequestsMy: () => api.get('travel-requests/my'),
  travelRequestsManagerPending: () => api.get('travel-requests/manager/pending'),
  travelRequestsTeamCalendar: () => api.get('travel-requests/manager/team-calendar'),
  travelRequestsCreate: (payload, config) => api.post('travel-requests', payload, config),
  travelRequestsCreateWithException: (payload, config) =>
    api.post('travel-requests/request-with-exception', payload, config),
  travelRequestDelete: (id) => api.delete(`travel-requests/${id}`),
  travelEntitlementNote: () => api.get('travel-requests/entitlement-note'),
  travelOptions: () => api.get('travel-requests/options'),
  // Real flight/train/bus options for one leg, found with Google by Gemini (in-policy classes only).
  travelSearchOptions: (payload) => api.post('travel-requests/options/search', payload, { suppressErrorToast: true }),
  travelCityExpenseLimits: (city, travelDate) =>
    api.get('travel-requests/expense-limits', { params: { city, travel_date: travelDate || undefined } }),
  travelCitySuggestions: (q, limit) =>
    api.get('travel-requests/city-suggestions', { params: { q, limit } }),
  travelDeskQueue: () => api.get('travel-requests/desk'),
  travelDeskAll: (params) => api.get('travel-requests/desk/all', { params }),
  travelApprove: (id, payload) => api.post(`travel-requests/${id}/approve`, payload ?? {}),
  travelReject: (id, payload) => api.post(`travel-requests/${id}/reject`, payload),
  travelRequestApprovalChain: (id) => api.get(`travel-requests/${id}/approval-chain`),
  travelUploadTicket: (id, formData) =>
    api.post(`travel-requests/${id}/upload-ticket`, formData, {
      headers: { 'Content-Type': 'multipart/form-data' },
    }),
  travelTicketDetails: (ticketId) => api.get(`travel-requests/tickets/${ticketId}`),
  travelTicketFileBlob: (ticketId) =>
    api.get(`travel-requests/tickets/${ticketId}/file`, { responseType: 'blob' }),
  // Reads a ticket before it's uploaded (PNR, provider, route check). Stores nothing.
  travelReadTicket: (id, formData) =>
    api.post(`travel-requests/${id}/read-ticket`, formData, {
      headers: { 'Content-Type': 'multipart/form-data' },
    }),
  travelUploadSupportingDocument: (id, formData) =>
    api.post(`travel-requests/${id}/supporting-documents`, formData, {
      headers: { 'Content-Type': 'multipart/form-data' },
    }),
  travelSupportingDocumentBlob: (documentId) =>
    api.get(`travel-requests/supporting-documents/${documentId}/file`, { responseType: 'blob' }),
  // Emails the configured travel agent a one-time /book/{token} link; same call for a first send
  // and a resend (a resend overwrites the previous link).
  sendRequestToAgent: (id) => api.post(`travel-requests/${id}/send-to-agent`),
  travelAgentEmailConfigured: () => api.get('travel-requests/agent-email-configured'),

  invoices: (params) => api.get('invoices', { params }),
  uploadInvoice: (formData) =>
    api.post('invoices/upload', formData, {
      headers: { 'Content-Type': 'multipart/form-data' },
    }),
  invoiceExtraction: (invoiceId) => api.get(`invoices/${invoiceId}/extraction`),
  invoiceFileBlob: (invoiceId) => api.get(`invoices/${invoiceId}/file`, { responseType: 'blob' }),
  updateInvoiceFields: (invoiceId, payload) => api.put(`invoices/${invoiceId}/fields`, payload),
  releaseInvoiceFromDraft: (invoiceId) => api.delete(`invoices/${invoiceId}/claim-link`),
  deleteInvoice: (invoiceId) => api.delete(`invoices/${invoiceId}`),
  validateGstin: (gstin) => api.post('invoices/validate-gstin', { gstin }),
  saveClaimDraft: (payload) => api.post('claims/draft', payload),
  deleteClaim: (claimId) => api.delete(`claims/${claimId}`),
  policyCheck: (claimId) => api.get(`claims/${claimId}/policy-check`),
  // payload: { exceptions: [{ exception_type, category_name, reason }] } — one reason per flagged expense
  submitClaim: (claimId, payload) => api.post(`claims/${claimId}/submit`, payload ?? { exceptions: [] }),
  claims: (params) => api.get('claims', { params }),
  claimDetail: (claimId) => api.get(`claims/${claimId}`),
  claimRelocationEvidenceBlob: (claimId) =>
    api.get(`claims/${claimId}/relocation-evidence`, { responseType: 'blob' }),

  // Relocation approvals (New Claim → Relocation Claim; approvers in Pending Approvals)
  relocationMine: () => api.get('relocation/mine'),
  createRelocationRequest: (payload) => api.post('relocation/requests', payload),
  uploadRelocationPriorApproval: (formData) =>
    api.post('relocation/prior-approvals', formData, {
      headers: { 'Content-Type': 'multipart/form-data' },
    }),
  relocationPending: () => api.get('relocation/pending'),
  approveRelocation: (requestId, payload) => api.post(`relocation/requests/${requestId}/approve`, payload ?? {}),
  rejectRelocation: (requestId, payload) => api.post(`relocation/requests/${requestId}/reject`, payload),
  relocationEvidenceBlob: (requestId) =>
    api.get(`relocation/requests/${requestId}/evidence`, { responseType: 'blob' }),
  claimTimeline: (claimId) => api.get(`claims/${claimId}/timeline`),
  pendingApprovals: () => api.get('claims/pending-approvals'),
  approvalChain: (claimId) => api.get(`claims/${claimId}/approval-chain`),
  approveClaim: (claimId, payload) => api.post(`claims/${claimId}/approve`, payload ?? {}),
  sendBackClaim: (claimId, payload) => api.post(`claims/${claimId}/send-back`, payload),
  rejectClaim: (claimId, payload) => api.post(`claims/${claimId}/reject`, payload),
  modifyClaimAmount: (claimId, payload) => api.post(`claims/${claimId}/modify-amount`, payload),
  recordClaimPayment: (claimId, payload) => api.post(`claims/${claimId}/payment`, payload),
  teamClaims: () => api.get('claims/team'),
  teamSpend: () => api.get('claims/team/spend'),
  managerAnalytics: () => api.get('reports/manager/team-spend'),

  gstSummary: (params) => api.get('finance/gst-summary', { params }),
  // Departments, invoice categories and levels for the report filters (anyone who can view reports).
  reportFilterOptions: () => api.get('finance/filter-options'),
  spendByCategory: (params) => api.get('finance/spend-by-category', { params }),
  policyViolations: (params) => api.get('reports/policy-violations', { params }),
  exportGstr2b: (params) =>
    api.get('finance/gstr2b/export', { params: { ...params, format: 'csv' }, responseType: 'blob' }),
  erpPost: (payload) => api.post('finance/erp/post', payload),
  erpLedger: (params) => api.get('finance/erp-ledger', { params }),
  grantAdvance: (payload) => api.post('advances/grant', payload),
  updateAdvance: (advanceId, payload) => api.put(`advances/${advanceId}`, payload),
  listAdvances: (params) => api.get('advances', { params }),
  listArchivedAdvances: () => api.get('advances/archived'),
  outstandingAdvanceFor: (employeeUserId) => api.get(`advances/outstanding/${employeeUserId}`),
  settleAdvance: (employeeUserId, payload) => api.post(`advances/settle/${employeeUserId}`, payload),
  reportRun: (reportType, params) => api.get(`reports/${reportType}`, { params }),
  reportExportCsv: (reportType, params) =>
    api.get(`reports/${reportType}/export`, { params: { ...params, format: 'csv' }, responseType: 'blob' }),
  reportExportXlsx: (reportType, params) =>
    api.get(`reports/${reportType}/export`, { params: { ...params, format: 'xlsx' }, responseType: 'blob' }),
  reportExportPdf: (reportType, params) =>
    api.get(`reports/${reportType}/export`, { params: { ...params, format: 'pdf' }, responseType: 'blob' }),
  reportSchedules: () => api.get('reports/schedule'),
  createReportSchedule: (payload) => api.post('reports/schedule', payload),
  setReportScheduleActive: (id, isActive) => api.put(`reports/schedule/${id}/active`, { is_active: isActive }),
  deleteReportSchedule: (id) => api.delete(`reports/schedule/${id}`),
  exceptionRequestsLog: (params) => api.get('reports/exception-requests', { params }),

  getException: (id) => api.get(`exceptions/${id}`),
  decideException: (id, payload) => api.post(`exceptions/${id}/approve`, payload),
  // A claim's exceptions, one decision each: { decisions: [{ item_id, decision: ACCEPT|REJECT|SEND_BACK, comment }] }
  decideExceptionItems: (id, payload) => api.post(`exceptions/${id}/decide-items`, payload),
  workflowConfig: () => api.get('workflow/config'),
  companyProfile: () => api.get('admin/company-profile'),
  resolveCityGroup: (cityName, travelDate) =>
    api.get(ADMIN_CITY_GROUP_RESOLVE_PATH, { params: { city_name: cityName, travel_date: travelDate } }),
  updateWorkflowConfig: (payload) => api.put('workflow/config', payload),
  notificationTemplates: () => api.get('notifications/templates'),
  updateNotificationTemplate: (id, payload) => api.put(`notifications/templates/${id}`, payload),
  notifications: (params) => api.get('notifications', { params }),
  notificationsUnreadCount: () => api.get('notifications/unread-count'),
  markNotificationRead: (id) => api.post(`notifications/${id}/read`),
  markAllNotificationsRead: () => api.post('notifications/read-all'),
};
