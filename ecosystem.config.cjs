module.exports = {
  apps: [
    {
      name: 'give-or-take-api',
      cwd: '/home/YOUR_SITE_USER/htdocs/YOUR_DOMAIN/GiveOrTake',
      script: 'pnpm',
      args: '--filter @got/api start',
      env: {
        NODE_ENV: 'production',
        PORT: '4000',
        CORS_ORIGIN: 'https://YOUR_DOMAIN',
        DATABASE_URL: 'postgresql://USER:PASSWORD@HOST:5432/DB?sslmode=require',
        REDIS_URL: 'redis://default:PASSWORD@HOST:6379',
        SESSION_SECRET: 'replace-with-a-long-random-secret',
      },
    },
    {
      name: 'give-or-take-web',
      cwd: '/home/YOUR_SITE_USER/htdocs/YOUR_DOMAIN/GiveOrTake',
      script: 'pnpm',
      args: '--filter @got/web start',
      env: {
        NODE_ENV: 'production',
        PORT: '3001',
        NEXT_PUBLIC_API_URL: 'https://YOUR_DOMAIN/api',
        NEXT_PUBLIC_WS_URL: 'https://YOUR_DOMAIN',
      },
    },
  ],
};
