import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import {
  Outlet,
  Link,
  createRootRouteWithContext,
  useRouter,
  HeadContent,
  Scripts,
} from "@tanstack/react-router";
import { useEffect, useRef, type ReactNode } from "react";

import appCss from "../styles.css?url";
import { humanError } from "../lib/errors";
import { AuthProvider, useAuth } from "../lib/auth";
import { clearAccount, setArchiveAccount } from "../lib/offline/archive";
import { installOfflineArchive } from "../lib/offline/persist";
import { ensureServiceWorker } from "../lib/sw";
import { SHELL_INIT_SCRIPT } from "../lib/display-mode";
import { INSTALL_INIT_SCRIPT, attachInstallEvents } from "../lib/install/prompt";
import { THEME_COLORS, THEME_INIT_SCRIPT } from "../lib/theme";
import { siteOrigin } from "../lib/site-origin";

/**
 * The 404 and the error page.
 *
 * Both used to be built from `bg-primary`, `rounded-md` and `text-7xl` — the
 * shadcn defaults, which appear nowhere else in this product. So the two pages
 * a reader is most likely to hit when something has already gone wrong were
 * also the two that looked least like nyuz, at exactly the moment they are
 * deciding whether the thing is trustworthy. They now use the same display
 * face, hairline borders and single accent as every other page.
 */
function NotFoundComponent() {
  return (
    <div className="flex min-h-screen items-center justify-center bg-background px-5 py-16">
      <div className="w-full max-w-md text-center">
        <p className="font-serif text-[13px] uppercase tracking-[0.18em] text-muted-foreground">
          404
        </p>
        <h1 className="display mt-4 text-[clamp(1.625rem,6vw,3.25rem)]">Nothing here.</h1>
        <p className="mt-5 text-[14.5px] leading-relaxed text-muted-foreground">
          This address does not point at anything. It may have moved, or it may never have existed.
        </p>
        <div className="mt-8 flex flex-wrap justify-center gap-3">
          <Link
            to="/"
            className="inline-flex h-10 items-center justify-center rounded-full bg-foreground px-5 text-[13.5px] font-medium text-background transition-opacity hover:opacity-90"
          >
            Back to nyuz
          </Link>
          <Link
            to="/dashboard"
            className="inline-flex h-10 items-center justify-center rounded-full border border-border px-5 text-[13.5px] transition-colors hover:bg-muted"
          >
            My briefing
          </Link>
        </div>
      </div>
    </div>
  );
}

// `error: unknown` rather than `Error`: the router's own `ErrorRouteComponent`
// widened its prop to `unknown` in 1.168.60, and `humanError` already reads
// anything (a thrown string, an Error, a rejected value). Narrowing it here would
// only re-assert a guarantee the router no longer makes.
function ErrorComponent({ error, reset }: { error: unknown; reset: () => void }) {
  console.error(error);
  const router = useRouter();
  // Empty string when there is nothing readable, which is what hides the box.
  const generic = "Something went wrong. Please try again.";
  const message = humanError(error, generic);
  const detail = message === generic ? "" : message;

  return (
    <div className="flex min-h-screen items-center justify-center bg-background px-5 py-16">
      <div className="w-full max-w-md text-center">
        <p className="font-serif text-[13px] uppercase tracking-[0.18em] text-muted-foreground">
          Error
        </p>
        <h1 className="display mt-4 text-[clamp(1.625rem,6vw,3.25rem)]">That didn&apos;t load.</h1>
        <p className="mt-5 text-[14.5px] leading-relaxed text-muted-foreground">
          Something failed on our side rather than yours. Nothing you have saved is affected — your
          topics, briefings and history are untouched.
        </p>

        {/* The message, when there is a readable one. `humanError` returns the
            fallback for anything that is a stack frame or a JSON blob, so this
            never prints machinery at somebody; and the block is skipped
            entirely when the fallback is all we have, because repeating the
            paragraph above in a box helps nobody. */}
        {detail ? (
          <p className="mt-5 rounded-2xl border border-hairline bg-surface px-4 py-3 text-[13px] leading-relaxed text-muted-foreground">
            {detail}
          </p>
        ) : null}

        <div className="mt-8 flex flex-wrap justify-center gap-3">
          <button
            onClick={() => {
              router.invalidate();
              reset();
            }}
            className="inline-flex h-10 items-center justify-center rounded-full bg-foreground px-5 text-[13.5px] font-medium text-background transition-opacity hover:opacity-90"
          >
            Try again
          </button>
          <a
            href="/"
            className="inline-flex h-10 items-center justify-center rounded-full border border-border px-5 text-[13.5px] transition-colors hover:bg-muted"
          >
            Back to nyuz
          </a>
        </div>
      </div>
    </div>
  );
}

