from fastapi.encoders import jsonable_encoder

from app.schemas.reimbursement import ClaimDraftOut


def claim_workflow_bundle_dict(claim, expenses: list, invoice_ids: list[int], trip_ids: list[int]) -> dict:
    """Shape returned by claim workflow endpoints that expose a full claim draft bundle."""
    return jsonable_encoder({
        **ClaimDraftOut.model_validate(claim).model_dump(exclude={"expenses", "invoice_ids", "trip_ids"}),
        "expenses": expenses,
        "invoice_ids": invoice_ids,
        "trip_ids": list(trip_ids),
    })
