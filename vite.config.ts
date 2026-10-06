import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

function deploymentBase(): string {
  const explicit = process.env.VITE_BASE_PATH?.trim();
  if (explicit) {
    const withLeadingSlash = explicit.startsWith('/') ? explicit : `/${explicit}`;
    return withLeadingSlash.endsWith('/') ? withLeadingSlash : `${withLeadingSlash}/`;
  }

  const repository = process.env.GITHUB_REPOSITORY?.split('/')[1];
  if (process.env.GITHUB_ACTIONS === 'true' && repository) return `/${repository}/`;
  return '/';
}

export default defineConfig({
  plugins: [react()],
  base: deploymentBase(),
  server: {
    host: '0.0.0.0',
    allowedHosts: ['terminal.local'],
  },
  build: {
    sourcemap: false,
    target: 'es2022',
    cssCodeSplit: true,
  },
});
