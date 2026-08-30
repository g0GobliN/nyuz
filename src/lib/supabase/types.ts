/**
 * Types for the schema in supabase/migrations/. Hand-written, and therefore
 * hand-maintained: a migration that adds a column or a table has to be reflected
 * here in the same commit, or the client silently types the query as `never` and
 * every use of it fails somewhere unrelated. Regenerate once a personal access
 * token is available:
 *
 *   npx supabase gen types typescript --project-id qdnemetjiygvpedomvba > src/lib/supabase/types.ts
 *
 * Columns with a DB default are optional on Insert. Nullable columns are `| null`.
 */

export type PlanTier = "free" | "personal" | "pro";
export type SourceKind =
  "company_blog" | "news" | "rss" | "github" | "research" | "product" | "other";
export type SourcePref = "normal" | "priority" | "muted";
/** Added in 0018. 'core' = editorially selected, monitored regardless of demand. */
export type SourceCoverageMode = "core" | "demand";

/**
 * Where a source came from (0039). Provenance only — never ownership, which
 * lives in `user_custom_sources` because one canonical source has many
 * followers.
 */
export type SourceOrigin = "curated" | "user";
export type TopicImportance = "everything" | "notable" | "only_major";
export type TopicFrequency = "daily" | "weekly" | "breaking_only";
export type EventStatus = "pending" | "analysing" | "complete" | "failed";
export type DigestStatus = "scheduled" | "generating" | "ready" | "sent" | "skipped" | "failed";
export type DigestKind = "briefing" | "alert";
export type DeliveryChannel = "email" | "telegram" | "whatsapp" | "push";
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
  /** Set when the pause confirmation is sent, cleared when briefings resume. */
  paused_notified_at: string | null;
  /** Set only by the inactivity job; presence resumes this kind of pause. */
  auto_paused_at: string | null;
};

export type Subscription = {
  user_id: string;
  plan: PlanTier;
  status: string;
  current_period_end: string | null;
  updated_at: string;
  /**
   * The Stripe identifiers, added by 0005. Null for everyone who has never
   * reached checkout, which is most accounts — both columns carry a *partial*
   * unique index for that reason.
   *
   * They are how an incoming webhook finds the user it is about: Stripe names a
   * customer and a subscription and has never heard of a Supabase user id.
   */
  stripe_customer_id: string | null;
  stripe_subscription_id: string | null;
  /** True between a cancellation and `current_period_end` (0041). */
  cancel_at_period_end: boolean;
};

/**
 * One row per Stripe event already processed (0005).
 *
 * The webhook inserts before doing the work and treats a unique violation as
 * "already done" — Stripe retries for up to three days and does not promise
 * exactly-once delivery. No RLS policies at all: written only with the
 * service-role key, and the absence of a write policy is the write guard.
 */
export type StripeEvent = {
  event_id: string;
  type: string;
  received_at: string;
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
  /**
   * Reading language for story content (0029). BCP-47, default 'en'.
   * Distinct from UI localisation, which is static i18n and unbuilt.
   */
  language: string;
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
  /** Added in 0018. Every pre-0018 row was backfilled to 'core'. */
  coverage_mode: SourceCoverageMode;
  /**
   * Whether readers may discover this source in the catalogue (0039).
   *
   * Deliberately NOT the same question as `coverage_mode`: 27 curated sources
   * are `demand`, so coverage cannot stand in for visibility without hiding
   * real catalogue entries. Defaults false, so a reader-submitted feed is
   * private until somebody promotes it.
   */
  listed: boolean;
  /** Added in 0039. See `SourceOrigin`. */
  origin: SourceOrigin;
  /**
   * When a reader last wanted this source (0031). Drives the grace period
   * before zero-demand collection stops. Null means "not yet measured",
   * which is treated as eligible — see `sources_to_collect`.
   */
  last_demand_at: string | null;
  /**
   * When this source last published something new (0032) — not when it was
   * last read. Drives cadence decay in `recompute_polling_tiers`.
   */
  last_new_content_at: string | null;
  /** Learned cadence band (0032). Set by `recompute_polling_tiers`, never by hand. */
  polling_tier: PollingTier;
};

export type PollingTier = "hot" | "normal" | "low" | "cold" | "paused";

/**
 * What the deterministic cluster layer would have decided versus what the
 * model did (0033). Measurement only — nothing reads it to make a decision.
 * No RLS policies: service-role only, unreachable from a browser.
 */
