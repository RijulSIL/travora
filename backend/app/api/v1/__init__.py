from fastapi import APIRouter

from app.api.v1 import (
    advances_api,
    auth,
    claim_workflow,
    claims,
    exceptions_api,
    finance_reporting,
    health,
    holiday_calendar,
    invoices,
    me,
    manager_analytics,
    notifications_admin,
    travel_booking,
    travel_requests,
    workflow_admin,
)
from app.api.v1.admin import company_profile, expense_categories, policy, users

api_router = APIRouter()
api_router.include_router(health.router)
api_router.include_router(auth.router)
api_router.include_router(me.router)
api_router.include_router(manager_analytics.router)
api_router.include_router(invoices.router)
api_router.include_router(claims.router)
api_router.include_router(claim_workflow.router)
api_router.include_router(exceptions_api.router)
api_router.include_router(finance_reporting.router)
api_router.include_router(advances_api.router)
api_router.include_router(workflow_admin.router)
api_router.include_router(holiday_calendar.router)
api_router.include_router(notifications_admin.router)
api_router.include_router(travel_booking.router)
api_router.include_router(travel_requests.router)
api_router.include_router(policy.router)
api_router.include_router(users.router)
api_router.include_router(expense_categories.router)
api_router.include_router(company_profile.router)
