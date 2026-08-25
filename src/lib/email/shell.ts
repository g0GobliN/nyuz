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
  /** Outer canvas — chroma 0, so the letter sits on paper, not a black void. */
  paper: "#f2f2f2",
  signal: "#0573AA",
  /** Same hue as --signal, the dark-mode sRGB from public/logo.svg — readable on ink. */
  signalOnInk: "#55AEE8",
  mutedOnInk: "#a3a3a3",
  onSignal: "#ffffff",
} as const;

/** Manrope is the app's face; no mail client will load it, so it leads a stack. */
const FONT =
  "Manrope, -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif";

/** Same pairing as the site: Newsreader for display, Georgia when the webfont is absent. */
const SERIF = "Newsreader, Georgia, 'Times New Roman', Times, serif";

function wordmark(baseUrl: string): string {
  // A transparent PNG, not the og-image: mail clients cannot render SVG, and the
  // social card is a 1200x630 letterbox that would arrive here as a white slab
  // squeezed into 28px. This one is the bare mark on no field, so it sits on the
  // card rather than in a box of its own.
  const logo = `${baseUrl.replace(/\/+$/, "")}/logo-mark.png`;
  return `
    <a href="${escapeHtml(baseUrl)}" style="text-decoration:none;color:${PALETTE.ink};">
      <table role="presentation" cellpadding="0" cellspacing="0" border="0">
        <tr>
          <td valign="middle" style="padding-right:10px;">
            <img src="${escapeHtml(logo)}" width="28" height="28" alt=""
                 style="display:block;border:0;outline:none;text-decoration:none;width:28px;height:28px;" />
          </td>
          <td valign="middle" style="font-family:${FONT};font-size:16px;font-weight:600;letter-spacing:-0.02em;color:${PALETTE.ink};">nyuz</td>
        </tr>
      </table>
    </a>`;
}

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

/** A body paragraph. 16px so it stays readable on a phone. */
export function p(html: string): string {
  return `<p style="margin:0 0 18px;font-family:${FONT};font-size:16px;line-height:1.7;color:${PALETTE.ink};">${html}</p>`;
}

/** Secondary text — the same paragraph, quieter. */
export function pMuted(html: string): string {
  return `<p style="margin:0 0 16px;font-family:${FONT};font-size:14px;line-height:1.65;color:${PALETTE.muted};">${html}</p>`;
}

/** Uppercase strip above a heading — same voice as the dashboard. */
export function eyebrow(text: string): string {
  return `<p style="margin:0 0 8px;font-family:${FONT};font-size:11px;font-weight:600;letter-spacing:0.16em;text-transform:uppercase;color:${PALETTE.signal};">${escapeHtml(text)}</p>`;
}

/** A boxed aside: what changed, what it costs, when it renews. */
export function panel(rows: { label: string; value: string }[]): string {
  const cells = rows
    .map(
      ({ label, value }, i) => `
      <tr>
        <td style="padding:${i === 0 ? "0" : "12px"} 0 0;font-family:${FONT};font-size:11px;font-weight:600;letter-spacing:0.14em;text-transform:uppercase;color:${PALETTE.muted};">${escapeHtml(label)}</td>
        <td align="right" style="padding:${i === 0 ? "0" : "12px"} 0 0;font-family:${FONT};font-size:15px;color:${PALETTE.ink};font-weight:500;">${escapeHtml(value)}</td>
      </tr>`,
    )
    .join("");

  return `
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0"
         style="margin:8px 0 24px;background:${PALETTE.surfaceAlt};border:1px solid ${PALETTE.hairline};border-radius:8px;">
    <tr><td style="padding:18px 20px;">
      <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0">${cells}</table>
    </td></tr>
  </table>`;
}

/**
 * One story in a briefing: enough paragraphs to know what happened, then a
 * pull to the site for the full piece. Not a teaser card.
 */
