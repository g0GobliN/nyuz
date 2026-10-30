/**
 * Is this text English? The one detector, and the only place that answers.
 *
 * ---------------------------------------------------------------------------
 * The rule it enforces
 * ---------------------------------------------------------------------------
 *
 * English only, of any country: an English-language Argentine, Japanese, Indian,
 * Nigerian or Brazilian outlet is wanted, a Portuguese, Hindi or Russian one is
 * not (owner ruling, 2026-10-30, cards t_06bd689e and t_bcf87ee3). The test is
 * the language of the text, never the country of the outlet, and nothing is
 * translated. So the question here is narrow on purpose: given the words in
 * front of it, is this English?
 *
 * ---------------------------------------------------------------------------
 * Two signals, because English has two kinds of neighbour
 * ---------------------------------------------------------------------------
 *
 *   script    A title in Cyrillic, Arabic, Urdu, Devanagari, Bengali, Han,
 *             Kana, Hangul, Thai, Hebrew, Greek, Tamil, Telugu, Kannada,
 *             Malayalam, Gujarati or Gurmukhi is not English regardless of how
 *             many Latin words it also carries. Measured as the share of
 *             letters outside the Latin script.
 *
 *   function  Spanish, Portuguese, French, German, Italian, Indonesian, Dutch
 *   words     and Turkish all use the Latin script, so script says nothing
 *             about them. What separates them from English is the small words:
 *             `del`, `não`, `und`, `yang`, `için`, `het`. A run of those is the
 *             signal, and no single one is -- `De La Cruz` is a name, and
 *             `Van Morrison` is not Dutch.
 *
 * The word lists are deliberately the *unambiguous* small words. The English
 * words every sentence contains -- a, as, on, in, no, over, was, her, am, it,
 * the -- are absent, because a list that contains them scores English prose as
 * foreign. What is left almost never begins an English clause.
 *
 * ---------------------------------------------------------------------------
 * It fails closed, and it is allowed to be wrong in one direction
 * ---------------------------------------------------------------------------
 *
 * Unknown, empty, or too little text to judge is NOT English: the ruling says a
 * candidate that cannot be shown to be English is a reject, so silence is
 * correct and a foreign line reaching a reader is the defect. The cost of the
 * other error -- an English feed rejected for looking odd -- is one source not
 * added, which the daily discovery pass refinds tomorrow. That asymmetry is why
 * the thresholds lean strict.
 *
 * The detector makes no network call, reads no configuration and has no model
 * in it. Same input, same answer, forever, which is what lets ingest, compose,
 * the growth pass and the audit share one verdict instead of arguing.
 */

/** The scripts this product reads. `latin` is the only one that can pass. */
export type DetectedScript =
  | "latin"
  | "cyrillic"
  | "arabic"
  | "hebrew"
  | "greek"
  | "devanagari"
  | "bengali"
  | "gurmukhi"
  | "gujarati"
  | "tamil"
  | "telugu"
  | "kannada"
  | "malayalam"
  | "thai"
  | "han"
  | "kana"
  | "hangul"
  | "unknown";

export type LanguageVerdict = {
  /** The whole answer. False means: do not show this to a reader. */
  english: boolean;
  /** Why, in a form a log or a card can carry verbatim. */
  reason: string;
  /** The script that made the verdict, or the dominant non-Latin script. */
  script: DetectedScript;
  /** Share of letters that are not Latin script. 0 for pure ASCII English. */
  nonLatinRatio: number;
  /** Share of words that are another Latin-script language's function words. */
  latinStopwordRatio: number;
  /** Share of Latin letters that carry a diacritic (0.08 in Hungarian, 0.00 in English). */
  latinAccentRatio: number;
};

/**
 * Non-Latin script ranges.
 *
 * Arabic covers Urdu, Persian and Pashto too -- they share the block, and the
 * ruling bans all of them, so telling them apart would buy a nicer label and
 * nothing else. `kana` is tested before `han` because Japanese mixes both and
 * naming the kana is the more useful label.
 */
