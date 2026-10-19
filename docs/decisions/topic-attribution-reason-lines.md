# The reason line, and the headline that carries it (measured 2026-10-19)

**Status: measured and recorded, awaiting a ruling.** No rule was changed to produce this file.

**The reader-facing fact.** Every card on the dashboard and in the briefing carries one line that explains
why the story is on _that reader's_ page — `"You follow AI."`, `"You follow Chips, NVIDIA."`. It is the
reader's only account of the matching, so a line that names a topic the story is not about is a defect of
the same family as a wrong summary. The 2026-10-19 read of the live dashboard found one instance: a Windows
command-prompt story from The Register reasoned **"You follow AI."**

**How the line is composed** (pure code, no model in the path):
`personalizationFor` in [server/briefing.ts](../../src/lib/server/briefing.ts) intersects the event's
`event_topics` labels with the reader's own `user_topics` labels. `event_topics` is written by
`assignTopics` — [pipeline/topic-assign.ts](../../src/lib/pipeline/topic-assign.ts) — deterministic keyword
matching over the event's title, each article's title and excerpt, and each source's signal. So a wrong
line is never the line's own fault: the event carries a label it should not, or the reader follows a term
they did not mean.

**The mechanism, exactly.** The AI topic's vocabulary is
`strong: [ai, artificial intelligence, machine learning, deep learning, neural network, llm, large language
model, chatbot, ai agent(s), agentic ai, coding agent]` and `weak: [generative, prompt, inference, training
data, model parameter]`. A topic labels a story when the text mentions a strong term, **or two distinct
weak terms**, **or one weak term in the headline** — that last clause exists because a publisher's headline
states the subject (a real travel headline should label with no body mention at all). The Register's
headline contains _"Windows command **prompt** puts in a surprise appearance"_. Measured on the event's own
rows (`29a4fa68-3de0-46eb-8846-e0da7b6963e9`): the haystack contains **no strong AI term anywhere** in the
title, in any article's title or excerpt, or in the source signal; recomputing `assignTopics` with the
headline removed returns **nothing**. The label — and therefore the reader-visible line — rests on one weak
term in one headline.

**The population** (`npm run audit:topic-attribution`, added with this record; read-only, SELECTs plus the
shipped pure function). Newest briefing (`e9e485a5-113c-4b38-b9ed-acbf80e18fcd`, 2026-10-18T22:30Z, 13
cards, `status=ready`, the newest delivered set). Positions below are `digest_items.position`, which is what
the instrument prints; the dashboard renders the same card one higher, so the card the 2026-10-19 read
called **#08** is **#7** here.

```
cards examined                              13
reason names a headline-only topic          4
```

| card | the reason line                                  | the topic it names | the headline's carrier                                                         |
| ---- | ------------------------------------------------ | ------------------ | ------------------------------------------------------------------------------ |
| #3   | You follow **Claude**, AI, OpenAI, Cybersecurity | Claude             | "**Anthropic** gives outside AI watchdog…" (Anthropic is a Claude _weak_ term) |
| #7   | You follow **AI**                                | AI                 | "Windows command **prompt**…"                                                  |
| #11  | You follow **Chips**, NVIDIA                     | Chips              | "…full Nvidia DLSS 5 suite to three generations of **AMD** gaming GPUs"        |
| #12  | You follow **World**, AI, NVIDIA                 | World              | "RTX Spark Ignites **Global** Celebration…" (the vendor's own blog)            |

**What this does and does not say.** The four labels are not equally wrong: _#3_ is arguably correct — the
story is about Anthropic, a Claude vendor — and _#11_ is a chip story in which "AMD" is a fair signal. The
finding is narrower and it is about the **line**, not the label set: on all four, the sentence the reader
reads claims an interest the story's own text does not support, and on _#7_ the label itself is wrong. The
matcher is behaving exactly as written; the fault is upstream, in the vocabulary and in the title rule.

**Why this is not "AI".** Nothing here calls a model, and nothing may: `assignTopics` is a keyword table over
stored text, `event_topics` is read by the reader join, and the fix for a mislabel is a better rule in that
table — never a provider. The AI _topic_ is a category a reader can follow; it is not an AI feature.

**The options for the ruling** (the arbiter's call, not this session's — the ruling changes what readers
see):

1. **Demote the carrier.** Drop `"prompt"` from AI's weak list (a command prompt, a UI prompt and a verb
   are all ordinary English). Smallest possible change; it fixes #7 only, and leaves the other three.
2. **Raise the headline's bar.** Require two distinct weak terms in the headline, as the body already
   requires, keeping the title rule only for headlines that state their subject twice. Kills #7, #11 and
   #12; keeps #3.
3. **Change the line, not the labels.** Keep the taxonomy as it is and name in the reason line only topics
   whose evidence is strong — the labels still decide matching, but the reader is told only what the story's
   own text carries.
4. **Do nothing.** Accept the labels as the taxonomy's judgement and the intersection as an honest report
   of it. Recorded so the choice is deliberate rather than unexamined.

**The measurement is one briefing.** One 13-card set, the newest delivered, read 2026-10-19. A ruling that
wants a wider population should say so: the instrument takes `--digest <uuid>` and `--all`, and the corpus
to widen over is every briefing with `status in (sent, ready)`.

**Blocked on the arbiter.** The standing rule is that a question goes to the owner's ChatGPT `nyuz` project
before it goes to the owner. It could not be reached from this session: the browser panel's clean profile is
held at the Cloudflare interstitial on `chatgpt.com`, and real-profile browsing (the route earlier sessions
used) requires a Chromium-family _default_ browser, which this machine does not have — LibreWolf is the
default, and Chromium's own profile is not in use. Either the default browser changes, or the owner relays.