export function storyBrief(input: {
  index: number;
  title: string;
  grafs: string[];
  why: string;
  href: string;
  kicker?: string;
  last?: boolean;
}): string {
  const n = String(input.index + 1).padStart(2, "0");
  const kicker = escapeHtml(input.kicker ?? n);
  const grafs = input.grafs.map(
    (g, i) =>
      `<p style="margin:${i === 0 ? "0" : "15px"} 0 0;font-family:${FONT};font-size:16px;line-height:1.75;color:${PALETTE.ink};">${escapeHtml(g)}</p>`,
  );
  const why = input.why.trim()
    ? `
      <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="margin:22px 0 0;">
        <tr>
          <td style="width:3px;background:${PALETTE.signal};font-size:0;line-height:0;">&nbsp;</td>
          <td style="padding:2px 0 2px 14px;">
            <p style="margin:0 0 6px;font-family:${FONT};font-size:11px;font-weight:600;letter-spacing:0.16em;text-transform:uppercase;color:${PALETTE.signal};">Why it matters to you</p>
            <p style="margin:0;font-family:${SERIF};font-size:17px;line-height:1.55;color:${PALETTE.ink};">${escapeHtml(input.why)}</p>
          </td>
        </tr>
      </table>`
    : "";
  const rule = input.last ? "none" : `1px solid ${PALETTE.hairline}`;

  return `
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="margin:0;">
    <tr>
      <td valign="top" width="44" style="width:44px;padding:4px 12px 32px 0;border-bottom:${rule};">
        <p style="margin:0;font-family:${SERIF};font-size:22px;line-height:1;font-weight:500;color:${PALETTE.signal};">${kicker}</p>
      </td>
      <td valign="top" style="padding:0 0 32px;border-bottom:${rule};">
        <h2 style="margin:0 0 14px;font-family:${SERIF};font-size:24px;line-height:1.28;font-weight:500;letter-spacing:-0.02em;color:${PALETTE.ink};">
          ${escapeHtml(input.title)}
        </h2>
        ${grafs.join("")}
        ${why}
        <p style="margin:22px 0 0;font-family:${FONT};font-size:14px;font-weight:600;">
          <a href="${escapeHtml(input.href)}" style="color:${PALETTE.signal};text-decoration:none;border-bottom:1px solid ${PALETTE.signal};">Read the full story on nyuz</a>
        </p>
      </td>
    </tr>
  </table>`;
}

/**
 * Empty briefing — a quiet day, boxed like the dashboard empty state.
 */
export function emptyState(html: string): string {
  return `
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0"
         style="margin:0 0 20px;background:${PALETTE.surfaceAlt};border:1px solid ${PALETTE.hairline};border-radius:8px;">
    <tr><td style="padding:20px 22px 4px;">${html}</td></tr>
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
  <table role="presentation" cellpadding="0" cellspacing="0" border="0" style="margin:4px 0 0;">
    <tr><td style="background:${PALETTE.ink};">
      <a href="${escapeHtml(href)}"
         style="display:inline-block;padding:13px 22px;font-family:${FONT};font-size:14px;font-weight:600;line-height:1.2;letter-spacing:0.02em;color:${PALETTE.surface};text-decoration:none;">
        ${escapeHtml(label)}
      </a>
    </td></tr>
  </table>`;
}

export type LayoutInput = {
  /** The grey line inbox lists show after the subject. Never leave it to chance. */
  preheader: string;
  heading: string;
  /** Small uppercase line above the heading. Same register as the dashboard. */
  eyebrow?: string;
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
  /**
   * Briefings and alerts carry the source disclaimer. Account mail does not —
   * repeating it on a receipt is how every message starts to look the same.
   */
  disclaimer?: boolean;
};

