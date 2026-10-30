import { describe, expect, it } from "vitest";
import { detectLanguage, detectTitlesLanguage } from "./language-detection";

/* ---------------------------------------------------------------------- */
/* The strings the ruling was made about                                   */
/* ---------------------------------------------------------------------- */

/**
 * Every one of these reached a reader on 2026-10-30 (card t_bcf87ee3). They are
 * the acceptance set for the detector, not illustrations: if one of them passes,
 * the gate is open and the card is not done.
 */
const DELIVERED_NON_ENGLISH = [
  "Última hora del accidente de trenes en Toledo, en directo | Al menos 68 muertos en el choque de trenes de alta velocidad",
  "فرعباسی، فرشته ای که کابوس را کشت؛ روزگار خوش حبیب آقا در استقلال",
  "«Зенит» подписал соглашение о сотрудничестве с БАТЭ",
  "سکی کناری ہائیڈرو پاور منصوبہ: اراضی معاوضے میں اضافے کا ریفرنس منظور، مالکان میں خوشی کی لہر",
];

describe("the delivered non-English headlines", () => {
  for (const title of DELIVERED_NON_ENGLISH) {
    it(`rejects ${title.slice(0, 24)}…`, () => {
      const verdict = detectLanguage({ title });
      expect(verdict.english).toBe(false);
      expect(verdict.reason).not.toBe("english");
    });
  }

  it("names the script that made the verdict", () => {
    expect(detectLanguage({ title: DELIVERED_NON_ENGLISH[2] ?? "" }).script).toBe("cyrillic");
    expect(detectLanguage({ title: DELIVERED_NON_ENGLISH[1] ?? "" }).script).toBe("arabic");
    expect(detectLanguage({ title: DELIVERED_NON_ENGLISH[3] ?? "" }).script).toBe("arabic");
  });
});

/* ---------------------------------------------------------------------- */
/* Latin-script languages, which script alone cannot catch                 */
/* ---------------------------------------------------------------------- */

const LATIN_LANGUAGE_CASES: ReadonlyArray<{ language: string; title: string }> = [
  {
    language: "es",
    title: "El gobierno anuncia un plan para reducir el desempleo entre los jóvenes",
  },
  {
    language: "pt",
    title: "Governo anuncia plano para reduzir o desemprego entre os jovens, diz ministro",
  },
  {
    language: "fr",
    title: "Le gouvernement annonce un plan pour réduire le chômage des jeunes",
  },
  {
    language: "de",
    title: "Die Regierung hat den Haushalt für das kommende Jahr beschlossen",
  },
  {
    language: "it",
    title: "Il governo ha approvato il piano per la riduzione della disoccupazione",
  },
  {
    language: "id",
    title: "Pemerintah akan mengumumkan kebijakan baru untuk harga bahan bakar minggu ini",
  },
  {
    language: "nl",
    title: "Het kabinet heeft een plan voor de zorg en de woningmarkt gepresenteerd",
  },
  {
    language: "tr",
    title: "Hükümet yeni ekonomik programı için bir açıklama yaptı ve piyasalar tepki verdi",
  },
];

describe("Latin-script languages", () => {
  for (const { language, title } of LATIN_LANGUAGE_CASES) {
    it(`rejects ${language}`, () => {
      const verdict = detectLanguage({ title });
      expect(verdict.english).toBe(false);
      expect(verdict.reason).toContain(`latin-stopwords:${language}`);
      expect(verdict.latinStopwordRatio).toBeGreaterThan(0.15);
    });
  }
});

/* ---------------------------------------------------------------------- */
/* English, including the controls that must NOT be flagged                */
/* ---------------------------------------------------------------------- */

const ENGLISH_CONTROLS = [
  // Card t_bcf87ee3 names these explicitly: an English edition of a foreign
  // outlet, accented proper nouns, transliterated names.
  "Mainichi English",
  "Taipei Times",
  "São Paulo",
  "Zürich",
  "José Mourinho",
  "Buenos Aires Times",
  // Ordinary English prose, with the kind of words that look like a cue.
  "Treasury yields climb as investors weigh the Fed's next move",
  "Rio de Janeiro opens a new metro line ahead of the election",
  "De La Cruz wins gold in the 400 metres",
  "Die Hard is still the best Christmas film, readers say",
  "Van Morrison announces a new album and a European tour",
  "Why the Port of Singapore is betting on green ammonia",
  "Nigeria's central bank holds rates for a third meeting",
  "Wall Street closes higher after a volatile session",
];

