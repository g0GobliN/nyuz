import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import {
  Outlet,
  Link,
  createRootRouteWithContext,
  useRouter,
  HeadContent,
  Scripts,
} from "@tanstack/react-router";
import { type ReactNode } from "react";

import appCss from "../styles.css?url";
import { humanError } from "../lib/errors";
import { AuthProvider } from "../lib/auth";
import { THEME_COLORS, THEME_INIT_SCRIPT } from "../lib/theme";

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
        <h1 className="display mt-4 text-[clamp(2.2rem,6vw,3.25rem)]">Nothing here.</h1>
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

function ErrorComponent({ error, reset }: { error: Error; reset: () => void }) {
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
        <h1 className="display mt-4 text-[clamp(2.2rem,6vw,3.25rem)]">That didn&apos;t load.</h1>
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
      { name: "viewport", content: "width=device-width, initial-scale=1" },
      { title: "nyuz — Stop searching. Start knowing." },
      {
        name: "description",
        content:
          "You don't read the news. It reports to you. nyuz watches hundreds of sources, merges the duplicates, and sends you the handful of things worth knowing.",
      },
      { name: "author", content: "nyuz" },
      { name: "theme-color", content: THEME_COLORS.dark },
      { property: "og:title", content: "nyuz — Stop searching. Start knowing." },
      {
        property: "og:description",
        content:
          "You don't read the news. It reports to you. nyuz watches hundreds of sources, merges the duplicates, and sends you the handful of things worth knowing.",
      },
      { property: "og:type", content: "website" },
      { property: "og:image", content: "/og-image.png" },
      { property: "og:image:width", content: "1200" },
      { property: "og:image:height", content: "630" },
      { name: "twitter:card", content: "summary_large_image" },
      { name: "twitter:image", content: "/og-image.png" },
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
          Sets the theme before the first paint.

          It sits after <HeadContent /> because it rewrites the theme-color meta
          tag that renders there, and inside <head> because a parser-blocking
          inline script here runs before the body is parsed — the document is
          themed before the browser has painted anything.

          React is deliberately not given a className on <html>: the script owns
          that attribute outright, so there is nothing for hydration to disagree
          with.
        */}
        <script dangerouslySetInnerHTML={{ __html: THEME_INIT_SCRIPT }} />
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
        {/* Required: nested routes render here. Removing <Outlet /> breaks all child routes. */}
        <Outlet />
      </AuthProvider>
    </QueryClientProvider>
  );
}