const SCRIPT_RANGES: ReadonlyArray<{ script: DetectedScript; pattern: RegExp }> = [
  { script: "cyrillic", pattern: /[\u0400-\u04ff\u0500-\u052f]/ },
  {
    script: "arabic",
    pattern: /[\u0600-\u06ff\u0750-\u077f\u08a0-\u08ff\ufb50-\ufdff\ufe70-\ufeff]/,
  },
  { script: "hebrew", pattern: /[\u0590-\u05ff]/ },
  { script: "greek", pattern: /[\u0370-\u03ff\u1f00-\u1fff]/ },
  { script: "devanagari", pattern: /[\u0900-\u097f]/ },
  { script: "bengali", pattern: /[\u0980-\u09ff]/ },
  { script: "gurmukhi", pattern: /[\u0a00-\u0a7f]/ },
  { script: "gujarati", pattern: /[\u0a80-\u0aff]/ },
  { script: "tamil", pattern: /[\u0b80-\u0bff]/ },
  { script: "telugu", pattern: /[\u0c00-\u0c7f]/ },
  { script: "kannada", pattern: /[\u0c80-\u0cff]/ },
  { script: "malayalam", pattern: /[\u0d00-\u0d7f]/ },
  { script: "thai", pattern: /[\u0e00-\u0e7f]/ },
  { script: "kana", pattern: /[\u3040-\u30ff]/ },
  { script: "han", pattern: /[\u3400-\u4dbf\u4e00-\u9fff\uf900-\ufaff]/ },
  { script: "hangul", pattern: /[\u1100-\u11ff\uac00-\ud7af]/ },
];

/**
 * Above this share of non-Latin letters the text is not English.
 *
 * 0.2 is deliberately low: five Latin words around one Cyrillic word is 0.2,
 * and a headline written in Russian with an English brand name in it is still a
 * Russian headline. At least `MIN_NON_LATIN_LETTERS` must be present as well, so
 * one stray character in an English title -- a Greek letter used as a symbol, a
 * single Han character in a company name -- is not a verdict.
 */
const NON_LATIN_RATIO_LIMIT = 0.2;
const MIN_NON_LATIN_LETTERS = 3;

/**
 * Function words per Latin-script language: strong cues only.
 *
 * These are the words an English sentence does not contain. `de`, `la`, `y`,
 * `a`, `o`, `e`, `i`, `as`, `no`, `on`, `in`, `was`, `her`, `am` and `over` are
 * left out on purpose even where they are genuinely Spanish, Portuguese, Dutch
 * or German -- they are also ordinary English, and a cue that fires on English
 * turns the gate into a coin flip.
 */
