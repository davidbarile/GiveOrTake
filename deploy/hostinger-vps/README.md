# Hostinger VPS deployment for Give or Take

This repo can run on a Hostinger VPS without major architecture changes.

Recommended production layout:
- Next.js web app on `127.0.0.1:3001`
- NestJS API on `127.0.0.1:4000`
- Nginx reverse proxy on ports `80/443`
- PostgreSQL as an external managed database (recommended: Supabase/Neon) or on-VPS Postgres
- Redis as an external managed Redis (recommended: Upstash/Redis Cloud) or on-VPS Redis
- PM2 to supervise both Node processes

Why this layout:
- keeps frontend and API on the same public origin
- preserves cookie auth
- preserves Socket.IO realtime updates through `/ws`
- avoids cross-origin production complexity

## 1. VPS prerequisites

On the VPS:

```bash
sudo apt update && sudo apt upgrade -y
sudo apt install -y git nginx
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
pm2 -v
nginx -v
```

Use Node 22 because the repo requires `>=22.13`.

## 2. Get the code onto the VPS

```bash
cd /home/YOUR_SITE_USER/htdocs/YOUR_DOMAIN
git clone YOUR_REPO_URL GiveOrTake
cd GiveOrTake
pnpm install --frozen-lockfile
pnpm -r build
```

## 3. Production environment

Use the example values from `deploy/hostinger-vps/env.production.example`.

Important production values:
- `CORS_ORIGIN=https://YOUR_DOMAIN`
- `NEXT_PUBLIC_API_URL=https://YOUR_DOMAIN/api`
- `NEXT_PUBLIC_WS_URL=https://YOUR_DOMAIN`
- `SESSION_SECRET=` a long random secret
- `DATABASE_URL=` your production Postgres connection string
- `REDIS_URL=` your production Redis connection string

Because the frontend is built with public env vars, set the web env before running the production build.

## 4. Start the processes with PM2

Edit `ecosystem.config.cjs` first:
- replace `YOUR_SITE_USER`
- replace `YOUR_DOMAIN`
- replace DB/Redis credentials
- replace `SESSION_SECRET`

Then:

```bash
cd /home/YOUR_SITE_USER/htdocs/YOUR_DOMAIN/GiveOrTake
pm2 start ecosystem.config.cjs
pm2 save
pm2 status
```

Useful commands:

```bash
pm2 logs give-or-take-api
pm2 logs give-or-take-web
pm2 restart give-or-take-api
pm2 restart give-or-take-web
```

## 5. Nginx reverse proxy

Use `deploy/hostinger-vps/nginx-give-or-take.conf` as the site config.

Install it:

```bash
sudo cp deploy/hostinger-vps/nginx-give-or-take.conf /etc/nginx/sites-available/give-or-take
sudo ln -s /etc/nginx/sites-available/give-or-take /etc/nginx/sites-enabled/give-or-take
sudo nginx -t
sudo systemctl reload nginx
```

You must replace `YOUR_DOMAIN` in the config first.

## 6. SSL

After DNS points to the VPS:

```bash
sudo apt install -y certbot python3-certbot-nginx
sudo certbot --nginx -d YOUR_DOMAIN -d www.YOUR_DOMAIN
```

## 7. Database migration

If using Postgres for the first time:

```bash
cd /home/YOUR_SITE_USER/htdocs/YOUR_DOMAIN/GiveOrTake
DATABASE_URL='your-production-url' pnpm exec prisma db push --schema=prisma/schema.prisma
```

## 8. Health checks

```bash
curl -I http://127.0.0.1:3001
curl -I http://127.0.0.1:4000/api/session/me
curl -I https://YOUR_DOMAIN
curl -I https://YOUR_DOMAIN/api/session/me
```

Expected behavior:
- web root returns 200
- API `/api/session/me` returns 401 without a session cookie

## 9. Architecture notes specific to this repo

Current repo facts:
- web production server starts on port 3001
- API defaults to port 4000
- API sets global prefix `/api`
- websocket namespace is `/ws`
- API cookie auth uses `got_session`

Those defaults are already compatible with the provided Nginx config.

## 10. Recommended first production deployment path

Fastest stable path:
- Host the app on the VPS
- Put Postgres on Supabase or Neon
- Put Redis on Upstash or Redis Cloud

That minimizes server maintenance while keeping the app architecture intact.