describe("English", () => {
  for (const title of ENGLISH_CONTROLS) {
    it(`accepts ${title.slice(0, 32)}…`, () => {
      const verdict = detectLanguage({ title });
      expect(verdict.english).toBe(true);
      expect(verdict.reason).toBe("english");
    });
  }

  it("rejects a title whose bulk is a refused script, even with English around it", () => {
    const verdict = detectLanguage({
      title: "Zelensky meets the Greek prime minister in Athens",
      excerpt: "Ο Κυριάκος Μητσοτάκης συνάντησε τον Ζελένσκι",
    });
    expect(verdict.english).toBe(false);
    expect(verdict.reason).toContain("non-latin");
    expect(verdict.script).toBe("greek");
  });
});

/* ---------------------------------------------------------------------- */
/* Fail closed                                                             */
/* ---------------------------------------------------------------------- */

describe("fail closed", () => {
  it("rejects an empty title", () => {
    expect(detectLanguage({ title: "" })).toMatchObject({
      english: false,
      reason: "too-little-text",
      script: "unknown",
    });
  });

  it("rejects null and undefined", () => {
    expect(detectLanguage({ title: null }).english).toBe(false);
    expect(detectLanguage({ title: undefined }).english).toBe(false);
  });

  it("rejects a title with no letters at all", () => {
    expect(detectLanguage({ title: "1234 — 5678" }).english).toBe(false);
  });

  it("rejects text that is mostly a refused script even with English around it", () => {
    const verdict = detectLanguage({ title: "Breaking: Зенит подписал соглашение с БАТЭ" });
    expect(verdict.english).toBe(false);
    expect(verdict.script).toBe("cyrillic");
    expect(verdict.nonLatinRatio).toBeGreaterThan(0.2);
  });

  it("does not reject an English title over one stray non-Latin character", () => {
    expect(detectLanguage({ title: "Sony's new Α-series camera ships in March" }).english).toBe(
      true,
    );
  });
});

/* ---------------------------------------------------------------------- */
/* The feed-level question                                                 */
/* ---------------------------------------------------------------------- */

describe("detectTitlesLanguage", () => {
  it("rejects a Portuguese feed on the strength of its last titles, not one of them", () => {
    const verdict = detectTitlesLanguage([
      "Governo anuncia plano para reduzir o desemprego",
      "Ministro diz que a inflação está sob controle",
      "Eleições municipais terão segundo turno em 12 capitais",
      "Novo pacote de ajuda para as famílias de baixa renda",
      "Chuvas fortes deixam milhares sem energia no sul",
    ]);
    expect(verdict.english).toBe(false);
    expect(verdict.reason).toContain("latin-stopwords:pt");
  });

  it("accepts an English feed whose titles mention foreign places", () => {
    const verdict = detectTitlesLanguage([
      "Government announces plan to cut youth unemployment",
      "Inflation holds steady for a third month, minister says",
      "Municipal elections head to a runoff in 12 state capitals",
      "Heavy rain leaves thousands without power in the south",
      "New aid package targets low-income households",
    ]);
    expect(verdict.english).toBe(true);
  });

  it("rejects a feed whose titles are mostly Devanagari", () => {
    const verdict = detectTitlesLanguage([
      "सरकार ने नई योजना की घोषणा की",
      "बाजार में तेजी, निवेशकों को फायदा",
      "मौसम विभाग ने बारिश का अलर्ट जारी किया",
    ]);
    expect(verdict.english).toBe(false);
    expect(verdict.script).toBe("devanagari");
  });

  it("rejects an empty title list", () => {
    expect(detectTitlesLanguage([]).english).toBe(false);
  });
});

/* ---------------------------------------------------------------------- */
/* The feeds the gate let through on 2026-10-30                            */
/* ---------------------------------------------------------------------- */

/**
 * Every title below was fetched from the feed named above it on 2026-10-30, and
 * every one of those feeds was inserted as English and counted toward the day's
 * floor. None of them is English. The gate only knew Spanish, Portuguese,
 * French, German, Italian, Indonesian, Dutch and Turkish function words, so
 * Icelandic, Hungarian, Danish, Swedish, Dutch-accented and Finnish copy all
 * passed -- the defect recorded in docs/decisions/daily-source-floor.md.
 */
