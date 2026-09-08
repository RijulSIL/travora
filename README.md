# Travel & Reimbursement Portal

Enterprise Travel & Reimbursement Portal scaffold with a FastAPI backend, React/Vite frontend, and MySQL 8 database.

## Services

- `backend/`: FastAPI API, async SQLAlchemy, Alembic migrations, RBAC, email/password auth, policy engine, expense category and company profile admin APIs.
- `frontend/`: React, Vite, Tailwind CSS, Zustand auth store, protected routes, and admin console pages.
- `db`: MySQL 8.x (run locally on Windows or via Docker Compose).

## Run the backend (local Python on Windows)

The backend talks to your existing local MySQL. DB credentials are kept as separate fields, so passwords containing `@` (like `Prabhats@9654`) work without URL escaping.

```powershell
cd "d:\Digital Transformation\Reimbursement\backend"
python -m venv .venv
.\.venv\Scripts\Activate.ps1
pip install -r requirements.txt
Copy-Item .env.example .env
# Edit .env if your MySQL host/port/user/password/db differ from the defaults
uvicorn app.main:app --reload --host 0.0.0.0 --port 8000
```

On first startup the backend automatically:

1. Connects to MySQL and runs `CREATE DATABASE IF NOT EXISTS <DB_NAME>` (controlled by `DB_CREATE_IF_MISSING`).
2. Applies `alembic upgrade head`.
3. Seeds policy/impact-level/city-group/expense-category reference data (no-op on subsequent runs).
4. Creates the IT_ADMIN account from `ADMIN_EMAIL` / `ADMIN_PASSWORD` if it does not already exist.

The API serves at `http://localhost:8000/api/v1` with health checks at `http://localhost:8000/health` and `http://localhost:8000/api/v1/health`.

## Run the frontend

```powershell
cd "d:\Digital Transformation\Reimbursement\frontend"
npm install
Copy-Item .env.example .env
npm run dev
```

The frontend runs at `http://localhost:3000`. Sign in at `/login` with the `ADMIN_EMAIL` / `ADMIN_PASSWORD` from `backend/.env`. Once logged in, an IT_ADMIN can create additional users from **Admin -> User Management -> Create User**.

## Backend environment (`backend/.env`)

| Variable | Purpose | Default |
| --- | --- | --- |
| `DB_HOST` | MySQL host | `localhost` |
| `DB_PORT` | MySQL port | `3306` |
| `DB_USER` | MySQL user | `root` |
| `DB_PASSWORD` | MySQL password (literal value, `@` and special chars are fine) | _empty_ |
| `DB_NAME` | Schema name to use/create | `trp` |
| `DB_CREATE_IF_MISSING` | Auto-create the schema on startup | `true` |
| `ADMIN_EMAIL` | Bootstrap admin email | `admin@local` |
| `ADMIN_PASSWORD` | Bootstrap admin password | `ChangeMe!123` |
| `ADMIN_FULL_NAME` | Display name for the bootstrap admin | `System Administrator` |
| `SECRET_KEY` | JWT signing secret | `change-me-in-production` |

Other variables (`S3_*`, `CORS_ORIGINS`, token TTLs) match the previous defaults.

## Run via Docker Compose (optional)

The bundled `docker-compose.yml` still works for the full stack against a containerized MySQL. The compose file mounts `backend/.env`, so update `DB_HOST` to the compose service name (`db`) before running:

```powershell
docker compose up --build
```

## Authentication

Authentication is now email + password (SSO has been removed):

- `POST /api/v1/auth/login` -> `{ email, password }` returns an access token and sets the refresh-token cookie.
- `POST /api/v1/auth/refresh` rotates the refresh-token cookie and returns a fresh access token.
- `POST /api/v1/auth/logout` revokes the current refresh token.
- `POST /api/v1/admin/users/create` (IT_ADMIN, `manage_users`) creates a new user with an email + password + role.

User management is handled through the direct admin create flow. Supplying an optional employee ID creates or links the matching employee profile.

## CI Baseline

- GitHub Actions workflow: `.github/workflows/ci.yml`
- Backend gate: `ruff check app tests` plus smoke compile (`python -m compileall app`)
- Frontend gate: `npm run lint` and `npm run build`

## Development Notes

- The baseline migrations create the policy, employee, user, expense category, and company profile tables in FK-safe dependency order; `0015_user_password` adds `users.full_name` and `users.hashed_password`.
- Initial migrations seed Policy Version `1.0`, SIL impact levels `L1` through `L6D`, Group A/B cities, default expense limits, and out-of-the-box expense categories.
- Sensitive bank fields are encrypted via Fernet in `backend/app/core/encryption.py`.
"# travora" 
