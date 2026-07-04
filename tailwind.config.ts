import type { Config } from 'tailwindcss';

const config: Config = {
  content: [
    './apps/web/src/pages/**/*.{js,ts,jsx,tsx,mdx}',
    './apps/web/src/components/**/*.{js,ts,jsx,tsx,mdx}',
    './apps/web/src/app/**/*.{js,ts,jsx,tsx,mdx}',
  ],
  theme: {
    extend: {},
  },
  plugins: [],
};

export default config;