export const Route = createRootRouteWithContext<{ queryClient: QueryClient }>()({
  head: () => ({
    meta: [
      { charSet: "utf-8" },
      // `viewport-fit=cover` is load-bearing, not decoration. Without it the
      // layout viewport is inset to clear the notch and the home indicator, and
      // every `env(safe-area-inset-*)` in the stylesheet resolves to 0 — so the
      // app shell's full-bleed top bar and padded bottom strip would render exactly
      // as if the safe areas had been handled, while sitting under the notch in
      // landscape. It also makes the insets real in a normal browser tab, which
      // is why the site's own fixed chrome pads for them too.
      {
        name: "viewport",
        content: "width=device-width, initial-scale=1, viewport-fit=cover",
      },
      { title: "nyuz — Stop searching. Start knowing." },
      {
        name: "description",
        content:
          "Tell nyuz what matters. It keeps watch across relevant sources, connects duplicate coverage into events, and delivers a personalized information briefing without the noise.",
      },
      { name: "author", content: "nyuz" },
      { name: "theme-color", content: THEME_COLORS.dark },
      // ^ The dark value, which is also the ink an installed window uses. On a
      // client, THEME_INIT_SCRIPT rewrites this to match the reader's theme —
      // except in an installed window, where it stays ink because the shell's
      // top bar is ink in both themes. See themeColorFor in src/lib/theme.ts.
      // Install and standalone behaviour.
      //
      // `display: standalone` in the manifest is what makes an installed app
      // open without browser chrome, and iOS has honoured that since 11.3. The
      // two `-capable` metas are kept anyway: they are what gates
      // `apple-touch-startup-image`, they are what older iOS reads, and they
      // cost two lines. `black-translucent` is the status bar the standalone
      // shell is designed around — it draws its own ink bar underneath, and
      // that bar is ink in both themes precisely because the status-bar ink
      // over it is always white.
      { name: "mobile-web-app-capable", content: "yes" },
      { name: "apple-mobile-web-app-capable", content: "yes" },
      { name: "apple-mobile-web-app-title", content: "nyuz" },
      { name: "apple-mobile-web-app-status-bar-style", content: "black-translucent" },
      { property: "og:title", content: "nyuz — Stop searching. Start knowing." },
      {
        property: "og:description",
        content:
          "Tell nyuz what matters. It keeps watch across relevant sources, connects duplicate coverage into events, and delivers a personalized information briefing without the noise.",
      },
      { property: "og:type", content: "website" },
      { property: "og:image", content: `${siteOrigin()}/og-image.png` },
      { property: "og:image:width", content: "1200" },
      { property: "og:image:height", content: "630" },
      { name: "twitter:card", content: "summary_large_image" },
      { name: "twitter:image", content: `${siteOrigin()}/og-image.png` },
    ],
    links: [
      { rel: "preconnect", href: "https://fonts.googleapis.com" },
      { rel: "preconnect", href: "https://fonts.gstatic.com", crossOrigin: "anonymous" },
      {
        rel: "stylesheet",
        href: "https://fonts.googleapis.com/css2?family=Manrope:wght@400;500;600;700&family=Newsreader:opsz,wght@6..72,300;6..72,400&display=swap",
      },
      {
        rel: "stylesheet",
        href: appCss,
      },
      // The manifest is linked from every page, not only /dashboard. Installing
      // from the landing page is a supported path, and iOS reads the display
      // mode at Add to Home Screen time — a manifest it never saw is a home
      // screen icon that opens with Safari's chrome on it.
      { rel: "manifest", href: "/manifest.webmanifest" },
      // Chrome requests /favicon.ico on its own. Without that file it draws the
      // globe even when an SVG icon is listed. SVG second, for browsers that use it:
      // anything that understands image/svg+xml prefers it regardless of order, so
      // the .ico is only ever the fallback for browsers that cannot.
      //
      // That is why the two look different on purpose. favicon.svg is the bare mark
      // and swaps colour with the OS theme. The .ico and the iOS icon cannot carry a
      // media query, so a bare dark mark would disappear on a dark tab strip — they
      // get the ink field instead, which reads on any background.
      { rel: "icon", href: "/favicon.ico", sizes: "32x32" },
      { rel: "icon", href: "/favicon.svg", type: "image/svg+xml" },
      { rel: "apple-touch-icon", href: "/apple-touch-icon.png" },
    ],
  }),
  shellComponent: RootShell,
  component: RootComponent,
  notFoundComponent: NotFoundComponent,
  errorComponent: ErrorComponent,
});

