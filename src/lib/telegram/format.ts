/**
 * Telegram briefing text. Pure so the pipeline and the tests share one formatter.
 *
 * Telegram caps a message at 4096 characters. A long briefing is truncated
 * rather than split: two messages would look like two briefings, and the second
 * can arrive after the reader has already left the chat.
 */

export const TELEGRAM_MAX = 4096;

export type TelegramStory = {
  title: string;
  why: string;
  href: string;
};

export function escapeHtml(value: string): string {
  return value.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

export function parseStartCommand(text: string): string | null {
  const match = /^\/start(?:@\S+)?(?:\s+(\S+))?/.exec(text.trim());
  const payload = match?.[1];
  return payload && payload.length > 0 ? payload : null;
}

export function formatTelegramBriefing(input: {
  scheduledFor: Date;
  items: TelegramStory[];
  briefingHref: string;
}): string {
  const date = input.scheduledFor.toLocaleDateString("en-GB", {
    weekday: "long",
    day: "numeric",
    month: "long",
  });

  if (input.items.length === 0) {
    return clip(
      `<b>Your nyuz — a quiet ${escapeHtml(date)}</b>\n\n` +
        "Nothing crossed the threshold you set.\n\n" +
        `<a href="${escapeHtml(input.briefingHref)}">Open nyuz</a>`,
    );
  }

  const blocks = input.items.map((item, i) => {
    const n = String(i + 1).padStart(2, "0");
    const why = item.why.trim();
    return (
      `<b>${n}. ${escapeHtml(item.title)}</b>` +
      (why ? `\n${escapeHtml(why)}` : "") +
      `\n<a href="${escapeHtml(item.href)}">Read</a>`
    );
  });

  return clip(
    `<b>Your nyuz — ${escapeHtml(date)}</b>\n\n` +
      blocks.join("\n\n") +
      `\n\n<a href="${escapeHtml(input.briefingHref)}">Open nyuz</a>`,
  );
}

export function formatTelegramAlert(input: { title: string; why: string; href: string }): string {
  const why = input.why.trim();
  return clip(
    `<b>Breaking · ${escapeHtml(input.title)}</b>` +
      (why ? `\n${escapeHtml(why)}` : "") +
      `\n\n<a href="${escapeHtml(input.href)}">Read the story</a>`,
  );
}

function clip(text: string): string {
  if (text.length <= TELEGRAM_MAX) return text;
  return `${text.slice(0, TELEGRAM_MAX - 1)}…`;
}
