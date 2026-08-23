import { useQuery } from "@tanstack/react-query";
import { createFileRoute } from "@tanstack/react-router";
import { ExternalLink, Eye, Plus, Trash2, X } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import {
  ConsoleHeader,
  ErrorNote,
  Field,
  Loading,
  Panel,
  Pill,
  formatDate,
  formatDateTime,
  formatNumber,
  inputClass,
  useConsoleMutation,
} from "@/components/admin/shell";
import { Button, Chip } from "@/components/kit";
import { Markdown } from "@/lib/markdown";
import {
  adminListPosts,
  deletePost,
  getPostForEdit,
  savePost,
  type AdminPostRow,
} from "@/lib/server/blog";
import type { PostStatus } from "@/lib/supabase/types";

export const Route = createFileRoute("/admin/blog")({ component: BlogPage });

const STATUSES: PostStatus[] = ["draft", "scheduled", "published", "archived"];

/** The editor's working copy. Mirrors `savePost`'s input, not the row. */
type Draft = {
  id: string | undefined;
  slug: string;
  title: string;
  excerpt: string;
  bodyMd: string;
  coverUrl: string;
  status: PostStatus;
  tags: string;
  seoTitle: string;
  seoDescription: string;
  featured: boolean;
  publishedAt: string;
};

const EMPTY: Draft = {
  id: undefined,
  slug: "",
  title: "",
  excerpt: "",
  bodyMd: "",
  coverUrl: "",
  status: "draft",
  tags: "",
  seoTitle: "",
  seoDescription: "",
  featured: false,
  publishedAt: "",
};

function BlogPage() {
  const [status, setStatus] = useState<PostStatus | "">("");
  const [search, setSearch] = useState("");
  const [editing, setEditing] = useState<Draft | null>(null);

  const posts = useQuery({
    queryKey: ["admin", "posts", status, search],
    queryFn: () =>
      adminListPosts({
        data: { search, ...(status ? { status } : {}) },
      }),
    staleTime: 15_000,
  });

  const remove = useConsoleMutation(deletePost, [
    ["admin", "posts"],
    ["admin", "overview"],
  ]);
  const [confirmDelete, setConfirmDelete] = useState<string | null>(null);

  const rows = posts.data ?? [];

  return (
    <>
      <ConsoleHeader
        title="Blog"
        sub="Posts are written in Markdown and rendered as React nodes on the public site — never as raw HTML. That means a pasted <script> tag shows up as text, so an editor cannot inject code into the marketing pages."
      >
        <Button variant="primary" onClick={() => setEditing({ ...EMPTY })}>
          <Plus className="h-4 w-4" /> New post
        </Button>
      </ConsoleHeader>

      <Panel>
        <div className="flex flex-wrap items-center gap-3">
          <input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search titles"
            className={`${inputClass} mt-0 max-w-xs`}
            aria-label="Search posts"
          />
          <div className="flex flex-wrap gap-1.5">
            <Chip active={status === ""} onClick={() => setStatus("")}>
              All
            </Chip>
            {STATUSES.map((s) => (
              <Chip key={s} active={status === s} onClick={() => setStatus(s)}>
                {s}
              </Chip>
            ))}
          </div>
        </div>

        <ErrorNote error={posts.error} />
        <ErrorNote error={remove.error} />

        {posts.isLoading ? (
          <Loading label="Loading posts" />
        ) : rows.length === 0 ? (
          <p className="py-10 text-[13.5px] text-muted-foreground">
            Nothing here yet. A first post is the cheapest SEO you will ever ship.
          </p>
        ) : (
          <ul className="mt-5 divide-y divide-[var(--hairline)]">
            {rows.map((row) => (
              <PostRow
                key={row.id}
                row={row}
                onEdit={() => void openForEdit(row.id, setEditing)}
                confirming={confirmDelete === row.id}
                onAskDelete={() => setConfirmDelete(row.id)}
                onCancelDelete={() => setConfirmDelete(null)}
                onDelete={() => {
                  remove.mutate({ data: { id: row.id } });
                  setConfirmDelete(null);
                }}
              />
            ))}
          </ul>
        )}
      </Panel>

      {editing ? (
        <Editor draft={editing} onChange={setEditing} onClose={() => setEditing(null)} />
      ) : null}
    </>
  );
}

/**
 * The list carries only the columns needed to render a row, so opening the
 * editor fetches the full record. Loading the bodies of two hundred posts to
 * populate a list nobody reads them from would be the alternative.
 */
async function openForEdit(id: string, set: (draft: Draft) => void): Promise<void> {
  const post = await getPostForEdit({ data: { id } });
  set({
    id: post.id,
    slug: post.slug,
    title: post.title,
    excerpt: post.excerpt,
    bodyMd: post.body_md,
    coverUrl: post.cover_url ?? "",
    status: post.status,
    tags: post.tags.join(", "),
    seoTitle: post.seo_title,
    seoDescription: post.seo_description,
    featured: post.featured,
    publishedAt: post.published_at ?? "",
  });
}