export function layout({
  preheader,
  heading,
  eyebrow: kicker,
  body,
  baseUrl,
  unsubscribeUrl,
  disclaimer,
}: LayoutInput): string {
  const manage = `${baseUrl}/dashboard/settings`;
  const unsub = unsubscribeUrl
    ? ` &nbsp;·&nbsp; <a href="${escapeHtml(unsubscribeUrl)}" style="color:${PALETTE.muted};text-decoration:underline;">Unsubscribe</a>`
    : "";

  const dateCell = kicker
    ? `<td align="right" valign="middle" style="font-family:${FONT};font-size:11px;font-weight:600;letter-spacing:0.14em;text-transform:uppercase;color:${PALETTE.signal};">${escapeHtml(kicker)}</td>`
    : "";

  return `<!doctype html>
<html lang="en" dir="ltr">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<meta name="color-scheme" content="light">
<meta name="supported-color-schemes" content="light">
<title>${escapeHtml(heading)}</title>
</head>
<body style="margin:0;padding:0;background:${PALETTE.paper};">
  <div lang="en" dir="ltr">
  <!-- Preheader: shown in the inbox list, never in the open message. Padded so
       the client cannot pull the footer up into the preview. -->
  <div style="display:none;max-height:0;overflow:hidden;opacity:0;">
    ${escapeHtml(preheader)}
    ${"&#8199;&#65279;&#847; ".repeat(60)}
  </div>

  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0"
         bgcolor="${PALETTE.paper}" style="background:${PALETTE.paper};">
    <tr><td align="center" style="padding:28px 16px 48px;">

      <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0"
             bgcolor="${PALETTE.surface}"
             style="max-width:600px;background:${PALETTE.surface};border:1px solid ${PALETTE.hairline};">
        <tr>
          <td width="5" bgcolor="${PALETTE.signal}" style="width:5px;background:${PALETTE.signal};font-size:0;line-height:0;">&nbsp;</td>
          <td style="padding:0;">

            <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0">
              <tr>
                <td style="padding:28px 36px 0 32px;">
                  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0">
                    <tr>
                      <td valign="middle">${wordmark(baseUrl)}</td>
                      ${dateCell}
                    </tr>
                  </table>
                </td>
              </tr>
              <tr>
                <td style="padding:22px 36px 0 32px;">
                  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0">
                    <tr><td style="height:2px;line-height:2px;font-size:0;background:${PALETTE.ink};">&nbsp;</td></tr>
                    <tr><td style="height:4px;line-height:4px;font-size:0;">&nbsp;</td></tr>
                    <tr><td style="height:1px;line-height:1px;font-size:0;background:${PALETTE.ink};">&nbsp;</td></tr>
                  </table>
                </td>
              </tr>
              <tr>
                <td style="padding:20px 36px 8px 32px;">
                  <h1 style="margin:0;font-family:${SERIF};font-size:34px;line-height:1.15;font-weight:500;letter-spacing:-0.03em;color:${PALETTE.ink};">
                    ${escapeHtml(heading)}
                  </h1>
                </td>
              </tr>
              <tr>
                <td style="padding:20px 36px 8px 32px;">${body}</td>
              </tr>
              <tr>
                <td style="padding:12px 36px 32px 32px;">
                  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0">
                    <tr><td style="height:1px;line-height:1px;font-size:0;background:${PALETTE.hairline};">&nbsp;</td></tr>
                  </table>
                  <div style="padding-top:18px;">
                    ${
                      disclaimer
                        ? `<p style="margin:0 0 10px;font-family:${FONT};font-size:12px;line-height:1.6;color:${PALETTE.muted};">
                      Summaries are generated and can be wrong. The rest of each story — and the reporting it came from — is on nyuz.
                    </p>`
                        : ""
                    }
                    <p style="margin:0;font-family:${FONT};font-size:12px;line-height:1.6;color:${PALETTE.muted};">
                      <a href="${escapeHtml(manage)}" style="color:${PALETTE.muted};text-decoration:underline;">Manage your briefing</a>${unsub}
                    </p>
                  </div>
                </td>
              </tr>
            </table>

          </td>
        </tr>
      </table>

    </td></tr>
  </table>
  </div>
</body>
</html>`;
}