export type ClusterShadowLog = {
  id: number;
  article_id: string;
  article_title: string;
  candidates: number;
  shadow_verdict: "same" | "different" | "ambiguous";
  shadow_matched_id: string | null;
  model_matched_id: string | null;
  /** Null when the shadow verdict was ambiguous — nothing to compare. */
  agreed: boolean | null;
  created_at: string;
};

/** Per-tier fetch interval (0032). A table so cadence is tunable without a deploy. */
export type PollingTierRow = {
  tier: PollingTier;
  interval_minutes: number;
  label: string;
  description: string;
};

export type UserSourcePref = {
  user_id: string;
  source_id: string;
  pref: SourcePref;
  created_at: string;
};

/**
 * A reader's request that nyuz watch a source (0030). The `sources` row is
 * shared — many followers, one crawler. No insert policy: adding a follow
 * goes through `claim_custom_source`, which is where the plan cap lives.
 */
export type UserCustomSource = {
  user_id: string;
  source_id: string;
  active: boolean;
  created_at: string;
  updated_at: string;
};

/**
 * Somebody turned away by the capacity gate who left an address (0038).
 *
 * `invited_at` is the closest thing in this schema to a permission: a row
 * carrying one, and no `signed_up_at`, is what lets an address past a full
 * cap. The signup trigger spends it, which is why the row is kept after
 * signup rather than deleted -- it is the record of who was admitted, when.
 */
export type WaitlistEntry = {
  id: string;
  email: string;
  name: string;
  note: string;
  created_at: string;
  invited_at: string | null;
  signed_up_at: string | null;
};

export type AlertClaim = { user_id: string; event_id: string; created_at: string };
export type AiUsageLedger = {
  id: string;
  user_id: string | null;
  capability: AiCapability;
  model: string;
  prompt_tokens: number;
  completion_tokens: number;
  reserved_tokens: number;
  created_at: string;
};

export type ImpactStatus = "pending" | "generating" | "complete" | "failed";

/**
 * The shared "why it matters" explanation, one row per event, reused by
 * every reader it is briefed to. Added in 0028 -- see docs/track.md phase 2.
 */
export type EventImpact = {
  event_id: string;
  status: ImpactStatus;
  text: string | null;
  model: string | null;
  prompt_tokens: number;
  completion_tokens: number;
  created_at: string;
  updated_at: string;
};

export type TranslationStatus = "pending" | "generating" | "complete" | "failed";

/**
 * A cached language view of one event's canonical English text (0029).
 * Keyed by (event, language, content_version) — never by user: one row
 * serves every reader of that language. See src/lib/pipeline/translate.ts.
 */
export type EventTranslation = {
  event_id: string;
  /** BCP-47. `zh-Hans`, not bare `zh`. */
  language: string;
  /**
   * Short hash of the English source text this was translated from — and of
   * the editorial profile, so improving a profile invalidates the cache.
   */
  content_version: string;
  /**
   * Which `TRANSLATION_STYLE_VERSION` wrote this row (0040). Not part of the
   * cache key; `content_version` already covers correctness. This is for
   * traceability — asking how much of the cache is still on an older style,
   * which a hash cannot answer.
   */
  style_version: string;
  status: TranslationStatus;
  title: string | null;
  what_happened: string | null;
  before_state: string | null;
  after_state: string | null;
  impact: string | null;
  model: string | null;
  prompt_tokens: number;
  completion_tokens: number;
  created_at: string;
  updated_at: string;
};

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

/**
 * Global source→topic map, added in 0018. Written by admin/pipeline only —
 * no write policy for signed-in users, matching event_topics.
 */
export type SourceTopic = {
  source_id: string;
  topic_id: string;
  confidence: number;
  created_at: string;
  updated_at: string;
};

export type UserEvent = {
  user_id: string;
  event_id: string;
  relevance: number;
  matched_at: string;
  /**
   * Engagement, added in `0016_engagement.sql`. Written only by the server —
   * a browser that could set these could inflate its own relevance.
   */
  impressions: number;
  open_count: number;
  opened_at: string | null;
  read_ms: number;
  reached_end: boolean;
  engaged_at: string | null;
  /** Durable deduplication marker; digest history may be purged independently. */
  briefed_at: string | null;
};