function PostRow({
  row,
  onEdit,
  confirming,
  onAskDelete,
  onCancelDelete,
  onDelete,
}: {
  row: AdminPostRow;
  onEdit: () => void;
  confirming: boolean;
  onAskDelete: () => void;
  onCancelDelete: () => void;
  onDelete: () => void;
}) {
  return (
    <li className="flex flex-wrap items-center gap-x-4 gap-y-2 py-3.5">
      <button onClick={onEdit} className="min-w-0 flex-1 text-left">
        <p className="truncate font-medium">
          {row.title}
          {row.featured ? <span className="ml-2 text-signal">★</span> : null}
        </p>
        <p className="truncate text-[12px] text-muted-foreground">
          /{row.slug} · {row.readingMinutes} min · edited {formatDate(row.updatedAt)}
          {row.publishedAt ? ` · live ${formatDate(row.publishedAt)}` : ""}
        </p>
      </button>

      <span className="flex items-center gap-1.5 text-[12px] text-muted-foreground">
        <Eye className="h-3.5 w-3.5" />
        <span className="tabular-nums">{formatNumber(row.viewCount)}</span>
      </span>

      <Pill tone={row.status === "published" ? "signal" : "outline"}>{row.status}</Pill>

      {row.status === "published" ? (
        <a
          href={`/blog/${row.slug}`}
          target="_blank"
          rel="noreferrer"
          className="text-muted-foreground transition-colors hover:text-foreground"
          aria-label="View live"
        >
          <ExternalLink className="h-4 w-4" />
        </a>
      ) : null}

      {confirming ? (
        <span className="flex items-center gap-2">
          <Button size="sm" variant="signal" onClick={onDelete}>
            Delete
          </Button>
          <Button size="sm" variant="ghost" onClick={onCancelDelete}>
            Keep
          </Button>
        </span>
      ) : (
        <button
          onClick={onAskDelete}
          className="rounded-full p-2 text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
          aria-label={`Delete ${row.title}`}
        >
          <Trash2 className="h-4 w-4" />
        </button>
      )}
    </li>
  );
}

/* ---------------------------------------------------------------------- */
/* Editor                                                                 */
/* ---------------------------------------------------------------------- */

