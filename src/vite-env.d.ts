/// <reference types="vite/client" />

/**
 * Only VITE_-prefixed vars are inlined into the browser bundle. Server-side
 * secrets are deliberately absent here — if a secret ever needs adding to this
 * interface, that is the signal it is being read from client code.
 */
interface ImportMetaEnv {
  readonly VITE_SUPABASE_URL: string;
  readonly VITE_SUPABASE_ANON_KEY: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