const LATIN_FUNCTION_WORDS: Readonly<Record<string, readonly string[]>> = {
  es: [
    "el",
    "los",
    "las",
    "una",
    "unas",
    "unos",
    "del",
    "por",
    "para",
    "con",
    "sus",
    "pero",
    "como",
    "más",
    "muy",
    "este",
    "esta",
    "estos",
    "estas",
    "entre",
    "desde",
    "según",
    "también",
    "sin",
    "sobre",
    "tras",
    "hay",
    "fue",
    "son",
    "será",
    "han",
    "desde",
    "hasta",
    "durante",
    "cuando",
    "donde",
    "porque",
    "se",
    "lo",
    "ya",
    "al",
    "en",
  ],
  pt: [
    "não",
    "uma",
    "para",
    "com",
    "dos",
    "das",
    "do",
    "da",
    "dos",
    "pelo",
    "pela",
    "pelos",
    "pelas",
    "mais",
    "mas",
    "como",
    "também",
    "entre",
    "sobre",
    "após",
    "sem",
    "foi",
    "foram",
    "são",
    "será",
    "está",
    "estão",
    "ao",
    "aos",
    "em",
    "seu",
    "sua",
    "os",
    "um",
    "que",
    "tem",
    "têm",
    "já",
    "até",
    "quando",
    "onde",
    "porque",
    "muito",
    "muita",
    "pelo",
    "num",
    "numa",
    "lhe",
  ],
  fr: [
    "les",
    "des",
    "du",
    "une",
    "aux",
    "et",
    "est",
    "que",
    "qui",
    "pour",
    "dans",
    "avec",
    "sur",
    "pas",
    "plus",
    "cette",
    "ces",
    "cet",
    "son",
    "ses",
    "leur",
    "leurs",
    "au",
    "par",
    "mais",
    "été",
    "être",
    "sont",
    "sous",
    "vers",
    "après",
    "avant",
    "depuis",
    "pendant",
    "chez",
    "très",
    "moins",
    "tout",
    "tous",
    "toute",
    "déjà",
    "encore",
    "quand",
    "comme",
    "elle",
    "ils",
    "elles",
    "nous",
    "vous",
    "ne",
    "ou",
    "où",
    "le",
  ],
  de: [
    "der",
    "die",
    "das",
    "und",
    "den",
    "dem",
    "des",
    "ist",
    "hat",
    "eine",
    "einen",
    "einem",
    "einer",
    "mit",
    "für",
    "auf",
    "von",
    "nicht",
    "sich",
    "wird",
    "werden",
    "wurde",
    "auch",
    "sind",
    "zum",
    "zur",
    "bei",
    "nach",
    "noch",
    "schon",
    "sehr",
    "wenn",
    "weil",
    "aber",
    "oder",
    "als",
    "wie",
    "über",
    "unter",
    "zwischen",
    "durch",
    "gegen",
    "ohne",
    "im",
    "vom",
    "beim",
    "hier",
    "dann",
    "doch",
    "nur",
    "mehr",
    "haben",
    "hatte",
    "können",
  ],
  it: [
    "gli",
    "della",
    "dello",
    "degli",
    "delle",
    "dei",
    "che",
    "chi",
    "cui",
    "con",
    "per",
    "una",
    "uno",
    "sono",
    "nel",
    "nella",
    "negli",
    "alla",
    "allo",
    "più",
    "non",
    "anche",
    "dal",
    "dalla",
    "dai",
    "sul",
    "sulla",
    "tra",
    "fra",
    "come",
    "quando",
    "dove",
    "perché",
    "molto",
    "già",
    "ancora",
    "sempre",
    "senza",
    "sotto",
    "sopra",
    "verso",
    "dopo",
    "prima",
    "durante",
    "questo",
    "questa",
    "questi",
    "queste",
    "suo",
    "sua",
    "loro",
    "era",
    "hanno",
    "è",
    "il",
    "lo",
  ],
  id: [
    "yang",
    "dan",
    "untuk",
    "dari",
    "tidak",
    "dengan",
    "ini",
    "itu",
    "akan",
    "pada",
    "juga",
    "bisa",
    "sudah",
    "dalam",
    "lebih",
    "masih",
    "kata",
    "atau",
    "tetapi",
    "karena",
    "sebagai",
    "oleh",
    "saat",
    "setelah",
    "sebelum",
    "sampai",
    "hanya",
    "banyak",
    "semua",
    "telah",
    "adalah",
    "mereka",
    "kami",
    "kita",
    "saya",
    "dia",
  ],
  nl: [
    "het",
    "een",
    "van",
    "voor",
    "dat",
    "niet",
    "met",
    "zijn",
    "wordt",
    "worden",
    "ook",
    "maar",
    "aan",
    "bij",
    "nog",
    "naar",
    "heeft",
    "hebben",
    "kan",
    "kunnen",
    "moet",
    "moeten",
    "dit",
    "deze",
    "die",
    "als",
    "dan",
    "toch",
    "wel",
    "geen",
    "veel",
    "meer",
    "minder",
    "tussen",
    "door",
    "tegen",
    "zonder",
    "onder",
    "tijdens",
    "volgens",
    "omdat",
    "wanneer",
    "waar",
  ],
  tr: [
    "için",
    "bir",
    "ve",
    "bu",
    "ile",
    "çok",
    "olarak",
    "daha",
    "gibi",
    "sonra",
    "kadar",
    "değil",
    "var",
    "yeni",
    "iki",
    "şey",
    "ama",
    "ancak",
    "hem",
    "ki",
    "mi",
    "mı",
    "ne",
    "nasıl",
    "neden",
    "kendi",
    "tüm",
    "üzere",
    "göre",
    "karşı",
    "arasında",
    "sırasında",
    "sonunda",
    "üzerine",
    "birlikte",
  ],
  is: [
    "og",
    "ekki",
    "það",
    "þetta",
    "þessi",
    "með",
    "frá",
    "til",
    "eftir",
    "yfir",
    "undir",
    "milli",
    "vegna",
    "áfram",
    "líka",
    "þegar",
    "hver",
    "hvað",
    "því",
    "sér",
    "verið",
    "vera",
    "voru",
    "hefur",
    "hafa",
    "hafði",
    "myndi",
    "getur",
    "kemur",
    "segir",
    "sagði",
    "hér",
    "þar",
    "sem",
    "við",
    "þeir",
    "þær",
    "þau",
    "okkar",
    "ykkar",
  ],
  nordic: [
    "og",
    "ikke",
    "det",
    "som",
    "til",
    "med",
    "på",
    "er",
    "har",
    "kan",
    "skal",
    "bliver",
    "blev",
    "också",
    "eller",
    "når",
    "hvor",
    "hvordan",
    "hvorfor",
    "denne",
    "dette",
    "disse",
    "sine",
    "deres",
    "mye",
    "mange",
    "bare",
    "alltid",
    "aldri",
    "igjen",
    "allerede",
    "fortsatt",
    "både",
    "enten",
    "hvis",
    "fordi",
    "etter",
    "mellom",
    "gjennom",
    "uten",
    "blant",
    "sedan",
    "eftersom",
    "mellan",
    "utan",
    "enligt",
    "att",
    "för",
    "ett",
    "en",
    "är",
    "den",
    "där",
    "hur",
    "vad",
    "hade",
    "här",
    "från",
    "vid",
    "mot",
    "över",
    "genom",
    "efter",
    "före",
    "samt",
  ],
  fi: [
    "ja",
    "ei",
    "että",
    "oli",
    "ovat",
    "joka",
    "jotka",
    "kun",
    "missä",
    "miksi",
    "koska",
    "mutta",
    "tai",
    "myös",
    "vielä",
    "vain",
    "hyvin",
    "paljon",
    "kaikki",
    "tämä",
    "nämä",
    "hän",
    "sen",
    "siitä",
    "siihen",
    "kanssa",
    "ilman",
    "välillä",
    "jälkeen",
    "ennen",
    "mukaan",
    "sekä",
  ],
  et: [
    "ja",
    "ei",
    "et",
    "seda",
    "kui",
    "mis",
    "kes",
    "aga",
    "või",
    "veel",
    "ainult",
    "väga",
    "palju",
    "kõik",
    "siis",
    "nüüd",
    "siin",
    "seal",
    "ning",
    "pärast",
    "enne",
    "vahel",
    "ilma",
    "jaoks",
    "juures",
    "kohta",
  ],
  lv: [
    "un",
    "ir",
    "nav",
    "bet",
    "vai",
    "kad",
    "kur",
    "kāpēc",
    "jo",
    "kas",
    "kurš",
    "bija",
    "būs",
    "var",
    "vajag",
    "vēl",
    "tikai",
    "ļoti",
    "daudz",
    "visi",
    "šis",
    "šī",
    "viņš",
    "viņa",
    "mēs",
    "jūs",
    "viņi",
    "starp",
    "pēc",
    "pirms",
    "laikā",
    "pret",
  ],
  lt: [
    "ir",
    "yra",
    "kad",
    "kur",
    "kodėl",
    "nes",
    "bet",
    "arba",
    "kas",
    "kuris",
    "kuri",
    "kurie",
    "buvo",
    "gali",
    "turi",
    "dar",
    "tik",
    "labai",
    "daug",
    "visi",
    "šis",
    "ši",
    "jis",
    "ji",
    "mes",
    "jūs",
    "jie",
    "tarp",
    "prieš",
    "apie",
    "nuo",
    "iki",
  ],
  pl: [
    "nie",
    "jest",
    "są",
    "był",
    "była",
    "było",
    "byli",
    "które",
    "który",
    "która",
    "oraz",
    "ale",
    "lub",
    "czy",
    "jak",
    "tak",
    "tego",
    "tej",
    "tym",
    "przez",
    "dla",
    "przy",
    "pod",
    "nad",
    "bez",
    "już",
    "jeszcze",
    "tylko",
    "także",
    "bardzo",
    "można",
    "trzeba",
    "będzie",
    "może",
    "musi",
    "gdy",
    "kiedy",
    "gdzie",
    "dlaczego",
    "ponieważ",
    "jeśli",
    "aby",
    "żeby",
  ],
  cs: [
    "ve",
    "na",
    "se",
    "je",
    "že",
    "jako",
    "ale",
    "nebo",
    "když",
    "kde",
    "proč",
    "protože",
    "který",
    "která",
    "které",
    "jeho",
    "její",
    "jejich",
    "byl",
    "byla",
    "bylo",
    "jsou",
    "bude",
    "může",
    "musí",
    "také",
    "ještě",
    "jen",
    "pouze",
    "velmi",
    "mezi",
    "přes",
    "bez",
    "pod",
    "nad",
    "před",
    "při",
    "aby",
    "jestli",
  ],
  hu: [
    "az",
    "és",
    "nem",
    "hogy",
    "van",
    "volt",
    "lesz",
    "már",
    "még",
    "csak",
    "mint",
    "vagy",
    "ha",
    "mikor",
    "hol",
    "miért",
    "mert",
    "aki",
    "ami",
    "amely",
    "ezt",
    "azt",
    "ezek",
    "azok",
    "egy",
    "sok",
    "több",
    "minden",
    "nagyon",
    "itt",
    "ott",
    "úgy",
    "így",
    "után",
    "előtt",
    "alatt",
    "felett",
    "között",
    "miatt",
    "nélkül",
    "felé",
    "óta",
    "pedig",
    "tehát",
    "azonban",
    "viszont",
  ],
  ro: [
    "și",
    "în",
    "la",
    "cu",
    "pe",
    "din",
    "este",
    "sunt",
    "fost",
    "mai",
    "dar",
    "sau",
    "dacă",
    "când",
    "unde",
    "pentru",
    "fără",
    "între",
    "peste",
    "după",
    "înainte",
    "deja",
    "încă",
    "doar",
    "foarte",
    "multe",
    "toate",
    "acest",
    "această",
    "aceste",
    "lui",
    "lor",
    "său",
  ],
  hr: [
    "je",
    "na",
    "se",
    "da",
    "za",
    "od",
    "su",
    "kao",
    "ali",
    "ili",
    "kada",
    "gdje",
    "zašto",
    "jer",
    "koji",
    "koja",
    "koje",
    "bio",
    "bila",
    "bilo",
    "biti",
    "će",
    "može",
    "mora",
    "također",
    "još",
    "samo",
    "vrlo",
    "između",
    "preko",
    "bez",
    "pod",
    "nad",
    "prije",
    "poslije",
    "nakon",
    "tijekom",
    "prema",
    "zbog",
  ],
  af: [
    "en",
    "nie",
    "het",
    "sal",
    "kan",
    "moet",
    "maar",
    "toe",
    "waar",
    "hoekom",
    "wat",
    "wie",
    "hierdie",
    "daardie",
    "ons",
    "julle",
    "hulle",
    "hom",
    "haar",
    "baie",
    "meer",
    "nog",
    "ook",
    "sonder",
    "tussen",
    "voor",
    "onder",
    "oor",
  ],
  tl: [
    "ng",
    "mga",
    "ang",
    "sa",
    "na",
    "ay",
    "si",
    "ni",
    "kay",
    "pero",
    "kung",
    "dahil",
    "kapag",
    "habang",
    "mula",
    "hanggang",
    "tungkol",
    "lamang",
    "hindi",
    "wala",
    "mayroon",
    "ito",
    "iyon",
    "siya",
    "sila",
    "kami",
    "tayo",
    "kanila",
    "aming",
    "kanilang",
  ],
};

