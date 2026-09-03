import type { ReactNode } from "react";

/**
 * A small Markdown renderer that emits React nodes.
 *
 * Why not a library, and why not `innerHTML`: blog bodies are written in the
 * admin console and rendered on the public marketing site. If they were stored
 * or rendered as HTML, anyone who reached an admin session could plant script
 * into every visitor's page. Returning React nodes makes that impossible by
 * construction — text becomes text children, and there is no path from post
 * body to executable markup.
 *
 * The subset is deliberate: headings, paragraphs, bold, italic, inline code,
 * links, images, fenced code, blockquotes, lists and rules. That is what a
 * changelog or announcement post needs. Anything unsupported renders as its
 * literal characters rather than being silently dropped, so a writer can see
 * that it did not work.
 */

type Block =
  | { kind: "heading"; level: 2 | 3 | 4; text: string }
  | { kind: "paragraph"; text: string }
  | { kind: "code"; lang: string; body: string }
  | { kind: "quote"; text: string }
  | { kind: "list"; ordered: boolean; items: string[] }
  | { kind: "rule" };

/** URLs are restricted to schemes that cannot execute — no javascript:, no data:. */
function safeHref(raw: string): string | null {
  const url = raw.trim();
  if (url.startsWith("//")) return null;
  if (/^(https?:\/\/|mailto:|#)/i.test(url)) return url;
  if (url.startsWith("/")) return url;
  return null;
}

function parseBlocks(md: string): Block[] {
  const lines = md.replace(/\r\n/g, "\n").split("\n");
  const blocks: Block[] = [];
  let i = 0;

  while (i < lines.length) {
    const line = lines[i] ?? "";

    if (line.trim() === "") {
      i += 1;
      continue;
    }

    // Fenced code. An unterminated fence runs to the end of the document rather
    // than throwing away the rest of the post.
    const fence = /^```\s*([\w+-]*)\s*$/.exec(line);
    if (fence) {
      const lang = fence[1] ?? "";
      const body: string[] = [];
      i += 1;
      while (i < lines.length && !/^```\s*$/.test(lines[i] ?? "")) {
        body.push(lines[i] ?? "");
        i += 1;
      }
      i += 1;
      blocks.push({ kind: "code", lang, body: body.join("\n") });
      continue;
    }

    if (/^(-{3,}|\*{3,}|_{3,})\s*$/.test(line.trim())) {
      blocks.push({ kind: "rule" });
      i += 1;
      continue;
    }

    const heading = /^(#{2,4})\s+(.*)$/.exec(line);
    if (heading) {
      const hashes = heading[1] ?? "##";
      blocks.push({
        kind: "heading",
        level: hashes.length as 2 | 3 | 4,
        text: (heading[2] ?? "").trim(),
      });
      i += 1;
      continue;
    }

    // A single `#` is treated as h2 as well: the page already has an h1 (the
    // post title), and a second one would be wrong for both outline and SEO.
    const h1 = /^#\s+(.*)$/.exec(line);
    if (h1) {
      blocks.push({ kind: "heading", level: 2, text: (h1[1] ?? "").trim() });
      i += 1;
      continue;
    }

    if (/^>\s?/.test(line)) {
      const quote: string[] = [];
      while (i < lines.length && /^>\s?/.test(lines[i] ?? "")) {
        quote.push((lines[i] ?? "").replace(/^>\s?/, ""));
        i += 1;
      }
      blocks.push({ kind: "quote", text: quote.join(" ").trim() });
      continue;
    }

    const bullet = /^[-*+]\s+(.*)$/.exec(line);
    const numbered = /^\d+[.)]\s+(.*)$/.exec(line);
    if (bullet || numbered) {
      const ordered = numbered !== null;
      const items: string[] = [];
      while (i < lines.length) {
        const current = lines[i] ?? "";
        const match = ordered ? /^\d+[.)]\s+(.*)$/.exec(current) : /^[-*+]\s+(.*)$/.exec(current);
        if (!match) break;
        items.push((match[1] ?? "").trim());
        i += 1;
      }
      blocks.push({ kind: "list", ordered, items });
      continue;
    }

    // Paragraph: consecutive non-blank lines that do not start another block.
    const para: string[] = [];
    while (i < lines.length) {
      const current = lines[i] ?? "";
      if (
        current.trim() === "" ||
        /^```/.test(current) ||
        /^#{1,4}\s/.test(current) ||
        /^>\s?/.test(current) ||
        /^[-*+]\s+/.test(current) ||
        /^\d+[.)]\s+/.test(current) ||
        /^(-{3,}|\*{3,}|_{3,})\s*$/.test(current.trim())
      ) {
        break;
      }
      para.push(current.trim());
      i += 1;
    }
    if (para.length) blocks.push({ kind: "paragraph", text: para.join(" ") });
  }

  return blocks;
}

/**
 * Inline spans. Ordered so that code wins over emphasis — backticks are a
 * verbatim fence, so `**not bold**` inside them must stay literal.
 */
function renderInline(text: string, keyPrefix: string): ReactNode[] {
  const out: ReactNode[] = [];
  // One pass, alternating between "literal text" and the next markup match.
  const pattern =
    /(`[^`]+`)|(!\[[^\]]*\]\([^)]+\))|(\[[^\]]+\]\([^)]+\))|(\*\*[^*]+\*\*)|(\*[^*]+\*)|(_[^_]+_)/g;

  let last = 0;
  let match: RegExpExecArray | null;
  let n = 0;

  while ((match = pattern.exec(text)) !== null) {
    if (match.index > last) out.push(text.slice(last, match.index));
    const token = match[0];
    const key = `${keyPrefix}-${n++}`;

    if (token.startsWith("`")) {
      out.push(
        <code key={key} className="rounded-md bg-muted px-1.5 py-0.5 font-mono text-[0.9em]">
          {token.slice(1, -1)}
        </code>,
      );
    } else if (token.startsWith("![")) {
      const img = /^!\[([^\]]*)\]\(([^)]+)\)$/.exec(token);
      const href = safeHref(img?.[2] ?? "");
      out.push(
        href ? (
          <img
            key={key}
            src={href}
            alt={img?.[1] ?? ""}
            loading="lazy"
            className="my-6 w-full rounded-2xl border border-hairline"
          />
        ) : (
          token
        ),
      );
    } else if (token.startsWith("[")) {
      const link = /^\[([^\]]+)\]\(([^)]+)\)$/.exec(token);
      const href = safeHref(link?.[2] ?? "");
      const label = link?.[1] ?? "";
      const external = href !== null && /^https?:\/\//i.test(href);
      out.push(
        href ? (
          <a
            key={key}
            href={href}
            className="underline decoration-signal decoration-2 underline-offset-2 hover:text-signal"
            {...(external ? { target: "_blank", rel: "noopener noreferrer" } : {})}
          >
            {label}
          </a>
        ) : (
          // Unsafe scheme: show the author what they wrote instead of a dead
          // link, so the mistake is visible.
          token
        ),
      );
    } else if (token.startsWith("**")) {
      out.push(
        <strong key={key} className="font-semibold">
          {token.slice(2, -2)}
        </strong>,
      );
    } else {
      out.push(
        <em key={key} className="italic">
          {token.slice(1, -1)}
        </em>,
      );
    }

    last = match.index + token.length;
  }

  if (last < text.length) out.push(text.slice(last));
  return out;
}

