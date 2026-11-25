import { defineConfig, loadEnv } from 'vite';

// Supabase settings without the VITE_ prefix: Vercel will not save a key-like
// variable with a public framework prefix. Only these two names are baked into the
// game at build time (from .env.local or the Vercel project settings); every other
// variable stays out of the browser bundle. Both values are public by design.
const PUBLIC_VARS = ['SUPABASE_URL', 'SUPABASE_PUBLISHABLE_KEY'] as const;

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), '');
  const define: Record<string, string> = {};
  for (const k of PUBLIC_VARS) define[`__${k}__`] = JSON.stringify((process.env[k] ?? env[k] ?? '').trim());
  return { define };
});
