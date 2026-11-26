"""The welcome tours on Home (frontend components/tour): one short guided tour per role, telling
a new person what happens to a trip or a claim from their side and where each part is done.

Which tours someone gets comes from their role and the Manager setting. A tour they haven't seen
starts by itself the next time they open Home; finished and skipped both count as seen, and any
of their tours can be replayed from the account menu.

The tour keys must match frontend/src/components/tour/tours.js. The 'existing' outcome is only
written by the migration that added tours (people already using Travora then)."""

from fastapi import HTTPException

from app.core.rbac import is_manager
from app.models.auth import Role, User

TOUR_KEYS = ("employee", "manager", "hrbp", "finance", "payroll", "admin", "approver", "recruiter")
OUTCOMES = ("finished", "skipped")

ROLE_TOUR = {
    Role.EMPLOYEE: "employee",
    # Legacy: being a manager is now the Manager setting on any role.
    Role.REPORTING_MANAGER: "manager",
    Role.HRBP_HR: "hrbp",
    Role.FINANCE: "finance",
    Role.PAYROLL: "payroll",
    Role.IT_ADMIN: "admin",
    # The senior approvers share one tour: their pages are the same.
    Role.CEO: "approver",
    Role.GROUP_HEAD_HR: "approver",
    Role.ADMIN: "approver",
    Role.RECRUITER: "recruiter",
}


def tours_for(user: User) -> list[str]:
    """This person's tours, in the order they're shown. With the Manager setting on, an employee
    gets the Manager tour instead of the Employee one (it ends on their own trips and claims), and
    any other role gets it as well, after their own (the CEO always has the setting)."""
    own = ROLE_TOUR.get(user.role, "employee")
    if is_manager(user) and own != "manager":
        return ["manager"] if own == "employee" else [own, "manager"]
    return [own]


def pending_tours(user: User) -> list[str]:
    """Their tours not seen yet: Home starts the first one by itself."""
    seen = user.tours_seen or {}
    return [tour for tour in tours_for(user) if tour not in seen]


def available_tours(user: User) -> list[str]:
    """What the account menu offers: their own tours, plus the Employee tour for anyone who
    doesn't have it (every role asks for trips and claims too)."""
    tours = tours_for(user)
    return tours if "employee" in tours else [*tours, "employee"]


def record_tour(user: User, tour: str, outcome: str) -> None:
    """Notes that they finished or skipped a tour. Doesn't commit."""
    if tour not in TOUR_KEYS:
        raise HTTPException(status_code=404, detail="There's no such tour")
    if outcome not in OUTCOMES:
        raise HTTPException(status_code=422, detail="Say whether the tour was finished or skipped")
    seen = dict(user.tours_seen or {})
    # Skipping a replay never undoes having finished it.
    if outcome == "skipped" and seen.get(tour) == "finished":
        return
    seen[tour] = outcome
    # A new dict, so the JSON column sees the change.
    user.tours_seen = seen
