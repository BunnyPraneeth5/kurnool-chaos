// Supabase settings, baked in at build time by vite.config.ts from SUPABASE_URL and
// SUPABASE_PUBLISHABLE_KEY (.env.local locally, Vercel project settings for deploys).
// Both are public by design.

declare const __SUPABASE_URL__: string;
declare const __SUPABASE_PUBLISHABLE_KEY__: string;

export class NetConfigError extends Error {}

export interface NetConfig {
  url: string;
  key: string;
}

/** Throws NetConfigError naming the missing variables. No silent fallback. */
export function readNetConfig(): NetConfig {
  const url = __SUPABASE_URL__.trim();
  const key = __SUPABASE_PUBLISHABLE_KEY__.trim();
  const missing = [!url && 'SUPABASE_URL', !key && 'SUPABASE_PUBLISHABLE_KEY'].filter(Boolean);
  if (missing.length) {
    throw new NetConfigError(
      `This build has no ${missing.join(' or ')}. Add it to .env.local (local) or to the Vercel project settings, then rebuild.`,
    );
  }
  if (!/^https:\/\/[^/]+$/.test(url.replace(/\/$/, ''))) {
    throw new NetConfigError(`SUPABASE_URL should look like https://xxxx.supabase.co, but it is "${url}".`);
  }
  return { url: url.replace(/\/$/, ''), key };
}

export function hasNetConfig(): boolean {
  try {
    readNetConfig();
    return true;
  } catch {
    return false;
  }
}
