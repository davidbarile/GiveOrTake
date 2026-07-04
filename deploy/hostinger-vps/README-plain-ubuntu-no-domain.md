# Give or Take on a plain Ubuntu Hostinger VPS with no domain

This is the right deployment path for the current repo.

Current app architecture already fits a VPS well:
- Next.js frontend
- NestJS API
- PostgreSQL
- Redis
- Socket.IO realtime

## Important no-domain constraint

If you deploy by raw IP over plain HTTP, secure cookies will not work if they are forced on.

This repo now supports:
- `COOKIE_SECURE=false`

Use that until you later add a real domain + HTTPS.

## Recommended topology

Run everything on the VPS:
- nginx on port 80
- web app on 127.0.0.1:3001
- API on 127.0.0.1:4000
- Postgres in Docker on 127.0.0.1:5432
- Redis in Docker on 127.0.0.1:6379
- PM2 for the two Node processes

Public URL:
- `http://VPS_IP/`

## 1. Base packages on Ubuntu

```bash
sudo apt update && sudo apt upgrade -y
sudo apt install -y git curl nginx ca-certificates docker.io docker-compose-v2
sudo systemctl enable --now docker
curl -fsSL https://deb.nodesource.com/setup_22.x | sudo -E bash -
sudo apt install -y nodejs
sudo corepack enable
corepack prepare pnpm@11.9.0 --activate
sudo npm install -g pm2
```

Verify:

```bash
node -v
pnpm -v
docker --version
docker compose version
pm2 -v
nginx -v
```

## 2. Upload the project from your Mac without GitHub

From your Mac:

```bash
cd /Users/davidbarile/Documents/HermesWorkspace
tar --exclude='GiveOrTake/node_modules' \
    --exclude='GiveOrTake/apps/web/.next' \
    --exclude='GiveOrTake/apps/api/dist' \
    --exclude='GiveOrTake/.git' \
    -czf give-or-take-deploy.tgz GiveOrTake
scp give-or-take-deploy.tgz root@VPS_IP:/root/
```

On the VPS:

```bash
mkdir -p /opt/give-or-take
cd /opt/give-or-take
tar -xzf /root/give-or-take-deploy.tgz --strip-components=1
```

If you prefer a non-root deploy user, create one and place the app under `/home/<user>/give-or-take` instead.

## 3. Start Postgres and Redis on the VPS

From the app directory on the VPS:

```bash
cd /opt/give-or-take
docker compose -f infrastructure/docker/docker-compose.yml up -d
sudo docker compose -f infrastructure/docker/docker-compose.yml ps
```

That compose file already defines:
- Postgres 16 on 5432
- Redis 7 on 6379

## 4. Create production env files for the VPS IP

Copy the example and replace `VPS_IP`:

```bash
cd /opt/give-or-take
cp deploy/hostinger-vps/env.vps-ip.example .env.vps-ip
nano .env.vps-ip
```

Minimum values to set:
- `CORS_ORIGIN=http://VPS_IP`
- `NEXT_PUBLIC_API_URL=http://VPS_IP/api`
- `NEXT_PUBLIC_WS_URL=http://VPS_IP`
- `COOKIE_SECURE=false`
- `SESSION_SECRET=<long random secret>`
- `DATABASE_URL=postgresql://devuser:devpass@127.0.0.1:5432/give_or_take`
- `REDIS_URL=redis://127.0.0.1:6379`

## 5. Install dependencies and build

Because Next.js bakes public env vars into the build, export them before building:

```bash
cd /opt/give-or-take
set -a
source ./.env.vps-ip
set +a
pnpm install --frozen-lockfile
pnpm -r build
```

## 6. Push the schema to Postgres

```bash
cd /opt/give-or-take
set -a
source ./.env.vps-ip
set +a
pnpm exec prisma db push --schema=prisma/schema.prisma
```

## 7. Start both Node apps under PM2

Use these commands directly:

```bash
cd /opt/give-or-take
set -a
source ./.env.vps-ip
set +a
pm2 start "pnpm --filter @got/api start" --name give-or-take-api
pm2 start "pnpm --filter @got/web start" --name give-or-take-web
pm2 save
pm2 status
```

Useful logs:

```bash
pm2 logs give-or-take-api --lines 100
pm2 logs give-or-take-web --lines 100
```

## 8. Put nginx in front of the apps

Install the IP-based nginx config:

```bash
sudo cp deploy/hostinger-vps/nginx-give-or-take-ip.conf /etc/nginx/sites-available/give-or-take
sudo rm -f /etc/nginx/sites-enabled/default
sudo ln -s /etc/nginx/sites-available/give-or-take /etc/nginx/sites-enabled/give-or-take
sudo nginx -t
sudo systemctl reload nginx
```

## 9. Open firewall ports if needed

If `ufw` is enabled:

```bash
sudo ufw allow 80/tcp
sudo ufw allow 22/tcp
sudo ufw status
```

## 10. Verify end-to-end

On the VPS:

```bash
curl -I http://127.0.0.1:3001
curl -I http://127.0.0.1:4000/api/session/me
curl -I http://127.0.0.1/
curl -I http://127.0.0.1/api/session/me
```

Expected:
- web returns `200`
- API session endpoint returns `401` without a cookie

API smoke test:

```bash
cd /opt/give-or-take
API=http://127.0.0.1:4000/api bash scripts/smoke-api.sh
```

## 11. What to improve later

After you buy or attach a domain:
- switch to `https://YOUR_DOMAIN`
- set `COOKIE_SECURE=true`
- rebuild web with domain-based `NEXT_PUBLIC_*` values
- install certbot and TLS

## 12. Why this path is better than waiting for GitHub

You do not need GitHub first.

For this first deployment, tar + scp is simpler and faster because:
- the repo is local already
- the app is not yet committed remotely
- you can prove the VPS stack works first, then clean up Git later
