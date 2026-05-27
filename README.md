# NCMS

Clean full-stack architecture scaffold.

Stack:
- Django + Django REST Framework
- Simple JWT
- PostgreSQL
- Redis
- Vite + React + TypeScript
- shadcn-style UI components
- nginx reverse proxy
- Docker and production Docker Compose

Local ports:
- Frontend: http://localhost:5175
- Backend: http://localhost:8002
- Public portal through nginx: http://localhost:1515
- Internal admin portal through nginx: http://localhost:1515/login
- Postgres: localhost:5435
- Redis: localhost:6381

## Start

```powershell
docker compose up --build
```

## Production config

```powershell
docker compose --env-file .env.prod -f docker-compose.prod.yml up --build -d
```

## First backend setup

```powershell
docker compose exec backend python manage.py migrate
docker compose exec backend python manage.py createsuperuser
```

## Health

- API: `/api/health/`
- Frontend proxy: `http://localhost:5175/api/health/`