function RootShell({ children }: { children: ReactNode }) {
  return (
    <html lang="en">
      <head>
        <HeadContent />
        {/*
          Marks the document when it is an installed app rather than a browser
          tab, so CSS that has to hold before the first paint can key off it.

          Read from `SHELL_INIT_SCRIPT` in src/lib/display-mode.ts so the
          attribute and the `useStandalone` hook cannot disagree about what
          "installed" means. Unlike the theme, this is not a preference: it is a
          fact about the window, so it is never overwritten from storage.

          It comes first of the two head scripts because the theme script below
          reads the attribute this one sets.
        */}
        <script dangerouslySetInnerHTML={{ __html: SHELL_INIT_SCRIPT }} />
        {/*
          Sets the theme before the first paint.

          It sits after <HeadContent /> because it rewrites the theme-color meta
          tag that renders there, and inside <head> because a parser-blocking
          inline script here runs before the body is parsed — the document is
          themed before the browser has painted anything.

          It is emitted *after* the shell script above, and that order is
          load-bearing rather than incidental: the colour it writes depends on
          whether this window is an installed app, which is the attribute that
          script sets. Both run before the body is parsed, so nothing can paint
          in between. src/lib/theme.test.ts runs the two in this order.

          React is deliberately not given a className on <html>: the script owns
          that attribute outright, so there is nothing for hydration to disagree
          with.
        */}
        <script dangerouslySetInnerHTML={{ __html: THEME_INIT_SCRIPT }} />
        {/*
          Catches the browser's install prompt, if it offers one, before the
          bundle has finished downloading.

          `beforeinstallprompt` fires once and is not repeated on demand, so an
          event that arrives before this app's JavaScript is running is not late
          — it is lost, and the Install button in Settings would silently never
          appear for that reader. On a cold launch on a phone that is a race the
          bundle loses: Chrome fires it as soon as it has processed the manifest,
          which can be seconds earlier. Hence an inline script in <head>, in the
          same shape and for the same reason as the two above it.

          Unlike SHELL_INIT_SCRIPT this does not depend on the theme script's
          attribute, so the order of the three carries no meaning. It must stay
          in <head> rather than <body>: a parser-blocking script there runs before
          the reader can be on the page at all. src/lib/install/prompt.test.ts
          runs it the way a parser does.
        */}
        <script dangerouslySetInnerHTML={{ __html: INSTALL_INIT_SCRIPT }} />
      </head>
      <body>
        {children}
        <Scripts />
      </body>
    </html>
  );
}

function RootComponent() {
  const { queryClient } = Route.useRouteContext();

  return (
    <QueryClientProvider client={queryClient}>
      <AuthProvider>
        <OfflineArchive />
        <ServiceWorkerBoot />
        <InstallPromptBoot />
        {/* Required: nested routes render here. Removing <Outlet /> breaks all child routes. */}
        <Outlet />
      </AuthProvider>
    </QueryClientProvider>
  );
}

/**
 * Registers the service worker, once, on boot. Renders nothing.
 *
 * In an effect rather than at module scope: the worker is a browser-only thing,
 * and a server render that reached `navigator` would be a crash rather than a
 * missed registration. `ensureServiceWorker` decides for itself whether this
 * environment wants one (production only) — see src/lib/sw.ts.
 */
function ServiceWorkerBoot() {
  useEffect(() => {
    void ensureServiceWorker();
  }, []);
  return null;
}

/**
 * Watches for `appinstalled`, so an install finishes the story it started.
 * Renders nothing.
 *
 * The event that *offers* installation is captured by an inline script in
 * <head>, because it can fire before this component exists. This one is the
 * opposite case: it fires while the reader is looking at the app, in response to
 * a prompt this app just opened, so an effect is not only enough — it is the
 * right place, since the outcome has to change what is on screen.
 *
 * It is mounted at the root rather than on the pages that offer installation,
 * because the reader can install from the browser's own menu, or accept our
 * prompt and then navigate away before it resolves.
 */
function InstallPromptBoot() {
  useEffect(() => {
    attachInstallEvents();
  }, []);
  return null;
}

/**
 * Files what this reader has already been shown, so the app opens without a
 * network. Renders nothing.
 *
 * Two rules it exists to enforce, both of which are about the device rather than
 * the reader:
 *
 * 1. **Nothing is archived for nobody.** The archive is keyed by account and
 *    installed only while there is a session, from an effect — so a server render
 *    cannot write to it and a signed-out browser has nothing to file.
 * 2. **A change of account erases the last one.** The previous account's rows go
 *    the moment a different id appears, and again on sign-out. IndexedDB
 *    outlives the tab that wrote it, so a shared browser would otherwise hand
 *    one reader's briefings to the next person who signs in.
 */
function OfflineArchive() {
  const { queryClient } = Route.useRouteContext();
  const { user } = useAuth();
  const previous = useRef<string | null>(null);
  const userId = user?.id ?? null;

  useEffect(() => {
    const before = previous.current;
    if (before && before !== userId) void clearAccount(before);
    previous.current = userId;

    if (!userId) {
      setArchiveAccount(null);
      return;
    }
    return installOfflineArchive(queryClient, userId);
  }, [userId, queryClient]);

  return null;
}
