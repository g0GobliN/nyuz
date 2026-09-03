import { QueryClient } from "@tanstack/react-query";
import { createRouter } from "@tanstack/react-router";
import { routeTree } from "./routeTree.gen";

export const getRouter = () => {
  const queryClient = new QueryClient({
    defaultOptions: {
      queries: {
        // Longer than React Query's five minute default because of what a
        // reader does between two views of the same list: they open a story
        // and read it. Once the list route unmounts its query has no
        // observers, and at five minutes the cached feed is collected — so
        // coming back re-renders an empty page, and the router restores a
        // scroll position the page is no longer tall enough to hold. Keeping
        // the list around means the cards are in the first commit and the
        // reader lands on the card they clicked.
        gcTime: 60 * 60 * 1000,
      },
    },
  });

  const router = createRouter({
    routeTree,
    context: { queryClient },
    scrollRestoration: true,
    defaultPreloadStaleTime: 0,
  });

  return router;
};