describe("the non-English feeds inserted on 2026-10-30", () => {
  const FEEDS: Array<[string, string[]]> = [
    [
      "fjardarfrettir.is",
      [
        "Hafnarfjarðarbær leggur niður 23 störf",
        "Skógræktarfélag Hafnarfjarðar 80 ára í dag",
        "Bætti 23 ára Íslandsmet í sundi",
        "Stærsta hótel landsins rís í Hafnarfirði",
        "Ákvörðunin tekin í hliðarherbergi af fulltrúm þriggja flokka",
      ],
    ],
    [
      "hafnarfrettir.is",
      [
        "Ábyrgð, samstaða og sókn",
        "Öflug þjónusta og aukin lífsgæði í Ölfusi",
        "Frístundamiðstöð sem styður börn og fjölskyldur",
        "Við óskum eftir ykkar stuðning til að vinna þetta saman",
        "Kosningar snúast ekki bara um hávaða, heldur framtíð okkar",
      ],
    ],
    [
      "ujember.hu",
      [
        "Az Új Ember szeptember 13-ai száma",
        "Az Új Ember szeptember 13-ai számának kulturális melléklete",
        "Az Új Ember szeptember 6-ai száma",
        "Az Új Ember augusztus 30-ai számának kulturális melléklete",
        "Az Új Ember augusztus 23-ai száma",
      ],
    ],
    [
      "dr.dk",
      [
        "EU indfører gebyr på pakker",
        "Verdens største kryptobørs ramt af muligt hackerangreb",
        "Skanderborg AGF tæt på sensation mod Barcelona, men er ude af Champions League",
        "Motorvej genåbner efter ulykke med brændende grisetransport",
        "Danmark overtager formandskab i Nordisk Råd",
      ],
    ],
    [
      "svt.se",
      [
        "Vännerna startade en runclub i Eskilstuna – för att få en ny gemenskap",
        "Politiskt gräl i Sigtuna efter brottsmisstankarna på internatet",
        "William vill rädda ett åldrande lantbruk – nästan hälften har nått pensionsåldern",
        "60-tal personer fortfarande saknade efter tågolyckan",
        "Kaosavslutning när Häcken tog första poängen i Champions League",
      ],
    ],
    [
      "nu.nl",
      [
        "Consumentenbond: Fabrikanten geven nauwelijks duidelijkheid over pfas in producten",
        "Video | Verkeer rijdt door dichte mist bij Heerenveen",
        "Twaalf EU-landen brengen 42,6 miljoen vaten brandstof uit reserves op de markt",
        "Aantal zzp'ers daalt zeven kwartalen op rij vanwege strengere handhaving",
        "Stemmen in Israël zijn geteld: Netanyahu wint, maar heeft geen meerderheid",
      ],
    ],
    [
      "yle.fi",
      [
        "Dieselin hinta nousi lokakuussa ennätystasolle",
        "Äiti kertoo lapsensa vähättelystä Tampereen transklinikalla",
        "Vantaalla Katriinantie on suljettu liikenteeltä onnettomuuden vuoksi",
        "Pörssisähkön hinta nousee tänään tasaisesti",
        "Suomessa on tehty satoja liikenneympyröitä puutteellisilla ohjeilla",
      ],
    ],
  ];

  for (const [feed, titles] of FEEDS) {
    it(`rejects ${feed}`, () => {
      const verdict = detectTitlesLanguage(titles);
      expect(verdict.english).toBe(false);
      expect(verdict.reason).not.toBe("english");
    });
  }

  const titlesFor = (feed: string) => FEEDS.find(([name]) => name === feed)?.[1] ?? [];

  it("names the suffix that gives Finnish away, because its cue word is also English", () => {
    const verdict = detectTitlesLanguage(titlesFor("yle.fi"));
    expect(verdict.reason).toMatch(/^finnic-suffixes/);
  });

  it("names the Icelandic function words", () => {
    expect(detectTitlesLanguage(titlesFor("hafnarfrettir.is")).reason).toMatch(
      /^latin-stopwords:is/,
    );
  });

  it("names the Hungarian function words", () => {
    expect(detectTitlesLanguage(titlesFor("ujember.hu")).reason).toMatch(/^latin-stopwords:hu/);
  });
});

