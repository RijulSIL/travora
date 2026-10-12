from pydantic import BaseModel, Field


class PermissionMatrixConfigOut(BaseModel):
    config: dict
    # Everything the admin UI needs to render a generic grid without hardcoding its own copy of
    # permission names — see permission_config_service.permission_catalog(). Omitted on PUT's
    # response (the catalog never changes from a save, only `config` does).
    catalog: dict | None = None


class PermissionMatrixConfigUpdate(BaseModel):
    config: dict = Field(...)
