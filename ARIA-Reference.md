# ARIA — Adaptive Rhythm Intelligence Assistant

## Developer Reference & Integration Guide

> **Last verified against source:** 2026-08-14. This revision was checked line-by-line against the real My Body fitness app source (`server/src/utils/aria-*.ts`, `server/src/routes/aria-chat.ts`, `server/src/routes/plan-generate.ts`, `client/src/pages/aria/chat.tsx`, `client/src/components/aria-briefing.tsx`, `server/src/utils/exercise-modifications.ts`, `server/src/utils/periodization.ts`) after two independent audits found the prior version was written from memory/description rather than the shipped code. Earlier drafts of this doc understated the real system significantly — most of what was listed below as an "Improvements Roadmap" was already built. Treat this revision as grounded in code; treat anything you read in an *older* copy of this doc as unverified.

---

## Table of Contents

1. [What Is ARIA](#what-is-aria)
2. [Name & Philosophy](#name--philosophy)
3. [Architecture Overview](#architecture-overview)
4. [Layer 1: Context Engine](#layer-1-context-engine)
5. [Layer 2: System Prompt Builder](#layer-2-system-prompt-builder)
6. [Layer 3: Chat Router (API)](#layer-3-chat-router-api)
7. [Tool Use / Function Calling](#tool-use--function-calling)
8. [Topic Guardrails](#topic-guardrails)
9. [Sentiment Detection](#sentiment-detection)
10. [Long-Term Memory](#long-term-memory)
11. [Exercise Modification & Safety System](#exercise-modification--safety-system)
12. [Layer 4: Frontend Components](#layer-4-frontend-components)
13. [Database Schema](#database-schema)
14. [LLM Integration](#llm-integration)
15. [Fallback Engine](#fallback-engine)
16. [Rate Limiting & Monetization](#rate-limiting--monetization)
17. [Plan Generation (Structured Output Mode)](#plan-generation-structured-output-mode)
18. [Sport Periodization](#sport-periodization)
19. [Weekly Wellness Plan System](#weekly-wellness-plan-system)
20. [Making ARIA Cross-Project](#making-aria-cross-project)
21. [Integration Checklist for a New App](#integration-checklist-for-a-new-app)
22. [File Map](#file-map)
23. [Remaining Gaps & Open Items](#remaining-gaps--open-items)
24. [Summary](#summary)

---

## What Is ARIA

ARIA is a **context-aware AI assistant framework** — a personality layer + user context engine that sits between your app's data and a Large Language Model (LLM). She is not a generic chatbot. She is a domain-specific AI companion that knows who she's talking to, what they've done, and what they need, because she pulls all of that from your database before every conversation.

What makes ARIA different from "just calling an API":

| Generic API Call | ARIA |
|---|---|
| Sends user message to LLM | Sends user message + full user context + personality rules + conversation history to LLM |
| Gets generic response | Gets response that references user's actual data (sleep scores, streak, conditions) |
| Fails if API is down | Falls back to rule-based responses — never leaves the user hanging |
| No access control | Built-in rate limiting with free/premium tiers, timezone-aware |
| Stateless, forgets everything | Maintains persistent chat history (20-message window) plus a separate long-term memory store that survives across sessions |
| Can only talk | Can call tools to look up real data and log water/mood on the user's behalf |
| No topic boundaries | Pre-LLM guardrail filter redirects clearly off-topic requests before they reach the model |
| No guardrails | Hard rules: no medical advice, respect health conditions (deferring to a reviewed modification table), respect dietary choices |

---

## Name & Philosophy

**ARIA** = **A**daptive **R**hythm **I**ntelligence **A**ssistant

"Rhythm" because she adapts to each user's patterns, pace, and lifestyle cadence. She doesn't push a one-size-fits-all program — she meets you where you are.

### The EASE Philosophy

ARIA operates under four principles, defined in her system prompt and enforced across all responses:

| Principle | Meaning | In Practice |
|---|---|---|
| **Empathy** | Meet every person where they are, not where you think they should be | A beginner gets different language than an advanced athlete. Someone reporting stress gets a calming tone. |
| **Authenticity** | Be real. Don't pretend everything is easy. | ARIA acknowledges struggles, doesn't use toxic positivity, admits when something is hard. |
| **Simplicity** | Clear, actionable guidance — not information overload | Responses are 2-4 paragraphs max. End with one actionable next step. |
| **Equity** | Honor all bodies, all cultures, all starting points. No body shaming, ever. | Respects every dietary framework (halal, sattvic, keto), every body type, every fitness level. |

### Personality Traits

- Speaks like a supportive coach who genuinely cares — not clinical, not robotic
- Uses the user's name naturally
- Adapts tone to the user's current state (stressed -> calming, energized -> match energy) — as of the sentiment detection system, this is now backed by an explicit pre-LLM signal rather than pure model inference (see [Sentiment Detection](#sentiment-detection))
- Celebrates every win — even small ones
- Normalizes struggles — everyone has hard days
- Honest but kind — doesn't sugarcoat, but isn't harsh
- Uses encouraging language: "you've got this", "great question", "let's figure this out together"
- Never breaks character — she is ARIA, not a generic AI

---

## Architecture Overview

ARIA is built as four decoupled layers, plus a set of supporting utility modules that plug into Layers 2 and 3 (tool use, guardrails, sentiment, memory, exercise modifications). Each can be extracted, modified, or replaced independently.

```
+------------------------------------------------------------------+
|                        FRONTEND (React)                          |
|                                                                  |
|  +---------------------------+  +-----------------------------+  |
|  |   AriaBriefing Component  |  |    AriaChatPage Component   |  |
|  |   (Dashboard Widget)      |  |    (Full Chat Interface)    |  |
|  |                           |  |                             |  |
|  |  - Rule-based generation  |  |  - Message history          |  |
|  |  - No API call needed     |  |  - Streaming (SSE) by default|  |
|  |  - Sleep/workout/meal     |  |  - Typing indicator          |  |
|  |    insights               |  |  - Rate limit banner         |  |
|  |  - Streak tracking        |  |  - Thumbs up/down feedback   |  |
|  |  - Goal references        |  |  - Image upload (vision)     |  |
|  |                           |  |  - Demo mode fallback        |  |
|  +---------------------------+  +-----------------------------+  |
|                                          |                       |
+------------------------------------------|-----------------------+
                                           | HTTP (Bearer token)
+------------------------------------------|-----------------------+
|                        BACKEND (Express)  |                      |
|                                           v                      |
|  +----------------------------------------------------------+   |
|  |              Layer 3: Chat Router (aria-chat.ts)          |   |
|  |                              8 endpoints (see below)      |   |
|  +----+------------------------------------------+----------+   |
|       |                                          |               |
|       v                                          v               |
|  +-------------------------+  +------------------------------+   |
|  | Layer 1: Context Engine |  | Layer 2: System Prompt       |   |
|  | (aria-context.ts)       |  | Builder                      |   |
|  |                         |  | (aria-system-prompt.ts)      |   |
|  | - 19 parallel queries   |  |                              |   |
|  | - AriaUserContext type  |  | - buildAriaSystemPrompt()    |   |
|  | - 1-hour cache (JSONB)  |  | - buildPlanGenerationPrompt()|   |
|  | - Level naming system   |  | - Personality + rules         |   |
|  +------------+------------+  | - User data injection         |   |
|               |               +------------------------------+   |
|               v                                                  |
|  +----------------------------------------------------------+   |
|  |                    Supabase (PostgreSQL)                  |   |
|  |                                                          |   |
|  |  aria_messages   - Chat history with RLS                 |   |
|  |  aria_context    - Cached user context (JSONB)           |   |
|  |  aria_memory      - Long-term conversation memories       |   |
|  |  aria_feedback    - Thumbs up/down on ARIA responses      |   |
|  |  exercise_modifications - Curated, human-reviewed         |   |
|  |                     exercise safety guidance               |   |
|  |  weekly_wellness_plans - 7-day Move/Eat/Rest/Mind plans   |   |
|  |  profiles         - User profile data                    |   |
|  |  health_profiles - Conditions, limitations, allergies    |   |
|  |  assessments     - Goals, schedule, preferences          |   |
|  |  workout_logs    - Exercise history                      |   |
|  |  nutrition_logs  - Meal tracking                         |   |
|  |  hydration_logs  - Water intake (written by the log_water|   |
|  |                     tool, separate from nutrition_logs)   |   |
|  |  sleep_logs      - Sleep data                            |   |
|  |  mood_logs       - Mood/energy/stress                    |   |
|  |  gamification    - XP, level, badges, streaks            |   |
|  |  + more tables...                                         |   |
|  +----------------------------------------------------------+   |
+------------------------------------------------------------------+
                               |
                               | OpenAI-compatible API
                               v
                    +---------------------+
                    |  OpenRouter / LLM   |
                    |  (Claude Sonnet)    |
                    +---------------------+
```

**Supporting utility modules** wired into Layers 2 and 3, not shown in the box diagram above:

| Module | File | Role |
|---|---|---|
| Tool definitions & executor | `server/src/utils/aria-tools.ts` | 8 tools the LLM can call mid-conversation (log water/mood, query stats/trends/history) |
| Topic guardrails | `server/src/utils/aria-guardrails.ts` | Pre-LLM off-topic filter (7 categories) |
| Sentiment detection | `server/src/utils/aria-sentiment.ts` | Pre-LLM mood/energy/intent classifier, injected into the system prompt |
| Long-term memory | `server/src/utils/aria-memory.ts` | Fire-and-forget conversation summarization into persistent memories |
| Exercise modifications | `server/src/utils/exercise-modifications.ts` | Curated, human-reviewed condition-specific exercise safety guidance |
| Sport periodization | `server/src/utils/periodization.ts` | 6-phase training-emphasis modifiers for plan generation |

---

## Layer 1: Context Engine

**File:** `server/src/utils/aria-context.ts` (449 lines)

This is ARIA's memory — the mechanism that makes her responses personal rather than generic. A single async function `buildAriaContext(userId)` gathers everything the app knows about a user into one typed object.

### The AriaUserContext Interface

```typescript
interface AriaUserContext {
  profile: {
    name: string;              // Display name or "there"
    email: string;
    timezone: string;          // e.g. "America/New_York"
    subscription_tier: string; // "free" | "premium"
    onboarding_complete: boolean;
    member_since: string;      // ISO date
  };

  health: {
    fitness_level: string;       // "beginner" | "intermediate" | "advanced"
    conditions: string[];        // Adaptive-Training condition-entry IDs, e.g. ["adaptive-rotator-cuff", "adaptive-type-2-diabetes"] — see Exercise Modification & Safety System
    limitations: string[];       // e.g. ["lower back", "right knee"]
    allergies: string[];         // e.g. ["peanuts", "shellfish"]
    medications: string[];       // e.g. ["metformin"]
    blood_type: string | null;
    diet_framework: string | null; // e.g. "halal", "keto", "sattvic"
    pregnancy_status: string | null;
    equipment_available: string[];
    training_location: string | null;
    work_schedule: string | null;
    climate: string | null;
    recovery_methods: string[];
    stretching_prefs: string[];
    body_comp_goal: string | null;
    injury_history: unknown[];
    meal_frequency: number | null;
    modifications: ExerciseModificationRow[]; // Reviewed exercise safety
                                                // guidance matched to this
                                                // user's disclosed conditions
                                                // — see Exercise Modification
                                                // & Safety System below
  };

  selections: {
    training_styles: string[];     // e.g. ["strength", "yoga", "calisthenics"]
    diet_frameworks: string[];
    sports: string[];              // e.g. ["basketball", "swimming"]
    workout_reasons: string[];     // e.g. ["stress relief", "muscle gain"]
    stretching_types: string[];
    spiritual_practices: string[]; // e.g. ["yoga", "tai chi", "qigong"]
  };

  assessment: {
    goals: string[];             // e.g. ["lose weight", "build muscle"]
    age_range: string;           // e.g. "25-34"
    days_per_week: number;       // e.g. 4
    minutes_per_session: number; // e.g. 45
    wake_time: string;           // e.g. "6:30 AM"
    bed_time: string;            // e.g. "10:30 PM"
  };

  recentActivity: {
    lastWorkout: { title: string; date: string; rpe: number } | null;
    lastMeal: { meal_type: string; food_name: string; date: string } | null;
    lastSleep: { duration: number; quality: number; sleep_score: number; date: string } | null;
    lastMood: { mood: number; energy: number; stress: number; date: string } | null;
    lastStretch: { title: string; date: string; mobility_score: number | null } | null;
    lastRecovery: { protocol_name: string; date: string; recovery_score: number | null } | null;
    weeklyStats: {
      workouts_count: number;
      avg_sleep_hours: number;
      avg_mood: number;
      total_calories_today: number;
    };
  };

  gamification: {
    level: number;              // 1-10
    level_name: string;         // "Awakening" through "Body Wisdom"
    xp_total: number;
    current_streak: number;     // consecutive days
    longest_streak: number;
    badges_earned: string[];    // e.g. ["First Workout", "7-Day Streak"]
  };

  plan: {
    has_active_plan: boolean;   // 4-week AI-generated plan (thirty_day_plans)
    current_week: number;       // 1-4
    tasks_completed: number;
    total_tasks: number;
  };

  weeklyPlan: {                 // The separate 7-day Weekly Wellness Plan
                                 // system — see Weekly Wellness Plan System
    has_weekly_plan: boolean;
    today_theme: string | null;
    today_workout: string | null;
    today_is_rest_day: boolean;
    completed_today_count: number;
    total_today_items: number;
    weekly_completion_pct: number;
  };

  dailyActions: {
    actions: { pillar: string; title: string; completed: boolean }[];
    completedCount: number;
  };
}
```

Two fields were missing from earlier versions of this doc: `health.modifications` (populated from the exercise-modifications table, filtered to the user's disclosed conditions) and the entire `weeklyPlan` object (populated from the active row in `weekly_wellness_plans`, with today's items and weekly completion percentage computed in-process — see the `weeklyPlan` IIFE in `aria-context.ts`).

### How Context Building Works

1. **19 database queries run in parallel** via `Promise.all()` for speed — profile, health profile, wellness selections, assessment, last workout/meal/sleep/mood/stretch/recovery, this-week workout count, this-week sleep, this-week mood, today's nutrition, gamification, 4-week plan weeks, daily actions, the active weekly wellness plan, and the entire `exercise_modifications` table (fetched whole and filtered in memory, since it's a small curated table).
2. Each query fetches one slice of user data
3. Results are normalized into the `AriaUserContext` shape with sensible defaults for missing data
4. The assembled context is **cached** in the `aria_context` table as JSONB
5. `getAriaContext()` checks cache age — if < 1 hour old, returns cached; otherwise rebuilds

```typescript
// Usage
const context = await getAriaContext(userId);  // Cached (fast)
const context = await buildAriaContext(userId); // Force fresh build
```

### Level Naming System

ARIA's gamification uses named levels rather than raw numbers:

| Level | Name | Level | Name |
|---|---|---|---|
| 1 | Awakening | 6 | Resilience |
| 2 | Foundation | 7 | Mastery |
| 3 | Momentum | 8 | Transcendence |
| 4 | Discipline | 9 | Enlightenment |
| 5 | Strength | 10 | Body Wisdom |

### Key Design Decisions

- **Parallel queries:** All 19 queries run simultaneously. This is critical — running them sequentially would mean ~2-3 seconds of latency; parallel runs complete in ~200-400ms.
- **Caching with TTL:** Rebuilding context on every message would be wasteful. The 1-hour TTL balances freshness with performance.
- **Invalidation exists but is only partially wired.** `invalidateAriaContext(userId)` is a real, working function — it deletes the cached `aria_context` row and bumps `profiles.aria_data_version` so staleness is at least detectable. It is called from exactly one place today: the tool executor in `aria-chat.ts` calls it after a successful `log_water` or `log_mood` tool call (see [Tool Use / Function Calling](#tool-use--function-calling)). It is **not** called from any of the app's other data-writing routes (workout logging, meal logging, sleep logging, profile updates, etc.), so those still rely on the 1-hour TTL alone. This is a partial rollout of event-driven invalidation, not a fully missing feature and not a fully shipped one — treat it as "wired for two tool-triggered writes, TTL-only everywhere else."
- **Graceful defaults:** Every field has a fallback value. If a user hasn't completed onboarding, ARIA still works — she just has less data to reference.
- **JSONB storage:** The cached context is stored as JSONB, not normalized tables. This makes reads fast and avoids complex joins for a cache.

---

## Layer 2: System Prompt Builder

**File:** `server/src/utils/aria-system-prompt.ts` (265 lines)

This is ARIA's personality and instruction set. `buildAriaSystemPrompt()` takes an `AriaUserContext` plus an optional `SystemPromptOptions` bag and returns a string that becomes the LLM's system prompt.

### SystemPromptOptions

```typescript
interface SystemPromptOptions {
  memories?: AriaMemory[];        // Long-term memories (see Long-Term Memory)
  sentiment?: SentimentHint;      // Detected from the current message (see Sentiment Detection)
  visionEnabled?: boolean;        // Whether this call includes an image
}
```

All three are optional — the prompt works with just the context, but gets more capable with each additional signal supplied by the router.

### buildAriaSystemPrompt(context, options)

The prompt is structured into these sections:

#### 1. Personality Definition
```
You are ARIA (Adaptive Rhythm Intelligence Assistant), the AI wellness
companion for the My Body fitness app. You are warm, knowledgeable,
encouraging, and culturally aware.
```

Defines how ARIA speaks, her tone, and her emotional intelligence rules.

#### 2. Philosophy (EASE)
The four principles that constrain ARIA's behavior — Empathy, Authenticity, Simplicity, Equity.

#### 3. Expertise Domains
What ARIA is qualified to discuss:

- Physical training (strength, cardio, flexibility, adaptive, sports-specific)
- Nutrition (all dietary frameworks: keto, halal, sattvic, Mediterranean, plant-based)
- Sleep science (architecture, hygiene, scoring, circadian rhythms)
- Recovery (active recovery, deload cycles, thermal therapy)
- Mental wellness (motivation science, stress management, trauma-informed care)
- Spirituality in training (yoga, tai chi, qigong, capoeira, indigenous movement)
- Adaptive training for conditions (diabetes, arthritis, back pain, pregnancy)
- Supplementation (evidence-based: creatine, vitamin D, omega-3, magnesium, adaptogens)
- Longevity science (VO2 max, grip strength, sarcopenia prevention, Zone 2)
- Breathwork (box breathing, Wim Hof, physiological sigh, nasal breathing)
- Sport periodization (off-season through competition phases)

#### 4. "Your Capabilities" — Tool Awareness

A section that earlier versions of this doc did not document at all: the prompt explicitly tells the model it can look up weekly stats, sleep trends, workout history, nutrition, mood trends, and personal records, and can log water and mood on the user's behalf — and instructs it to use those tools instead of guessing or telling the user to do something manually. See [Tool Use / Function Calling](#tool-use--function-calling).

#### 5. User Data Injection
Real user data is interpolated directly into the prompt:

```
### Profile
- Name: ${profile.name}
- Member since: ${new Date(profile.member_since).toLocaleDateString()}
- Subscription: ${profile.subscription_tier}
- Timezone: ${profile.timezone}

### Health
- Fitness Level: ${health.fitness_level}
- Conditions: ${health.conditions.join(', ')}
- Limitations: ${health.limitations.join(', ')}
...
[REVIEWED EXERCISE MODIFICATIONS section, if any conditions match — see below]

### Recent Activity
- Last Workout: "${recentActivity.lastWorkout.title}" on ... (RPE: .../10)
- Last Sleep: ...h, quality .../10, score .../100
- This Week: ... workouts, avg ...h sleep, avg mood .../5

### Progress
- Level: ... (...) — ... XP
- Current Streak: ... days
- Plan: Week X/4, or "No active plan"
- Weekly Plan: XX% complete | Today: ... (see Weekly Wellness Plan System)

[WHAT YOU REMEMBER FROM PAST CONVERSATIONS section, if any memories exist]
[IMAGE ANALYSIS section, if visionEnabled]
```

This is what enables responses like "Your sleep score was 62 last night — let's look at why" rather than generic "try to sleep more."

#### 6. Behavioral Rules (14 Hard Rules)

The real prompt has **14** rules, not 12. Two tool-use-related rules were missing from earlier versions of this doc (13 and 14 below), and Rule 2's real text includes an explicit instruction to defer to the reviewed exercise-modification guidance rather than reasoning independently:

1. NEVER give specific medical advice — redirect to doctor
2. ALWAYS respect health conditions — never recommend contraindicated exercises. **When exercise modification guidance is present for a condition, use ONLY that guidance — do not reason about contraindications yourself for a condition the guidance covers.**
3. ALWAYS respect diet framework — never suggest violating foods
4. Reference actual data when relevant
5. If no recent data, gently encourage logging
6. Keep responses to 2-4 paragraphs
7. Stay within fitness level and training preferences
8. If pain/injury reported, take seriously and recommend professional consultation
9. Can suggest activities but don't be pushy
10. Match formality to user's message
11. Can reference wellness encyclopedia topics by name
12. Never break character
13. **When you use tools to look up data, weave the results naturally into your response — don't just dump raw numbers.**
14. **If a tool call fails, gracefully continue with the information you already have from the context above.**

A `sentimentSection` (see [Sentiment Detection](#sentiment-detection)) is appended after the rules when a sentiment hint is supplied.

### buildPlanGenerationPrompt(context, planType)

A second prompt builder for structured JSON output. Same context, different instructions:

- Generates 4-week periodized plans
- Returns strict JSON format with weeks, workouts, nutrition, sleep, mindset, daily tasks
- Each workout has specific exercises, sets, reps, rest periods
- Includes adaptive notes for health conditions
- Respects diet framework, fitness level, schedule constraints
- Also includes the same REVIEWED EXERCISE MODIFICATIONS section as the chat prompt, with the same "use ONLY that guidance" instruction
- When the caller (`plan-generate.ts`) passes a `sport_phase`, an additional periodization context block is appended after this prompt — see [Sport Periodization](#sport-periodization)

**Plan types:** `full_program`, `workout`, `nutrition`, `recovery`, `mental_wellness`

---

## Layer 3: Chat Router (API)

**File:** `server/src/routes/aria-chat.ts` (767 lines)
**Mount point:** `/api/aria`

All routes require authentication via `verifyToken` middleware. The router has **8 endpoints**, not 5 — three were missing from earlier versions of this doc (`POST /message/stream`, `POST /feedback`, `GET /memories`).

### Endpoints

#### `GET /api/aria/messages` — Chat History

Paginated retrieval of conversation history.

**Query params:**
- `limit` (default: 50, max: 100)
- `offset` (default: 0)

**Response:**
```json
{
  "data": [
    {
      "id": "uuid",
      "user_id": "uuid",
      "role": "user" | "aria",
      "content": "message text",
      "tokens_used": 0,
      "created_at": "2024-01-15T10:30:00Z"
    }
  ],
  "pagination": {
    "total": 42,
    "limit": 50,
    "offset": 0,
    "has_more": false
  },
  "rate_limit": {
    "used": 2,
    "limit": 3,
    "remaining": 1,
    "is_premium": false
  }
}
```

#### `GET /api/aria/remaining` — Rate Limit Status

Quick check without loading messages.

**Response:**
```json
{
  "used": 2,
  "limit": 3,
  "remaining": 1,
  "is_premium": false
}
```

#### `POST /api/aria/message` — Send Message & Get Response

The core endpoint. The real flow is considerably deeper than a plain "call the LLM and save the response" — it wires together rate limiting, guardrails, tool use, sentiment, and memory:

```
User message
    |
    v
[1] Rate limit check — timezone-aware (getUserMidnight), free=3/day, premium=unlimited
    |
    v
[2] Topic guardrail check (checkTopicRelevance) — if blocked, save both messages
    |   with the canned redirect and return immediately; NO LLM call is made
    |
    v
[3] Save user message to aria_messages
    |
    v
[4] Load last 20 messages as conversation history
    |
    v
[5] In parallel: get/build user context (cached 1hr) + load long-term memories
    |
    v
[6] Detect sentiment from the current message (detectSentiment)
    |
    v
[7] Build system prompt with injected context + memories + sentiment + vision flag
    |
    v
[8] First LLM call, WITH tool definitions (ARIA_TOOLS) attached
    |   |
    |   +-- If the model returns tool_calls: execute each tool server-side,
    |   |   invalidate the context cache if it was log_water/log_mood,
    |   |   then make a SECOND LLM call with the tool results appended
    |   |
    |   +-- On failure: use fallback response generator
    |
    v
[9] Fire-and-forget: trigger summarizeConversation() in the background
    |   (not awaited — the HTTP response does not wait on this)
    |
    v
[10] Save ARIA response to aria_messages
    |
    v
[11] Return both messages + rate limit status
```

**Request:**
```json
{
  "content": "What should I eat before my workout tomorrow?",
  "image": "optional base64 string or data: URL"
}
```

**Response (200):**
```json
{
  "data": {
    "user_message": { "id": "...", "role": "user", "content": "...", "created_at": "..." },
    "aria_message": { "id": "...", "role": "aria", "content": "...", "tokens_used": 450, "created_at": "..." }
  },
  "rate_limit": {
    "used": 3,
    "limit": 3,
    "remaining": 0,
    "is_premium": false
  }
}
```

**Response (429 — rate limited):**
```json
{
  "error": "Daily message limit reached",
  "message": "Free accounts get 3 ARIA messages per day. Upgrade to Premium for unlimited access.",
  "remaining": 0,
  "limit": 3
}
```

#### `POST /api/aria/message/stream` — Streaming Response (SSE)

Server-Sent Events variant of the endpoint above. Same rate-limit and guardrail checks up front; if the model is unavailable it simulates streaming by chunking the fallback response word-by-word. Sends `{ type: 'chunk', content }` events as tokens arrive and a final `{ type: 'done', message_id, rate_limit }` event once the full response is saved. Memory summarization is triggered the same way as the non-streaming endpoint (fire-and-forget). Note: this endpoint accepts only `content`, not `image` — image/vision input goes through the standard `/message` endpoint.

#### `POST /api/aria/feedback` — Rate an ARIA Response

Records a thumbs up/down (and optional free-text feedback) on a specific ARIA message. Validates that the message belongs to the requesting user and has `role: 'aria'` before accepting the rating. Upserts on `(user_id, message_id)` so a user can change their mind.

**Request:**
```json
{ "message_id": "uuid", "rating": 1, "feedback": "optional text" }
```

#### `GET /api/aria/memories` — View Long-Term Memories

Returns the user's stored long-term memories (see [Long-Term Memory](#long-term-memory)).

#### `POST /api/aria/refresh-context` — Force Context Rebuild

Invalidates the cached context and rebuilds from scratch.

**Response:**
```json
{
  "message": "Context refreshed",
  "data": { /* full AriaUserContext object */ }
}
```

#### `DELETE /api/aria/messages` — Clear Chat History

Deletes all messages for the authenticated user.

**Response:**
```json
{
  "message": "Chat history cleared"
}
```

### Conversation History Management

When generating a response, the router loads the **last 20 messages** and maps them to the LLM's expected format:

```typescript
const conversationHistory = recentMessages
  .reverse()
  .map(m => ({
    role: m.role === 'aria' ? 'assistant' : 'user',
    content: m.content,
  }));
```

The final LLM call looks like:
```typescript
messages: [
  { role: 'system', content: systemPrompt },  // ARIA's personality + user context
  ...conversationHistory,                       // Last 20 messages
]
```

---

## Tool Use / Function Calling

**File:** `server/src/utils/aria-tools.ts` (312 lines)

Earlier versions of this doc listed function calling as unbuilt future work (with a proposed tool set of `log_workout`, `log_water`, `get_weekly_stats`, `get_sleep_trend`, `suggest_workout`, `set_reminder`). It is fully implemented, and the real tool set differs from that proposal — `log_workout`, `suggest_workout`, and `set_reminder` don't exist; they'd be reasonable future additions, but should not be presented as current.

### The 8 real tools (`ARIA_TOOLS`)

| Tool | Type | What it does |
|---|---|---|
| `log_water` | write | Logs water intake to **`hydration_logs`** (not `nutrition_logs`) |
| `log_mood` | write | Logs mood/energy/stress ratings (1-5 each) plus an optional note to `mood_logs` |
| `get_weekly_stats` | read | Workouts this week, avg sleep, avg mood, calories today |
| `get_sleep_trend` | read | Sleep entries for the past N days (default 7, max 30) |
| `get_workout_history` | read | Workout entries for the past N days (default 7, max 30) |
| `get_nutrition_today` | read | Today's logged meals + totals |
| `get_mood_trend` | read | Mood/energy/stress entries for the past N days |
| `get_personal_records` | read | PRs, optionally filtered by exercise name |

Tools are passed to the first LLM call as `tools: ARIA_TOOLS` (OpenAI function-calling format). If the model returns `tool_calls`, `aria-chat.ts` executes each one via `executeAriaTool(userId, toolName, args)`, then makes a **second** LLM call with the tool results appended so the model can weave them into a natural-language reply (Rule 13 above).

### Cache invalidation on write tools

After executing a tool call, the router checks:

```typescript
if (['log_water', 'log_mood'].includes(toolCall.function.name)) {
  invalidateAriaContext(userId).catch(() => {});
}
```

This is the one place `invalidateAriaContext()` is actually called from outside the context engine itself — see the "partially wired" note in [Layer 1](#layer-1-context-engine).

---

## Topic Guardrails

**File:** `server/src/utils/aria-guardrails.ts` (68 lines)

Also previously documented as unbuilt. It's real, and runs as a pre-LLM filter in both `/message` and `/message/stream` — a blocked message never reaches the LLM at all (saves tokens, guarantees consistent behavior).

### 7 categories, not 5

Earlier versions of this doc listed 5 off-topic categories. The real `OFF_TOPIC_PATTERNS` list has **7**: finance, programming, politics, harmful, creative writing, **academics**, and **legal** (the last two were missing).

### Real precedence rules

`checkTopicRelevance(message)` applies three checks, in this order, and the order matters:

1. **Messages under 15 characters are always allowed.** Short greetings and follow-ups never get blocked, regardless of content.
2. **Wellness-keyword override.** If the message matches a broad wellness-related pattern (workout, nutrition, sleep, stress, mood, etc.) it is allowed through **even if it also matches an off-topic pattern.** This is checked before the off-topic patterns, not after — e.g. "how does stress affect my workout performance" would otherwise risk no match, but a message mentioning both "stock" and "workout" is let through because of this override, not despite it.
3. **Only then** are the 7 off-topic patterns checked. A match returns `{ allowed: false, redirect_message }` with a topic-specific canned response (or a generic fallback if the topic key isn't found).

Anything that doesn't hit an off-topic pattern is allowed through to the LLM.

---

## Sentiment Detection

**File:** `server/src/utils/aria-sentiment.ts` (91 lines)

Also real, not a roadmap item. `detectSentiment(message)` runs before every LLM call and produces a `SentimentHint`:

```typescript
interface SentimentHint {
  mood: 'positive' | 'neutral' | 'negative' | 'distressed';
  energy: 'high' | 'medium' | 'low';
  intent: 'question' | 'venting' | 'celebration' | 'request' | 'greeting' | 'unknown';
}
```

Detection order: distress patterns are checked first and short-circuit to `{ mood: 'distressed', energy: 'low', intent: 'venting' }` if matched. Otherwise mood is derived from counting positive vs. negative keyword matches, energy from high/low-energy keyword patterns, and intent from a set of heuristics (question marks and question words, negative-without-a-question-mark as venting, positive keywords as celebration, action verbs as request, greeting patterns as greeting).

### It materially changes what the LLM is told to do, not just its tone label

`buildSentimentHint()` appends a `## CURRENT MESSAGE CONTEXT` block to the system prompt, and the content of that block is conditional on the detected state — this is instruction, not just labeling:

- `mood: 'distressed'` → "Be extra gentle, validate their feelings, and suggest professional support if appropriate. Do NOT jump to workout suggestions."
- `mood: 'negative'` → "Be empathetic and validating before offering advice."
- `intent: 'celebration'` → "Match their excitement! Celebrate with them."
- `intent: 'venting'` → "Listen first. Don't jump to solutions unless asked."
- `energy: 'low'` → "Keep suggestions low-effort and manageable. Don't overwhelm with big plans."

---

## Long-Term Memory

**File:** `server/src/utils/aria-memory.ts` (166 lines)

Also real. Earlier versions of this doc proposed a cron-based summarization job; the real implementation is **fire-and-forget after every message send**, not cron-based, and has its own internal gating so it doesn't run (or write) on every call.

### How it actually runs

- `summarizeConversation(userId, openrouterClient)` is called from `aria-chat.ts` after the ARIA response is generated, as `summarizeConversation(userId, client).catch(err => ...)` — **not awaited**. The HTTP response to the user is not delayed by summarization.
- Internally it gates on volume: it loads up to the last 30 messages, bails if fewer than 10 exist, and — if a memory already exists — also checks how many messages have arrived since the most recent memory's `created_at` and bails unless that's **≥ 10**. So summarization only actually fires roughly once per 10 new messages, even though it's invoked on every send.
- When it does run, it calls the LLM with **`model: 'anthropic/claude-haiku-4-5-20251001'`** and **`max_tokens: 500`** — a smaller/cheaper model than the main chat model, asking it to extract `goal` / `concern` / `user_preference` / `conversation_summary` items as JSON.
- **Deduplication:** before inserting, it fetches the user's existing memory contents and skips any extracted memory whose content exactly matches (case-insensitively) an existing one.
- Each accepted memory is inserted individually into `aria_memory`.

### How memories come back into the prompt

`getAriaMemories(userId)` fetches up to 20 memories ordered by `source_date` descending, and `buildMemoryPromptSection()` renders them into a `## WHAT YOU REMEMBER FROM PAST CONVERSATIONS` block appended to the system prompt, with an instruction to reference them naturally and ask the user if an old memory seems outdated rather than assuming it's still true.

---

## Exercise Modification & Safety System

**File:** `server/src/utils/exercise-modifications.ts` (94 lines)

This is what Hard Rule 2 actually depends on, and earlier versions of this doc never explained the mechanism at all — Rule 2 just said "never recommend contraindicated exercises" with no description of how ARIA is supposed to know what's contraindicated.

### The real mechanism

- `exercise_modifications` is a **curated, human-reviewed** database table. Each row (`ExerciseModificationRow`) has a `condition_id`, a `movement_category`, a **severity** taxonomy value (`'avoid' | 'modify' | 'caution'`), a `gentler_variation` suggestion, a `doctor_pt_note`, and reviewer metadata (`reviewed_by`, `reviewed_at`, optional `source`).
- The whole table is fetched once per context build (it's small — tens of rows) and filtered in memory: `getModificationsForConditions(conditionIds, allModifications)` returns only the rows matching the user's disclosed `health.conditions`.
- `buildModificationPromptSection()` renders the matched rows into a `## REVIEWED EXERCISE MODIFICATIONS` prompt block with an explicit instruction: **"use ONLY the reviewed guidance provided. Do not invent your own contraindication reasoning for these conditions."** This is the literal source of the "use ONLY that guidance" clause now folded into Hard Rule 2 above.
- If a disclosed condition has zero matching rows, the section still includes a generic fallback line for that condition ("no reviewed guidance on file... do not name a specific exercise... give only a generic gentler-variation suggestion and tell them to check with a doctor or physical therapist") rather than silently omitting it.

### Condition-ID format — verified, not a bug

`buildModificationPromptSection()` filters `conditionIds` through:

```typescript
const VALID_CONDITION_ID = /^adaptive-[a-z0-9-]+$/;
```

Only condition IDs matching that pattern (e.g. `adaptive-rotator-cuff`, `adaptive-acl`) are considered for lookup — anything not matching is silently dropped before the modification table is even consulted. An earlier revision of this doc flagged this as a possible bug, on the assumption that `health.conditions` might actually be plain strings like `"diabetes"`. That's been traced and ruled out: both `onboarding/index.tsx` and `health-profile.tsx` populate `health_profiles.conditions` exclusively through `EncyclopediaSelect(type="condition")`, which is hard-filtered (`client/src/data/wellness-encyclopedia.ts`'s `getDropdownOptions()`) to entries in the "Adaptive Training" category — and every entry in that category has an `adaptive-`-prefixed `id`, which is exactly what gets written on selection. So real stored values genuinely are `adaptive-*` slugs, matching this regex by design; the mechanism works correctly in production. This document's own type illustration (`health.conditions: string[]`, e.g. `["diabetes", "arthritis"]`) was the actual source of the confusion — treat it as shorthand for "an array of Adaptive-Training condition-entry IDs," not literal plain-English condition names.

---

## Layer 4: Frontend Components

### AriaChatPage (`client/src/pages/aria/chat.tsx`, 849 lines)

Full-screen chat interface at route `/aria`.

**Features:**
- **Dual mode:** API mode (authenticated) or Demo mode (localStorage-based, no API needed)
- **Streaming by default:** `useStreaming` is `true`; the page consumes the `/message/stream` SSE endpoint and falls back to standard JSON handling if the response isn't `text/event-stream` (e.g. an off-topic redirect or a 429)
- **Message rendering:** Custom markdown renderer (bold text, bullet lists, paragraphs)
- **Typing indicator:** Animated bouncing dots with "ARIA is thinking" label, hidden once streaming text starts arriving
- **Feedback:** Thumbs up/down buttons under every ARIA message, posting to `POST /api/aria/feedback`
- **Image upload:** An image-attach button lets the user send an image (base64, ≤5MB, validated client-side) alongside their message; sent via the standard (non-streaming) `/message` endpoint
- **Rate limit banner:** Shows remaining messages for free users, with "Go Premium" CTA
- **Rate limit lockout:** When limit is hit, input is replaced with upgrade prompt
- **Time-aware welcome:** "Good morning/afternoon/evening, {name}!" with personality
- **Chat controls:** Clear history (with a confirm dialog), back navigation
- **Keyboard:** Enter to send. The input is a single-line `<input type="text">`, not a `<textarea>` — there is no way to insert a literal newline, so "Shift+Enter for newline" does not apply here even though the keydown handler checks `!e.shiftKey`; Shift+Enter simply does nothing rather than inserting a line break.
- **Auto-scroll:** Scrolls to bottom on new messages

**Component Architecture:**
```
AriaChatPage
├── Header (back button, ARIA avatar, "AI Powered" badge, clear button)
├── Rate Limit Banner (conditional)
├── Messages Area (scrollable)
│   ├── ChatMessage (user) — coral bubble, right-aligned, optional image preview
│   ├── ChatMessage (aria) — sandy bubble, left-aligned, markdown rendered
│   ├── Feedback buttons (aria messages) — thumbs up/down
│   └── Typing Indicator (conditional)
└── Input Area
    ├── Image attach button + pending-image preview strip
    ├── Text Input (or rate limit lockout)
    └── Send Button
```

**Demo Mode:**

When Supabase isn't configured (`isDemoMode`), ARIA runs entirely client-side:
- Messages stored in `localStorage` under key `mybody_aria_chat`
- Responses generated by `getDemoAriaResponse()` — keyword-based matching, covering **8 topics** (greetings, workout, nutrition, sleep, stress, motivation, pain, thank-you) — narrower than the backend fallback's 11 topics (see [Fallback Engine](#fallback-engine))
- Simulated "thinking" pause of **400-800ms** before the response begins streaming in word-by-word (not 800-2000ms — that range was never in the code)
- No rate limiting

### AriaBriefing (`client/src/components/aria-briefing.tsx`, 292 lines)

Dashboard widget that shows a daily snapshot. Runs **entirely on rule-based logic** — no LLM API call. This section was confirmed accurate by both audit passes and is left as-is.

**Data sources (direct Supabase queries):**
- Recent workouts (last 30)
- Workouts this week (count)
- Recent sleep logs (last 3)
- Meals logged today (count)
- Assessment goals
- Workout streak (calculated client-side)

**Generated insights (examples):**
- "Good morning, Tamir! Here is your daily snapshot."
- "You slept 7.5 hours last night. That is solid rest for recovery."
- "You have completed 3 workouts this week. You are building a strong habit."
- "You have logged 2 meals today. Remember to fuel your body well."
- "You are on a 5 day streak. Your dedication is showing."

**Design:**
- Card with gradient background (sandy to primary/5)
- ARIA sparkle icon avatar
- Loading skeleton while fetching
- Max 5 bullet points
- "Powered by ARIA" footer

---

## Database Schema

### aria_messages (Migration 003)

Stores all chat history. Each message is either from the user or from ARIA.

```sql
CREATE TABLE aria_messages (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id     uuid NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  role        text NOT NULL CHECK (role IN ('user', 'aria')),
  content     text NOT NULL,
  tokens_used integer DEFAULT 0,
  created_at  timestamptz DEFAULT now()
);

-- Indexes
CREATE INDEX idx_aria_messages_user_id ON aria_messages(user_id);
CREATE INDEX idx_aria_messages_created_at ON aria_messages(created_at);

-- RLS Policies (users can only access their own messages)
ALTER TABLE aria_messages ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view own messages"
  ON aria_messages FOR SELECT USING (auth.uid() = user_id);

CREATE POLICY "Users can insert own messages"
  ON aria_messages FOR INSERT WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can delete own messages"
  ON aria_messages FOR DELETE USING (auth.uid() = user_id);
```

### aria_context (Migration 005)

Caches the assembled user context to avoid rebuilding on every message.

```sql
CREATE TABLE aria_context (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id      uuid NOT NULL UNIQUE REFERENCES profiles(id) ON DELETE CASCADE,
  context_data jsonb NOT NULL DEFAULT '{}',
  last_updated timestamptz DEFAULT now()
);

-- RLS Policies
ALTER TABLE aria_context ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view own context"
  ON aria_context FOR SELECT USING (auth.uid() = user_id);
```

### Additional tables now in active use

The migration files for these were not part of the ground-truth source set for this revision, so exact column types/constraints below are reconstructed from what the code actually reads and writes, not copied from a migration — treat column presence as verified, exact SQL types as best-effort:

- **`aria_memory`** — written by `aria-memory.ts`. Columns actually used: `user_id`, `memory_type` (`'conversation_summary' | 'user_preference' | 'goal' | 'concern'`), `content`, `source_date`, `created_at`.
- **`aria_feedback`** — written by the `/feedback` endpoint. Columns actually used: `user_id`, `message_id`, `rating` (`1 | -1`), `feedback` (nullable text), upserted on `(user_id, message_id)`.
- **`exercise_modifications`** — see [Exercise Modification & Safety System](#exercise-modification--safety-system) for its real shape (`id`, `condition_id`, `movement_category`, `severity`, `gentler_variation`, `doctor_pt_note`, `source`, `reviewed_by`, `reviewed_at`).
- **`hydration_logs`** — the real write target for the `log_water` tool (columns used: `user_id`, `cups`, `logged_at`). Note this is a separate table from `nutrition_logs`.
- **`weekly_wellness_plans`**, **`ai_generated_plans`** — see [Weekly Wellness Plan System](#weekly-wellness-plan-system) and [Plan Generation](#plan-generation-structured-output-mode).
- **`personal_records`** — read by the `get_personal_records` tool (columns used: `exercise_name`, `record_type`, `value`, `unit`, `achieved_at`).

---

## LLM Integration

### Provider: OpenRouter

ARIA uses OpenRouter, which provides an OpenAI-compatible API that routes to various LLM providers. This means you can swap models without changing code.

```typescript
const OpenAI = require('openai');
const client = new OpenAI({
  baseURL: 'https://openrouter.ai/api/v1',
  apiKey: process.env.OPENROUTER_API_KEY,
});

const response = await client.chat.completions.create({
  model: process.env.ARIA_MODEL || 'anthropic/claude-sonnet-4',
  max_tokens: parseInt(process.env.ARIA_MAX_TOKENS || '1024'),
  tools: ARIA_TOOLS,
  messages: [
    { role: 'system', content: systemPrompt },
    ...conversationHistory,
  ],
});
```

### Environment Variables

Chat and plan generation use **separate** model/token env vars — this was missing from earlier versions of this doc, which documented only the chat pair.

```bash
# Required for AI-powered responses
OPENROUTER_API_KEY=your_openrouter_api_key

# Chat (aria-chat.ts) — optional, defaults shown
ARIA_MODEL=anthropic/claude-sonnet-4
ARIA_MAX_TOKENS=1024

# Plan generation (plan-generate.ts) — optional, defaults shown.
# Separate from the chat pair above, and defaults to a much larger
# token budget since it's producing full structured JSON plans.
PLAN_MODEL=anthropic/claude-sonnet-4
PLAN_MAX_TOKENS=4096
```

The long-term memory summarizer (`aria-memory.ts`) does not use either of these — it hardcodes `model: 'anthropic/claude-haiku-4-5-20251001'` and `max_tokens: 500` directly in the call, not via an env var.

### Why OpenRouter Instead of Direct API

- **Model flexibility:** Switch between Claude, GPT-4, Llama, Mistral, etc. by changing one env var
- **OpenAI-compatible SDK:** Use the `openai` npm package (widely supported, well-documented)
- **Fallback routing:** OpenRouter can auto-fallback to other providers if one is down
- **Cost tracking:** Built-in usage dashboard

### Swapping to Direct Anthropic API

To use the Anthropic SDK directly instead of OpenRouter:

```typescript
import Anthropic from '@anthropic-ai/sdk';

const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

const response = await client.messages.create({
  model: 'claude-sonnet-4-20250514',
  max_tokens: 1024,
  system: systemPrompt,
  messages: conversationHistory,
});
```

Note: the tool-calling and streaming code paths documented above are written against OpenAI's function-calling and SSE chunk shapes; a direct-Anthropic port would need to adapt both to Anthropic's native tool-use and streaming event formats, not just swap the client.

---

## Fallback Engine

Both the backend and frontend include keyword-based fallback response generators that activate when:
- No API key is configured
- The LLM API call fails
- The app is running in demo mode

### How It Works (backend, `aria-chat.ts`)

```typescript
function generateFallbackResponse(userMessage: string): string {
  const lower = userMessage.toLowerCase();

  // Pattern match against topic keywords
  if (/^(hi|hello|hey|good morning)/.test(lower)) return greetingResponse();
  if (lower.includes('workout'))    return workoutResponse();
  if (lower.includes('nutrition'))  return nutritionResponse();
  if (lower.includes('sleep'))      return sleepResponse();
  if (lower.includes('stress'))     return mentalHealthResponse();
  if (lower.includes('motivation')) return motivationResponse();
  if (lower.includes('pain'))       return painResponse();
  if (lower.includes('progress'))   return progressResponse();
  if (lower.includes('water'))      return hydrationResponse();
  if (lower.includes('weight'))     return bodyCompResponse();
  if (lower.includes('thank'))      return gratitudeResponse();

  return defaultResponse(); // Encourages user to be more specific
}
```

### Topics Covered (backend — this table was confirmed accurate and is unchanged)

| Topic | Keywords Matched |
|---|---|
| Greetings | hi, hello, hey, good morning/afternoon/evening |
| Training | workout, exercise, training, lift |
| Nutrition | nutrition, diet, eat, food, meal, protein, calories |
| Sleep | sleep, tired, rest, insomnia, nap |
| Mental Health | stress, anxious, anxiety, overwhelm, mental health, mindset |
| Motivation | motivation, motivated, lazy, don't feel like, give up, quit |
| Pain/Injury | pain, hurt, injury, sore, ache |
| Progress | progress, results, plateau, not seeing |
| Hydration | water, hydrat, drink |
| Body Comp | weight, lose, gain, fat, lean |
| Gratitude | thank, thanks, appreciate |

The frontend's demo-mode fallback (`getDemoAriaResponse()` in `chat.tsx`) is a separate, narrower implementation covering only 8 of these 11 topics — see [Layer 4](#layer-4-frontend-components).

Each response is 2-4 paragraphs with bullet-point advice, uses ARIA's tone, and includes a follow-up question to keep the conversation going.

### Why This Matters

ARIA **never fails silently**. Even without an API key or internet connection, users get helpful, domain-appropriate responses. This is critical for:
- Development/testing without burning API credits
- Graceful degradation in production
- Demo environments
- Onboarding new developers who haven't set up API keys yet

Note the topic guardrail filter (see [Topic Guardrails](#topic-guardrails)) runs *before* this fallback logic and before the LLM call, not as part of it — an off-topic message never reaches either the fallback engine or the LLM.

---

## Rate Limiting & Monetization

### How Rate Limiting Works

```
Free users:    3 messages per calendar day (resets at midnight, in the user's own timezone)
Premium users: Unlimited messages
```

Earlier versions of this doc described this as using server time (UTC) for the daily reset — that was never actually accurate to a shipped version; the real implementation is timezone-aware via `getUserMidnight(timezone)` in `aria-chat.ts`:

```typescript
function getUserMidnight(timezone: string): Date {
  const now = new Date();
  const formatter = new Intl.DateTimeFormat('en-US', {
    timeZone: timezone, year: 'numeric', month: '2-digit', day: '2-digit',
  });
  const parts = formatter.formatToParts(now);
  const year = parts.find(p => p.type === 'year')?.value;
  const month = parts.find(p => p.type === 'month')?.value;
  const day = parts.find(p => p.type === 'day')?.value;

  const midnightLocal = new Date(`${year}-${month}-${day}T00:00:00`);
  const midnightUTC = new Date(midnightLocal.toLocaleString('en-US', { timeZone: 'UTC' }));
  const midnightInTZ = new Date(midnightLocal.toLocaleString('en-US', { timeZone: timezone }));
  const offset = midnightUTC.getTime() - midnightInTZ.getTime();

  return new Date(midnightLocal.getTime() + offset);
  // Falls back to server midnight (new Date().setHours(0,0,0,0)) if the
  // timezone string is invalid / the Intl call throws.
}
```

`checkRateLimit()` fetches `profiles.subscription_tier` and `profiles.timezone` in the same query (no extra round-trip), defaults timezone to `'America/New_York'` if unset, computes `todayStart` via `getUserMidnight()`, and counts `aria_messages` where `role = 'user'` and `created_at >= todayStart`.

Rate limiting is checked by counting user-role messages in `aria_messages` where `created_at >= start of today` (in the user's timezone).

The rate limit status is returned with every API response so the frontend can display remaining count and upgrade prompts proactively.

### Monetization Flow

```
User sends message
    |
    v
Count today's messages for this user (timezone-aware "today")
    |
    v
Is user premium?
    |-- Yes -> Process normally, no limit
    |-- No  -> Has user sent < 3 today?
                  |-- Yes -> Process normally, show "X remaining"
                  |-- No  -> Return 429 with upgrade message
```

The frontend handles 429 by:
1. Showing ARIA's rate-limit message in chat
2. Replacing the input area with an "Upgrade" button
3. Disabling the text input

Plan generation has its own, separate monthly monetization rule — see [Plan Generation](#plan-generation-structured-output-mode).

---

## Plan Generation (Structured Output Mode)

**File:** `server/src/routes/plan-generate.ts` (910 lines)

`plan-generate.ts` is actually **two product surfaces sharing one file**: the 4-week `POST /api/plan/generate` AI plan documented here, and an entirely separate 7-day Weekly Wellness Plan system with its own endpoints — see [Weekly Wellness Plan System](#weekly-wellness-plan-system) below. Earlier versions of this doc only covered the first one.

### How the 4-Week Plan Differs from Chat

| Chat Mode | Plan Generation Mode |
|---|---|
| Free-form text output | Strict JSON output |
| `buildAriaSystemPrompt()` | `buildPlanGenerationPrompt()`, optionally with periodization context appended |
| Conversational, warm | Structured, data-dense |
| 2-4 paragraphs | Multi-week plan with exercises, meals, sleep tips, tasks |
| Uses conversation history | Single-shot generation |
| `ARIA_MODEL` / `ARIA_MAX_TOKENS` (default 1024) | `PLAN_MODEL` / `PLAN_MAX_TOKENS` (default 4096) |

### `POST /api/plan/generate` request parameters

```json
{
  "plan_type": "full_program",
  "title": "optional custom title",
  "sport_phase": "optional — one of the 6 SportPhase values, see Sport Periodization",
  "regen_context": {}
}
```

`plan_type` must be one of `full_program`, `workout`, `nutrition`, `recovery`, `mental_wellness`. `sport_phase` was undocumented in earlier versions of this doc — it's optional, validated against `VALID_PHASES`, and when present appends a periodization context block to the prompt (see [Sport Periodization](#sport-periodization)).

### Free-tier monthly rate limit (undocumented monetization rule)

Free-tier users are capped at **1 AI-generated 4-week plan per calendar month**, counted from `ai_generated_plans` rows where `generated_at >= start of this month` (server month boundary, not timezone-aware like chat's rate limiter). A free user who has already generated a plan this month gets a 429 with `"Free accounts can generate 1 AI plan per month. Upgrade to Premium for unlimited plans."` This limit did not exist anywhere in earlier versions of this doc.

### Plan JSON Structure

```json
{
  "overview": "A 2-3 sentence personalized summary",
  "aria_message": "A warm, personal message from ARIA",
  "weeks": [
    {
      "week": 1,
      "theme": "Foundation / Building Blocks",
      "fitness": {
        "sessions": 3,
        "duration_min": 30,
        "focus": "What this week targets",
        "workouts": [
          {
            "day": "Monday",
            "title": "Upper Body Foundations",
            "warmup": "5 min dynamic stretching...",
            "exercises": [
              { "name": "Push-ups", "sets": 3, "reps": "8-10", "rest": "60s", "notes": "Modify on knees if needed" }
            ],
            "cooldown": "5 min static stretching",
            "adaptive_notes": "Condition-specific modifications"
          }
        ]
      },
      "nutrition": {
        "daily_calories": 2000,
        "protein_g": 120,
        "focus": "This week's nutrition focus",
        "meal_ideas": [
          { "meal": "Breakfast", "suggestion": "Greek yogurt with mixed berries" }
        ],
        "hydration_cups": 8
      },
      "sleep": {
        "target_hours": 7.5,
        "focus": "This week's sleep focus",
        "tips": ["No screens 1 hour before bed"]
      },
      "mindset": {
        "focus": "This week's mindset theme",
        "daily_practice": "5 min morning breathing",
        "weekly_reflection": "Journal about what motivates you"
      },
      "daily_tasks": [
        { "day": 1, "task": "Complete your first workout", "pillar": "move", "xp": 25 }
      ]
    }
  ]
}
```

If the model call fails or no API key is configured, `generateFallbackPlan()` produces a rule-based 4-week plan keyed off fitness level (beginner/intermediate/advanced), days/week, and goals — same shape as the AI output, less personalized.

### Key Constraints in Plan Generation

- Respects ALL health conditions — never includes contraindicated exercises; defers to the reviewed exercise-modification guidance where it exists (see [Exercise Modification & Safety System](#exercise-modification--safety-system))
- Uses preferred training styles when possible
- Matches fitness level (beginner/intermediate/advanced)
- Fits user's schedule (days per week, minutes per session)
- Progressive difficulty (Week 1 easiest, Week 4 hardest)
- Honors diet framework (halal, keto, plant-based, etc.)
- Personalizes sleep tips to user's wake/bed times

---

## Sport Periodization

**File:** `server/src/utils/periodization.ts` (143 lines)

Not documented at all in earlier versions of this doc. This is a real, standalone subsystem (referencing standard periodization models — Bompa, Issurin, per the file's own comment) that adjusts plan generation based on where the user is in a competitive training cycle.

### 6 phases, each with volume/intensity multipliers and 4 emphasis dimensions

```typescript
type SportPhase =
  | 'off_season' | 'pre_season' | 'in_season'
  | 'post_season' | 'competition' | 'transition';
```

Each phase has a `volumeMultiplier` and `intensityMultiplier` (both roughly 0.5-1.5x), plus four 0-1 emphasis dimensions — `strengthEmphasis`, `conditioningEmphasis`, `skillEmphasis`, `recoveryEmphasis` — along with a `nutritionFocus` string and free-text `trainingNotes`. For example, `in_season` drops volume to 0.7x and pushes intensity to 1.2x, shifts emphasis heavily toward skill (0.9) and recovery (0.8) and away from strength (0.4), with training notes explicitly warning against introducing new exercises mid-season. `competition` (taper week) drops volume to 0.5x, pushes skill and recovery emphasis to 1.0, and reprioritizes nutrition toward carb-loading and hydration.

### How it's triggered

`plan-generate.ts`'s `POST /api/plan/generate` accepts an optional `sport_phase` body param (validated against `VALID_PHASES`). When present, `buildPeriodizationContext(sport, phase)` appends a `## SPORT PERIODIZATION CONTEXT` block to the plan prompt, rendering the phase's multipliers, emphasis percentages, nutrition focus, and training notes, with an instruction that the plan's volume/intensity/exercise selection should reflect them.

### ⚠️ Undocumented default — flagged, not resolved

```typescript
export function getPeriodizationModifiers(phase: SportPhase): PeriodizationModifiers {
  const config = PHASE_CONFIGS[phase] || PHASE_CONFIGS.transition;
  return { phase, ...config };
}
```

Any phase value that isn't recognized silently falls back to `PHASE_CONFIGS.transition`. In practice this specific fallback is hard to hit from the API, since `plan-generate.ts` validates `sport_phase` against `VALID_PHASES` before ever calling into this function and rejects invalid values with a 400 — but `getPeriodizationModifiers()` and `buildPeriodizationContext()` are exported and usable independently of that validation, and nothing in the code or in any prior version of this doc documents `transition` as the intended default phase for an unspecified or unrecognized value. This is an undocumented decision baked into the code, not a deliberately chosen default — flag it for whoever next extends this subsystem (e.g. adds a caller that doesn't route through the validated endpoint) rather than treating "it falls back to transition" as settled, reviewed behavior.

---

## Weekly Wellness Plan System

**File:** `server/src/routes/plan-generate.ts` (same file as the 4-week plan system, different endpoints)

Entirely undocumented in earlier versions of this doc. This is a **second, separate product surface** from the 4-week AI plan — a rolling 7-day plan across four pillars (**Move / Eat / Rest / Mind**), with its own generator, its own fallback engine, and its own storage table (`weekly_wellness_plans`). Don't conflate it with the 4-week `ai_generated_plans` / `thirty_day_plans` system documented above — they're generated by different prompts, stored in different tables, and surfaced through different endpoints.

### Endpoints

| Method | Path | Purpose |
|---|---|---|
| `GET` | `/api/plan/weekly` | Fetch the current active weekly plan (or `{ data: null }` if none) |
| `POST` | `/api/plan/weekly/generate` | Generate (and activate) a new 7-day plan, deactivating any prior active one |
| `PATCH` | `/api/plan/weekly/complete` | Toggle (or explicitly set) completion of one plan item by `item_id` |
| `GET` | `/api/plan/weekly/today` | Fetch just today's slice of the plan plus completion state (used to power ARIA nudges / context injection) |

### Generation

`POST /api/plan/weekly/generate` accepts an optional `weekend_preference` (`'lighter' | 'same' | 'heavier'`, default `'lighter'`). It builds a fresh `AriaUserContext`, calls the LLM with `buildWeeklyPlanPrompt()` (a distinct prompt builder from both `buildAriaSystemPrompt()` and `buildPlanGenerationPrompt()`) using the same `PLAN_MODEL`/`PLAN_MAX_TOKENS` env vars as the 4-week system, and on failure or no API key falls back to `generateFallbackWeeklyPlan()` — a rule-based generator that distributes training days across the week according to `weekend_preference`, picks from a small library of workout templates/meal suggestions/mind activities, and adjusts intensity down for the day after a high-RPE (≥8) last workout.

The prompt explicitly folds in recovery awareness (references the user's last workout RPE and this week's workout count so far) and the same reviewed exercise-modification deference language used elsewhere ("use ONLY that guidance... for a condition that guidance covers").

Each generated plan is saved to `weekly_wellness_plans` with a computed `week_start` (Monday) / `week_end` (Sunday), `plan_data` (the full JSON), an empty `completed_items` map, and `is_active: true` — prior active plans for the user are deactivated first.

### Weekly plan JSON shape (abbreviated)

```json
{
  "overview": "2-3 sentence plan summary",
  "aria_message": "Warm personal message from ARIA about this week's plan",
  "weekly_targets": {
    "workouts": 4, "calories_avg": 2000, "protein_avg_g": 120,
    "sleep_hours": 7.5, "hydration_cups": 8, "mindfulness_minutes": 10
  },
  "days": [
    {
      "day_name": "Monday", "day_number": 1, "theme": "Upper Body Power", "is_rest_day": false,
      "move": { "type": "strength", "title": "...", "duration_min": 30, "intensity": 7, "exercises": [ /* ... */ ], "warmup": "...", "cooldown": "..." },
      "eat": { "calories": 2000, "protein_g": 120, "carbs_g": 250, "fat_g": 65, "hydration_cups": 8, "meal_suggestion": { "meal": "Lunch", "idea": "..." } },
      "rest": { "bedtime": "10:30 PM", "wake_time": "6:30 AM", "sleep_hours": 8, "recovery_activity": null },
      "mind": { "type": "breathwork", "title": "Box Breathing", "duration_min": 5, "description": "...", "journal_prompt": "..." }
    }
  ]
}
```

### How this feeds back into ARIA chat

`aria-context.ts` reads the active `weekly_wellness_plans` row and computes today's item completion and overall weekly completion percentage in-process (see the `weeklyPlan` field on `AriaUserContext`, documented in [Layer 1](#layer-1-context-engine)). That summary is injected into the chat system prompt as a "Weekly Plan: XX% complete | Today: ..." line, so ARIA can reference weekly-plan progress in normal conversation even though it's a completely separate system from the 4-week plan.

### Monetization

Unlike the 4-week plan, weekly plan generation is **not** currently rate-limited by subscription tier in the code read for this revision — the monthly cap described above applies only to `POST /api/plan/generate` (the 4-week system).

---

## Making ARIA Cross-Project

ARIA's architecture is inherently portable. Here's the blueprint for extracting her into a reusable system that works across multiple apps.

### The Core Insight

ARIA is three things:
1. **A pattern** — gather context, inject into personality prompt, call LLM, persist history, degrade gracefully
2. **A personality** — the EASE philosophy, the coaching tone, the behavioral rules
3. **A context shape** — the specific data points she knows about the user

Items 1 and 2 are **universal**. Item 3 is **app-specific**. This is where you split.

### ⚠️ Open Design Question — not resolved by this doc

The three-way split above (universal pattern / universal personality / app-specific context) predates tool use, guardrails, sentiment detection, and long-term memory being built. All four are real, shipped subsystems today (see the sections above), but **all four are currently implemented as fitness-app-coupled code** — the tool definitions are fitness data operations, the guardrail redirect copy is fitness-flavored, the memory summarization prompt is written for a wellness AI, and none of the four were ever explicitly assigned to either the "universal" or "app-specific" bucket in a design discussion.

Plausible arguments exist for putting each of them on either side: tool-calling *as a mechanism* (define tools, execute, feed results back) looks universal, but *which* tools exist is obviously app-specific — same tension applies to guardrails (the pre-LLM filter pattern vs. the fitness-specific topic list and redirect copy), sentiment (the detector itself is domain-agnostic text analysis; the prompt injection it produces isn't), and memory (summarization mechanics are generic; the extraction prompt is wellness-specific).

**This rewrite deliberately does not decide this.** Categorizing these four subsystems is a real design decision for whoever scopes the next adapter package (`@aria/core` vs. `@aria/adapter-fitness`), and it should be made deliberately, not inherited by default from wherever the code happens to live today. Flag it explicitly in that scoping conversation rather than assuming the existing file layout already reflects the right split.

### Proposed Package Structure

```
@aria/core/                          # Universal — shared across all apps
├── types.ts                         # Generic interfaces
├── personality.ts                   # EASE philosophy, tone rules, base prompt sections
├── chat-engine.ts                   # LLM call orchestration, history management
├── rate-limiter.ts                  # Tier-based daily limits (timezone-aware)
├── fallback-engine.ts               # Base class for keyword fallback responses
└── index.ts

@aria/adapter-fitness/               # My Body Fitness App adapter
├── context-provider.ts              # buildAriaContext() for fitness data
├── prompt-config.ts                 # Fitness expertise, health rules, data injection
├── fallback-responses.ts            # Workout/nutrition/sleep keyword responses
├── tools.ts                         # log_water / log_mood / get_* fitness tools — see Open Design Question above
├── guardrails.ts                    # Fitness-flavored off-topic categories & redirects
└── index.ts

@aria/adapter-meditation/            # Hypothetical meditation app adapter
├── context-provider.ts              # buildAriaContext() for meditation data
├── prompt-config.ts                 # Meditation expertise, mindfulness rules
├── fallback-responses.ts            # Meditation/stress/breathing responses
└── index.ts

@aria/adapter-productivity/          # Hypothetical productivity app adapter
├── context-provider.ts              # buildAriaContext() for task/habit data
├── prompt-config.ts                 # Productivity expertise, focus rules
├── fallback-responses.ts            # Habits/goals/focus keyword responses
└── index.ts
```

### Key Abstractions

#### Generic Context Provider

```typescript
// @aria/core/types.ts

interface AriaContextProvider<TContext> {
  /** Gather all user data into a typed context object */
  buildContext(userId: string): Promise<TContext>;

  /** Get cached context if fresh, otherwise rebuild */
  getCachedContext(userId: string): Promise<TContext | null>;

  /** Save context to cache */
  cacheContext(userId: string, context: TContext, ttlMs?: number): Promise<void>;

  /** Invalidate cached context — call from any data-writing route */
  invalidateContext(userId: string): Promise<void>;
}
```

#### Generic Prompt Builder

```typescript
// @aria/core/types.ts

interface AriaPromptConfig<TContext> {
  /** App-specific expertise domains */
  expertise: string[];

  /** App-specific behavioral rules */
  rules: string[];

  /** Transform context into prompt sections */
  injectContext(context: TContext): string;

  /** Optional: structured output prompts */
  structuredPrompts?: Record<string, (context: TContext) => string>;
}
```

#### Shared Personality Core

```typescript
// @aria/core/personality.ts

const ARIA_PERSONALITY = `
You are ARIA (Adaptive Rhythm Intelligence Assistant).
You are warm, knowledgeable, encouraging, and culturally aware.

## YOUR PERSONALITY
- Speak like a supportive coach who genuinely cares
- Use the user's name naturally
- Adapt your tone to their current state
- Celebrate every win — even small ones
- Normalize struggles
- Be honest but kind
- Keep responses concise: 2-4 paragraphs
- End with an actionable next step

## YOUR PHILOSOPHY (EASE)
- Empathy: Meet every person where they are
- Authenticity: Be real
- Simplicity: Clear, actionable guidance
- Equity: Honor all backgrounds and starting points
`;

// This stays the same across ALL apps.
// What changes per app: expertise, rules, context injection —
// and (per the Open Design Question above) possibly tools, guardrails,
// sentiment prompt copy, and memory extraction prompts too.
```

#### Usage in a New App

```typescript
import { AriaEngine } from '@aria/core';
import { MeditationContextProvider, meditationPromptConfig } from '@aria/adapter-meditation';

const aria = new AriaEngine({
  contextProvider: new MeditationContextProvider(supabase),
  promptConfig: meditationPromptConfig,
  llm: {
    provider: 'openrouter',  // or 'anthropic', 'openai'
    model: 'anthropic/claude-sonnet-4',
    maxTokens: 1024,
    apiKey: process.env.OPENROUTER_API_KEY,
  },
  rateLimit: {
    free: 3,       // messages per day
    premium: null, // unlimited
  },
});

// Mount on your router
app.use('/api/aria', aria.router());
```

### What Stays the Same Across Apps

- ARIA's core personality (warm coach, EASE philosophy)
- Chat history schema (`aria_messages`)
- Context caching schema (`aria_context`)
- Rate limiting logic (timezone-aware daily reset)
- Fallback engine pattern
- Conversation history management (last N messages)
- LLM provider abstraction
- Graceful degradation behavior

### What Changes Per App

| Component | Fitness App | Meditation App | Productivity App |
|---|---|---|---|
| Context fields | workouts, sleep, nutrition, RPE | sessions, streaks, techniques, emotions | tasks, habits, focus time, goals |
| Expertise | training, nutrition, sleep, recovery | mindfulness, breathwork, meditation styles | time management, habit science, deep work |
| Hard rules | No medical advice, respect conditions | No therapy replacement, trauma-aware | No financial advice, respect work-life balance |
| Fallback topics | workout, diet, sleep, pain, motivation | stress, breathing, focus, sleep, anxiety | productivity, procrastination, habits, goals |
| Structured outputs | 4-week + weekly wellness plans | Meditation programs, breathing sequences | Weekly focus plans, habit stacks |
| Gamification | XP, levels, badges, streaks | Mindfulness minutes, consistency, depth | Productivity score, focus chains |

---

## Integration Checklist for a New App

1. **Define your context interface** — What does ARIA need to know about your users? List every data point that would make her responses personal rather than generic.

2. **Implement `buildContext()`** — Write the parallel database queries that gather that data. Use `Promise.all()` for speed.

3. **Write your system prompt** — Start with the shared personality. Add your domain expertise, your rules, and your context injection template.

4. **Write fallback responses** — Identify 8-12 common topics your users will ask about. Write helpful keyword-matched responses for each.

5. **Create the database tables:**
   ```sql
   CREATE TABLE aria_messages (
     id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
     user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
     role text NOT NULL CHECK (role IN ('user', 'aria')),
     content text NOT NULL,
     tokens_used integer DEFAULT 0,
     created_at timestamptz DEFAULT now()
   );

   CREATE TABLE aria_context (
     id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
     user_id uuid NOT NULL UNIQUE REFERENCES users(id) ON DELETE CASCADE,
     context_data jsonb NOT NULL DEFAULT '{}',
     last_updated timestamptz DEFAULT now()
   );
   ```
   Add RLS policies so users only see their own data. If you're porting the long-term memory or feedback subsystems too, also add `aria_memory` and `aria_feedback` — see [Database Schema](#database-schema) for their real column usage.

6. **Mount the chat router** — Wire up all 8 endpoints (messages, remaining, message, message/stream, feedback, memories, refresh-context, delete) — not just the original 5. Decide up front whether you're porting tool use, guardrails, sentiment, and memory, or starting without them (see the Open Design Question above).

7. **Set environment variables:**
   ```bash
   OPENROUTER_API_KEY=your_key
   ARIA_MODEL=anthropic/claude-sonnet-4   # optional
   ARIA_MAX_TOKENS=1024                    # optional
   PLAN_MODEL=anthropic/claude-sonnet-4    # optional, if porting structured plan generation
   PLAN_MAX_TOKENS=4096                    # optional
   ```

8. **Build a chat UI** — Or adapt the existing React component. Key features: message list, input, typing indicator, streaming, feedback buttons, rate limit display, demo mode fallback.

9. **Test without an API key first** — Verify the fallback engine works. Then add your key and test real responses.

10. **Configure rate limits** — Decide on free vs premium message counts, and whether to make the reset timezone-aware from day one (retrofitting it later, as this app did, leaves a period where it's UTC-only).

---

## File Map

### Backend (server/) — 12 files, ~4,406 lines total (was previously undercounted as "~1,400 lines across 6 files")

| File | Purpose | Lines |
|---|---|---|
| `src/utils/aria-context.ts` | Context engine — 19 parallel queries, caching, level naming, weekly-plan summary computation | 449 |
| `src/utils/aria-system-prompt.ts` | System prompt builder — personality, 14 hard rules, tool/memory/sentiment/vision injection | 265 |
| `src/routes/aria-chat.ts` | Chat API router — all 8 endpoints, timezone rate limiting, guardrails, tool loop, memory trigger | 767 |
| `src/routes/plan-generate.ts` | Two product surfaces: 4-week AI plan generation + the Weekly Wellness Plan system | 910 |
| `src/utils/aria-tools.ts` | Tool definitions (`ARIA_TOOLS`) and server-side tool executor (8 tools) | 312 |
| `src/utils/aria-guardrails.ts` | Pre-LLM topic guardrail filter (7 off-topic categories) | 68 |
| `src/utils/aria-sentiment.ts` | Rule-based sentiment/energy/intent detector + prompt-hint builder | 91 |
| `src/utils/aria-memory.ts` | Fire-and-forget long-term memory summarization + retrieval | 166 |
| `src/utils/exercise-modifications.ts` | Curated exercise-safety modification lookup + prompt rendering | 94 |
| `src/utils/periodization.ts` | 6-phase sport periodization modifiers for plan generation | 143 |

### Frontend (client/)

| File | Purpose | Lines |
|---|---|---|
| `src/pages/aria/chat.tsx` | Full chat page — dual mode (API/demo), streaming, feedback, image upload, markdown, rate limits | 849 |
| `src/components/aria-briefing.tsx` | Dashboard briefing widget — rule-based, no API | 292 |

### Database (server/supabase/migrations/)

| Migration | Tables |
|---|---|
| `003_sprint3_tables.sql` | `aria_messages` |
| `005_encyclopedia_and_ai.sql` | `aria_context`, tokens_used column |
| *(not in ground-truth source set)* | `aria_memory`, `aria_feedback`, `exercise_modifications`, `hydration_logs`, `weekly_wellness_plans`, `ai_generated_plans`, `personal_records` — real tables in active use; see [Database Schema](#database-schema) for what's verified about each |

### Routes

| Type | Path |
|---|---|
| Client route | `/aria` -> `AriaChatPage` |
| Server mount | `/api/aria` -> `aria-chat.ts` router (8 endpoints) |
| Server mount | `/api/plan` -> `plan-generate.ts` router (4-week plan + weekly wellness plan endpoints) |

---

## Remaining Gaps & Open Items

Earlier versions of this doc framed 9 of the following 10 items as unbuilt future work with priority levels and time estimates. Two independent audits against the real source confirmed all but one are already shipped. This section replaces that roadmap with an honest accounting of what's actually still open.

### Genuinely unbuilt: Proactive Outreach / Nudges

ARIA is still entirely reactive — she only responds when a user opens the chat and sends a message. There is no scheduled job that reaches out about a streak about to break, several days of inactivity, or a declining sleep trend. `GET /api/plan/weekly/today` exists and is commented as "used by ARIA nudges," which suggests this was planned, but no cron job, notification table, or delivery mechanism was found in the source reviewed for this revision. If this is built, the original proposal (a `aria_nudges` table, a daily cron scanning `buildAriaContext()` output for streak/inactivity/sleep-decline/milestone triggers, delivered via dashboard badge / notification center / push / email) is still a reasonable starting design — but treat it as a fresh design exercise, not something partially built already.

### Partially wired, not fully missing or fully done: context invalidation

`invalidateAriaContext()` is real and correctly bumps `profiles.aria_data_version`, but is only called after `log_water` / `log_mood` tool calls. No other data-writing route (workout logging, meal logging, sleep logging, health-profile updates, XP gain, daily-action completion) calls it — those all still depend on the 1-hour TTL alone. See [Layer 1: Context Engine](#layer-1-context-engine) for the full detail.

### One item resolved, one still flagged-not-resolved

- **Exercise modification condition-ID matching** ([full detail](#exercise-modification--safety-system)): previously flagged here as a possible bug. **Resolved (2026-08-21), verified against the actual write path**: `onboarding/index.tsx` and `health-profile.tsx` both populate `health_profiles.conditions` exclusively through `EncyclopediaSelect(type="condition")`, hard-filtered to the "Adaptive Training" category, whose entries all carry `adaptive-`-prefixed `id`s that get written on selection. Real stored values are genuinely `adaptive-*` slugs, matching `VALID_CONDITION_ID` by design — the mechanism behind Hard Rule 2 works correctly in production. This document's own plain-string illustration (`"diabetes"`, `"arthritis"`) was the actual bug, not the code — corrected above.
- **Sport phase fallback default** ([full detail](#sport-periodization)) — still open: `getPeriodizationModifiers()` silently falls back to `'transition'` for any unrecognized `SportPhase`. The API route guards against this today via `VALID_PHASES` validation, but the fallback itself was never a deliberate, documented design decision — anyone calling the periodization functions outside that validated route would hit it unknowingly.

### Open design question carried from earlier section

- **Universal vs. app-specific categorization of tool use, guardrails, sentiment, and memory** ([full detail](#making-aria-cross-project)) — genuinely undecided, not something this rewrite resolves.

---

## Summary

ARIA is **~4,406 lines of TypeScript across 12 files** (not the ~1,400 lines across 6 files claimed by earlier versions of this doc — that figure covered only the context engine, prompt builder, chat router, plan generator, chat page, and briefing widget, and missed the entire tool-use, guardrails, sentiment, memory, exercise-modification, and periodization subsystems, plus the Weekly Wellness Plan surface layered into `plan-generate.ts`). She is not a framework — she is a **pattern**:

> **Gather context -> Inject into personality prompt (with tool/memory/sentiment/safety signals) -> Call LLM, letting her use tools if needed -> Persist history + long-term memory -> Degrade gracefully**

That pattern is domain-agnostic. The fitness-specific parts (what data to gather, what expertise to claim, what topics to fall back on, which tools exist, what the guardrail redirects say) are — today — bundled together with the universal parts (personality, caching, rate limiting, history management, LLM orchestration) rather than cleanly separated; see the Open Design Question in [Making ARIA Cross-Project](#making-aria-cross-project) for what still needs deciding before that separation is real.

To put ARIA in a new app, you don't fork the code — you implement the same pattern with your domain's context, expertise, rules, tools, and guardrails. What's actually shipped today is considerably more capable than earlier versions of this doc credited: tool use, streaming, long-term memory, response feedback, sentiment-aware prompting, topic guardrailing, and image/vision support are all real and running in production, not aspirational. The one substantive gap that remains is proactive nudges — everything else in the old "roadmap" was already built.
