/**
 * The two rulers D9 asked for, pinned on the strings that motivated them — and
 * on the strings that proved a first draft of each one wrong.
 *
 * D9 was opened by reading three alerted stories by hand: the audit called them
 * clean and a person found five defects in them, two of which no ruler could see
 * -- a block opening on a sentence cut at a clipping boundary, and a raw URL from
 * a comment thread published as reporting. The ruling's order was *the ruler
 * first, then a rule only on a ruling*, so this file tests the rulers and nothing
 * else. No publication behaviour depends on either one.
 *
 * Every case below is a real string, from the frozen corpus or from the alerted
 * stories the owner read. The negatives are the ones that matter most: the first
 * draft of the truncation ruler fired on four published leads that were merely
 * idiomatic, and the first draft of the URL ruler called `llama.cpp` and
 * `Node.js` web addresses. Both are recorded here so the next edit cannot
 * reintroduce them.
 */
import { describe, expect, it } from "vitest";
import { RAW_URL, truncatedLead, truncatedSentence } from "../../scripts/lib/defects";

describe("a sentence that ends where prose cannot", () => {
  it("catches the clipped leads the owner read", () => {
    // Both are cut mid-date, which is what an excerpt boundary leaves behind.
    expect(
      truncatedSentence(
        "Investigators found the meeting at the Loews Philadelphia Hotel between Oct.",
      ),
    ).toBe("Investigators found the meeting at the Loews Philadelphia Hotel between Oct.");
    expect(truncatedSentence("He was sentenced on Sept.")).toBe("He was sentenced on Sept.");
  });

  it("catches a sentence left hanging on an article, a conjunction or a binding preposition", () => {
    expect(
      truncatedSentence("The company said the change would arrive in the first half of."),
    ).toBe("The company said the change would arrive in the first half of.");
    expect(truncatedSentence("Officials described the site as a warehouse and.")).toBe(
      "Officials described the site as a warehouse and.",
    );
    expect(truncatedSentence("The filing named the operator of the.")).toBe(
      "The filing named the operator of the.",
    );
  });

  it("leaves the idiomatic endings the first draft fired on", () => {
    // All four are real published leads from the frozen corpus. A ruler that
    // counts these measures English, not damage, and its number cannot be used
    // to argue for a rule.
    expect(
      truncatedSentence(
        "Careers upended overnight, academics will have to separate solutions from slop while OpenAI moves on.",
      ),
    ).toBe("");
    expect(
      truncatedSentence(
        "When they're paired up with someone that's a CS major, it's giving this autonomy for people to do what they're most passionate about.",
      ),
    ).toBe("");
    expect(
      truncatedSentence(
        "The same tech company figures who rushed to donate millions to Trump after his election have quickly signed on.",
      ),
    ).toBe("");
    expect(truncatedSentence("It was signed and paid for.")).toBe("");
  });

  it("accepts the miss that keeps `moves on` out", () => {
    // This one is genuinely cut -- the clause wants a complement -- and the ruler
    // deliberately does not catch it, because it is the same shape as `moves on`.
    // A deliberate, recorded miss is cheaper than a false positive that inflates
    // the count the ruling would be argued from.
    expect(
      truncatedSentence(
        "WebGPU did not support DUP, so the dup ran on the CPU while the set_rows writing into it was scheduled on.",
      ),
    ).toBe("");
  });

  it("leaves a date that ends the sentence alone", () => {
    // The spelling matters: an abbreviation is a cut, the full month is a stop.
    expect(truncatedSentence("The filing was dated October.")).toBe("");
    expect(truncatedSentence("The hearing was set for September.")).toBe("");
  });

  it("does not call a short line a truncation", () => {
    expect(truncatedSentence("Oct.")).toBe("");
    expect(truncatedSentence("In Oct.")).toBe("");
  });

  it("judges only the opening sentence of a block", () => {
    const block = "The council approved the plan. The work was scheduled between Oct.";
    expect(truncatedLead(block)).toBe("");
    expect(
      truncatedLead("The work was scheduled between Oct. Officials said nothing further."),
    ).toBe("The work was scheduled between Oct.");
    expect(truncatedLead("")).toBe("");
  });
});

describe("a URL published as prose", () => {
  it("catches the comment-thread address the owner read", () => {
    expect(RAW_URL.test("Investors.boeing.com/threads/4412 Am wondering what happened")).toBe(true);
  });

  it("catches a scheme, a www address, a named domain and an address with a path", () => {
    expect(RAW_URL.test("See https://example.com/path for the filing")).toBe(true);
    expect(RAW_URL.test("It appeared on www.nyuz.app yesterday")).toBe(true);
    expect(RAW_URL.test("the tip through PhillyUnsolvedMurders.com on July 18th")).toBe(true);
    expect(RAW_URL.test("urged users to visit Orkut.com and add their names")).toBe(true);
    expect(RAW_URL.test('Windows: powershell -c "irm bun.sh/install.ps1|iex"')).toBe(true);
  });

  it("leaves the software names the first draft called addresses", () => {
    // Real strings from the frozen corpus: a file extension and a country TLD
    // are the same shape, so the suffix alone cannot decide it.
    expect(RAW_URL.test("according to llama.cpp releases")).toBe(false);
    expect(
      RAW_URL.test("Node.js was an exploration of what a purely asynchronous model could enable"),
    ).toBe(false);
    expect(RAW_URL.test("Assisted-by: pi:zai-org/GLM-5.3-Flash ui: mark favorite models")).toBe(
      false,
    );
  });

  it("leaves an abbreviation that is not an address alone", () => {
    expect(RAW_URL.test("The U.S. and Japan both signed.")).toBe(false);
    expect(RAW_URL.test("Officials in Washington, D.C. declined.")).toBe(false);
  });

  it("leaves a decimal number and ordinary prose alone", () => {
    expect(RAW_URL.test("The rate rose 1.5 percent in July.")).toBe(false);
    expect(RAW_URL.test("The company said the change would arrive next quarter.")).toBe(false);
  });
});
