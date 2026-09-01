/**
 * Renders every lifecycle email template with sample data, for eyeballing.
 *
 *   node scripts/tsrun.mjs scripts/email-preview.ts
 *   npm run email:preview -- --name "Sam Lee"
 *
 * The templates in src/lib/email/templates.ts are pure functions — no
 * transport, no database — so this needs no .env and sends nothing. It writes
 * static HTML next to each subject line, plus an index that links them all.
 *
 * Output goes to .email-preview/ (gitignored). Open .email-preview/index.html.
 */

import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import {
  briefingEmail,
  breakingEmail,
  briefingsPausedEmail,
  dormantEmail,
  paymentFailedEmail,
  subscriptionCancelledEmail,
  subscriptionStartedEmail,
  waitlistInvitedEmail,
  waitlistJoinedEmail,
  welcomeEmail,
} from "../src/lib/email/templates.ts";
import type { Email } from "../src/lib/email/shell.ts";

const baseUrl = "https://nyuz.app";
const args = process.argv.slice(2);
const nameFlag = args.findIndex((arg) => arg === "--name" || arg.startsWith("--name="));
const nameArg = nameFlag < 0 ? undefined : args[nameFlag];
const name =
  nameArg === "--name"
    ? (args[nameFlag + 1] ?? "Vishal")
    : (nameArg?.slice("--name=".length) ?? "Vishal");

const samples: Record<string, Email> = {
  "01-welcome": welcomeEmail({ name, baseUrl }),
  "02-subscription-started": subscriptionStartedEmail({
    name,
    baseUrl,
    plan: "Personal",
    priceLabel: "$14.99/month",
    renewsOn: new Date("2026-09-30T00:00:00Z"),
  }),
  "03-subscription-cancelled": subscriptionCancelledEmail({
    name,
    baseUrl,
    plan: "Personal",
    accessUntil: new Date("2026-09-30T00:00:00Z"),
  }),
  "04-payment-failed": paymentFailedEmail({
    name,
    baseUrl,
    plan: "Personal",
    retryOn: new Date("2026-09-03T00:00:00Z"),
  }),
  "05-briefings-paused": briefingsPausedEmail({ name, baseUrl }),
  "06-dormant": dormantEmail({
    name,
    baseUrl,
    days: 14,
    unsubscribeUrl: `${baseUrl}/dashboard/delivery?unsub=1`,
  }),
  "07-briefing-with-stories": briefingEmail({
    baseUrl,
    scheduledFor: new Date("2026-08-31T07:30:00+09:00"),
    unsubscribeUrl: `${baseUrl}/dashboard/delivery?unsub=1`,
    items: [
      {
        title: "OpenAI ships GPT-5.2 with a 2M-token context window",
        why: "The context ceiling that made retrieval pipelines necessary just moved — a lot of RAG infrastructure built to work around 128K tokens is now optional, not required.",
        grafs: [
          "OpenAI released GPT-5.2 today, raising the maximum context window from 400,000 to 2 million tokens while cutting per-token cost by roughly 40%. The model is available immediately through the API and ChatGPT Enterprise.",
          "Early benchmarks from the company show retrieval-heavy tasks — codebase-wide refactors, multi-document legal review — completing in a single pass that previously needed a chunking and retrieval layer.",
        ],
        href: `${baseUrl}/dashboard/story/sample-1`,
      },
      {
        title: "EU finalises AI Act enforcement timeline, first fines land March 2027",
        why: "If you ship a model into the EU, the compliance clock most teams treated as abstract now has a real date attached to it.",
        grafs: [
          "The European Commission confirmed the phased enforcement schedule for the AI Act today. High-risk system providers have until March 2027 before the first penalties apply, with transparency obligations for general-purpose models starting this November.",
        ],
        href: `${baseUrl}/dashboard/story/sample-2`,
      },
      {
        title: "Anthropic, Google DeepMind publish joint interpretability benchmark",
        why: "The two labs agreeing on a shared yardstick is the first sign the field might grade interpretability claims the same way it grades capability ones.",
        grafs: [
          "The benchmark, released jointly, scores models on how well their stated reasoning matches the internal computation a probe can recover — an attempt to make 'we understand what the model is doing' a falsifiable claim rather than a talking point.",
        ],
        href: `${baseUrl}/dashboard/story/sample-3`,
      },
    ],
  }),
  "08-briefing-quiet-day": briefingEmail({
    baseUrl,
    scheduledFor: new Date("2026-08-30T07:30:00+09:00"),
    unsubscribeUrl: `${baseUrl}/dashboard/delivery?unsub=1`,
    items: [],
  }),
  "09-breaking-alert": breakingEmail({
    baseUrl,
    unsubscribeUrl: `${baseUrl}/dashboard/delivery?unsub=1`,
    title: "Federal Reserve cuts rates by 50bp in unscheduled announcement",
    why: "A move this size outside a scheduled meeting is the Fed signalling it sees something in the data it isn't waiting to talk about.",
    grafs: [
      "The Federal Reserve cut its benchmark rate by 50 basis points in an unscheduled announcement this afternoon, citing 'emerging signs of labour market weakness' not yet visible in headline figures.",
    ],
    href: `${baseUrl}/dashboard/story/sample-breaking`,
  }),
  "10-waitlist-joined": waitlistJoinedEmail({ name, baseUrl }),
  "11-waitlist-invited": waitlistInvitedEmail({ name, baseUrl }),
};

const outDir = path.resolve(process.cwd(), ".email-preview");
await mkdir(outDir, { recursive: true });

const links = Object.entries(samples)
  .map(
    ([slug, email]) =>
      `<li><a href="${slug}.html">${slug}</a> — <span style="color:#666">${email.subject}</span></li>`,
  )
  .join("\n");

await writeFile(
  path.join(outDir, "index.html"),
  `<!doctype html><html><head><meta charset="utf-8"><title>nyuz email previews</title></head>
  <body style="font-family:system-ui;max-width:640px;margin:40px auto;line-height:1.8;">
  <h1>nyuz — email previews</h1>
  <ul>${links}</ul>
  </body></html>`,
);

for (const [slug, email] of Object.entries(samples)) {
  await writeFile(path.join(outDir, `${slug}.html`), email.html);
  await writeFile(path.join(outDir, `${slug}.txt`), email.text);
}

console.log(`Wrote ${Object.keys(samples).length} previews to ${outDir}`);
console.log(`Open: ${path.join(outDir, "index.html")}`);
