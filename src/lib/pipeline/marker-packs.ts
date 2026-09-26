/**
 * Material markers, in more than one language. The only place they are defined.
 *
 * ---------------------------------------------------------------------------
 * What a marker is, and what a pack is not
 * ---------------------------------------------------------------------------
 *
 * `event-version.ts` decides whether an event's *material state* has moved. The
 * markers here are the part of that state which names a transition rather than
 * a magnitude: talks becoming a confirmed deal, a ruling after a filing, an
 * announcement becoming a release. They are presence tests.
 *
 * A pack is a language, not a domain. There is deliberately no "software
 * markers" list, no "music markers" list and no "sports markers" list, because
 * that shape is how a product ends up unable to follow anything its authors did
 * not anticipate. The same transition -- a thing was released -- is expressed in
 * Japanese as 発売 and in English as "released", and the two are the same
 * concept key. Script detection picks the packs, the concept key is shared, and
 * nothing above this module needs to know which language produced a marker.
 *
 * This file is the single source. `event-version.ts` used to carry its own copy
 * of the English list, and the two could drift -- one of them already had: the
 * English `deal_confirmed` pattern here was present and silently skipped, while
 * the copy there used an affirmative-sentence test instead. A rule is now either
 * a pattern or a test, and every rule in every pack is evaluated; a marker that
 * does not apply to a language is simply absent from that pack.
 *
 * ---------------------------------------------------------------------------
 * Why release stages are version-gated, in every script
 * ---------------------------------------------------------------------------
 *
 * "Announced" and "released" are ordinary news verbs, and so are 発表 and 公布.
 * Firing a *stage* marker on every sentence that uses them would turn every
 * rehash into a revision, so a release stage (`release_announced`, `_preview`,
 * `_beta`, `_candidate`, `_final`) is emitted only from a sentence that also
 * carries a version token -- `2.0`, `v1.4.2`, `バージョン 2.0`, `2.0版`. That is
 * what makes
 *
 *      Day 1: Rust 2.0 announced              Rust 2.0 を発表
 *      Day 7: Rust 2.0 release candidate      Rust 2.0 のリリース候補版を公開
 *
 * two material states in either language, and what stops 正式版が登場 -- "the
 * official version arrived", with no version and no transition behind it -- from
 * moving an unrelated event's fingerprint. The generic `released` concept (発売,
 * 发布, 출시, "launched") stays ungated in every pack, exactly as the English verb
 * always was: it names a transition even without a version.
 */

/** The shared transition vocabulary. Language packs spell these, nothing else. */
export type MarkerConcept =
  | "deal_confirmed"
  | "deal_agreed"
  | "deal_completed"
  | "deal_abandoned"
  | "court_ruled"
  | "court_settled"
  | "charges_filed"
  | "regulator_approved"
  | "regulator_blocked"
  | "policy_enacted"
  | "released"
  | "recalled"
  | "results_reported"
  | "resigned"
  | "filed_bankruptcy"
  | "patch_available"
  | "exploited_in_wild"
  | "fatalities"
  | "release_announced"
  | "release_preview"
  | "release_beta"
  | "release_candidate"
  | "release_final";

/**
 * One rule: a regex, or -- where a regex cannot express the rule -- a test.
 *
 * Both are always evaluated. There is no third kind that is "defined but
 * skipped", which is the shape that let the two copies of this list disagree.
 */
export type MarkerRule =
  | { readonly marker: MarkerConcept; readonly pattern: RegExp }
  | { readonly marker: MarkerConcept; readonly test: (text: string) => boolean };

export type MarkerPack = { readonly lang: string; readonly rules: readonly MarkerRule[] };

/**
 * An affirmative deal confirmation, sentence by sentence.
 *
 * "Confirmed" is the most hedged word in business news: "has not confirmed",
 * "could not be confirmed", "declined to confirm whether". A bare pattern reads
 * every one of those as a closed deal, so English `deal_confirmed` needs a
 * sentence that says confirmed, is about a deal, and carries no negation, hedge
 * or question.
 */
export function hasAffirmativeDealConfirmation(text: string): boolean {
  return (text.match(/[^.!?;\n]+[.!?;]?/g) ?? []).some(
    (sentence) =>
      /\bconfirmed\b/i.test(sentence) &&
      !sentence.endsWith("?") &&
      /\b(?:deal|agreement|acquisition|merger|takeover|acquire|buy|merge)\b/i.test(sentence) &&
      !/\b(?:no|not|never|neither|without|unconfirmed|uncertain|unverified|if|whether|may|might|could|would|expected|reportedly|allegedly|rumou?rs?|awaiting|pending|yet|declined|refused)\b|\b\w+n['’]t\b/i.test(
        sentence,
      ),
  );
}

