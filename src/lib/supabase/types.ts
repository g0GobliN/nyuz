/**
 * Types for the schema in supabase/migrations/. Hand-written to mirror
 * 0001_init.sql exactly — regenerate once a personal access token is available:
 *
 *   npx supabase gen types typescript --project-id qdnemetjiygvpedomvba > src/lib/supabase/types.ts
 *
 * Columns with a DB default are optional on Insert. Nullable columns are `| null`.
 */

export type PlanTier = "free" | "personal" | "pro";
export type SourceKind =
  "company_blog" | "news" | "rss" | "github" | "research" | "product" | "other";
export type SourcePref = "normal" | "priority" | "muted";
export type TopicImportance = "everything" | "notable" | "only_major";
export type TopicFrequency = "daily" | "weekly" | "breaking_only";
export type EventStatus = "pending" | "analysing" | "complete" | "failed";
export type DigestStatus = "scheduled" | "generating" | "ready" | "sent" | "skipped" | "failed";
export type DeliveryChannel = "email" | "telegram" | "whatsapp";
export type DeliveryStatus = "queued" | "sent" | "failed" | "bounced";
export type DigestFrequency = "daily" | "weekly";
export type BreakingMode = "important" | "everything" | "off";
export type FeedbackVote = "useful" | "not_useful" | "not_interested";

/* Admin console (0003_admin.sql) */
export type AdminRole = "user" | "admin" | "superadmin";
export type PostStatus = "draft" | "scheduled" | "published" | "archived";
/** Mirrors ModelTier in src/lib/ai/deepseek.ts — keep the two in step. */
export type AiCapability = "cluster" | "digest" | "reason";

type Table<Row, Optional extends keyof Row = never> = {
  Row: Row;
  Insert: Omit<Row, Optional> & Partial<Pick<Row, Optional>>;
  Update: Partial<Row>;
  Relationships: [];
};

export type Profile = {
  id: string;
  display_name: string;
  timezone: string;
  onboarded_at: string | null;
  created_at: string;
  /**
   * Mirror of auth.users.email, kept in sync by a trigger (0003). A trigger
   * also clamps it on user-initiated updates, so it is safe to trust here.
   */
  email: string;
  last_seen_at: string | null;
  /** Set the first time the welcome email goes out, so it goes out once. */
  welcomed_at: string | null;
};

export type Subscription = {
  user_id: string;
  plan: PlanTier;
  status: string;
  current_period_end: string | null;
  updated_at: string;
};

export type NotificationPreferences = {
  user_id: string;
  send_at: string;
  timezone: string;
  /** ISO weekday numbers, 1 = Monday .. 7 = Sunday. */
  days: number[];
  channels: DeliveryChannel[];
  frequency: DigestFrequency;
  breaking: BreakingMode;
  /** 0 = minimal .. 100 = deep. */
  density: number;
  instructions: string;
  paused: boolean;
  updated_at: string;
};

export type Topic = { id: string; slug: string; label: string };

export type UserTopic = {
  user_id: string;
  topic_id: string;
  importance: TopicImportance;
  frequency: TopicFrequency;
  keywords: string[];
  exclude_keywords: string[];
  weight: number;
  muted: boolean;
  created_at: string;
};

export type UserExclusion = { user_id: string; term: string };

export type Source = {
  id: string;
  name: string;
  homepage: string | null;
  feed_url: string;
  kind: SourceKind;
  active: boolean;
  last_fetched_at: string | null;
  failure_count: number;
  created_at: string;
};

export type UserSourcePref = { user_id: string; source_id: string; pref: SourcePref };

export type EventRow = {
  id: string;
  title: string;
  what_happened: string;
  /** 0..10 */
  importance: number;
  /** 0..10 */
  novelty: number;
  status: EventStatus;
  before_state: string | null;
  after_state: string | null;
  first_seen_at: string;
  last_updated_at: string;
  analysed_at: string | null;
  analysis_tokens: number;
};

