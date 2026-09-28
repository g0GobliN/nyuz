import { beforeEach, describe, expect, it, vi } from "vitest";
import { setArchiveAccount } from "@/lib/offline/archive";
import {
  clearServedCopy,
  markServedCopy,
  servedCopySavedAt,
  subscribeToServedCopies,
} from "@/lib/offline/copies";

/**
 * The bug these lock down: the strip that says a screen is a saved copy drew
 * only while the browser reported no network, so the case that actually happens
 * — online, request fails, archive answers — showed a stale briefing as if it
 * were today's. These are the marks that make that visible, and the two things
 * they must never do are survive a change of reader and stay set after the
 * request starts working again.
 */

const USER = "aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee";
const OTHER = "11111111-2222-3333-4444-555555555555";

beforeEach(() => {
  setArchiveAccount(null);
  clearServedCopy("list:home");
  clearServedCopy("list:saved");
  clearServedCopy("story:one");
});

describe("served copies", () => {
  it("reports the copy the archive answered from", () => {
    setArchiveAccount(USER);
    markServedCopy("list:home", 1_700_000_000_000);
    expect(servedCopySavedAt()).toBe(1_700_000_000_000);
  });

  it("says nothing when nothing was served", () => {
    setArchiveAccount(USER);
    expect(servedCopySavedAt()).toBeNull();
  });

  it("says nothing for a signed-out browser", () => {
    // A mark written before it was cleared must not caption anything.
    setArchiveAccount(USER);
    markServedCopy("list:home", 1_700_000_000_000);
    setArchiveAccount(null);
    expect(servedCopySavedAt()).toBeNull();
  });

  it("cannot be written without an account", () => {
    markServedCopy("list:home", 1_700_000_000_000);
    setArchiveAccount(USER);
    expect(servedCopySavedAt()).toBeNull();
  });

  it("hides a previous reader's mark from the next one", () => {
    setArchiveAccount(USER);
    markServedCopy("list:home", 1_700_000_000_000);
    setArchiveAccount(OTHER);
    expect(servedCopySavedAt()).toBeNull();
  });

  it("captions the page with the newest copy on it", () => {
    // The strip stands for the whole screen, so the honest date is the freshest
    // of the copies it stands for.
    setArchiveAccount(USER);
    markServedCopy("list:saved", 1_700_000_000_000);
    markServedCopy("list:home", 1_700_000_500_000);
    expect(servedCopySavedAt()).toBe(1_700_000_500_000);
  });

  it("goes away when the same screen gets a live answer", () => {
    setArchiveAccount(USER);
    markServedCopy("list:home", 1_700_000_000_000);
    clearServedCopy("list:home");
    expect(servedCopySavedAt()).toBeNull();
  });

  it("keeps one screen's clear from clearing another's", () => {
    setArchiveAccount(USER);
    markServedCopy("list:home", 1_700_000_000_000);
    markServedCopy("list:saved", 1_700_000_000_000);
    clearServedCopy("list:home");
    expect(servedCopySavedAt()).toBe(1_700_000_000_000);
  });
});

describe("notifying the strip", () => {
  it("notifies on a real change and on nothing else", () => {
    setArchiveAccount(USER);
    const listener = vi.fn();
    const unsubscribe = subscribeToServedCopies(listener);

    markServedCopy("list:home", 1_700_000_000_000);
    expect(listener).toHaveBeenCalledTimes(1);

    // The strip prints the newest copy on screen; rewriting the same one is not
    // a change, and re-rendering for it would be noise.
    markServedCopy("list:home", 1_700_000_000_000);
    expect(listener).toHaveBeenCalledTimes(1);

    // Clearing a key that was never marked is not one either.
    clearServedCopy("story:none");
    expect(listener).toHaveBeenCalledTimes(1);

    clearServedCopy("list:home");
    expect(listener).toHaveBeenCalledTimes(2);

    unsubscribe();
    markServedCopy("list:saved", 1_700_000_000_000);
    expect(listener).toHaveBeenCalledTimes(2);
  });
});