function Editor({
  draft,
  onChange,
  onClose,
}: {
  draft: Draft;
  onChange: (draft: Draft) => void;
  onClose: () => void;
}) {
  const [preview, setPreview] = useState(false);
  const save = useConsoleMutation(savePost, [
    ["admin", "posts"],
    ["admin", "overview"],
  ]);

  const set = <K extends keyof Draft>(key: K, value: Draft[K]) =>
    onChange({ ...draft, [key]: value });

  const tags = useMemo(
    () =>
      draft.tags
        .split(",")
        .map((t) => t.trim())
        .filter(Boolean)
        .slice(0, 20),
    [draft.tags],
  );

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape" && !save.isPending) onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose, save.isPending]);

  const submit = () => {
    save.mutate(
      {
        data: {
          ...(draft.id ? { id: draft.id } : {}),
          slug: draft.slug,
          title: draft.title,
          excerpt: draft.excerpt,
          bodyMd: draft.bodyMd,
          // An empty string is not a URL, and the column is nullable — send null
          // rather than failing validation on a field the author left blank.
          coverUrl: draft.coverUrl.trim() ? draft.coverUrl.trim() : null,
          status: draft.status,
          tags,
          seoTitle: draft.seoTitle,
          seoDescription: draft.seoDescription,
          featured: draft.featured,
          publishedAt: draft.publishedAt ? new Date(draft.publishedAt).toISOString() : null,
        },
      },
      { onSuccess: () => onClose() },
    );
  };

  return (
    <div className="fixed inset-0 z-50 overflow-y-auto bg-background">
      <div className="glass sticky top-0 z-10 border-b border-hairline">
        <div className="mx-auto flex max-w-5xl flex-wrap items-center gap-3 px-5 py-3.5 sm:px-7">
          <p className="mr-auto text-[11px] font-semibold uppercase tracking-[0.18em] text-muted-foreground">
            {draft.id ? "Edit post" : "New post"}
          </p>
          <Chip active={preview} onClick={() => setPreview((v) => !v)}>
            {preview ? "Editing" : "Preview"}
          </Chip>
          <Button size="sm" variant="primary" disabled={save.isPending} onClick={submit}>
            {save.isPending ? "Saving…" : "Save"}
          </Button>
          <button
            onClick={onClose}
            className="rounded-full p-2 text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
            aria-label="Close editor"
          >
            <X className="h-4 w-4" />
          </button>
        </div>
      </div>

      <div className="mx-auto max-w-5xl px-5 py-8 sm:px-7">
        <ErrorNote error={save.error} />

        {preview ? (
          <article className="mx-auto max-w-2xl">
            <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-signal">
              Preview
            </p>
            <h1 className="display mt-3 text-[clamp(1.9rem,5vw,2.8rem)]">
              {draft.title || "Untitled"}
            </h1>
            {draft.excerpt ? (
              <p className="mt-4 font-serif text-[19px] leading-relaxed text-muted-foreground">
                {draft.excerpt}
              </p>
            ) : null}
            <div className="mt-8">
              <Markdown source={draft.bodyMd} />
            </div>
          </article>
        ) : (
          <div className="grid gap-6 lg:grid-cols-[1fr_320px]">
            <div className="space-y-5">
              <Field label="Title">
                <input
                  value={draft.title}
                  onChange={(e) => set("title", e.target.value)}
                  className={inputClass}
                  placeholder="How we keep AI cost flat as readers grow"
                />
              </Field>

              <Field
                label="Slug"
                hint="Leave blank to derive it from the title. Changing it after publishing breaks existing links."
              >
                <input
                  value={draft.slug}
                  onChange={(e) => set("slug", e.target.value)}
                  className={inputClass}
                  placeholder="flat-ai-cost"
                />
              </Field>

              <Field label="Excerpt" hint="Shown on the index and used as the social description.">
                <textarea
                  value={draft.excerpt}
                  onChange={(e) => set("excerpt", e.target.value)}
                  rows={3}
                  className={`${inputClass} resize-y`}
                />
              </Field>

              <Field label="Body" hint="Markdown. Headings, lists, links, quotes, code and images.">
                <textarea
                  value={draft.bodyMd}
                  onChange={(e) => set("bodyMd", e.target.value)}
                  rows={22}
                  spellCheck
                  className={`${inputClass} resize-y font-mono text-[13px] leading-relaxed`}
                />
              </Field>
            </div>

            <aside className="space-y-5">
              <div className="rounded-2xl border border-hairline bg-surface p-5">
                <h3 className="text-[11px] font-semibold uppercase tracking-[0.18em] text-muted-foreground">
                  Publishing
                </h3>
                <div className="mt-3 flex flex-wrap gap-1.5">
                  {STATUSES.map((s) => (
                    <Chip key={s} active={draft.status === s} onClick={() => set("status", s)}>
                      {s}
                    </Chip>
                  ))}
                </div>

                <div className="mt-4">
                  <Field
                    label="Go live"
                    hint={
                      draft.status === "scheduled"
                        ? "Required for a scheduled post. The public query hides posts dated in the future."
                        : "Leave blank to publish now."
                    }
                  >
                    <input
                      type="datetime-local"
                      value={toLocalInput(draft.publishedAt)}
                      onChange={(e) => set("publishedAt", e.target.value)}
                      className={inputClass}
                    />
                  </Field>
                </div>

                <label className="mt-4 flex items-start gap-2.5 text-[13px]">
                  <input
                    type="checkbox"
                    checked={draft.featured}
                    onChange={(e) => set("featured", e.target.checked)}
                    className="mt-0.5 h-4 w-4 accent-[var(--signal)]"
                  />
                  <span>
                    Featured
                    <span className="mt-0.5 block text-[11.5px] text-muted-foreground">
                      Pinned to the top of the blog index.
                    </span>
                  </span>
                </label>
              </div>

              <div className="rounded-2xl border border-hairline bg-surface p-5">
                <h3 className="text-[11px] font-semibold uppercase tracking-[0.18em] text-muted-foreground">
                  Metadata
                </h3>
                <div className="mt-3 space-y-4">
                  <Field label="Tags" hint="Comma separated. Used for the tag filter.">
                    <input
                      value={draft.tags}
                      onChange={(e) => set("tags", e.target.value)}
                      className={inputClass}
                      placeholder="engineering, ai"
                    />
                  </Field>
                  <Field label="Cover image URL" hint="Absolute URL. Optional.">
                    <input
                      value={draft.coverUrl}
                      onChange={(e) => set("coverUrl", e.target.value)}
                      className={inputClass}
                      placeholder="https://…"
                    />
                  </Field>
                  <Field label="SEO title" hint="Falls back to the post title.">
                    <input
                      value={draft.seoTitle}
                      onChange={(e) => set("seoTitle", e.target.value)}
                      className={inputClass}
                    />
                  </Field>
                  <Field label="SEO description" hint="Falls back to the excerpt.">
                    <textarea
                      value={draft.seoDescription}
                      onChange={(e) => set("seoDescription", e.target.value)}
                      rows={3}
                      className={`${inputClass} resize-y`}
                    />
                  </Field>
                </div>
              </div>

              {draft.id ? (
                <p className="text-[11.5px] leading-relaxed text-muted-foreground">
                  Reading time is recalculated from the body on every save.
                  {draft.publishedAt
                    ? ` Currently dated ${formatDateTime(draft.publishedAt)}.`
                    : ""}
                </p>
              ) : null}
            </aside>
          </div>
        )}
      </div>
    </div>
  );
}

/**
 * `datetime-local` will not display an ISO string with a `Z` suffix, so the
 * stored UTC instant is converted to the operator's wall clock for editing and
 * back to ISO on save. Getting this wrong shows a post as an hour late rather
 * than failing, which is why it is a named function and not an inline slice.
 */
function toLocalInput(iso: string): string {
  if (!iso) return "";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}