export type Article = {
  id: string;
  source_id: string | null;
  event_id: string | null;
  url: string;
  title: string;
  author: string | null;
  excerpt: string | null;
  published_at: string | null;
  fetched_at: string;
  content_hash: string;
};

export type EventTopic = { event_id: string; topic_id: string; confidence: number };

export type UserEvent = {
  user_id: string;
  event_id: string;
  relevance: number;
  matched_at: string;
};

export type Digest = {
  digest_id: string;
  user_id: string;
  scheduled_for: string;
  generated_at: string | null;
  status: DigestStatus;
  item_count: number;
  generation_tokens: number;
};

export type DigestItem = {
  digest_id: string;
  event_id: string;
  position: number;
  why_it_matters: string;
};

export type Delivery = {
  id: string;
  digest_id: string;
  channel: DeliveryChannel;
  status: DeliveryStatus;
  attempts: number;
  last_error: string | null;
  delivered_at: string | null;
  created_at: string;
};

export type Feedback = {
  user_id: string;
  event_id: string;
  vote: FeedbackVote;
  created_at: string;
};

export type SavedStory = { user_id: string; event_id: string; saved_at: string };

/* ------------------------------------------------------------------------ */
/* Admin console                                                            */
/* ------------------------------------------------------------------------ */

export type UserRole = {
  user_id: string;
  role: AdminRole;
  granted_by: string | null;
  granted_at: string;
};

export type UserBan = {
  user_id: string;
  reason: string;
  banned_by: string | null;
  banned_at: string;
  /** null = indefinite. */
  expires_at: string | null;
};

export type BlogPost = {
  id: string;
  slug: string;
  title: string;
  excerpt: string;
  /** Markdown. Never store rendered HTML here — see 0003_admin.sql. */
  body_md: string;
  cover_url: string | null;
  status: PostStatus;
  tags: string[];
  seo_title: string;
  seo_description: string;
  author_id: string | null;
  author_name: string;
  featured: boolean;
  reading_minutes: number;
  view_count: number;
  published_at: string | null;
  created_at: string;
  updated_at: string;
};

export type AiProvider = {
  id: string;
  slug: string;
  label: string;
  base_url: string;
  /** The NAME of the env var holding the key, never the key itself. */
  api_key_env: string;
  active: boolean;
  notes: string;
  created_at: string;
  updated_at: string;
};

export type AiModelRoute = {
  capability: AiCapability;
  provider_id: string;
  model: string;
  /** Must cover hidden reasoning tokens as well as visible output. */
  max_tokens: number;
  temperature: number | null;
  updated_at: string;
};

export type AiPrompt = {
  key: string;
  label: string;
  system_prompt: string;
  updated_at: string;
};

export type SiteSetting = {
  key: string;
  value: Json;
  updated_by: string | null;
  updated_at: string;
};

export type FeatureFlag = {
  key: string;
  label: string;
  description: string;
  enabled: boolean;
  /** 0..100, bucketed by user id so a user's bucket is stable. */
  rollout_percent: number;
  updated_by: string | null;
  updated_at: string;
};

export type AdminAuditEntry = {
  id: number;
  actor_id: string | null;
  actor_email: string;
  action: string;
  target_type: string;
  target_id: string;
  meta: Json;
  created_at: string;
};

export type Json = string | number | boolean | null | { [key: string]: Json } | Json[];

/** One row of public.admin_daily_counts(). */
export type DailyCount = {
  day: string;
  signups: number;
  digests: number;
  deliveries: number;
  events: number;
  posts: number;
};

