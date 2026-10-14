# dz-pk Docker Deploy Plan

## Files

| File | Role |
|------|------|
| `server/bankroll.mjs` | GET/POST `/api/bankroll` |
| `deploy/nginx.conf` | static + API proxy |
| `Dockerfile` | multi-stage: build / api / web |
| `docker-compose.yml` | api + web, port 1111, data volume |
| `.dockerignore` | exclude node_modules, .git, data |

## Tasks

1. Add bankroll API + nginx + Docker files
2. Local build sanity (`docker compose build`) if feasible
3. Deploy via remote-server skill and start compose
4. Verify `http://host:1111` and bankroll API