/**
 * The false-rejects the first attempt at this rule produced. Demanding positive
 * English evidence (three unmistakable English function words) rejected 7 real
 * English feeds out of 200 -- these five are that set, kept so the rule cannot
 * come back without a test failing.
 */
describe("English feeds that a stricter rule would have thrown away", () => {
  const ENGLISH: Array<[string, string[]]> = [
    [
      "kyivindependent.com",
      [
        "Russian oil refinery reportedly attacked amid renewed Ukrainian strikes on energy infrastructure",
        "Drone attack reportedly kills worker at Russian-occupied Zaporizhzhia plant",
        "Ukraine's air force reports downing dozens of drones overnight",
        "Officials: Russian missile strike damages residential block in Kharkiv",
        "EU ministers weigh new sanctions package against Moscow",
      ],
    ],
    [
      "pv-magazine.com",
      [
        "US policy tests PV adaptability",
        "Government backs Indian floating solar",
        "Gallium-doped zinc oxide enables 24.92%-efficient HJT solar cell",
        "Spanish developer signs 300 MW power purchase agreement",
        "Module prices hold steady for a third week",
      ],
    ],
    [
      "bnnbloomberg.ca",
      [
        "New national security strategy calls for worst-case scenario preparations including ‘war’",
        "PM Carney, von der Leyen float ‘associate member’ status at Canada-EU summit",
        "Ballard Power shares jump on hydrogen truck order",
        "Bank of Canada expected to hold rates steady",
        "Trade minister heads to Washington for tariff talks",
      ],
    ],
    [
      "macrumors.com",
      [
        "New Apple TV 4K and iPad Mini: RAM Amounts Revealed",
        "Apple Executive Comments on New iPad Mini Lacking 120Hz Display",
        "Apple Avoids Showing Pinched Fingers on Vision Pro Marketing Images",
        "iOS 27 Beta Adds New Lock Screen Widgets",
        "AirPods Pro 3 Firmware Update Now Available",
      ],
    ],
    [
      "thedailybeast.com",
      [
        "Anti-MAGA Heckler Takes Victory Lap as Trump Cancels Rallies",
        "Kaitlan Collins Sounds Alarm on ‘Unusual’ Move by Trump, 80",
        "MAGA Candidate’s Sick Attack Ad Takes Aim at Rival’s Family",
        "Senate Moves Toward Stopgap Deal to Avert Shutdown",
        "Judge Blocks Latest Bid to Expand Detention Capacity",
      ],
    ],
  ];

  for (const [feed, titles] of ENGLISH) {
    it(`accepts ${feed}`, () => {
      const verdict = detectTitlesLanguage(titles);
      expect(verdict.english).toBe(true);
      expect(verdict.reason).toBe("english");
    });
  }

  it("accepts US city names that end in -lle", () => {
    const verdict = detectTitlesLanguage([
      "Nashville council approves transit plan after long debate",
      "Jacksonville sheriff announces new unit for cold cases",
      "Man charged in Nashville shooting that wounded two",
      "Jacksonville hospital opens expanded emergency wing",
      "Nashville schools add 40 buses to fix late routes",
    ]);
    expect(verdict.english).toBe(true);
  });

  it("accepts English copy about accented places", () => {
    const verdict = detectTitlesLanguage([
      "São Paulo mayor announces flood defence plan",
      "Zürich voters reject motorway expansion in tight referendum",
      "José Mourinho returns to Portugal as national coach",
      "Bogotá extends metro line to the airport",
      "Malmö police investigate second overnight shooting",
    ]);
    expect(verdict.english).toBe(true);
  });
});

/* ---------------------------------------------------------------------- */
/* The verdict is rounded, so a log line is stable                         */
/* ---------------------------------------------------------------------- */

describe("verdict shape", () => {
  it("reports ratios rounded to three places", () => {
    const verdict = detectLanguage({ title: DELIVERED_NON_ENGLISH[2] ?? "" });
    expect(verdict.nonLatinRatio.toString()).toMatch(/^\d+(\.\d{1,3})?$/);
  });
});