/** English. */
const LATIN: MarkerPack = {
  lang: "latin",
  rules: [
    // Deals: agreed and closed are different events from "in talks".
    { marker: "deal_confirmed", test: hasAffirmativeDealConfirmation },
    { marker: "deal_agreed", pattern: /\b(?:has|have) agreed to (?:buy|acquire|merge)\b/i },
    {
      marker: "deal_completed",
      pattern: /\b(?:deal|acquisition|merger|takeover) (?:has )?(?:closed|completed)\b/i,
    },
    {
      marker: "deal_abandoned",
      pattern:
        /\b(?:called off|abandoned|walked away from|terminated) the (?:deal|merger|acquisition)\b/i,
    },

    // Courts and regulators: a ruling is not a filing.
    { marker: "court_ruled", pattern: /\b(?:ruled|ruling|verdict|judgment|judgement)\b/i },
    { marker: "court_settled", pattern: /\b(?:settled|settlement reached)\b/i },
    {
      marker: "charges_filed",
      pattern: /\b(?:charged with|indicted|pleaded (?:guilty|not guilty))\b/i,
    },
    { marker: "regulator_approved", pattern: /\b(?:approved|cleared|authorised|authorized) by\b/i },
    { marker: "regulator_blocked", pattern: /\b(?:blocked|rejected|refused|vetoed) the\b/i },
    {
      marker: "policy_enacted",
      pattern: /\b(?:signed into law|came into force|takes effect|enacted)\b/i,
    },

    // Shipping: a launch is not a leak.
    {
      marker: "released",
      pattern: /\b(?:has |have )?(?:launched|released|shipped|went on sale|now available)\b/i,
    },
    { marker: "recalled", pattern: /\b(?:recalled|pulled from sale|withdrawn)\b/i },

    // Corporate and personnel.
    {
      marker: "results_reported",
      pattern:
        /\b(?:reported|posted) (?:quarterly |annual |full-year )?(?:results|earnings|revenue)\b/i,
    },
    {
      marker: "resigned",
      pattern: /\b(?:resigned|stepped down|has been (?:fired|ousted|dismissed))\b/i,
    },
    {
      marker: "filed_bankruptcy",
      pattern: /\b(?:filed for bankruptcy|chapter 11|entered administration|liquidation)\b/i,
    },

    // Safety and security: a patch changes what a reader should do.
    {
      marker: "patch_available",
      pattern: /\b(?:patch|fix|update) (?:is )?(?:available|released)\b/i,
    },
    { marker: "exploited_in_wild", pattern: /\bexploited in the wild\b/i },

    // Casualty events: "died" after "injured" is a development.
    { marker: "fatalities", pattern: /\b(?:killed|dead|died|fatalities|death toll)\b/i },
  ],
};

/**
 * Japanese.
 *
 * `deal_confirmed` avoids bare 確認 on purpose: 未確認 is "unconfirmed", and a
 * substring test on a two-character word inside a negated one is exactly the
 * mistake `hasAffirmativeDealConfirmation` exists to prevent in English. The
 * pack spells the affirmative forms instead.
 */
const JAPANESE: MarkerPack = {
  lang: "ja",
  rules: [
    {
      marker: "deal_confirmed",
      pattern: /(?:合意した|合意に達した|締結した|承認された|確認された)/,
    },
    { marker: "deal_agreed", pattern: /(?:買収に合意|統合に合意|合意に至った)/ },
    { marker: "deal_completed", pattern: /(?:買収完了|統合完了|取引が完了|手続きが完了)/ },
    { marker: "deal_abandoned", pattern: /(?:買収を断念|交渉を打ち切り|統合を中止)/ },
    { marker: "court_ruled", pattern: /(?:判決|裁定|判断を下した|敗訴|勝訴)/ },
    { marker: "policy_enacted", pattern: /(?:施行|成立|可決|発効)/ },
    {
      marker: "released",
      pattern: /(?:発売(?!予定|日)|リリースされ|リリースした|配信開始|一般提供|正式公開)/,
    },
    { marker: "recalled", pattern: /(?:リコール|回収|出荷停止)/ },
    { marker: "results_reported", pattern: /(?:決算|業績|増収増益|減収減益)/ },
    { marker: "resigned", pattern: /(?:辞任|退任|解任|更迭)/ },
    { marker: "filed_bankruptcy", pattern: /(?:破産|倒産|民事再生)/ },
    { marker: "patch_available", pattern: /(?:修正版|パッチ|修正プログラム)/ },
    { marker: "exploited_in_wild", pattern: /(?:悪用|攻撃を確認)/ },
    { marker: "fatalities", pattern: /(?:死亡|死者|犠牲|遺体)/ },
  ],
};