export type Database = {
  public: {
    Tables: {
      profiles: Table<
        Profile,
        "display_name" | "timezone" | "onboarded_at" | "created_at" | "email" | "last_seen_at"
      >;
      subscriptions: Table<Subscription, "plan" | "status" | "current_period_end" | "updated_at">;
      notification_preferences: Table<
        NotificationPreferences,
        Exclude<keyof NotificationPreferences, "user_id">
      >;
      topics: Table<Topic, "id">;
      user_topics: Table<
        UserTopic,
        | "importance"
        | "frequency"
        | "keywords"
        | "exclude_keywords"
        | "weight"
        | "muted"
        | "created_at"
      >;
      user_exclusions: Table<UserExclusion>;
      sources: Table<
        Source,
        "id" | "homepage" | "kind" | "active" | "last_fetched_at" | "failure_count" | "created_at"
      >;
      user_source_prefs: Table<UserSourcePref, "pref">;
      events: Table<
        EventRow,
        | "id"
        | "what_happened"
        | "importance"
        | "novelty"
        | "status"
        | "before_state"
        | "after_state"
        | "first_seen_at"
        | "last_updated_at"
        | "analysed_at"
        | "analysis_tokens"
      >;
      articles: Table<
        Article,
        "id" | "source_id" | "event_id" | "author" | "excerpt" | "published_at" | "fetched_at"
      >;
      event_topics: Table<EventTopic, "confidence">;
      user_events: Table<UserEvent, "relevance" | "matched_at">;
      digests: Table<
        Digest,
        "digest_id" | "generated_at" | "status" | "item_count" | "generation_tokens"
      >;
      digest_items: Table<DigestItem, "why_it_matters">;
      deliveries: Table<
        Delivery,
        "id" | "status" | "attempts" | "last_error" | "delivered_at" | "created_at"
      >;
      feedback: Table<Feedback, "created_at">;
      saved_stories: Table<SavedStory, "saved_at">;

      user_roles: Table<UserRole, "role" | "granted_by" | "granted_at">;
      user_bans: Table<UserBan, "reason" | "banned_by" | "banned_at" | "expires_at">;
      blog_posts: Table<BlogPost, Exclude<keyof BlogPost, "slug">>;
      ai_providers: Table<AiProvider, "id" | "active" | "notes" | "created_at" | "updated_at">;
      ai_model_routes: Table<AiModelRoute, "max_tokens" | "temperature" | "updated_at">;
      ai_prompts: Table<AiPrompt, "system_prompt" | "updated_at">;
      site_settings: Table<SiteSetting, "value" | "updated_by" | "updated_at">;
      feature_flags: Table<
        FeatureFlag,
        "label" | "description" | "enabled" | "rollout_percent" | "updated_by" | "updated_at"
      >;
      admin_audit_log: Table<
        AdminAuditEntry,
        "id" | "actor_id" | "actor_email" | "target_type" | "target_id" | "meta" | "created_at"
      >;
    };
    Views: Record<string, never>;
    Functions: {
      /**
       * Not granted to anon or authenticated. Callable only with the
       * service-role key, after the caller's role has been checked in app code.
       */
      admin_daily_counts: {
        Args: { p_days?: number };
        Returns: DailyCount[];
      };
      increment_post_view: {
        Args: { p_slug: string };
        Returns: undefined;
      };
      is_admin: {
        Args: { uid?: string };
        Returns: boolean;
      };
      is_superadmin: {
        Args: { uid?: string };
        Returns: boolean;
      };
    };
    Enums: {
      plan_tier: PlanTier;
      source_kind: SourceKind;
      source_pref: SourcePref;
      topic_importance: TopicImportance;
      topic_frequency: TopicFrequency;
      event_status: EventStatus;
      digest_status: DigestStatus;
      delivery_channel: DeliveryChannel;
      delivery_status: DeliveryStatus;
      digest_frequency: DigestFrequency;
      breaking_mode: BreakingMode;
      feedback_vote: FeedbackVote;
      admin_role: AdminRole;
      post_status: PostStatus;
      ai_capability: AiCapability;
    };
    CompositeTypes: Record<string, never>;
  };
};
