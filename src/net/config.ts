// Supabase settings come from Vite env vars, baked in at build time
// (.env.local locally, Vercel project settings for deploys). Both are public by design.

export class NetConfigError extends Error {}

export interface NetConfig {
  url: string;
  key: string;
}

/** Throws NetConfigError naming the missing variables. No silent fallback. */
export function readNetConfig(): NetConfig {
  const url = (import.meta.env.VITE_SUPABASE_URL as string | undefined)?.trim() ?? '';
  const key = (import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY as string | undefined)?.trim() ?? '';
  const missing = [!url && 'VITE_SUPABASE_URL', !key && 'VITE_SUPABASE_PUBLISHABLE_KEY'].filter(Boolean);
  if (missing.length) {
    throw new NetConfigError(
      `This build has no ${missing.join(' or ')}. Add it to .env.local (local) or to the Vercel project settings, then rebuild.`,
    );
  }
  if (!/^https:\/\/[^/]+$/.test(url.replace(/\/$/, ''))) {
    throw new NetConfigError(`VITE_SUPABASE_URL should look like https://xxxx.supabase.co, but it is "${url}".`);
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