/**
 * Chinese (simplified and traditional forms both spelled).
 *
 * 正式版 is not a `released` spelling here: it is a *stage* ("the official
 * version"), and on its own -- with no version and no verb -- it says nothing
 * that happened. It lives in the version-gated stage table below.
 */
const CHINESE: MarkerPack = {
  lang: "zh",
  rules: [
    { marker: "deal_confirmed", pattern: /(?:已确认|確認達成|达成协议|達成協議|已批准)/ },
    { marker: "deal_agreed", pattern: /(?:同意收购|同意收購|达成收购协议)/ },
    { marker: "deal_completed", pattern: /(?:收购完成|收購完成|交易完成|交割完成)/ },
    { marker: "deal_abandoned", pattern: /(?:放弃收购|放棄收購|终止交易|終止交易)/ },
    { marker: "court_ruled", pattern: /(?:判决|判決|裁定|裁决|敗訴|败诉)/ },
    { marker: "policy_enacted", pattern: /(?:生效|实施|實施|通过|通過|施行)/ },
    { marker: "released", pattern: /(?:发布|發布|上市|正式推出|开始发售|開始發售)/ },
    { marker: "recalled", pattern: /(?:召回|下架|停止销售)/ },
    { marker: "results_reported", pattern: /(?:财报|財報|业绩|業績|营收|營收)/ },
    { marker: "resigned", pattern: /(?:辞职|辭職|卸任|免职|免職)/ },
    { marker: "filed_bankruptcy", pattern: /(?:破产|破產|重整)/ },
    { marker: "patch_available", pattern: /(?:补丁|補丁|修复|修復)/ },
    { marker: "exploited_in_wild", pattern: /(?:已被利用|在野利用|遭攻击)/ },
    { marker: "fatalities", pattern: /(?:死亡|遇难|遇難|罹难|罹難)/ },
  ],
};

/** Korean. */
const KOREAN: MarkerPack = {
  lang: "ko",
  rules: [
    { marker: "deal_confirmed", pattern: /(?:합의했다|합의에 도달|승인됐다|승인되었다|확인됐다)/ },
    { marker: "deal_agreed", pattern: /(?:인수에 합의|합병에 합의)/ },
    { marker: "deal_completed", pattern: /(?:인수 완료|합병 완료|거래 완료)/ },
    { marker: "deal_abandoned", pattern: /(?:인수 포기|협상 중단|합병 철회)/ },
    { marker: "court_ruled", pattern: /(?:판결|결정을 내렸|패소|승소)/ },
    { marker: "policy_enacted", pattern: /(?:시행|발효|통과|국회 통과)/ },
    { marker: "released", pattern: /(?:출시(?! 예정)|정식 발매|공개(?! 예정)|배포|판매 시작)/ },
    { marker: "recalled", pattern: /(?:리콜|회수|판매 중단)/ },
    { marker: "results_reported", pattern: /(?:실적|결산|매출)/ },
    { marker: "resigned", pattern: /(?:사임|퇴임|해임|경질)/ },
    { marker: "filed_bankruptcy", pattern: /(?:파산|법정관리)/ },
    { marker: "patch_available", pattern: /(?:패치|수정판|보안 업데이트)/ },
    { marker: "exploited_in_wild", pattern: /(?:실제 공격|악용|공격에 악용)/ },
    { marker: "fatalities", pattern: /(?:사망|사망자|희생자)/ },
  ],
};

/** Every pack, for callers that need to enumerate them (and for the drift test). */
export const MARKER_PACKS: readonly MarkerPack[] = [LATIN, JAPANESE, CHINESE, KOREAN];

/**
 * Which packs a body of text is written in.
 *
 * Kana implies Japanese even when Han characters dominate, because Chinese does
 * not use kana. Han alone is treated as Chinese. Hangul is Korean. The Latin
 * pack is included whenever Latin letters appear, so a Japanese story quoting a
 * product name still reads its English markers and the reverse.
 */
