/**
 * The chrome every nyuz email renders inside.
 *
 * Email is not the web. There is no external stylesheet, no web font worth
 * relying on, no flexbox in Outlook, and Gmail drops <style> blocks in several
 * contexts — so this is table markup with every rule inlined and every colour
 * written as a literal hex.
 *
 * The palette is the sRGB conversion of the oklch tokens in src/styles.css,
 * hard-coded for the same reason public/logo.svg hard-codes them: a mail client
 * cannot read a custom property. Change them together.
 */

export const PALETTE = {
  ink: "#0d0d0d",
  muted: "#656565",
  hairline: "#e6e6e6",
  surface: "#ffffff",
  surfaceAlt: "#f6f6f6",
  signal: "#c52c2a",
  onSignal: "#ffffff",
} as const;

/** Manrope is the app's face; no mail client will load it, so it leads a stack. */
const FONT =
  "Manrope, -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif";
const SERIF = "Newsreader, Georgia, 'Times New Roman', serif";

export type Email = {
  subject: string;
  html: string;
  text: string;
};

/**
 * Escapes a value on its way into markup.
 *
 * Names, topic strings and email addresses all reach these templates from user
 * input, and an email is a document sent to somebody else's inbox — the one
 * place where an injected tag is hardest to notice and impossible to recall.
 * Every interpolation of a caller-supplied value goes through this.
 */
export function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

/** A body paragraph. */
export function p(html: string): string {
  return `<p style="margin:0 0 16px;font-family:${FONT};font-size:15px;line-height:1.65;color:${PALETTE.ink};">${html}</p>`;
}

/** Secondary text — the same paragraph, quieter. */
export function pMuted(html: string): string {
  return `<p style="margin:0 0 16px;font-family:${FONT};font-size:13.5px;line-height:1.6;color:${PALETTE.muted};">${html}</p>`;
}

/** A boxed aside: what changed, what it costs, when it renews. */
export function panel(rows: { label: string; value: string }[]): string {
  const cells = rows
    .map(
      ({ label, value }) => `
      <tr>
        <td style="padding:6px 0;font-family:${FONT};font-size:13px;color:${PALETTE.muted};">${escapeHtml(label)}</td>
        <td align="right" style="padding:6px 0;font-family:${FONT};font-size:13px;color:${PALETTE.ink};font-weight:500;">${escapeHtml(value)}</td>
      </tr>`,
    )
    .join("");

  return `
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0"
         style="margin:0 0 20px;background:${PALETTE.surfaceAlt};border:1px solid ${PALETTE.hairline};border-radius:14px;">
    <tr><td style="padding:16px 18px;">
      <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0">${cells}</table>
    </td></tr>
  </table>`;
}

/**
 * The call to action.
 *
 * A table rather than a styled <a> because Outlook renders padding on inline
 * elements inconsistently, and a button that collapses to bare text is a dead
 * end in a message the reader cannot re-render.
 */
export function button(label: string, href: string): string {
  return `
  <table role="presentation" cellpadding="0" cellspacing="0" border="0" style="margin:4px 0 24px;">
    <tr><td align="center" style="border-radius:999px;background:${PALETTE.ink};">
      <a href="${escapeHtml(href)}"
         style="display:inline-block;padding:12px 22px;font-family:${FONT};font-size:14px;font-weight:500;color:${PALETTE.surface};text-decoration:none;border-radius:999px;">
        ${escapeHtml(label)}
      </a>
    </td></tr>
  </table>`;
}

export type LayoutInput = {
  /** The grey line inbox lists show after the subject. Never leave it to chance. */
  preheader: string;
  heading: string;
  /** Pre-rendered blocks from the helpers above. */
  body: string;
  /** Absolute origin — every link in an email has to be absolute. */
  baseUrl: string;
  /**
   * Present on anything that is not strictly transactional. A receipt needs no
   * unsubscribe; a "we have not seen you in a week" nudge does, and burying it
   * is what gets a sending domain reported rather than ignored.
   */
  unsubscribeUrl?: string;
};

export function layout({ preheader, heading, body, baseUrl, unsubscribeUrl }: LayoutInput): string {
  const manage = `${baseUrl}/dashboard/settings`;

  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<meta name="color-scheme" content="light">
<meta name="supported-color-schemes" content="light">
<title>${escapeHtml(heading)}</title>
</head>
<body style="margin:0;padding:0;background:${PALETTE.surfaceAlt};">
  <!-- Preheader: shown in the inbox list, never in the open message. Padded so
       the client cannot pull the footer up into the preview. -->
  <div style="display:none;max-height:0;overflow:hidden;opacity:0;">
    ${escapeHtml(preheader)}
    ${"&#8199;&#65279;&#847; ".repeat(60)}
  </div>

  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0"
         style="background:${PALETTE.surfaceAlt};">
    <tr><td align="center" style="padding:32px 16px;">

      <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0"
             style="max-width:560px;background:${PALETTE.surface};border:1px solid ${PALETTE.hairline};border-radius:20px;">
        <tr><td style="padding:32px 28px 8px;">
          <a href="${escapeHtml(baseUrl)}"
             style="font-family:${FONT};font-size:15px;font-weight:600;color:${PALETTE.ink};text-decoration:none;letter-spacing:-0.01em;">
            nyuz
          </a>
        </td></tr>

        <tr><td style="padding:8px 28px 0;">
          <h1 style="margin:0 0 18px;font-family:${SERIF};font-size:26px;line-height:1.25;font-weight:400;color:${PALETTE.ink};">
            ${escapeHtml(heading)}
          </h1>
        </td></tr>

        <tr><td style="padding:0 28px 8px;">${body}</td></tr>

        <tr><td style="padding:8px 28px 28px;">
          <div style="border-top:1px solid ${PALETTE.hairline};padding-top:18px;">
            <p style="margin:0 0 8px;font-family:${FONT};font-size:12px;line-height:1.6;color:${PALETTE.muted};">
              nyuz summarises and links to original reporting. Summaries are generated and can be
              wrong — every story keeps its sources one tap away.
            </p>
            <p style="margin:0;font-family:${FONT};font-size:12px;line-height:1.6;color:${PALETTE.muted};">
              <a href="${escapeHtml(manage)}" style="color:${PALETTE.muted};text-decoration:underline;">Manage your briefing</a>${
                unsubscribeUrl
                  ? ` &nbsp;·&nbsp; <a href="${escapeHtml(unsubscribeUrl)}" style="color:${PALETTE.muted};text-decoration:underline;">Unsubscribe</a>`
                  : ""
              }
            </p>
          </div>
        </td></tr>
      </table>

    </td></tr>
  </table>
</body>
</html>`;
}
