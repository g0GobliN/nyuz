/**
 * PROVISIONAL. Replace with generated types once the migrations are applied:
 *
 *   npx supabase gen types typescript --project-id qdnemetjiygvpedomvba > src/lib/supabase/types.ts
 *
 * Until then this is deliberately permissive so the clients compile. It gives
 * no column-level safety — do not mistake a green typecheck for a query that
 * matches the schema.
 */
export type Database = {
  public: {
    Tables: Record<
      string,
      {
        Row: Record<string, unknown>;
        Insert: Record<string, unknown>;
        Update: Record<string, unknown>;
        Relationships: [];
      }
    >;
    Views: Record<string, never>;
    Functions: Record<string, never>;
    Enums: Record<string, never>;
    CompositeTypes: Record<string, never>;
  };
};
