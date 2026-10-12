/// <reference types="vite/client" />

/**
 * Only VITE_-prefixed vars are inlined into the browser bundle. Server-side
 * secrets are deliberately absent here — if a secret ever needs adding to this
 * interface, that is the signal it is being read from client code.
 */
interface ImportMetaEnv {
  readonly VITE_SUPABASE_URL: string;
  readonly VITE_SUPABASE_ANON_KEY: string;
  /**
   * The public origin every absolute URL is built from — see `site-origin.ts`.
   *
   * Optional on purpose: an unset variable is `undefined` at runtime rather
   * than absent, and the module that reads it has to handle that. It has been
   * set to a placeholder sentence in this repository before, which is the other
   * thing `site-origin.ts` refuses.
   */
  readonly VITE_SITE_URL?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
