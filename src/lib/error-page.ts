/**
 * The last-resort error page, served when the app fails before React runs.
 *
 * It cannot import the stylesheet or any component — by the time this is
 * reached the bundle is the thing that failed — so the design tokens are
 * inlined by hand. Keep the two in step: this is the same ink, paper and
 * hairline as `styles.css`, and the same wording as the in-app error page in
 * `__root.tsx`, so a reader cannot tell which one they landed on.
 *
 * No message is interpolated in. Whatever threw here is unfiltered and may be a
 * stack frame or a database string, and this page has no way to run
 * `humanError` over it.
 */
export function renderErrorPage(): string {
  return `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <title>That didn't load — nyuz</title>
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <meta name="robots" content="noindex" />
    <style>
      :root {
        --paper: #fafafa; --ink: #111113; --muted: #6b6b70;
        --hairline: rgba(17, 17, 19, 0.09); --signal: #3d5afe;
      }
      @media (prefers-color-scheme: dark) {
        :root {
          --paper: #0b0b0d; --ink: #f4f4f5; --muted: #8f8f96;
          --hairline: rgba(244, 244, 245, 0.11); --signal: #7c8cff;
        }
      }
      * { box-sizing: border-box; }
      body {
        margin: 0; padding: 4rem 1.25rem; min-height: 100vh;
        display: grid; place-items: center;
        background: var(--paper); color: var(--ink);
        font: 400 15px/1.6 Manrope, ui-sans-serif, system-ui, -apple-system, sans-serif;
        -webkit-font-smoothing: antialiased;
      }
      .card { width: 100%; max-width: 28rem; text-align: center; }
      .eyebrow {
        font-family: Newsreader, ui-serif, Georgia, serif;
        font-size: 13px; letter-spacing: 0.18em; text-transform: uppercase;
        color: var(--muted); margin: 0;
      }
      h1 {
        margin: 1rem 0 0; font-size: clamp(2.2rem, 6vw, 3.25rem);
        font-weight: 600; letter-spacing: -0.03em; line-height: 1.04;
      }
      p.body { margin: 1.25rem 0 0; color: var(--muted); font-size: 14.5px; }
      .actions { margin-top: 2rem; display: flex; gap: 0.75rem; justify-content: center; flex-wrap: wrap; }
      a, button {
        height: 40px; padding: 0 1.25rem; border-radius: 999px;
        font: 500 13.5px/1 Manrope, ui-sans-serif, system-ui, sans-serif;
        display: inline-flex; align-items: center; cursor: pointer;
        text-decoration: none; border: 1px solid transparent;
      }
      .primary { background: var(--ink); color: var(--paper); }
      .secondary { background: transparent; color: var(--ink); border-color: var(--hairline); }
      .mark { display: block; margin: 0 auto 2.5rem; width: 24px; height: 24px; }
    </style>
  </head>
  <body>
    <div class="card">
      <!-- Same geometry as MARK_PATH in src/components/landing/nav.tsx. -->
      <svg class="mark" viewBox="0 0 40 40" fill="none" role="img" aria-label="nyuz">
        <path d="M7.89 34.95V5M7.89 18.85A12.11 12.11 0 0 1 32.11 18.85V29.7"
              stroke="currentColor" stroke-width="3.48" />
        <circle cx="32.11" cy="33.21" r="1.79" fill="var(--signal)" />
      </svg>
      <p class="eyebrow">Error</p>
      <h1>That didn&rsquo;t load.</h1>
      <p class="body">
        Something failed on our side rather than yours. Nothing you have saved is affected &mdash;
        your topics, briefings and history are untouched.
      </p>
      <div class="actions">
        <button class="primary" onclick="location.reload()">Try again</button>
        <a class="secondary" href="/">Back to nyuz</a>
      </div>
    </div>
  </body>
</html>`;
}
