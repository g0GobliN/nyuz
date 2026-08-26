-- 0015 — the localisation announcement post.
--
-- Data only, so `npm run db:seed -- supabase/migrations/0015_localisation_post.sql`
-- can apply it through PostgREST. No DDL, which is what makes that possible.
--
-- **It inserts as a draft on purpose.** `blog_post_is_live` gates the public site on
-- status plus published_at, so this sits in the console until somebody reads it and
-- presses publish. A post announcing unbuilt work should be a deliberate act, not a
-- side effect of running a seed.
--
-- **The body says what is coming, not how it is built.** Roadmap reasoning, cost
-- architecture and the known weak points in the pipeline live in
-- docs/localisation-plan.md and stay there. A customer post that explains the design
-- hands it to anyone who wants it and advertises where the system is thin.
--
-- `reading_minutes` is denormalised by the console on save. A raw INSERT has to set
-- it, so it is computed here at the same ~200 words per minute the console uses.
--
-- `tags` is written as a Postgres array literal in a string rather than `array[...]`:
-- the seed reader accepts scalars only, and PostgREST takes the `{a,b}` form for a
-- text[] column. Applied with the CLI instead, it is the same value either way.
--
-- Re-running is safe: `on conflict (slug) do nothing` maps onto the seed script's
-- ignore-duplicates preference. Editing the post afterwards is done in the console,
-- not by editing this file — the row is the source of truth once it exists.

insert into public.blog_posts
  (slug, title, excerpt, body_md, status, tags, seo_title, seo_description,
   author_name, featured, reading_minutes)
values
  ('nyuz-in-six-languages',
   'nyuz is coming to six languages',
   'Soon, your nyuz briefing won’t have to be in English. We’re bringing nyuz to Hindi, Nepali, Japanese, Korean and Simplified Chinese — with the English version of every story always one tap away.',
   'Soon, your nyuz briefing won’t have to be in English. We’re bringing nyuz to **Hindi, Nepali, Japanese, Korean and Simplified Chinese**, alongside English.

That means your briefing, emails, Telegram messages and notifications can all arrive in the language you choose. And whenever you want to check something, the English version of every story will always be one tap away.

## News should be easy to read

A morning briefing is supposed to save you time. You open it, see what happened in the things you care about, and move on with your day.

But reading news in a second language changes that. You might understand English perfectly well. You might use it every day at work. But understanding something and reading it effortlessly are not quite the same thing.

Take a sentence like:

> The central bank held rates but said it would not rule out another increase if inflation does not continue to ease.

There’s a lot packed into that sentence. A condition, a possibility, a negative. In your first language, you probably understand it immediately. In a second language, you might read it again.

Now do that across fifteen stories before breakfast. That little bit of effort adds up. We don’t think reading nyuz should feel like work.

## Read it in the language that feels natural

Some people need nyuz in their own language because they don’t read English. But this feature isn’t only for them. It’s also for people who *can* read English — and simply don’t want to start every morning doing it.

Sometimes you just want the news in the language you think in. So we’re making that possible.

Choose your language once, and nyuz will use it across your briefing, story pages, emails, Telegram messages and notifications. Your topics, exclusions, delivery time and schedule won’t change.

## The English original is always there

Translation is useful, but news is one place where you should always be able to check the original.

Maybe a number looks strange. Maybe a quote sounds stronger than you expected. Maybe you simply want to see exactly how something was written.

Every translated story will have the English version **one tap away**. No searching for the original. No guessing whether something was lost in translation.

We think that should be part of translation from day one, not something we add later.

## Your app language and news language are separate

We’re also keeping two things independent: **the language you use nyuz in**, and **the language you read stories in.**

So you could use the nyuz interface in Nepali while keeping your stories in English. Or use the interface in English and read your stories in Japanese. Whatever feels right to you.

## One thing this does *not* mean

This first release is about bringing the news nyuz already covers into more languages. It does **not** mean we’re suddenly covering every country’s local press.

Nepali, for example, means you can read your nyuz stories in Nepali. It doesn’t yet mean nyuz is following Nepal''s local newspapers and reporting ecosystem. That is something much bigger, and something we want to approach separately.

## We’re starting with six

The rollout will begin with **English, Hindi and Nepali**. Then **Japanese, Korean and Simplified Chinese**.

We could add a long list of languages quickly. We’d rather add them slowly enough that they’re actually good.

Before a language goes live, people who speak it will read real nyuz briefings and tell us when something sounds unnatural, confusing or simply wrong. Because a bad translation that sounds completely confident is worse than no translation at all.

Six languages are where we’re starting. Not where we plan to stop.

## You don''t need to do anything

When the new language setting arrives, English will remain the default. If you want to change it, choose your language once and nyuz will take care of the rest.

We’ll announce rollout dates when each language is ready. And if the language you want isn’t one of these six, **tell us**. What comes next will depend a lot on what people actually ask for.',
   'draft',
   '{roadmap,languages}',
   'nyuz is coming to six languages',
   'nyuz is coming to Hindi, Nepali, Japanese, Korean and Simplified Chinese. Read your briefing, emails and notifications in the language you choose, with the English original one tap away on every story.',
   'nyuz',
   false,
   3)
on conflict (slug) do nothing;
