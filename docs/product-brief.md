# Product brief

The original brief nyuz was built from, preserved as written.

> **This is a historical document.** It is kept because it records the intent behind
> decisions that are otherwise hard to explain — particularly the insistence that the
> landing page demonstrate the product rather than describe it. Where it disagrees with
> the code, the code is right and this is a record of what was asked for.
>
> One deliberate departure: the brief specifies an amber accent. The product now uses a
> blue one at hue 240. See [development.md](development.md#conventions).

---

The brief below was written as a single product/design prompt. The key idea is that the site should visually demonstrate the product: tell us what you care about → we watch the internet → AI filters it → you receive your personal briefing.

You can paste this as one big prompt:

Build: Personalized News Autopilot SaaS

Build a polished, production-quality SaaS website and dashboard for a product whose core promise is:

You don’t search for the news. We watch it for you.

The product monitors technology/news sources, understands and groups stories using AI, filters them according to each user’s interests, and delivers a personalized briefing to the user on their preferred schedule through email and eventually Telegram/WhatsApp.

This should NOT feel like a generic AI-news website.

It should feel like a premium Apple-style consumer SaaS product: visual, calm, minimal, cinematic, interactive, extremely clear, with almost no unnecessary text.

The user should be able to understand what the product does within 5–10 seconds of seeing the landing page, even if they don’t read the copy.

1. Product Concept

The problem:

People want to stay informed, but they don’t want to:

open 20 websites every morning

scroll Twitter/X for an hour

maintain dozens of RSS feeds

subscribe to 30 newsletters

constantly search Google

figure out which stories actually matter

The product solves this by continuously monitoring the internet and creating a personalized information stream.

Example user:

“I’m a developer. I care about AI, OpenAI, Anthropic, NVIDIA, Cursor, React, Next.js, TypeScript and startups. I don’t care about politics or celebrity news.”

The system watches relevant sources.

It discovers:

company announcements

product releases

major technical developments

funding

acquisitions

important research

major industry changes

important ecosystem updates

It then:

Collects stories

Removes duplicates

Groups multiple articles about the same event

Uses AI to understand the event

Scores importance

Matches it to user interests

Generates a concise explanation

Delivers it at the user’s chosen time

Example:

7:30 AM — Your Tech Brief

5 things worth knowing today.

OpenAI released X
What happened: …
Why it matters: …

Cursor launched Y
…

React announced Z
…

The website is the archive and control center.

The actual product is the personalized briefing/notification.

2. Brand / Design Direction

Use an Apple-inspired design philosophy, but DO NOT copy Apple’s website or branding.

Design principles:

extremely clean

premium

calm

lots of whitespace

strong typography

subtle gradients

cinematic product demonstrations

smooth scroll animations

elegant micro-interactions

minimal navigation

very high visual hierarchy

almost no walls of text

Think:

Apple product page + Linear + Arc + premium AI SaaS.

Avoid:

generic SaaS templates

excessive rounded cards everywhere

random gradients

purple AI clichés

stock photography

cartoon illustrations

huge paragraphs

“10x your productivity” nonsense

excessive badges

fake testimonials

fake customer logos

fake statistics

If imagery/video is useful, generate/create suitable visuals yourself rather than leaving empty placeholder boxes.

Where real video assets are not available, create a convincing interactive CSS/React animation that visually communicates the concept.

3. IMPORTANT: VISUALLY EXPLAIN THE PRODUCT

The landing page must explain the product visually.

Do NOT rely primarily on text.

The visitor should see something like:

THE INTERNET

      ↓

  thousands of stories

      ↓

   AI understands

      ↓

duplicates disappear

      ↓

important events emerge

      ↓

YOUR INTERESTS

      ↓

YOUR PERSONAL BRIEFING

      ↓

  7:30 AM

      ↓

📧 Email

💬 Telegram

📱 WhatsApp

Animate this entire process.

For example:

Thousands of small article cards can flow into the system.

They merge into one event:

“OpenAI launches new model”

Several duplicate stories disappear/merge.

Then that event moves toward:

Vishal’s interests

and becomes:

Your 7:30 AM Brief

This animation is one of the most important parts of the website.

4. Landing Page Structure

SECTION 1 — Hero

Full-screen hero.

Minimal navigation:

Logo | How it works | Pricing | Sign in | Get Started

Hero headline:

Stop searching.
Start knowing.

Subheadline:

Tell us what matters to you.
We watch the internet and deliver the things worth knowing.

Primary CTA:

Build my radar

Secondary CTA:

See how it works

Hero visual:

Create a highly polished animated visualization of the product.

Show:

Internet sources → AI → personalized briefing.

Do not just show a dashboard screenshot.

The visitor should immediately understand:

“This thing watches the internet for me.”

5. Interactive Hero Demo

Create an interactive mini-demo.

Title:

Show us what you care about.

Provide example interest chips:

AI
OpenAI
Anthropic
NVIDIA
Cursor
React
Next.js
Startups
Cybersecurity
Gaming

When users click topics, the visualization changes.

Example:

User selects:

AI + OpenAI + Anthropic + Cursor

Then the system animation shows relevant stories being selected.

Finally:

Your briefing is ready.

Display a beautiful notification/email preview:

Your 7:30 AM Brief

4 things worth knowing

OpenAI launches X

A concise 2–3 sentence explanation.

Why it matters

A short explanation tailored to the user.

Cursor introduces Y

…

At the bottom:

Delivered at 7:30 AM

This should feel like a real product, not a marketing mockup.

6. “The Internet Is Too Loud” Section

Visually demonstrate the problem.

Show a chaotic wall of:

news headlines

tweets

Reddit posts

blogs

product announcements

GitHub releases

newsletters

Animation:

Everything moves quickly.

Then fade/desaturate most of it.

Only a few important events remain.

Headline:

The internet is loud.
Your briefing shouldn’t be.

Short copy:

We filter the noise so you don’t have to.

Do not make this section text-heavy.

7. “How It Works”

Use a horizontal/scroll-based interactive experience.

Step 1 — Tell us what matters

Show user selecting interests.

Example:

I care about:

✓ AI

✓ Developer Tools

✓ OpenAI

✓ Anthropic

✓ Startups

Ignore:

× Crypto

× Celebrity news

× Politics

Step 2 — We watch

Show animated sources flowing into the system.

Examples:

Company blogs
News
RSS
GitHub
Product announcements
Research
Industry sources

Step 3 — AI understands

Visually demonstrate:

35 articles

      ↓

same event

      ↓

1 event

Example:

35 articles about an OpenAI announcement become:

OpenAI launches X

This is critical.

Explain visually that the product does not simply summarize every article.

It identifies the underlying event.

Step 4 — We rank what matters

Show:

Relevance       94%

Importance      91%

Novelty         87%

Then show the story being selected.

Step 5 — You receive it

Show:

7:30 AM

Email

Telegram

WhatsApp

And a beautiful personalized digest.

8. “Not Another News Feed”

Create a strong visual comparison.

Left:

Normal news

Search

↓

Scroll

↓

Click

↓

Read

↓

Repeat

↓

Waste time

Right:

This product

Tell us once

↓

We monitor

↓

We filter

↓

We summarize

↓

You receive

↓

Done

Use animation and visual contrast.

Headline:

You shouldn’t need a second job to stay informed.

9. Personalized Briefing Demo

Create a large interactive mock email.

User can switch between profiles:

Developer

Shows:

AI

React

TypeScript

GitHub

developer tools

Founder

Shows:

startups

funding

competitors

AI

SaaS

Investor

Shows:

companies

funding

acquisitions

markets

technology

AI Researcher

Shows:

papers

models

benchmarks

research labs

When profile changes, briefing content changes.

This visually demonstrates personalization.

10. The “Why This Is Different” Section

Use 3–4 large visual concepts.

Not another feed

We don’t ask you to keep scrolling.

Not another newsletter

Your briefing changes based on what you care about.

Not just an AI summarizer

We identify events, remove duplicates and decide what is worth your attention.

Not another app you have to remember

Once configured, it comes to you.

11. AI Architecture / Trust Section

We need to explain how AI is used without making the product sound expensive or magical.

Title:

AI does the boring work. You get the useful part.

Visually show:

Sources

  ↓

Collection

  ↓

Deduplication

  ↓

Event detection

  ↓

AI classification

  ↓

Importance scoring

  ↓

Interest matching

  ↓

Personalized briefing

Explain:

We don’t ask AI to read the entire internet for every user.

Instead:

News is collected centrally.

Duplicate stories are grouped.

Events are analyzed once.

Structured metadata is stored.

User interests are matched against that metadata.

Only the final relevant information is used to generate a personalized briefing.

This is important for scalability and cost.

12. Infrastructure Section

Create a beautiful visual technical architecture.

Do not make this feel like documentation.

It should feel like:

Simple on the outside. Sophisticated underneath.

Show:

             NEWS SOURCES

                  │

                  ▼

          ┌───────────────┐

          │   INGESTION   │

          └───────┬───────┘

                  ▼

          ┌───────────────┐

          │  DEDUPLICATE  │

          └───────┬───────┘

                  ▼

          ┌───────────────┐

          │ AI ANALYSIS   │

          └───────┬───────┘

                  ▼

          ┌───────────────┐

          │ EVENT DATABASE │

          └───────┬───────┘

                  ▼

          USER INTERESTS

                  │

                  ▼

          PERSONALIZATION

                  │

          ┌───────┼────────┐

          ▼       ▼        ▼

        EMAIL   TELEGRAM  WHATSAPP

Explain the core scaling philosophy:

Understand a story once. Personalize it many times.

This is the key infrastructure concept.

13. AI Cost / Scalability Explanation

Create a visual section explaining why the service can scale.

Do not expose internal secret pricing or claim exact AI costs unless they are configurable/current.

Explain conceptually:

Bad architecture

100,000 users

×

same news

×

AI processing

Expensive.

Our architecture

Internet

↓

Shared event intelligence

↓

100,000 users

↓

cheap database matching

↓

small personalized generation

Headline:

One event. Thousands of people. One analysis.

Explain:

AI processing is shared wherever possible.

The system should avoid processing the same event independently for every subscriber.

This helps maintain healthy unit economics as the user base grows.

14. Dashboard

Build a complete authenticated dashboard.

Sidebar:

Home

My Briefing

Topics

Sources

Alerts

Delivery

History

Settings

Billing

Top bar:

Search
Notifications
Profile

15. Dashboard Home

Show:

Good morning, Vishal.

Your radar found 6 things worth knowing.

Large briefing cards.

Example:

01 — OpenAI

OpenAI releases X

Importance: High

Short explanation.

Why it matters to you:

You’re following AI and developer tools.

Source count:

12 sources → 1 event

Actions:

Read
Save
Explain more
Not interested

02 — Cursor

…

Also show:

Your radar

AI ██████████
Developer Tools ████████
Startups █████
React ████

And:

Your next briefing

Tomorrow · 7:30 AM

16. Topics Dashboard

Create a beautiful topic management interface.

Allow:

Add topic

Search:

“What do you want to know about?”

Examples:

OpenAI
Anthropic
NVIDIA
React
Next.js
TypeScript
Startups
Cybersecurity

Each topic can have:

importance

frequency

keywords

excluded keywords

Allow natural language customization:

“Tell us anything else you want us to know.”

Example:

“Only tell me about React when something significant happens.”

17. Source Management

Show:

Sources we’re watching

Official company blogs
News sites
RSS
GitHub
Research
Product announcements

Allow users to:

prioritize sources

mute sources

add sources

remove sources

But don’t make this mandatory.

The product should work without users manually maintaining feeds.

18. Delivery Settings

Beautiful scheduling interface.

When should we talk to you?

Time:

07:30

Timezone:

Asia/Tokyo

Days:

Mon Tue Wed Thu Fri

Channels:

✓ Email
✓ Telegram
□ WhatsApp

Frequency:

Daily
Weekly
Breaking alerts

Breaking alerts:

Only important
Everything
Off

19. History

Create an elegant archive.

Calendar / timeline.

Example:

August 22

6 stories

August 21

8 stories

August 20

4 stories

Users can search:

“Show me everything about OpenAI”

20. Story Detail

When a user opens a story:

Show:

OpenAI launches X

What happened

Concise explanation.

Why it matters

Personalized explanation based on user’s interests.

What changed

Before → After

Sources

List sources.

Timeline

Show when the event developed.

Ask AI

Input:

“Explain this like I’m a beginner.”

or

“How does this affect developers?”

This can use a stronger AI model only when explicitly requested.

21. Pricing Page

Use the previously defined pricing structure.

Free

$0

3 topics

Daily briefing

Email

7-day history

CTA:

Start free

Personal

$7/month

Mark as:

Most popular

15 topics

Daily + weekly briefings

Custom delivery time

Telegram

Breaking alerts

Custom instructions

90-day history

AI explanations

CTA:

Start Personal

Annual:

$70/year

Pro

$15/month

Unlimited topics

Multiple schedules

Breaking alerts

WhatsApp

Advanced personalization

1-year history

Deeper AI explanations

Priority processing

Annual:

$150/year

Do not artificially limit the number of “news articles” users receive.

The product should be about relevance, not quantity.

22. Pricing Visual

Add a small interactive slider:

How much noise do you want?

Minimal ←────────────→ Deep

Explain that the system can adjust briefing density.

This is much more meaningful than “100 articles/month.”

23. Onboarding Flow

After clicking “Build my radar”:

Screen 1

What do you want to know about?

Search + topic chips.

Screen 2

What should we ignore?

Optional exclusions.

Screen 3

When should we talk to you?

Time + timezone + days.

Screen 4

Where should we send it?

Email
Telegram
WhatsApp

Screen 5

Show:

Your radar is ready.

Animated setup:

Monitoring 327 sources

      ↓

Understanding today's events

      ↓

Matching your interests

      ↓

Your first briefing is being prepared

Then dashboard.

24. Authentication

Implement:

Email/password or magic link

Google sign-in

GitHub sign-in if appropriate

Keep authentication simple.

25. Backend / Data Model

Prepare the application architecture so it can actually become a real SaaS.

Entities:

User

Subscription

Topic

UserTopic

Source

Article

Event

EventSource

EventTopic

UserEvent

Digest

DigestItem

Delivery

NotificationPreference

SavedStory

Feedback

Relationships:

User
→ Topics

User
→ Preferences

Article
→ Source

Article
→ Event

Event
→ Topics

Event
→ Sources

User
→ Relevant Events

Digest
→ Digest Items

Digest
→ Delivery

This architecture should make it possible to scale without creating a separate copy of every event for every user.

26. Feedback System

Every story should allow:

👍 Useful

👎 Not useful

Not interested

Mute topic

This data should improve personalization.

Example:

If a user repeatedly ignores crypto stories:

The system should gradually reduce crypto recommendations.

If they repeatedly open Anthropic stories:

Increase relevance.

Show this visually in the dashboard:

Your radar is learning

27. Important Product Philosophy

The site should repeatedly communicate:

Less information.

More relevance.

Zero searching.

The product is NOT:

“Here’s more content.”

It is:

“Here’s what you actually need to know.”

28. Landing Page Animation Requirements

Use smooth, premium animations.

Examples:

cards flowing into an AI processing layer

duplicate stories merging

irrelevant stories fading away

important events becoming brighter

personalized briefing assembling itself

delivery notification appearing

dashboard numbers updating

topic chips floating into a user profile

timeline animations

subtle parallax

scroll-triggered transitions

Keep animations fast and elegant.

Do NOT over-animate.

Support reduced-motion preferences.

29. Video / Visual Requirements

If possible, create short product videos or animated visual demonstrations.

Preferred visual sequence:

Video 1 — The problem

Person opens:

Google
Reddit
X
TechCrunch
Hacker News
GitHub

Too much information.

They close everything.

Video 2 — The solution

User chooses:

AI
OpenAI
Developer Tools
Startups

Then goes away.

Next morning:

7:30 AM

Their briefing arrives.

Video 3 — The engine

Thousands of articles enter.

Duplicates merge.

AI identifies events.

Only relevant events remain.

Personal briefing is generated.

If actual video generation isn’t available, implement these as high-quality React/CSS animations.

Do not use empty “video placeholder” boxes.

30. Mobile Design

Mobile is extremely important.

The landing page must look excellent on iPhone-sized screens.

Dashboard should become a mobile-first application.

Bottom navigation:

Home
Briefing
Topics
History
Settings

The briefing should feel like reading a premium mobile news product.

31. Dark Mode

Support both:

Light mode:
clean white / off-white / subtle gray

Dark mode:
deep black / charcoal / subtle contrast

Do not use neon cyberpunk colors.

32. Copywriting Style

Keep copy short.

Use statements like:

Stop searching. Start knowing.

The internet is loud. Your briefing shouldn’t be.

Tell us what matters. We’ll watch the rest.

Understand the event, not 30 copies of the same article.

AI does the boring work. You get the useful part.

One event. Thousands of people. One analysis.

Your morning briefing, already waiting.

Avoid:

“revolutionary”

“game changing”

“AI-powered next generation”

“10x”

“unlock your potential”

generic startup buzzwords

33. Trust / Sources

Create a source transparency section.

Every story should show:

Based on 12 sources

Clicking opens:

source names

original article

publication time

Never make the AI appear to be the original source of information.

The system should always make the original source accessible.

34. Legal / Responsible UI

Include footer links:

Privacy
Terms
Cookie Policy
Contact

News content should not simply be copied wholesale.

The product should store appropriate metadata and summaries and link users to original sources.

Do not present generated information as guaranteed fact.

35. Performance

The website must be fast.

Use:

lazy loading

optimized assets

responsive images

code splitting

minimal JavaScript where possible

efficient database queries

caching

pagination

Do not sacrifice performance for animations.

36. Technical Stack

Use a modern production-ready stack.

Prefer:

React

TypeScript

Tailwind

modern component system

Supabase/Postgres if backend is required

server-side functions for protected operations

proper authentication

secure environment variables

Keep the architecture modular so the news ingestion/AI pipeline can later run separately from the frontend.

37. Important AI Architecture

Design the backend around this model:

COLLECTION

↓

ARTICLE NORMALIZATION

↓

DEDUPLICATION

↓

EVENT CLUSTERING

↓

AI EVENT UNDERSTANDING

↓

IMPORTANCE SCORE

↓

TOPIC / ENTITY TAGGING

↓

USER INTEREST MATCHING

↓

DIGEST GENERATION

↓

DELIVERY

The critical principle:

AI processing should happen at the shared event level whenever possible.

Do not architect it as:

Every user

→ every article

→ AI

Instead:

Every article

→ shared event intelligence

→ many users

Use deterministic filtering/database queries before calling an LLM.

Use AI only where semantic understanding is actually necessary.

For example:

duplicate detection

event extraction

classification

importance

summarization

final digest generation

Do not use an LLM for simple:

topic matching

date filtering

timezone calculation

subscription checks

delivery scheduling

database queries

38. AI Cost Model

Create internal architecture/documentation explaining the economics.

Example:

Shared cost

News collection and event understanding.

This is mostly independent of the number of users.

User-variable cost

Personal digest generation and delivery.

This grows with users.

Optional expensive AI

Deep explanations and interactive questions.

Only execute when users request them.

This creates three cost layers:

LOW COST

database / rules

      ↓

MEDIUM COST

shared AI event understanding

      ↓

USER-VARIABLE

personal digest generation

      ↓

OPTIONAL PREMIUM

deep AI conversations

The product should be designed so the majority of users do not require expensive AI calls constantly.

39. Scaling Philosophy

The system should be designed for:

10 users

→ 100 users

→ 1,000 users

→ 10,000 users

→ 100,000 users

without fundamentally changing the product architecture.

At scale:

cache shared event intelligence

batch AI processing

batch digest generation where possible

use queues

process events asynchronously

avoid duplicate AI calls

archive old raw articles

retain compact event summaries

index database queries

rate-limit expensive operations

Use a queue architecture for:

News ingestion
AI processing
Digest generation
Email delivery
Notification delivery

Do not block web requests while AI processing is running.

40. Dashboard Metrics

Admin dashboard should eventually show:

Total users
Active users
Paid users
Daily digests generated
Stories processed
Events detected
AI calls
AI cost estimate
Email deliveries
Telegram deliveries
WhatsApp deliveries
Open rate
Click rate
Unsubscribe rate
Average stories per briefing
Most popular topics
Most ignored topics
AI cost per active user
Revenue
MRR

Very important:

Show:

AI cost / paying user

and

Gross margin estimate

This will help determine whether the SaaS is economically healthy.

41. Admin News Pipeline

Create an admin-only area eventually supporting:

Sources
Articles
Events
AI processing status
Failed jobs
Queue
User feedback
Topic trends

Example event:

Event #18291

OpenAI launches X

Sources: 38

Importance: 9.4

Topics:

AI

Developer Tools

AI processing:

Complete

Users matched:

18,421

Digests generated:

12,981

This makes the system understandable and debuggable.

42. Error States

Do not leave blank screens.

Create polished states for:

no stories

no topics

AI processing

failed delivery

source unavailable

subscription expired

empty history

no relevant stories today

Example:

Nothing important happened for your radar today.

That’s actually a good thing.

This is an important product philosophy.

Do not force content into the user’s briefing just to fill space.

43. Final Landing Page CTA

End the page with a simple full-screen section:

The internet never stops.
You don’t have to keep checking it.

Button:

Build my radar

Small text:

Free to start. No credit card required.

44. Overall Product Feeling

When someone visits this website, the emotional progression should be:

First 5 seconds

“What is this?”

→ They visually see internet → AI → personal briefing.

10 seconds

“Oh. It watches news for me.”

20 seconds

“I can choose what I care about.”

30 seconds

“And it sends it to me automatically.”

60 seconds

“Ah, this is basically my personal information radar.”

Then

“How much?”

→ Pricing.

45. Critical Final Instruction

Do not make this feel like a template generated by an AI website builder.

Spend most of the effort on:

Visual storytelling

Product demonstration

Typography

Motion

Dashboard polish

Realistic sample content

Clear information hierarchy

Premium interactions

The visitor should be able to understand the product with their eyes before reading the explanation.

Build the landing page and dashboard as if this is a real SaaS launching publicly tomorrow.

Use realistic sample data throughout the interface.

Do not use lorem ipsum.

Do not use fake testimonials or fake customer logos.

Do not claim users, revenue, accuracy, or AI cost numbers that haven’t actually been measured.

Make the application functional wherever possible rather than creating static mockups.

The final result should feel like a premium personal information operating system, not an AI news blog.
