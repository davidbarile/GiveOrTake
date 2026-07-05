---
name: deploy
description: Deploy GiveOrTake — merges v2-dev into main (fast-forward) and pushes, then pulls/builds/restarts the live app on the Hostinger VPS. Use whenever asked to deploy, ship, push to production, or "update the server" for this project.
---

# /deploy

Ships current `v2-dev` work to production: fast-forwards `main`, pushes, then pulls/builds/restarts on the VPS.

## When to use

Any request to deploy, ship, "push and deploy", or "update the server" for the GiveOrTake project.

## Branches

- `main` — deployed/production, always fast-forwarded from `v2-dev`, never edited directly.
- `v2-dev` — active development branch. Do the actual work here.
- `v1-mvp` — frozen historical checkpoint. Never touch unless the user explicitly asks.

## Steps

1. **Check for unrelated uncommitted work on `v2-dev`.**
   ```bash
   git status --short
   ```
   If there's uncommitted work that is NOT part of the current task (e.g. an unfinished refactor sitting in the tree), stash it before switching branches — `git checkout` will refuse to switch if it would overwrite those files:
   ```bash
   git stash push -u -m "wip: <short description> (pre-existing unrelated work)"
   ```
   If a file you need to edit for the current task *also* has unrelated uncommitted changes mixed into it, use the `isolate-edits` skill to stage only your intended edit before committing.

2. **Merge into `main` and push.**
   ```bash
   git checkout main
   git merge v2-dev --ff-only
   git push origin main
   ```

3. **Restore stashed work, if step 1 stashed anything.**
   ```bash
   git checkout v2-dev
   git stash pop
   ```

4. **Pull on the VPS.** SSH alias is `hostinger-vps` (configured in `~/.ssh/config`), app directory is `/opt/give-or-take`.
   ```bash
   ssh hostinger-vps 'cd /opt/give-or-take && git pull origin main'
   ```

5. **If `prisma/schema.prisma` changed in this deploy**, push the schema to the production DB before building anything (check with `git diff <previous-deployed-sha> HEAD -- prisma/schema.prisma` or just recall whether you touched it this session):
   ```bash
   ssh hostinger-vps 'cd /opt/give-or-take && set -a && source ./.env.vps-ip && set +a && pnpm exec prisma db push --schema=prisma/schema.prisma --accept-data-loss'
   ```

6. **Rebuild only the app(s) that changed.** Check which paths changed (`apps/api/` vs `apps/web/`) and only build those — building both every time wastes ~a minute for no reason.
   ```bash
   # if apps/api/** changed:
   ssh hostinger-vps 'cd /opt/give-or-take && set -a && source ./.env.vps-ip && set +a && pnpm --filter @got/api build'
   # if apps/web/** changed:
   ssh hostinger-vps 'cd /opt/give-or-take && set -a && source ./.env.vps-ip && set +a && pnpm --filter @got/web build'
   ```
   Web build note: Next.js bakes `NEXT_PUBLIC_*` vars into the bundle at build time — always `source .env.vps-ip` first or the build will revert to `localhost` fallback URLs.

7. **Restart only the process(es) whose build changed.**
   ```bash
   ssh hostinger-vps 'pm2 restart give-or-take-api give-or-take-web && pm2 status'
   ```
   (restart just `give-or-take-api` or just `give-or-take-web` if only one side was rebuilt)

8. **Verify** both processes show `online`, and optionally confirm the site responds:
   ```bash
   curl -sS -o /dev/null -w "%{http_code}\n" http://2.25.205.14/
   ```

## Key facts

- SSH alias: `hostinger-vps` → app dir `/opt/give-or-take`, env file `.env.vps-ip`.
- PM2 processes: `give-or-take-api` (port 4000), `give-or-take-web` (port 3001).
- Web build output dir is `.next-build` (not the default `.next` — see `apps/web/next.config.mjs`), only relevant if manually inspecting build output.
- This is a plain-HTTP, raw-IP deployment (no domain/TLS) — see `deploy/hostinger-vps/README-plain-ubuntu-no-domain.md` for why `COOKIE_SECURE=false` and similar settings matter; don't "fix" these back to production defaults.