/**
 * A verdict needs three cue words and this share of the text, or nothing.
 *
 * One hit is never enough -- `Die Hard`, `Rio de Janeiro`, `Van Morrison` all
 * contain a strong cue -- and every English control in the test file scores
 * zero or one. Against that, Portuguese or Spanish prose scores three or more
 * cues per ten words, so 0.06 separates the two populations with room between
 * them; the low number is only safe because the lists hold no English words.
 */
const MIN_FUNCTION_WORD_HITS = 3;
const FUNCTION_WORD_RATIO_LIMIT = 0.06;

/**
 * The backstop for a Latin-script language no list names.
 *
 * Rejecting on foreign cues only covers the languages somebody listed, and on
 * 2026-10-30 that is how Icelandic (`og`, `að`, `er`), Hungarian (`az`, `és`,
 * `nem`) and Danish (`ikke`, `det`, `til`) feeds passed as English and inflated
 * the daily count -- docs/decisions/daily-source-floor.md. The lists above now
 * name those languages. What they cannot name is the next one, so a text that
 * accents its letters far more densely than English does is refused as
 * unreadable rather than guessed at.
 *
 * The threshold is measured, not chosen: across the 200 feeds inserted on
 * 2026-10-30, English feeds carried a maximum accented-letter share of 0.013
 * (RÚV's English service, full of Icelandic place names) and a median of 0.000,
 * while Hungarian and Icelandic copy sits at 0.08 and above. 0.06 keeps a 4.6x
 * margin over the worst English feed measured.
 *
 * Demanding *positive* English evidence was tried first and abandoned: English
 * headlines are terse and title-case, so `US policy tests PV adaptability` and
 * `New Apple TV 4K and iPad Mini: RAM Amounts Revealed` carry no function word
 * at all, and that rule rejected 7 real English feeds out of 200 -- Kyiv
 * Independent, BNN Bloomberg, MacRumors and the Daily Beast among them.
 */
