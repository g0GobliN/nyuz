/**
 * The attribution ruler, pinned on the strings the live database writes.
 *
 * The 2026-10-12 ruling requires every discarded item to carry a disposition,
 * so the classifier behind `npm run audit:backlog` is a ruler like any other:
 * its judgement has to survive an edit. Every string below is one the audit
 * actually read out of `deliveries.last_error` on 2026-10-12.
 *
 * The case that motivates this file is the mixed-cause digest: the first draft
 * of the classifier filed a digest whose legs failed on a Resend 401 *and* a
 * missing table under "other attributable reason", when both legs are execution
 * failures. That misfiled 155 items. It is pinned last below.
 */
import { describe, expect, it } from "vitest";
import { digestDisposition, legCause } from "../../scripts/lib/disposition";

describe("why one delivery leg ended the way it did", () => {
  it("names an execution failure for every shape the machinery actually writes", () => {
    expect(legCause("Missing EMAIL_UNSUBSCRIBE_SECRET (minimum 32 characters)")).toBe(
      "execution failure",
    );
    expect(
      legCause(
        'Resend 401: {"statusCode":401,"name":"validation_error","message":"API key is invalid"}',
      ),
    ).toBe("execution failure");
    expect(
      legCause("Could not find the table 'public.registered_devices' in the schema cache"),
    ).toBe("execution failure");
  });

  it("separates a reader with no endpoint from a machine that failed", () => {
    expect(legCause("no push subscription")).toBe("no reader endpoint");
  });

  it("separates a policy refusal from both", () => {
    expect(legCause("Alert allowance changed or expired.")).toBe("policy refusal");
    expect(legCause("Telegram is not included in the current plan.")).toBe("policy refusal");
  });

  it("refuses to guess at a reason it does not recognise", () => {
    expect(legCause("something this ruler has never seen")).toBe("unattributed");
  });
});

describe("the disposition of one discarded digest", () => {
  const failed = (last_error: string) => ({ status: "failed", last_error });

  it("believes an accepted leg over the expiry: the reader got the briefing", () => {
    expect(
      digestDisposition([
        { status: "sent", last_error: null },
        failed('Resend 401: {"statusCode":401}'),
      ]),
    ).toBe("delivered, then mislabelled by expiry");
  });

  it("calls work never attempted what it is", () => {
    expect(digestDisposition([])).toBe("lost through the expiry defect");
  });

  it("refuses only when every leg was refused by rule or by reader state", () => {
    expect(
      digestDisposition([
        failed("Alert allowance changed or expired."),
        failed("no push subscription"),
      ]),
    ).toBe("correctly refused under policy");
  });

  it("attributes a digest whose legs failed for different execution reasons to execution", () => {
    // The misfiled 155: a rejected API key and a missing table are both the
    // machinery failing, even though no single regex in the first draft saw
    // both. Two execution causes is still one class.
    expect(
      digestDisposition([
        failed(
          'Resend 401: {"statusCode":401,"name":"validation_error","message":"API key is invalid"}',
        ),
        failed("Could not find the table 'public.registered_devices' in the schema cache"),
      ]),
    ).toBe("lost through execution failure");
    expect(
      digestDisposition([
        failed("Missing EMAIL_UNSUBSCRIBE_SECRET (minimum 32 characters)"),
        failed("no push subscription"),
      ]),
    ).toBe("lost through execution failure");
  });

  it("keeps an unrecognised reason visible as other, never folded into a class", () => {
    expect(digestDisposition([failed("something this ruler has never seen")])).toBe(
      "other attributable reason",
    );
  });
});
