import type { Story } from "@/lib/story";
import { archiveRowKey, rowKeysToDrop, type ArchiveRow } from "@/lib/offline/keys";

/**
 * The offline archive's storage. Thin on purpose — every decision about what is
 * worth keeping lives in keys.ts, which is pure and tested.
 *
 * ---------------------------------------------------------------------------
 * Why hand-rolled IndexedDB
 * ---------------------------------------------------------------------------
 *
 * localStorage would be simpler and is the wrong tool: it is synchronous (so a
 * write of a 200KB briefing blocks the main thread), it is capped at about 5MB
 * *per origin* where IndexedDB is quoted in tens of megabytes, and it holds
 * strings, so every read would pay a JSON parse of the whole archive to get one
 * story. `idb-keyval` and `fake-indexeddb` are not dependencies of this project
 * and this is not enough code to justify adding one.
 *
 * Every function here resolves to null/void rather than throwing when IndexedDB
 * is missing — Safari private mode, a locked-down webview, the server. An
 * archive that cannot be written is a feature that does not work, not an error
 * the reader should see.
 */

const DB_NAME = "nyuz-offline";
const STORE = "rows";
const DB_VERSION = 1;

let opening: Promise<IDBDatabase | null> | null = null;

function openDatabase(): Promise<IDBDatabase | null> {
  if (typeof indexedDB === "undefined") return Promise.resolve(null);
  if (opening) return opening;

  opening = new Promise((resolve) => {
    let request: IDBOpenDBRequest;
    try {
      request = indexedDB.open(DB_NAME, DB_VERSION);
    } catch {
      resolve(null);
      return;
    }
    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains(STORE)) {
        const store = db.createObjectStore(STORE, { keyPath: "key" });
        // Every read is "this account's rows", so the index is the access path.
        store.createIndex("userId", "userId");
      }
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => resolve(null);
    request.onblocked = () => resolve(null);
  });

  return opening;
}

/** Run one request in a transaction and resolve with its result, or null. */
function withStore<T>(
  mode: IDBTransactionMode,
  run: (store: IDBObjectStore) => IDBRequest,
): Promise<T | null> {
  return openDatabase().then(
    (db) =>
      new Promise<T | null>((resolve) => {
        if (!db) {
          resolve(null);
          return;
        }
        try {
          const tx = db.transaction(STORE, mode);
          const request = run(tx.objectStore(STORE));
          request.onsuccess = () => resolve(request.result as T);
          request.onerror = () => resolve(null);
          tx.onabort = () => resolve(null);
        } catch {
          resolve(null);
        }
      }),
  );
}

function rowsForUser(userId: string): Promise<ArchiveRow[]> {
  return withStore<ArchiveRow[]>("readonly", (store) =>
    store.index("userId").getAll(IDBKeyRange.only(userId)),
  ).then((rows) => rows ?? []);
}

/**
 * The account this browser is signed in as.
 *
 * Held here rather than fetched inside a query function, because a query that
 * has just failed has no session to read and the fallback needs the answer
 * synchronously. It is set and cleared in one place — the root component's
 * effect — so it cannot drift from the rows themselves, which are keyed by the
 * same id.
 */
let activeUserId: string | null = null;

export function setArchiveAccount(userId: string | null): void {
  activeUserId = userId;
}

export function archiveAccount(): string | null {
  return activeUserId;
}

export async function saveList(userId: string, listKey: string, payload: unknown): Promise<void> {
  const row: ArchiveRow = {
    key: archiveRowKey(userId, "list", listKey),
    kind: "list",
    userId,
    id: listKey,
    savedAt: Date.now(),
    payload,
  };
  await withStore("readwrite", (store) => store.put(row));
  // Lists are written once per visit, so this is the natural moment to enforce
  // the caps — and the moment a prune is least likely to be noticed.
  await prune(userId);
}

export async function readList<T>(
  userId: string,
  listKey: string,
): Promise<{ payload: T; savedAt: number } | null> {
  const row = await withStore<ArchiveRow>("readonly", (store) =>
    store.get(archiveRowKey(userId, "list", listKey)),
  );
  if (!row) return null;
  return { payload: row.payload as T, savedAt: row.savedAt };
}

/** The whole story, as the story page renders it. Never slimmed. */
export async function saveStory(userId: string, story: Story): Promise<void> {
  const row: ArchiveRow = {
    key: archiveRowKey(userId, "story", story.id),
    kind: "story",
    userId,
    id: story.id,
    savedAt: Date.now(),
    payload: story,
  };
  await withStore("readwrite", (store) => store.put(row));
}

/**
 * The saved story, and when it was written.
 *
 * The time travels with the payload because a copy read while the network is up
 * is a *dated* answer — the whole difference between a briefing and a stale one
 * — and the caption that says so has nowhere else to get the date from.
 */
export async function readStory(
  userId: string,
  storyId: string,
): Promise<{ story: Story; savedAt: number } | null> {
  const row = await withStore<ArchiveRow>("readonly", (store) =>
    store.get(archiveRowKey(userId, "story", storyId)),
  );
  return row ? { story: row.payload as Story, savedAt: row.savedAt } : null;
}

export async function hasStory(userId: string, storyId: string): Promise<boolean> {
  return (await readStory(userId, storyId)) !== null;
}

/** Drop everything past the caps. Deleting the rows a prune rejects is the point. */
export async function prune(userId: string): Promise<void> {
  const rows = await rowsForUser(userId);
  const drop = rowKeysToDrop(rows, Date.now());
  if (drop.length === 0) return;
  await after((store) => {
    for (const key of drop) store.delete(key);
  });
}

/**
 * Remove one account's archive entirely.
 *
 * Called on sign-out and on account switch, not on unload. A shared device with
 * one reader signed out and another signed in must not be able to read the first
 * reader's briefings, and IndexedDB outlives the tab that wrote it.
 */
export async function clearAccount(userId: string): Promise<void> {
  const rows = await rowsForUser(userId);
  await after((store) => {
    for (const row of rows) store.delete(row.key);
  });
}

/** Run several deletes in one transaction. */
function after(run: (store: IDBObjectStore) => void): Promise<void> {
  return openDatabase().then(
    (db) =>
      new Promise<void>((resolve) => {
        if (!db) {
          resolve();
          return;
        }
        try {
          const tx = db.transaction(STORE, "readwrite");
          run(tx.objectStore(STORE));
          tx.oncomplete = () => resolve();
          tx.onerror = () => resolve();
          tx.onabort = () => resolve();
        } catch {
          resolve();
        }
      }),
  );
}

/** What is stored for this account, for the row in Settings. */
export async function archiveUsage(
  userId: string,
): Promise<{ lists: number; stories: number; bytes: number }> {
  const rows = await rowsForUser(userId);
  const encoder = new TextEncoder();
  let bytes = 0;
  for (const row of rows) {
    try {
      bytes += encoder.encode(JSON.stringify(row.payload)).length;
    } catch {
      // A payload that will not serialise is one we cannot measure. It is not
      // worth failing the whole readout over.
    }
  }
  return {
    lists: rows.filter((row) => row.kind === "list").length,
    stories: rows.filter((row) => row.kind === "story").length,
    bytes,
  };
}

/** When this account's archive was last written, for the offline strip. */
export async function latestSavedAt(userId: string): Promise<number | null> {
  const rows = await rowsForUser(userId);
  return rows.reduce<number | null>((newest, row) => Math.max(newest ?? 0, row.savedAt), null);
}