const LATIN_ACCENT_RATIO_LIMIT = 0.06;

/**
 * How much text the accent share needs before it means anything.
 *
 * A short string has no letter profile: `São Paulo` is 3 accented letters in 7,
 * and `Zürich` is 1 in 5, so on a lone headline this test would reject English
 * it should accept. A feed is judged on its last ten titles, which run to
 * hundreds of letters, and that is the only place this rule is asked.
 */
const MIN_ACCENT_LETTERS = 60;

/**
 * Finnish and Estonian keep their grammar in case suffixes, not in free-standing
 * words: `lokakuussa`, `ennätystasolle`, `Joensuusta` are one word each where
 * English would write three. A feed of such titles carries almost none of the
 * function words the lists above look for, so Yle's Finnish service read as
 * English on 2026-10-30 (measured: 9 accented letters in 90, and its only cue
 * word is `on`, which is also English).
 *
 * The suffixes below are the endings that appear on ordinary Finnish nouns and
 * never on English ones -- `-lle` is left out because Nashville and
 * Jacksonville end in it. Four hits at this share is far beyond anything English
 * produces: the only English words in reach are loans like `villa` and
 * `guerrilla`.
 */
const FINNIC_SUFFIXES = ["ssa", "ssä", "sta", "stä", "lla", "llä", "lta", "ltä", "ksi", "nen"];
const MIN_FINNIC_SUFFIX_HITS = 4;
const FINNIC_SUFFIX_RATIO_LIMIT = 0.08;

