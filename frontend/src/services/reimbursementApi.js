import api from './api';

/** Must stay aligned with GET in backend `app/api/v1/admin/policy.py` (`/admin/city-groups/resolve`). */
export const ADMIN_CITY_GROUP_RESOLVE_PATH = 'admin/city-groups/resolve';

export const reimbursementApi = {
  me: () => api.get('me'),
  getDelegations: () => api.get('me/delegations'),
  createDelegation: (payload) => api.post('me/delegations', payload),
  deleteDelegation: (id) => api.delete(`me/delegations/${id}`),
  bookingTripsMy: (params) => api.get('booking/trips/my', { params }),
  travelRequestsMy: () => api.get('travel-requests/my'),
  travelRequestsManagerPending: () => api.get('travel-requests/manager/pending'),
  travelRequestsTeamCalendar: () => api.get('travel-requests/manager/team-calendar'),
  travelRequestsCreate: (payload) => api.post('travel-requests', payload),
  travelRequestDelete: (id) => api.delete(`travel-requests/${id}`),
  travelEntitlementNote: () => api.get('travel-requests/entitlement-note'),
  travelCitySuggestions: (q, limit) =>
    api.get('travel-requests/city-suggestions', { params: { q, limit } }),
  travelDeskQueue: () => api.get('travel-requests/desk'),
  travelDeskAll: (params) => api.get('travel-requests/desk/all', { params }),
  travelApprove: (id) => api.post(`travel-requests/${id}/approve`, {}),
  travelReject: (id, payload) => api.post(`travel-requests/${id}/reject`, payload),
  travelUploadTicket: (id, formData) =>
    api.post(`travel-requests/${id}/upload-ticket`, formData, {
      headers: { 'Content-Type': 'multipart/form-data' },
    }),
  travelTicketFileBlob: (ticketId) =>
    api.get(`travel-requests/tickets/${ticketId}/file`, { responseType: 'blob' }),

  invoices: (params) => api.get('invoices', { params }),
  uploadInvoice: (formData) =>
    api.post('invoices/upload', formData, {
      headers: { 'Content-Type': 'multipart/form-data' },
    }),
  invoiceExtraction: (invoiceId) => api.get(`invoices/${invoiceId}/extraction`),
  invoiceFileBlob: (invoiceId) => api.get(`invoices/${invoiceId}/file`, { responseType: 'blob' }),
  updateInvoiceFields: (invoiceId, payload) => api.put(`invoices/${invoiceId}/fields`, payload),
  validateGstin: (gstin) => api.post('invoices/validate-gstin', { gstin }),
  saveClaimDraft: (payload) => api.post('claims/draft', payload),
  policyCheck: (claimId) => api.get(`claims/${claimId}/policy-check`),
  submitClaim: (claimId) => api.post(`claims/${claimId}/submit`),
  claims: (params) => api.get('claims', { params }),
  claimDetail: (claimId) => api.get(`claims/${claimId}`),
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
  policyViolations: (params) => api.get('reports/policy-violations', { params }),
  exportGstr2b: (params) =>
    api.get('finance/gstr2b/export', { params: { ...params, format: 'csv' }, responseType: 'blob' }),
  erpPost: (payload) => api.post('finance/erp/post', payload),
  erpLedger: (params) => api.get('finance/erp-ledger', { params }),
  reportRun: (reportType, params) => api.get(`reports/${reportType}`, { params }),
  reportExportCsv: (reportType, params) =>
    api.get(`reports/${reportType}/export`, { params: { ...params, format: 'csv' }, responseType: 'blob' }),
  reportExportXlsx: (reportType, params) =>
    api.get(`reports/${reportType}/export`, { params: { ...params, format: 'xlsx' }, responseType: 'blob' }),
  reportExportPdf: (reportType, params) =>
    api.get(`reports/${reportType}/export`, { params: { ...params, format: 'pdf' }, responseType: 'blob' }),
  reportSchedules: () => api.get('reports/schedule'),
  createReportSchedule: (payload) => api.post('reports/schedule', payload),
  exceptionRequestsLog: (params) => api.get('reports/exception-requests', { params }),

  requestException: (payload) => api.post('exceptions/request', payload),
  getException: (id) => api.get(`exceptions/${id}`),
  decideException: (id, payload) => api.post(`exceptions/${id}/approve`, payload),
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