export function detectScripts(text: string): string[] {
  const found: string[] = [];
  const hasLatin = /[A-Za-z]/.test(text);
  const hasKana = /[\p{Script=Hiragana}\p{Script=Katakana}]/u.test(text);
  const hasHan = /\p{Script=Han}/u.test(text);
  const hasHangul = /\p{Script=Hangul}/u.test(text);

  if (hasLatin) found.push("latin");
  if (hasKana) found.push("ja");
  else if (hasHan) found.push("zh");
  if (hasHangul) found.push("ko");
  return found;
}

/** The packs that apply to a body of text. */
export function markerPacksFor(text: string): MarkerPack[] {
  const langs = detectScripts(text);
  return MARKER_PACKS.filter((pack) => langs.includes(pack.lang));
}

function ruleFires(rule: MarkerRule, text: string): boolean {
  return "test" in rule ? rule.test(text) : rule.pattern.test(text);
}

/* ---------------------------------------------------------------------------
 * Release identity
 * ------------------------------------------------------------------------- */

/**
 * A version token: at least two dot-separated numbers, so `2.0` and `v1.4.2`
 * qualify while `2026` and `5` do not. Trailing scale words and a leading
 * currency symbol are refused because `$2.0 billion` is money, not a version.
 *
 * The token may run straight into a pre-release tag -- `2.0rc1`, `1.4beta2` --
 * which a trailing `\b` alone would refuse, because a digit followed by a letter
 * is not a word boundary.
 */
const VERSION_RE = /\bv?(\d{1,4}(?:\.\d{1,4}){1,3})(?:\b|(?=(?:[Rr][Cc]|beta|alpha)\d*\b))/g;
const YEAR_RE = /^(?:19|20)\d{2}$/;
const SCALE_AFTER_RE = /^\s*(?:%|percent|billion|million|trillion|bn|mn|k)\b/i;
const MONEY_BEFORE_RE = /[$€£]\s*$/;

/**
 * Release stages, strongest first, each spelled for Latin and for CJK.
 *
 * The first stage whose pattern fires in a versioned sentence is that sentence's
 * stage, so "2.0 beta announced" is a beta and "2.0 リリース候補" is a candidate
 * rather than a release. The CJK column is script-specific by construction (no
 * spelling is shared with another language's ordinary vocabulary), so it needs
 * no script detection and never depends on an English word being present.
 */
const STAGES: readonly { stage: string; latin: RegExp; cjk: RegExp }[] = [
  {
    stage: "candidate",
    // `release candidate`, `RC1`, `rc.2`, and a bare `RC` -- but only a bare RC
    // that follows a version (`2.0 RC`, `2.0-rc`, `2.0rc`), so "RC car" and
    // "RC Cola" are not release candidates, and `rc.local` / `rc.d` are not
    // either (a dot-and-letter after it is a file name).
    latin:
      /(?:\brelease candidate\b|\bcandidate build\b|\brc[.-]?\d+\b|(?<=\d[\s._-]?)rc(?:[.-]?\d+)?\b(?![.-][a-z]))/i,
    cjk: /(?:候補版|リリース候補|RC版|候选版|候選版|发布候选|發布候選|후보 버전|RC 버전|출시 후보)/,
  },
  {
    stage: "beta",
    latin: /\b(?:closed beta|open beta|public beta|beta\d*)\b/i,
    cjk: /(?:ベータ|β版|测试版|測試版|公测|公測|内测|內測|베타)/,
  },
  {
    stage: "preview",
    latin: /\b(?:developer preview|technical preview|early access|preview build|preview)\b/i,
    cjk: /(?:プレビュー|先行版|早期アクセス|预览版|預覽版|抢先版|搶先版|미리보기|프리뷰|얼리 액세스)/,
  },
  {
    stage: "final",
    latin:
      /\b(?:generally available|ga|now available|available (?:today|now)|final release|stable release|general release|goes on sale|on sale|released|releases|launched|launches|ships|shipped)\b/i,
    cjk: /(?:正式版|正式リリース|一般提供|正式公開|配信開始|発売(?!予定|日)|リリースされ|リリースした|正式发布|正式發布|正式上市|正式推出|开始发售|開始發售|发布了|發布了|已发布|已發布|정식 버전|정식 출시|정식 발매|출시(?! 예정)|발매(?! 예정))/,
  },
  {
    stage: "announced",
    latin:
      /\b(?:announced|announces|unveiled|unveils|revealed|reveals|teased|teases|introduced|introduces|coming soon|due (?:in|on|next)|planned for|scheduled for|roadmap)\b/i,
    cjk: /(?:発表|予告|公開予定|発売予定|発売日|登場予定|リリース予定|宣布|公布|预告|預告|即将发布|即將發布|발표|예고|공개 예정|출시 예정|발매 예정)/,
  },
];