/** Below this many letters there is nothing to judge, so nothing is English. */
const MIN_LETTERS = 4;

/** Latin letters, as Unicode defines the script (so `é`, `ß`, `ı` count). */
const LATIN_LETTER = /^\p{Script=Latin}$/u;

/** The unaccented Latin alphabet: a Latin letter outside this range is accented. */
const ASCII_LETTER = /^[A-Za-z]$/;

/**
 * The verdict for one piece of text.
 *
 * `title` is the required field; `excerpt` is optional context for a title too
 * short to judge on its own. Callers that have several titles -- a feed's last
 * ten -- should use `detectTitlesLanguage` instead, because the function-word
 * signal is a ratio and one title carries too few words for it.
 */
export function detectLanguage(input: {
  title: string | null | undefined;
  excerpt?: string | null | undefined;
}): LanguageVerdict {
  const text = [input.title ?? "", input.excerpt ?? ""].join(" ").normalize("NFC");
  const letters = text.match(/\p{L}/gu) ?? [];

  if (letters.length < MIN_LETTERS) {
    return verdict(false, "too-little-text", "unknown", 0, 0);
  }

  let nonLatinLetters = 0;
  let latinLetters = 0;
  let accentedLatinLetters = 0;
  const scriptCounts = new Map<DetectedScript, number>();
  for (const letter of letters) {
    if (LATIN_LETTER.test(letter)) {
      latinLetters += 1;
      if (!ASCII_LETTER.test(letter)) accentedLatinLetters += 1;
      continue;
    }
    nonLatinLetters += 1;
    for (const { script, pattern } of SCRIPT_RANGES) {
      if (!pattern.test(letter)) continue;
      scriptCounts.set(script, (scriptCounts.get(script) ?? 0) + 1);
      break;
    }
  }

  const nonLatinRatio = nonLatinLetters / letters.length;
  const dominantScript = [...scriptCounts.entries()].sort((a, b) => b[1] - a[1])[0]?.[0];
  if (nonLatinLetters >= MIN_NON_LATIN_LETTERS && nonLatinRatio >= NON_LATIN_RATIO_LIMIT) {
    return verdict(
      false,
      `non-latin:${dominantScript ?? "unknown"} ratio ${nonLatinRatio.toFixed(2)}`,
      dominantScript ?? "unknown",
      nonLatinRatio,
      0,
    );
  }

  const words = text.toLowerCase().match(/\p{L}+/gu) ?? [];
  let worst: { language: string; hits: number; ratio: number } | null = null;
  for (const [language, cues] of Object.entries(LATIN_FUNCTION_WORDS)) {
    const cueSet = new Set(cues);
    const hits = words.filter((word) => cueSet.has(word)).length;
    if (hits < MIN_FUNCTION_WORD_HITS) continue;
    const ratio = words.length === 0 ? 0 : hits / words.length;
    if (worst === null || hits > worst.hits || (hits === worst.hits && ratio > worst.ratio)) {
      worst = { language, hits, ratio };
    }
  }

  if (worst !== null && worst.ratio >= FUNCTION_WORD_RATIO_LIMIT) {
    return verdict(
      false,
      `latin-stopwords:${worst.language} ratio ${worst.ratio.toFixed(2)}`,
      dominantScript ?? "latin",
      nonLatinRatio,
      worst.ratio,
    );
  }

  // Finnish and Estonian carry their grammar in the suffix, so they arrive here
  // with no cue word to show for it (see FINNIC_SUFFIXES).
  const finnicHits = words.filter(
    (word) => word.length >= 5 && FINNIC_SUFFIXES.some((suffix) => word.endsWith(suffix)),
  ).length;
  const finnicRatio = words.length === 0 ? 0 : finnicHits / words.length;
  if (finnicHits >= MIN_FINNIC_SUFFIX_HITS && finnicRatio >= FINNIC_SUFFIX_RATIO_LIMIT) {
    return verdict(
      false,
      `finnic-suffixes hits ${finnicHits} ratio ${finnicRatio.toFixed(2)}`,
      "latin",
      nonLatinRatio,
      0,
    );
  }

  const latinAccentRatio = latinLetters === 0 ? 0 : accentedLatinLetters / latinLetters;
  if (latinLetters >= MIN_ACCENT_LETTERS && latinAccentRatio >= LATIN_ACCENT_RATIO_LIMIT) {
    return verdict(
      false,
      `latin-diacritics ratio ${latinAccentRatio.toFixed(2)}`,
      "latin",
      nonLatinRatio,
      worst?.ratio ?? 0,
      latinAccentRatio,
    );
  }

  return verdict(true, "english", "latin", nonLatinRatio, worst?.ratio ?? 0, latinAccentRatio);
}

/**
 * The verdict for a feed's recent titles, which is how the intake gate asks.
 *
 * A feed is one source, so its identity should be decided by more than the one
 * title a merge happened to surface. Joining the titles keeps the function-word
 * ratio meaningful and means a single English-looking headline in a Portuguese
 * feed cannot carry the whole feed through.
 */
export function detectTitlesLanguage(titles: readonly string[]): LanguageVerdict {
  return detectLanguage({ title: titles.join(" · ") });
}

function verdict(
  english: boolean,
  reason: string,
  script: DetectedScript,
  nonLatinRatio: number,
  latinStopwordRatio: number,
  latinAccentRatio = 0,
): LanguageVerdict {
  return {
    english,
    reason,
    script,
    nonLatinRatio: round(nonLatinRatio),
    latinStopwordRatio: round(latinStopwordRatio),
    latinAccentRatio: round(latinAccentRatio),
  };
}

function round(value: number): number {
  return Math.round(value * 1000) / 1000;
}
