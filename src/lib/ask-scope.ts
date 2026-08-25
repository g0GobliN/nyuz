/**
 * Whether an Ask is about this story, decided before any model call.
 *
 * The reason tier is the expensive one. A question that is really "write me
 * Python" or a homework dump has to die here, not after a completion. The
 * model prompt is a second fence, not the first.
 */

export type StoryAskScope = {
  title: string;
  what: string;
  topics: string[];
  before?: string;
  after?: string;
};

const ABUSE: RegExp[] = [
  /\b(write|generate|give me|create|implement)\b[\s\S]{0,60}\b(code|script|function|class|sql|regex|python|javascript|typescript|java|golang|rust|c\+\+)\b/i,
  /\b(ignore|disregard)\b.{0,24}\b(previous|prior|above)\b.{0,24}\b(instructions?|prompts?|rules?)\b/i,
  /\bjailbreak\b/i,
  /\bdo my homework\b/i,
  /\bwrite (me )?(an? )?(essay|poem|song|recipe|email|cover letter)\b/i,
  /```/,
  /\bact as (a |an |my )/i,
  /\bsystem prompt\b/i,
  /\btranslate this\b/i,
];

const FOLLOW_UP = /\b(this|that|it|they|the story|the event|the news)\b/i;
const NEWS_VERB =
  /\b(explain|why|how|what|who|when|where|affect|mean|happen|change|matter|should|risk|impact|context|background)\b/i;

const STOP = new Set([
  "about",
  "after",
  "been",
  "does",
  "from",
  "have",
  "into",
  "just",
  "more",
  "than",
  "that",
  "the",
  "this",
  "what",
  "when",
  "with",
  "your",
]);

export function judgeStoryQuestion(
  question: string,
  story: StoryAskScope,
): { ok: true } | { ok: false; reason: "off-topic" } {
  const q = question.trim();
  if (ABUSE.some((re) => re.test(q))) return { ok: false, reason: "off-topic" };

  const storyTokens = tokens(
    `${story.title} ${story.what} ${story.topics.join(" ")} ${story.before ?? ""} ${story.after ?? ""}`,
  );
  for (const t of tokens(q)) {
    if (storyTokens.has(t)) return { ok: true };
  }

  if (q.length <= 140 && FOLLOW_UP.test(q) && NEWS_VERB.test(q)) return { ok: true };

  return { ok: false, reason: "off-topic" };
}

function tokens(text: string): Set<string> {
  const out = new Set<string>();
  for (const raw of text.toLowerCase().split(/[^a-z0-9]+/)) {
    if (raw.length < 4 || STOP.has(raw)) continue;
    out.add(raw);
  }
  return out;
}