/**
 * Sentence boundaries, scanned rather than matched.
 *
 * A regex over `[^.!?]+` cannot be used here: the dot in `2.0` would end the
 * sentence and the version identity would never survive to be compared, which
 * is the bug this function exists to prevent. A dot between digits, or a dot
 * inside a token, is not a full stop.
 */
function sentenceSplit(text: string): string[] {
  const out: string[] = [];
  let current = "";

  for (let i = 0; i < text.length; i += 1) {
    const ch = text.charAt(i);
    if (ch === "\n") {
      if (current.trim() !== "") out.push(current);
      current = "";
      continue;
    }
    current += ch;

    const isTerminator =
      ch === "." || ch === "!" || ch === "?" || ch === "。" || ch === "！" || ch === "？";
    if (!isTerminator) continue;

    const next = text.charAt(i + 1);
    // `2.0`, `v1.4.2`, `1.5x`: a dot between digits is inside a token.
    if (ch === "." && next !== "" && /\d/.test(next)) continue;
    // `U.S.` and file names: a dot immediately followed by a letter is inside a
    // token too. A sentence ends at a terminator followed by space or end.
    if (ch === "." && next !== "" && /[\p{L}]/u.test(next)) continue;

    if (current.trim() !== "") out.push(current);
    current = "";
  }

  if (current.trim() !== "") out.push(current);
  return out;
}

function versionsIn(sentence: string): string[] {
  const out: string[] = [];
  const re = new RegExp(VERSION_RE.source, VERSION_RE.flags);
  let match: RegExpExecArray | null;
  while ((match = re.exec(sentence)) !== null) {
    const token = match[1];
    if (!token || YEAR_RE.test(token)) continue;
    const after = sentence.slice(match.index + match[0].length);
    if (SCALE_AFTER_RE.test(after)) continue;
    if (MONEY_BEFORE_RE.test(sentence.slice(0, match.index))) continue;
    if (!out.includes(token)) out.push(token);
  }
  return out;
}

/** The first stage a sentence carries, in either column, strongest first. */
function stageOf(sentence: string): string | undefined {
  return STAGES.find(({ latin, cjk }) => latin.test(sentence) || cjk.test(sentence))?.stage;
}

export type ReleaseIdentity = {
  /** `release_<stage>` marker keys, de-duplicated. */
  stages: MarkerConcept[];
  /** Version tokens (`2.0`), de-duplicated. */
  versions: string[];
};

/**
 * Release stages and version identity, sentence by sentence.
 *
 * A sentence only contributes when it carries a version token, which is what
 * keeps `announced` -- or 発表 -- from meaning "a revision happened" in every
 * ordinary headline. The property the product needs is narrower and exact: the
 * *same* version at a *later* stage is a development.
 *
 * NFKC first, so full-width `２．０` and `ｖ２` read as the tokens they are: CJK
 * text regularly sets numbers full-width, and a version that is only
 * recognised half-width is a version CJK coverage cannot carry.
 */
export function releaseIdentity(text: string): ReleaseIdentity {
  const stages = new Set<MarkerConcept>();
  const versions = new Set<string>();

  for (const sentence of sentenceSplit(text.normalize("NFKC"))) {
    const found = versionsIn(sentence);
    if (found.length === 0) continue;

    const stage = stageOf(sentence);
    if (!stage) continue;

    for (const version of found) versions.add(version);
    stages.add(`release_${stage}` as MarkerConcept);
  }

  return {
    stages: [...stages].sort(),
    versions: [...versions].sort(),
  };
}

/**
 * Every marker a body of text carries, across every pack it is written in.
 *
 * Every rule of every applicable pack is evaluated, and the version-gated
 * release stages are added from `releaseIdentity`. Sorted and de-duplicated so
 * coverage order cannot move the fingerprint.
 */
export function markersIn(text: string, packs?: readonly MarkerPack[]): string[] {
  const applicable = packs ?? markerPacksFor(text);
  const found = new Set<string>();
  for (const pack of applicable) {
    for (const rule of pack.rules) {
      if (ruleFires(rule, text)) found.add(rule.marker);
    }
  }
  for (const stage of releaseIdentity(text).stages) found.add(stage);
  return [...found].sort();
}
