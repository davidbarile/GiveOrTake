/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  // Keep production-build artifacts separate from dev-server artifacts.
  // Running `next build` while `next dev` is active can otherwise mutate `.next`
  // and leave the dev server looking for a missing server chunk such as `./343.js`.
  distDir: process.env.NODE_ENV === 'production' ? '.next-build' : '.next-dev',
  webpack: (config, { dev }) => {
    // Next/webpack's filesystem cache can keep references to pack files that no longer
    // exist after aggressive cache cleanup or interrupted dev sessions. In dev, prefer
    // reliability over rebuild speed and keep the cache in-memory only.
    if (dev) {
      config.cache = false;
    }
    return config;
  },
};

export default nextConfig;