export type Digest = {
  digest_id: string;
  user_id: string;
  scheduled_for: string;
  generated_at: string | null;
  status: DigestStatus;
  item_count: number;
  generation_tokens: number;
  /** Scheduled briefing vs out-of-schedule alert. Default `briefing`. */
  kind: DigestKind;
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

/** Chat id is written only by the bot webhook. No RLS write policy (0013). */
export type TelegramAccount = {
  user_id: string;
  chat_id: string | null;
  connect_nonce: string | null;
  connect_expires_at: string | null;
  linked_at: string | null;
};

export type PushEndpoint = {
  id: string;
  user_id: string;
  endpoint: string;
  p256dh: string;
  auth: string;
  created_at: string;
};

/** One Ask call. RLS on, no policy — service role only (0010). */
export type AskLog = {
  id: string;
  user_id: string;
  event_id: string;
  created_at: string;
};

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
        | "display_name"
        | "timezone"
        | "onboarded_at"
        | "created_at"
        | "email"
        | "last_seen_at"
        | "welcomed_at"
        | "paused_notified_at"
        | "auto_paused_at"
      >;
      subscriptions: Table<
        Subscription,
        | "plan"
        | "status"
        | "current_period_end"
        | "updated_at"
        | "stripe_customer_id"
        | "stripe_subscription_id"
        | "cancel_at_period_end"
      >;
      stripe_events: Table<StripeEvent, "received_at">;
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
        | "listed"
        | "origin"
        | "id"
        | "homepage"
        | "kind"
        | "active"
        | "last_fetched_at"
        | "failure_count"
        | "created_at"
        | "coverage_mode"
        | "last_demand_at"
        | "last_new_content_at"
        | "polling_tier"
      >;
      polling_tiers: Table<PollingTierRow, "label" | "description">;
      cluster_shadow_log: Table<ClusterShadowLog, "id" | "agreed" | "created_at">;
      user_source_prefs: Table<UserSourcePref, "pref" | "created_at">;
      user_custom_sources: Table<UserCustomSource, "active" | "created_at" | "updated_at">;
      waitlist: Table<
        WaitlistEntry,
        "id" | "name" | "note" | "created_at" | "invited_at" | "signed_up_at"
      >;
      source_topics: Table<SourceTopic, "confidence" | "created_at" | "updated_at">;
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
      event_impacts: Table<
        EventImpact,
        | "status"
        | "text"
        | "model"
        | "prompt_tokens"
        | "completion_tokens"
        | "created_at"
        | "updated_at"
      >;
      event_translations: Table<
        EventTranslation,
        | "style_version"
        | "status"
        | "title"
        | "what_happened"
        | "before_state"
        | "after_state"
        | "impact"
        | "model"
        | "prompt_tokens"
        | "completion_tokens"
        | "created_at"
        | "updated_at"
      >;
      user_events: Table<
        UserEvent,
        | "relevance"
        | "matched_at"
        | "impressions"
        | "open_count"
        | "opened_at"
        | "read_ms"
        | "reached_end"
        | "engaged_at"
        | "briefed_at"
      >;
      digests: Table<
        Digest,
        "digest_id" | "generated_at" | "status" | "item_count" | "generation_tokens" | "kind"
      >;
      digest_items: Table<DigestItem, "why_it_matters">;
      deliveries: Table<
        Delivery,
        "id" | "status" | "attempts" | "last_error" | "delivered_at" | "created_at"
      >;
      feedback: Table<Feedback, "created_at">;
      saved_stories: Table<SavedStory, "saved_at">;
      ask_log: Table<AskLog, "id" | "created_at">;
      alert_claims: Table<AlertClaim, "created_at">;
      ai_usage_ledger: Table<
        AiUsageLedger,
        "id" | "user_id" | "prompt_tokens" | "completion_tokens" | "reserved_tokens" | "created_at"
      >;
      telegram_accounts: Table<
        TelegramAccount,
        "chat_id" | "connect_nonce" | "connect_expires_at" | "linked_at"
      >;
      push_subscriptions: Table<PushEndpoint, "id" | "created_at">;

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
      /**
       * Per-source article counts for the console list (0007). Left-joined, so a
       * feed that has never been fetched comes back with a count of zero rather
       * than being absent.
       */
      admin_source_stats: {
        Args: Record<string, never>;
        Returns: { source_id: string; article_count: number; latest_article_at: string | null }[];
      };
      /**
       * Added in 0020, extended in 0030 with `direct_followers` (readers who
       * explicitly asked for the source, not just its topics).
       */
      admin_source_demand: {
        Args: Record<string, never>;
        Returns: {
          source_id: string;
          interested_users: number;
          paid_interested_users: number;
          direct_followers: number;
        }[];
      };
      /**
       * Added in 0030. Enforces the per-plan custom-source cap atomically —
       * RLS cannot express "you may have five of these" without racing.
       * Returns 'ok' | 'limit' | 'exists'.
       */
      claim_custom_source: {
        Args: { p_user_id: string; p_source_id: string };
        Returns: string;
      };
      /**
       * Added in 0039. The reader source list: catalogue entries matching the
       * reader's topics, plus their own follows, bounded and paged.
       */
      reader_sources: {
        Args: { p_user_id: string; p_limit?: number; p_offset?: number };
        Returns: {
          id: string;
          name: string;
          kind: SourceKind;
          homepage: string | null;
          is_own: boolean;
        }[];
      };
      /** Added in 0039. Discovery across the whole catalogue plus own sources. */
      search_reader_sources: {
        Args: { p_user_id: string; p_query: string; p_limit?: number };
        Returns: {
          id: string;
          name: string;
          kind: SourceKind;
          homepage: string | null;
          is_own: boolean;
        }[];
      };
      /**
       * Added in 0038. One round trip for the access console: seats taken,
       * plus the three waitlist states.
       */
      admin_access_state: {
        Args: Record<string, never>;
        Returns: {
          seats_used: number;
          waiting: number;
          invited_pending: number;
          admitted: number;
        }[];
      };
      /** Added in 0031. Stamps `sources.last_demand_at`; returns rows touched. */
      refresh_source_demand: {
        Args: Record<string, never>;
        Returns: number;
      };
      /** Added in 0031. Which sources to collect, and the reason for each. */
      sources_to_collect: {
        Args: { p_grace_hours?: number };
        Returns: { source_id: string; eligible: boolean; reason: string }[];
      };
      /** Added in 0032. Relearns each source's cadence band; returns rows touched. */
      recompute_polling_tiers: {
        Args: Record<string, never>;
        Returns: number;
      };
      /**
       * Added in 0033. Shadow agreement split by verdict — the two directions
       * carry very different risk, so they must not be blended. Read this
       * before enabling `deterministic_cluster_skip`.
       */
      cluster_shadow_summary: {
        Args: { p_days?: number };
        Returns: {
          verdict: "same" | "different";
          decided: number;
          agreed: number;
          agreement_rate: number;
        }[];
      };
      /**
       * Added in 0035. One jsonb blob of counted facts about pipeline cost.
       * Shape is `CostIntelligence` in src/lib/server/cost-intelligence.ts.
       */
      admin_cost_intelligence: {
        Args: { p_days?: number };
        Returns: unknown;
      };
      /** Added in 0021. See loadDemand in src/lib/pipeline/analyse.ts. */
      events_with_demand: {
        Args: { p_event_ids: string[] };
        Returns: { event_id: string; has_demand: boolean }[];
      };
      increment_post_view: {
        Args: { p_slug: string };
        Returns: undefined;
      };
      /**
       * Atomically claims one Ask against the daily cap. Service-role only.
       * Returns ok | plan | quota | cooldown.
       */
      claim_ask: {
        Args: {
          p_user_id: string;
          p_event_id: string;
          p_cap: number;
          p_cooldown_ms: number;
        };
        Returns: string;
      };
      claim_alert: {
        Args: { p_user_id: string; p_event_id: string; p_importance: number };
        Returns: string;
      };
      reserve_ai_tokens: {
        Args: {
          p_user_id: string | null;
          p_capability: string;
          p_model: string;
          p_reserve: number;
          p_user_monthly_cap: number;
          p_global_monthly_cap: number;
        };
        Returns: string | null;
      };
      settle_ai_tokens: {
        Args: { p_id: string; p_prompt_tokens: number; p_completion_tokens: number };
        Returns: undefined;
      };
      purge_expired_digests: {
        Args: { p_limit?: number };
        Returns: number;
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
      source_coverage_mode: SourceCoverageMode;
      source_origin: SourceOrigin;
      impact_status: ImpactStatus;
      translation_status: TranslationStatus;
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
