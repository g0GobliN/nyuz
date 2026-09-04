# Future translation direction — DOCUMENT ONLY

DO NOT IMPLEMENT THIS NOW.

## Concept: Nyuz News + Language Learning

When translation comes back, it should NOT be simply "Translate this entire story."

The desired direction is:

**A user follows news normally but can use individual story sentences/key facts as lightweight language-learning material.**

### Possible future plan concept

**Personal:**
- choose up to 2 learning languages

**Pro:**
- choose up to 4 learning languages

These are languages the user chooses, not the story's original language.

### Possible interaction

Original:
> "Nvidia announced a new acquisition."

User selects:
> "Learn this in Japanese"

Nyuz could show:
- **Original**: "Nvidia announced a new acquisition."
- **Translation**: "Nvidiaは新しい買収を発表した。"
- **Useful phrase / vocabulary**: announced → 発表した
- Potentially: pronunciation, one grammar note, one short key phrase, one small contextual explanation

### Design principles

- user-initiated
- language-learning focused
- cache generated learning units
- never regenerate identical content unnecessarily
- cheaper than full-story automatic translation
- differentiate Nyuz from generic news translators
- plan-controlled language choices
- no background translation burn
- translation generated only when useful

### What this means for the current implementation

- DO NOT automatically translate every story
- Prefer translating only: one sentence, one key fact, one selected section, one learning unit
- The current `translateEvents()` infrastructure in `src/lib/pipeline/translate.ts` is preserved
- The `event_translations` table and migration 0029 are preserved
- The `story_translation_enabled` feature flag exists and can be turned on later
- When re-enabled, consider whether the full-story approach is what you want, or whether this lighter unit-based approach should replace it
