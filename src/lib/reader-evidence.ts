import { extractCompanies, extractProducts } from "./pipeline/extract";
import { claimKey } from "./pipeline/evidence-text";

export type ReaderSource = {
  name?: string | undefined;
  headline?: string | undefined;
  excerpt?: string | undefined;
  enrichedEvidence?:
    { kind: string; text: string; attribution?: string; entities?: string[] }[] | undefined;
};

const ACTION =
  /\b(?:is|are|was|were|has|have|had|said|says|announced|raised|raises|secured|gains?|reached|pledged|funded|backing|discovered|exposed|accessible|connected|restricted|released|launches?|launched|acquire[ds]?|approved|blocked|banned|hired|hires|includes?|reported|confirmed|will|plans?|requires?|remains?|allows?|supports?|offers?|runs?|running|uses?|used|built|found|started|spending|scores?|starts?|expanded|appears?|declined|rose|marks?|represents?|hosts?|values?|closed)\b/i;
const NOISE =
  /\b(?:welcome back|weekly column|this week['’]s (?:column|newsletter)|as regular readers know|subscribe to|sign up for|click here|read more|continue reading|cookie policy|all rights reserved|follow us on|share this article|related articles|the coverage centers on|amount mentioned|percentage mentioned|entity mentioned|source count|evidence suggests|nyuz has also covered)\b|\bthe post\b.*\bappeared first on\b|^(?:advertisement|image credit|photo credit|hopefully\b|the takeaway\b)/i;
const VOICE = /\b(?:we|we['’](?:ve|re|ll|d)|our|ours|you|your|as I remember)\b/i;
const COMMENTARY =
  /\b(?:tales of woe|gaping hole|so swimmingly|popularity is undeniable|likely a contributing factor|more important changes are less|make so many enemies|gaining ground fast|winning supporters and boosters|just in case there was)\b|^Even if\b|^[^.!?]{1,45},[^.!?]{1,45}\sThe problem\b/i;

/** Quoted speech belongs to its speaker, not the publication. */
export function publisherVoice(text: string): boolean {
  const unquoted = text.replace(/"[^"\n]*"|“[^”\n]*”/g, "");
  return VOICE.test(unquoted);
}

export function editorialNoise(text: string): boolean {
  return NOISE.test(text) || publisherVoice(text) || COMMENTARY.test(text);
}

const STOP = new Set(
  "the a an and or in on at to of for from with by as it its this that these those he she they his her their but when after before much most more less new earlier today yesterday according said says report reported company project foundation software technology business politics economy ai gains gain backing funding fresh converts fierce critics announces announced launches launch update anyone".split(
    " ",
  ),
);
const COMMON_ENTITY_WORDS = new Set(
  "test environment live customer data security government investors shares stock market researchers scientists developers president minister police court study report funding company project".split(
    " ",
  ),
);

/** Do not split a quotation away from its speaker or split decimals and versions. */
export function readerSentences(text: string): string[] {
  const clean = text.replace(/\s+/g, " ").trim();
  const out: string[] = [];
  let quote = "";
  let start = 0;
  for (let i = 0; i < clean.length; i++) {
    const c = clean[i];
    if (c === '"') quote = quote === '"' ? "" : quote || '"';
    if (c === "“") quote = "”";
    if (c === "”") quote = "";
    const end =
      /[.!?]/.test(c ?? "") || ((c === '"' || c === "”") && /[.!?]/.test(clean[i - 1] ?? ""));
    if (
      !quote &&
      end &&
      clean[i + 1] === " " &&
      !/^(?:said|says|he|she|they|according|told)\b/.test(clean.slice(i + 2))
    ) {
      out.push(clean.slice(start, i + 1).trim());
      start = i + 2;
    }
  }
  if (start < clean.length) out.push(clean.slice(start).trim());
  return out.filter(Boolean);
}

export function centralTokens(text: string): string[] {
  return [
    ...new Set(
      (text.toLowerCase().match(/[\p{L}\p{N}][\p{L}\p{N}.-]*/gu) ?? [])
        .map((t) => t.replace(/[.-]+$/, ""))
        .filter((t) => t.length > 2 && !STOP.has(t)),
    ),
  ];
}

function contains(text: string, name: string): boolean {
  return new RegExp(
    `(?<![\\p{L}\\p{N}])${name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}(?![\\p{L}\\p{N}])`,
    "iu",
  ).test(text);
}

export type RankedEntity = {
  name: string;
  aliases: string[];
  role: "PRIMARY" | "SECONDARY" | "BACKGROUND" | "REPORTING_SOURCE";
  score: number;
  sourceCount: number;
};

export function rankEntities(title: string, sources: ReaderSource[]): RankedEntity[] {
  const texts = sources.map((s) =>
    [s.excerpt ?? "", ...(s.enrichedEvidence ?? []).map((u) => u.text)].join(" "),
  );
  const all = [title, ...texts].join(" ");
  const names = new Map<string, string>();
  const add = (name: string) => {
    const clean = name.replace(/^(?:The|In|As|Much|After|Then)\s+/, "").trim();
    if (
      !clean ||
      STOP.has(clean.toLowerCase()) ||
      COMMON_ENTITY_WORDS.has(clean.toLowerCase()) ||
      /^\d/.test(clean)
    )
      return;
    const key = clean.toLowerCase();
    if (!names.has(key)) names.set(key, clean);
  };
  for (const hit of [...extractCompanies(all, 0), ...extractProducts(all, 0)]) add(hit.value);
  for (const name of all.match(
    /\b(?:[A-Z][\p{L}\d-]*(?:\.[\p{L}\d-]+)*)(?:\s+(?:[A-Z][\p{L}\d-]*(?:\.[\p{L}\d-]+)*|on(?=\s+[A-Z]))){0,3}/gu,
  ) ?? [])
    add(name);
  for (const s of sources) if (s.name) add(s.name);
  const aliases = new Map<string, string[]>();
  for (const [key, name] of names) {
    const parts = name.split(" ");
    if (parts.length < 2) continue;
    const initials = parts.map((p) => p[0]).join("");
    // Require an explicit alias cue as well as matching initials.
    if (
      initials.length >= 3 &&
      names.has(initials.toLowerCase()) &&
      new RegExp(`(?:known as |aka |\\()${initials}\\b`).test(all)
    ) {
      aliases.set(key, [initials]);
      names.delete(initials.toLowerCase());
    }
  }
  return [...names]
    .map(([key, name]) => {
      const forms = [name, ...(aliases.get(key) ?? [])];
      const inText = (text: string) => forms.some((n) => contains(text, n));
      const inTitle = inText(title);
      const supporting = new Set(
        sources.flatMap((s, i) => (inText(texts[i]!) ? [s.name?.toLowerCase() ?? String(i)] : [])),
      ).size;
      const units = [...new Set(texts.flatMap(readerSentences))].filter(inText);
      const subjects = units.filter(
        (t) =>
          forms.some((n) =>
            new RegExp(
              `^(?:The )?${n.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}(?:['’]s)?\\b`,
              "i",
            ).test(t),
          ) && ACTION.test(t),
      ).length;
      const reporting =
        sources.some((s) => s.name && contains(s.name, name)) ||
        /^(?:Reuters|BBC|The Register|Register)$/i.test(name);
      const score =
        (inTitle ? 12 : 0) +
        Math.min(units.length, 4) +
        subjects * 3 +
        Math.max(0, supporting - 1) * 2;
      const role =
        reporting && !inTitle
          ? "REPORTING_SOURCE"
          : inTitle || subjects >= 2 || (aliases.has(key) && units.length >= 2)
            ? "PRIMARY"
            : subjects > 0 || units.length >= 2
              ? "SECONDARY"
              : "BACKGROUND";
      return {
        name,
        aliases: forms.slice(1),
        role,
        score,
        sourceCount: supporting,
      } as RankedEntity;
    })
    .sort((a, b) => b.score - a.score || a.name.localeCompare(b.name));
}

/** Matching includes currency and scale, so $18.5M is not confused with 18.5%. */
export function numericKeys(text: string): string[] {
  return [
    ...text.matchAll(
      /([$€£])\s*([\d,]+(?:\.\d+)?)\s*(trillion|billion|million|tn|bn|mn|[bmt])?\b|(\d+(?:\.\d+)?)\s*%/gi,
    ),
  ].map((m) => {
    if (m[4]) return `${m[4]}%`;
    const scale = m[3]?.toLowerCase()[0];
    return `${m[1]}${Number(m[2]!.replace(/,/g, "")) * (scale === "t" ? 1e12 : scale === "b" ? 1e9 : scale === "m" ? 1e6 : 1)}`;
  });
}

export function evidenceScore(text: string, title: string, entities: RankedEntity[] = []): number {
  if (editorialNoise(text)) return -100;
  const tokens = new Set(centralTokens(text));
  const overlap = centralTokens(title).filter((t) => tokens.has(t)).length;
  const primary = entities.filter(
    (e) => e.role === "PRIMARY" && [e.name, ...e.aliases].some((n) => contains(text, n)),
  ).length;
  const numbers = numericKeys(text);
  const headlineNumber = numbers.some((n) => numericKeys(title).includes(n));
  return (
    overlap * 4 +
    Math.min(primary, 3) * 3 +
    (ACTION.test(text) ? 4 : 0) +
    (numbers.length && ACTION.test(text) ? 2 : 0) +
    (headlineNumber ? 18 : 0) -
    (/^(?:he|she|it|they|this|that|its|the project|the company|in the short interval)\b/i.test(text)
      ? 5
      : 0)
  );
}

export type ReaderFact = {
  text: string;
  evidence: number[];
  origin: "rss" | "enriched";
  score: number;
  quote: boolean;
  uncertain: boolean;
};

export function selectReaderEvidence(title: string, sources: ReaderSource[]) {
  const entities = rankEntities(title, sources);
  const raw: ReaderFact[] = [];
  sources.forEach((source, index) => {
    let antecedent: string | undefined;
    // Use both existing evidence stores: an enrichment cap must not hide an RSS fact.
    const units = [
      ...(source.enrichedEvidence ?? []).map((u) => ({ ...u, origin: "enriched" as const })),
      ...readerSentences(source.excerpt ?? "").map((text) => ({
        text,
        kind: "fact",
        origin: "rss" as const,
        attribution: undefined,
      })),
    ];
    for (const unit of units) {
      const quote = unit.kind === "quote" && !!unit.attribution;
      let text = quote
        ? `${unit.attribution} said: "${unit.text}"`
        : unit.text.trim().replace(/®$/, "");
      const retrospective = text.match(/^When we [^,]+, (.+)$/i);
      if (retrospective?.[1] && source.name)
        text = `${source.name} previously reported that ${retrospective[1]}`;
      text = text.replace(/^In the short interval since then,\s*/i, "");
      text = text.replace(
        /^(?:Unfortunately|Fortunately|Indeed),\s*([a-z])/i,
        (_, letter: string) => letter.toUpperCase(),
      );
      // Resolve a surname only when the source supplies one unambiguous full name.
      for (const entity of entities) {
        const parts = entity.name.split(" ");
        const surname = parts.at(-1)!;
        if (parts.length < 2 || parts.length > 3 || !/^[A-Z][a-z]+$/.test(surname)) continue;
        if (entities.filter((e) => e.name.endsWith(` ${surname}`)).length !== 1) continue;
        if (!contains(text, entity.name))
          text = text.replace(
            new RegExp(`\\b${surname}(?= (?:and (?:his|her)|[–—] better known|said|was working))`),
            entity.name,
          );
      }
      const identity = text.match(
        /([A-Z][a-z]+(?: [A-Z][a-z]+){1,3}) [–—] better known as ([A-Z]{2,6}) [–—] (the .+)$/,
      );
      if (identity) text = `${identity[1]}, better known as ${identity[2]}, is ${identity[3]}`;
      if (antecedent) text = text.replace(/^Its\b/, `${antecedent}'s`).replace(/^It\b/, antecedent);
      const subject = entities.find(
        (e) => e.role !== "REPORTING_SOURCE" && text.replace(/^The /, "").startsWith(`${e.name} `),
      );
      antecedent = subject?.name;
      raw.push({
        text,
        evidence: [index + 1],
        origin: unit.origin,
        score:
          unit.kind === "quote" && !unit.attribution ? -100 : evidenceScore(text, title, entities),
        quote,
        uncertain: unit.kind === "uncertain",
      });
    }
  });
  const accepted: ReaderFact[] = [];
  let rejected = 0;
  let duplicates = 0;
  for (const fact of raw) {
    const text = fact.text;
    const unbalanced =
      (text.match(/"/g)?.length ?? 0) % 2 !== 0 ||
      (text.match(/“/g)?.length ?? 0) !== (text.match(/”/g)?.length ?? 0);
    const unassignedQuote = /^["“]/.test(text) && !/\b(?:said|says|told|according to)\b/.test(text);
    if (
      text.length < 40 ||
      text.length > 320 ||
      fact.score <= -100 ||
      /…$|\.\.\.$/.test(text) ||
      unbalanced ||
      unassignedQuote ||
      (!fact.quote && !ACTION.test(text))
    ) {
      rejected++;
      continue;
    }
    const duplicateKey = (value: string) =>
      claimKey(value)
        .toLowerCase()
        .replace(/\bhas announced\b/g, "announced")
        .replace(/\btoday\b/g, "")
        .replace(/\s+/g, " ")
        .trim() + (/\btoday\b/i.test(value) ? "|today" : "");
    const prior = accepted.find((f) => duplicateKey(f.text) === duplicateKey(text));
    if (prior) {
      for (const ref of fact.evidence) if (!prior.evidence.includes(ref)) prior.evidence.push(ref);
      duplicates++;
      continue;
    }
    accepted.push(fact);
  }
  const ranked = [...accepted].sort((a, b) => b.score - a.score);
  const lead = ranked.find(
    (f) => !f.quote && !f.uncertain && !/^(?:he|she|it|they|this|that|its)\b/i.test(f.text),
  );
  const selected = new Set(ranked.slice(0, 28));
  const facts = accepted.filter((f) => selected.has(f));
  return {
    rawCount: raw.length,
    rejectedCount: rejected,
    duplicateCount: duplicates,
    entities,
    lead,
    facts,
  };
}