export function Markdown({ source }: { source: string }) {
  const blocks = parseBlocks(source);

  return (
    <div className="space-y-5">
      {blocks.map((block, i) => {
        const key = `b${i}`;
        switch (block.kind) {
          case "heading": {
            const cls =
              block.level === 2
                ? "display mt-10 text-[clamp(1.25rem,3vw,2rem)]"
                : block.level === 3
                  ? "mt-8 text-[19px] font-semibold"
                  : "mt-6 text-[16px] font-semibold";
            const Tag = block.level === 2 ? "h2" : block.level === 3 ? "h3" : "h4";
            return (
              <Tag key={key} className={cls}>
                {renderInline(block.text, key)}
              </Tag>
            );
          }
          case "paragraph":
            return (
              <p key={key} className="text-[15.5px] leading-[1.75] text-foreground/90">
                {renderInline(block.text, key)}
              </p>
            );
          case "code":
            return (
              <pre
                key={key}
                className="overflow-x-auto rounded-2xl border border-hairline bg-surface-2 p-5 text-[13px] leading-relaxed"
              >
                <code data-lang={block.lang || undefined} className="font-mono">
                  {block.body}
                </code>
              </pre>
            );
          case "quote":
            return (
              <blockquote
                key={key}
                className="border-l-2 border-signal pl-5 font-serif text-[17px] leading-relaxed text-muted-foreground"
              >
                {renderInline(block.text, key)}
              </blockquote>
            );
          case "list": {
            const Tag = block.ordered ? "ol" : "ul";
            return (
              <Tag
                key={key}
                className={
                  "space-y-2 pl-6 text-[15.5px] leading-[1.7] text-foreground/90 " +
                  (block.ordered ? "list-decimal" : "list-disc")
                }
              >
                {block.items.map((item, j) => (
                  <li key={`${key}-${j}`}>{renderInline(item, `${key}-${j}`)}</li>
                ))}
              </Tag>
            );
          }
          case "rule":
            return <hr key={key} className="my-10 border-0 border-t border-hairline" />;
        }
      })}
    </div>
  );
}

/** Plain-text excerpt for meta descriptions and cards. */
export function stripMarkdown(md: string, limit = 200): string {
  const text = md
    .replace(/```[\s\S]*?```/g, " ")
    .replace(/!\[[^\]]*\]\([^)]+\)/g, " ")
    .replace(/\[([^\]]+)\]\([^)]+\)/g, "$1")
    .replace(/[#>*_`]/g, "")
    .replace(/\s+/g, " ")
    .trim();
  return text.length > limit ? `${text.slice(0, limit - 1).trimEnd()}…` : text;
}
