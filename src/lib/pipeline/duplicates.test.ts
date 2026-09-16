import { describe, expect, it } from "vitest";
import { FakeDb, asDb } from "@/lib/test-support/fake-db";
import { suppressDeliveredDuplicates } from "./duplicates";
const now = new Date("2026-09-16T12:00:00Z");
const title = "Central bank raises interest rate to 4 percent";
describe.each(["briefing", "alert"] as const)("conservative %s duplicate suppression", (kind) => {
  it("avoids repeats within a batch and across recent deliveries", async () => {
    const db = new FakeDb({
      events: [
        { id: "sent", title, first_seen_at: now.toISOString() },
        { id: "duplicate", title: title + "!", first_seen_at: now.toISOString() },
        { id: "development", title: title.replace("4", "5"), first_seen_at: now.toISOString() },
      ],
      digests: [{ digest_id: "d", user_id: "u", kind, generated_at: now.toISOString() }],
      digest_items: [{ digest_id: "d", event_id: "sent" }],
    });
    expect([
      ...(await suppressDeliveredDuplicates(
        asDb(db),
        "u",
        ["duplicate", "development"],
        now,
        kind,
      )),
    ]).toEqual(["development"]);
    db.tables["digests"] = [];
    expect([
      ...(await suppressDeliveredDuplicates(
        asDb(db),
        "u",
        ["sent", "duplicate", "development"],
        now,
        kind,
      )),
    ]).toEqual(["sent", "development"]);
  });
  it("does not hide separate dated developments or another reader's coverage", async () => {
    const db = new FakeDb({
      events: [
        { id: "old", title, first_seen_at: "2026-09-01T00:00:00Z" },
        { id: "new", title, first_seen_at: now.toISOString() },
      ],
      digests: [{ digest_id: "d", user_id: "other", kind, generated_at: now.toISOString() }],
      digest_items: [{ digest_id: "d", event_id: "new" }],
    });
    expect([
      ...(await suppressDeliveredDuplicates(asDb(db), "u", ["old", "new"], now, kind)),
    ]).toEqual(["old", "new"]);
  });
});
