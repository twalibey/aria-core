# ARIA — Adaptive Rhythm Intelligence Assistant

## Developer Reference & Integration Guide

---

## Table of Contents

1. [What Is ARIA](#what-is-aria)
2. [Name & Philosophy](#name--philosophy)
3. [Architecture Overview](#architecture-overview)
4. [Layer 1: Context Engine](#layer-1-context-engine)
5. [Layer 2: System Prompt Builder](#layer-2-system-prompt-builder)
6. [Layer 3: Chat Router (API)](#layer-3-chat-router-api)
7. [Layer 4: Frontend Components](#layer-4-frontend-components)
8. [Database Schema](#database-schema)
9. [LLM Integration](#llm-integration)
10. [Fallback Engine](#fallback-engine)
11. [Rate Limiting & Monetization](#rate-limiting--monetization)
12. [Plan Generation (Structured Output Mode)](#plan-generation-structured-output-mode)
13. [Making ARIA Cross-Project](#making-aria-cross-project)
14. [Integration Checklist for a New App](#integration-checklist-for-a-new-app)
15. [File Map](#file-map)
16. [Improvements Roadmap](#improvements-roadmap)

---

## What Is ARIA

ARIA is a **context-aware AI assistant framework** — a personality layer + user context engine that sits between your app's data and a Large Language Model (LLM). She is not a generic chatbot. She is a domain-specific AI companion that knows who she's talking to, what they've done, and what they need, because she pulls all of that from your database before every conversation.

What makes ARIA different from "just calling an API":

| Generic API Call | ARIA |
|---|---|
| Sends user message to LLM | Sends user message + full user context + personality rules + conversation history to LLM |
| Gets generic response | Gets response that references user's actual data (sleep scores, streak, conditions) |
| Fails if API is down | Falls back to rule-based responses — never leaves the user hanging |
| No access control | Built-in rate limiting with free/premium tiers |
| Stateless | Maintains persistent chat history and cached user context |
| No guardrails | Hard rules: no medical advice, respect health conditions, respect dietary choices |

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
- Adapts tone to the user's current state (stressed -> calming, energized -> match energy)
- Celebrates every win — even small ones
- Normalizes struggles — everyone has hard days
- Honest but kind — doesn't sugarcoat, but isn't harsh
- Uses encouraging language: "you've got this", "great question", "let's figure this out together"
- Never breaks character — she is ARIA, not a generic AI

---

## Architecture Overview

ARIA is built as four decoupled layers. Each can be extracted, modified, or replaced independently.

```
+------------------------------------------------------------------+
|                        FRONTEND (React)                          |
|                                                                  |
|  +---------------------------+  +-----------------------------+  |
|  |   AriaBriefing Component  |  |    AriaChatPage Component   |  |
|  |   (Dashboard Widget)      |  |    (Full Chat Interface)    |  |
|  |                           |  |                             |  |
|  |  - Rule-based generation  |  |  - Message history          |  |
|  |  - No API call needed     |  |  - Real-time chat           |  |
|  |  - Sleep/workout/meal     |  |  - Typing indicator         |  |
|  |    insights               |  |  - Rate limit banner        |  |
|  |  - Streak tracking        |  |  - Demo mode fallback       |  |
|  |  - Goal references        |  |  - Markdown rendering       |  |
|  +---------------------------+  +-----------------------------+  |
|                                          |                       |
+------------------------------------------|-----------------------+
                                           | HTTP (Bearer token)
+------------------------------------------|-----------------------+
|                        BACKEND (Express)  |                      |
|                                           v                      |
|  +----------------------------------------------------------+   |
|  |              Layer 3: Chat Router (aria-chat.ts)          |   |
|  |                                                          |   |
|  |  GET  /api/aria/messages        Paginated chat history   |   |
|  |  GET  /api/aria/remaining       Rate limit check         |   |
|  |  POST /api/aria/message         Send + receive response  |   |
|  |  POST /api/aria/refresh-context Force context rebuild    |   |
|  |  DELETE /api/aria/messages      Clear history            |   |
|  +----+------------------------------------------+----------+   |
|       |                                          |               |
|       v                                          v               |
|  +-------------------------+  +------------------------------+   |
|  | Layer 1: Context Engine |  | Layer 2: System Prompt       |   |
|  | (aria-context.ts)       |  | Builder                      |   |
|  |                         |  | (aria-system-prompt.ts)      |   |
|  | - 17+ parallel queries  |  |                              |   |
|  | - AriaUserContext type  |  | - buildAriaSystemPrompt()    |   |
|  | - 1-hour cache (JSONB)  |  | - buildPlanGenerationPrompt()|   |
|  | - Level naming system   |  | - Personality + rules        |   |
|  +------------+------------+  | - User data injection        |   |
|               |               +------------------------------+   |
|               v                                                  |
|  +----------------------------------------------------------+   |
|  |                    Supabase (PostgreSQL)                  |   |
|  |                                                          |   |
|  |  aria_messages   - Chat history with RLS                 |   |
|  |  aria_context    - Cached user context (JSONB)           |   |
|  |  profiles        - User profile data                     |   |
|  |  health_profiles - Conditions, limitations, allergies    |   |
|  |  assessments     - Goals, schedule, preferences          |   |
|  |  workout_logs    - Exercise history                      |   |
|  |  nutrition_logs  - Meal tracking                         |   |
|  |  sleep_logs      - Sleep data                            |   |
|  |  mood_logs       - Mood/energy/stress                    |   |
|  |  gamification    - XP, level, badges, streaks            |   |
|  |  + 8 more tables...                                      |   |
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

---

## Layer 1: Context Engine

**File:** `server/src/utils/aria-context.ts`

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
    conditions: string[];        // e.g. ["diabetes", "arthritis"]
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
    has_active_plan: boolean;
    current_week: number;       // 1-4
    tasks_completed: number;
    total_tasks: number;
  };

  dailyActions: {
    actions: { pillar: string; title: string; completed: boolean }[];
    completedCount: number;
  };
}
```

### How Context Building Works

1. **17+ database queries run in parallel** via `Promise.all()` for speed
2. Each query fetches one slice of user data (profile, health, last workout, weekly stats, etc.)
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

- **Parallel queries:** All 17+ queries run simultaneously. This is critical — running them sequentially would mean ~2-3 seconds of latency; parallel runs complete in ~200-400ms.
- **Caching with TTL:** Rebuilding context on every message would be wasteful. The 1-hour TTL balances freshness with performance.
- **Graceful defaults:** Every field has a fallback value. If a user hasn't completed onboarding, ARIA still works — she just has less data to reference.
- **JSONB storage:** The cached context is stored as JSONB, not normalized tables. This makes reads fast and avoids complex joins for a cache.

---

## Layer 2: System Prompt Builder

**File:** `server/src/utils/aria-system-prompt.ts`

This is ARIA's personality and instruction set. A pure function that takes an `AriaUserContext` and returns a string that becomes the LLM's system prompt.

### buildAriaSystemPrompt(context)

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

#### 4. User Data Injection
Real user data is interpolated directly into the prompt:

```
### Profile
- Name: ${profile.name}
- Member since: ${new Date(profile.member_since).toLocaleDateString()}
- Subscription: ${profile.subscription_tier}

### Health
- Fitness Level: ${health.fitness_level}
- Conditions: ${health.conditions.join(', ')}
- Limitations: ${health.limitations.join(', ')}
...

### Recent Activity
- Last Workout: "${recentActivity.lastWorkout.title}" on ... (RPE: .../10)
- Last Sleep: ...h, quality .../10, score .../100
- This Week: ... workouts, avg ...h sleep, avg mood .../5

### Progress
- Level: ... (...) — ... XP
- Current Streak: ... days
```

This is what enables responses like "Your sleep score was 62 last night — let's look at why" rather than generic "try to sleep more."

#### 5. Behavioral Rules (12 Hard Rules)

1. NEVER give specific medical advice — redirect to doctor
2. ALWAYS respect health conditions — never recommend contraindicated exercises
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

### buildPlanGenerationPrompt(context, planType)

A second prompt builder for structured JSON output. Same context, different instructions:

- Generates 4-week periodized plans
- Returns strict JSON format with weeks, workouts, nutrition, sleep, mindset, daily tasks
- Each workout has specific exercises, sets, reps, rest periods
- Includes adaptive notes for health conditions
- Respects diet framework, fitness level, schedule constraints

**Plan types:** `full_program`, `workout`, `nutrition`, `recovery`, `mental_wellness`

---

## Layer 3: Chat Router (API)

**File:** `server/src/routes/aria-chat.ts`
**Mount point:** `/api/aria`

All routes require authentication via `verifyToken` middleware.

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

The core endpoint. This is the full flow:

```
User message
    |
    v
[1] Rate limit check (free=3/day, premium=unlimited)
    |
    v
[2] Save user message to aria_messages
    |
    v
[3] Load last 20 messages as conversation history
    |
    v
[4] Get or build user context (cached 1hr)
    |
    v
[5] Build system prompt with injected context
    |
    v
[6] Call LLM (OpenRouter -> Claude)
    |   |
    |   +-- On failure: use fallback response generator
    |
    v
[7] Save ARIA response to aria_messages
    |
    v
[8] Return both messages + rate limit status
```

**Request:**
```json
{
  "content": "What should I eat before my workout tomorrow?"
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

## Layer 4: Frontend Components

### AriaChatPage (`client/src/pages/aria/chat.tsx`)

Full-screen chat interface at route `/aria`.

**Features:**
- **Dual mode:** API mode (authenticated) or Demo mode (localStorage-based, no API needed)
- **Message rendering:** Custom markdown renderer (bold text, bullet lists, paragraphs)
- **Typing indicator:** Animated bouncing dots with "ARIA is thinking" label
- **Rate limit banner:** Shows remaining messages for free users, with "Go Premium" CTA
- **Rate limit lockout:** When limit is hit, input is replaced with upgrade prompt
- **Time-aware welcome:** "Good morning/afternoon/evening, {name}!" with personality
- **Chat controls:** Clear history, back navigation
- **Keyboard:** Enter to send, Shift+Enter preserved for newline
- **Auto-scroll:** Scrolls to bottom on new messages

**Component Architecture:**
```
AriaChatPage
├── Header (back button, ARIA avatar, "AI Powered" badge, clear button)
├── Rate Limit Banner (conditional)
├── Messages Area (scrollable)
│   ├── ChatMessage (user) — coral bubble, right-aligned
│   ├── ChatMessage (aria) — sandy bubble, left-aligned, markdown rendered
│   └── Typing Indicator (conditional)
└── Input Area
    ├── Text Input (or rate limit lockout)
    └── Send Button
```

**Demo Mode:**

When Supabase isn't configured (`isDemoMode`), ARIA runs entirely client-side:
- Messages stored in `localStorage` under key `mybody_aria_chat`
- Responses generated by `getDemoAriaResponse()` — keyword-based matching
- Simulated typing delay (800-2000ms random)
- No rate limiting

### AriaBriefing (`client/src/components/aria-briefing.tsx`)

Dashboard widget that shows a daily snapshot. Runs **entirely on rule-based logic** — no LLM API call.

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
  messages: [
    { role: 'system', content: systemPrompt },
    ...conversationHistory,
  ],
});
```

### Environment Variables

```bash
# Required for AI-powered responses
OPENROUTER_API_KEY=your_openrouter_api_key

# Optional (defaults shown)
ARIA_MODEL=anthropic/claude-sonnet-4
ARIA_MAX_TOKENS=1024
```

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

---

## Fallback Engine

Both the backend and frontend include keyword-based fallback response generators that activate when:
- No API key is configured
- The LLM API call fails
- The app is running in demo mode

### How It Works

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

### Topics Covered

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

Each response is 2-4 paragraphs with bullet-point advice, uses ARIA's tone, and includes a follow-up question to keep the conversation going.

### Why This Matters

ARIA **never fails silently**. Even without an API key or internet connection, users get helpful, domain-appropriate responses. This is critical for:
- Development/testing without burning API credits
- Graceful degradation in production
- Demo environments
- Onboarding new developers who haven't set up API keys yet

---

## Rate Limiting & Monetization

### How Rate Limiting Works

```
Free users:    3 messages per calendar day (resets at midnight)
Premium users: Unlimited messages
```

Rate limiting is checked by counting user-role messages in `aria_messages` where `created_at >= start of today`.

The rate limit status is returned with every API response so the frontend can display remaining count and upgrade prompts proactively.

### Monetization Flow

```
User sends message
    |
    v
Count today's messages for this user
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

---

## Plan Generation (Structured Output Mode)

**File:** `server/src/routes/plan-generate.ts`

ARIA's context engine powers a second use case: generating structured 4-week wellness plans as JSON.

### How It Differs from Chat

| Chat Mode | Plan Generation Mode |
|---|---|
| Free-form text output | Strict JSON output |
| `buildAriaSystemPrompt()` | `buildPlanGenerationPrompt()` |
| Conversational, warm | Structured, data-dense |
| 2-4 paragraphs | Multi-week plan with exercises, meals, sleep tips, tasks |
| Uses conversation history | Single-shot generation |

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

### Key Constraints in Plan Generation

- Respects ALL health conditions — never includes contraindicated exercises
- Uses preferred training styles when possible
- Matches fitness level (beginner/intermediate/advanced)
- Fits user's schedule (days per week, minutes per session)
- Progressive difficulty (Week 1 easiest, Week 4 hardest)
- Honors diet framework (halal, keto, plant-based, etc.)
- Personalizes sleep tips to user's wake/bed times

---

## Making ARIA Cross-Project

ARIA's architecture is inherently portable. Here's the blueprint for extracting her into a reusable system that works across multiple apps.

### The Core Insight

ARIA is three things:
1. **A pattern** — gather context, inject into personality prompt, call LLM, persist history, degrade gracefully
2. **A personality** — the EASE philosophy, the coaching tone, the behavioral rules
3. **A context shape** — the specific data points she knows about the user

Items 1 and 2 are **universal**. Item 3 is **app-specific**. This is where you split.

### Proposed Package Structure

```
@aria/core/                          # Universal — shared across all apps
├── types.ts                         # Generic interfaces
├── personality.ts                   # EASE philosophy, tone rules, base prompt sections
├── chat-engine.ts                   # LLM call orchestration, history management
├── rate-limiter.ts                  # Tier-based daily limits
├── fallback-engine.ts               # Base class for keyword fallback responses
└── index.ts

@aria/adapter-fitness/               # My Body Fitness App adapter
├── context-provider.ts              # buildAriaContext() for fitness data
├── prompt-config.ts                 # Fitness expertise, health rules, data injection
├── fallback-responses.ts            # Workout/nutrition/sleep keyword responses
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
// What changes per app: expertise, rules, and context injection.
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
- Rate limiting logic
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
| Structured outputs | 4-week workout/nutrition plans | Meditation programs, breathing sequences | Weekly focus plans, habit stacks |
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
   Add RLS policies so users only see their own data.

6. **Mount the chat router** — Wire up the 5 endpoints (messages, remaining, message, refresh-context, delete).

7. **Set environment variables:**
   ```bash
   OPENROUTER_API_KEY=your_key
   ARIA_MODEL=anthropic/claude-sonnet-4  # optional
   ARIA_MAX_TOKENS=1024                   # optional
   ```

8. **Build a chat UI** — Or adapt the existing React component. Key features: message list, input, typing indicator, rate limit display, demo mode fallback.

9. **Test without an API key first** — Verify the fallback engine works. Then add your key and test real responses.

10. **Configure rate limits** — Decide on free vs premium message counts.

---

## File Map

### Backend (server/)

| File | Purpose | Lines |
|---|---|---|
| `src/utils/aria-context.ts` | Context engine — gathers user data, caching | ~340 |
| `src/utils/aria-system-prompt.ts` | System prompt builder — personality, rules, data injection | ~200 |
| `src/routes/aria-chat.ts` | Chat API router — all 5 endpoints | ~385 |
| `src/routes/plan-generate.ts` | Plan generation — uses ARIA context for structured JSON output | ~100 |

### Frontend (client/)

| File | Purpose | Lines |
|---|---|---|
| `src/pages/aria/chat.tsx` | Full chat page — dual mode (API/demo), markdown, rate limits | ~550 |
| `src/components/aria-briefing.tsx` | Dashboard briefing widget — rule-based, no API | ~300 |

### Database (server/supabase/migrations/)

| Migration | Tables |
|---|---|
| `003_sprint3_tables.sql` | `aria_messages` |
| `005_encyclopedia_and_ai.sql` | `aria_context`, tokens_used column |

### Routes

| Type | Path |
|---|---|
| Client route | `/aria` -> `AriaChatPage` |
| Server mount | `/api/aria` -> `aria-chat.ts` router |

---

## Improvements Roadmap

ARIA's current implementation is functional and well-structured, but has 10 concrete gaps that limit her from being a truly intelligent, responsive assistant. These are ordered by priority — the first three are bugs or critical missing pieces; the rest are enhancements that deepen ARIA's value.

### Gap Summary

| # | Improvement | Priority | Current State | Impact |
|---|---|---|---|---|
| 1 | Event-Driven Context Invalidation | Critical | Cache is TTL-only (1hr). User logs a workout, ARIA doesn't know for up to 60 min. | ARIA references stale data |
| 2 | Tool Use / Function Calling | Critical | ARIA can only talk. She can't take actions inside the app. | Limits ARIA to chatbot instead of assistant |
| 3 | Timezone-Aware Rate Limiting | Critical | Uses server time (UTC) for daily reset, not user's timezone. | Users get wrong reset time |
| 4 | Streaming Responses | High | Full response arrives at once after complete generation. | Slow perceived response time |
| 5 | Long-Term Conversation Memory | High | Only last 20 messages loaded. No cross-session memory. | ARIA forgets everything between sessions |
| 6 | Response Feedback Loop | High | No way for users to rate responses. | Can't measure or improve quality |
| 7 | Sentiment-Aware Prompting | Medium | System prompt says "adapt tone" but no detection mechanism. | Tone matching is hit-or-miss |
| 8 | Proactive Outreach / Nudges | Medium | ARIA only speaks when spoken to. | Missed engagement opportunities |
| 9 | Topic Guardrailing | Medium | Relies entirely on Claude's base behavior for off-topic. | Could break character on edge cases |
| 10 | Multimodal Support (Vision) | Future | Text-only. Can't analyze photos. | Can't do food photo analysis, form checks, progress photos |

---

### Improvement 1: Event-Driven Context Invalidation

**The Problem:**
ARIA's context cache uses a 1-hour TTL. If a user logs a workout at 2:05 PM and then opens ARIA chat at 2:06 PM and says "how was my workout?", ARIA's cached context might still show yesterday's workout as the most recent. The cache won't refresh until 3:05 PM.

**Current Code (aria-context.ts:325-342):**
```typescript
// Only checks time — not data freshness
const age = Date.now() - new Date(data.last_updated).getTime();
const ONE_HOUR = 60 * 60 * 1000;
if (age < ONE_HOUR) {
  return data.context_data as AriaUserContext; // Could be stale
}
```

**The Fix: Invalidate on Data Changes**

When any of these actions happen, delete or touch the `aria_context` row so the next `getAriaContext()` call triggers a rebuild:

```typescript
// Add to each data-writing route (workout, meal, sleep, mood, etc.)
async function invalidateAriaContext(userId: string) {
  await supabaseAdmin
    .from('aria_context')
    .delete()
    .eq('user_id', userId);
}

// Example: in workout logging route
router.post('/workout', async (req, res) => {
  // ... save workout ...
  await invalidateAriaContext(userId); // ARIA will rebuild on next chat
  res.status(201).json({ data: workout });
});
```

**Which routes should trigger invalidation:**
- `POST /api/workouts` (new workout logged)
- `POST /api/nutrition` (meal logged)
- `POST /api/sleep` (sleep logged)
- `POST /api/mood` (mood logged)
- `POST /api/stretching` (stretch logged)
- `POST /api/recovery` (recovery logged)
- `PUT /api/health-profile` (health profile updated)
- `PUT /api/profile` (profile updated)
- `POST /api/gamification/xp` (XP gained)
- `POST /api/daily-actions` (task completed)

**Alternative: Hybrid approach** — keep the TTL but also track a `data_version` counter. Increment it on writes, compare on reads. If version mismatches, rebuild.

```sql
ALTER TABLE aria_context ADD COLUMN data_version integer DEFAULT 0;

-- In your app, also track:
ALTER TABLE profiles ADD COLUMN aria_data_version integer DEFAULT 0;
-- Increment on any user data change, compare in getAriaContext()
```

---

### Improvement 2: Tool Use / Function Calling

**The Problem:**
ARIA can only generate text. She can't take actions. When a user says "log 8 glasses of water for me" or "show me my sleep trend this week", ARIA can only describe what to do — she can't actually do it.

**The Fix: Add Claude Tools**

Define tools that ARIA can call, then execute them server-side:

```typescript
const ARIA_TOOLS = [
  {
    type: 'function',
    function: {
      name: 'log_workout',
      description: 'Log a workout for the user',
      parameters: {
        type: 'object',
        properties: {
          title: { type: 'string', description: 'Workout name' },
          duration_minutes: { type: 'number' },
          rpe: { type: 'number', description: 'Perceived exertion 1-10' },
          exercises: {
            type: 'array',
            items: {
              type: 'object',
              properties: {
                name: { type: 'string' },
                sets: { type: 'number' },
                reps: { type: 'string' },
              },
            },
          },
        },
        required: ['title'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'log_water',
      description: 'Log water intake for the user',
      parameters: {
        type: 'object',
        properties: {
          cups: { type: 'number', description: 'Number of cups (8oz each)' },
        },
        required: ['cups'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'get_weekly_stats',
      description: 'Get the user\'s stats for the current week (workouts, sleep, mood, nutrition)',
      parameters: { type: 'object', properties: {} },
    },
  },
  {
    type: 'function',
    function: {
      name: 'get_sleep_trend',
      description: 'Get the user\'s sleep data for the past N days',
      parameters: {
        type: 'object',
        properties: {
          days: { type: 'number', description: 'Number of days to look back (default 7)' },
        },
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'suggest_workout',
      description: 'Generate a workout suggestion based on user\'s profile, recent activity, and preferences',
      parameters: {
        type: 'object',
        properties: {
          focus: { type: 'string', description: 'e.g. upper body, cardio, flexibility' },
          duration_minutes: { type: 'number' },
        },
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'set_reminder',
      description: 'Set a reminder/nudge for the user',
      parameters: {
        type: 'object',
        properties: {
          message: { type: 'string' },
          time: { type: 'string', description: 'ISO timestamp or relative like "tomorrow 7am"' },
          type: { type: 'string', enum: ['workout', 'meal', 'sleep', 'water', 'general'] },
        },
        required: ['message'],
      },
    },
  },
];

// In the LLM call:
const response = await client.chat.completions.create({
  model: process.env.ARIA_MODEL || 'anthropic/claude-sonnet-4',
  max_tokens: 1024,
  tools: ARIA_TOOLS,
  messages: [
    { role: 'system', content: systemPrompt },
    ...conversationHistory,
  ],
});

// Handle tool calls
if (response.choices[0].message.tool_calls) {
  for (const toolCall of response.choices[0].message.tool_calls) {
    const result = await executeAriaTool(userId, toolCall.function.name, JSON.parse(toolCall.function.arguments));
    // Send tool result back to Claude for final response
  }
}
```

**Tool executor pattern:**
```typescript
async function executeAriaTool(userId: string, toolName: string, args: any): Promise<string> {
  switch (toolName) {
    case 'log_workout':
      const workout = await supabaseAdmin.from('workout_logs').insert({ user_id: userId, ...args }).select().single();
      await invalidateAriaContext(userId);
      return `Workout "${args.title}" logged successfully.`;

    case 'log_water':
      await supabaseAdmin.from('nutrition_logs').insert({ user_id: userId, food_name: 'Water', cups: args.cups });
      return `Logged ${args.cups} cups of water.`;

    case 'get_weekly_stats':
      const context = await buildAriaContext(userId);
      return JSON.stringify(context.recentActivity.weeklyStats);

    case 'get_sleep_trend':
      const days = args.days || 7;
      const { data } = await supabaseAdmin.from('sleep_logs')
        .select('duration_hours, quality_rating, sleep_score, logged_at')
        .eq('user_id', userId)
        .order('logged_at', { ascending: false })
        .limit(days);
      return JSON.stringify(data);

    default:
      return `Tool ${toolName} not implemented yet.`;
  }
}
```

**What this enables:**
- "Log my workout — I did 30 minutes of yoga" -> ARIA logs it and confirms
- "How did I sleep this week?" -> ARIA pulls real data and analyzes the trend
- "Remind me to stretch before bed" -> ARIA sets a reminder
- "What should I do for upper body today?" -> ARIA generates a workout from her fitness knowledge + user context

---

### Improvement 3: Timezone-Aware Rate Limiting

**The Problem:**
Rate limiting calculates "today" using server time:

```typescript
// aria-chat.ts line 51-52
const todayStart = new Date();
todayStart.setHours(0, 0, 0, 0); // Server's midnight, not user's
```

If the server runs in UTC and a user is in `America/New_York` (UTC-5), their daily messages reset at 7 PM Eastern instead of midnight.

**The Fix:**

```typescript
function getUserMidnight(timezone: string): Date {
  // Get current time in user's timezone
  const now = new Date();
  const userTime = new Date(now.toLocaleString('en-US', { timeZone: timezone }));

  // Set to midnight in user's timezone
  userTime.setHours(0, 0, 0, 0);

  // Convert back to UTC for database comparison
  const offset = now.getTime() - userTime.getTime();
  return new Date(now.getTime() - offset);
}

// In the rate limit check:
const { data: profile } = await supabaseAdmin
  .from('profiles')
  .select('subscription_tier, timezone')
  .eq('id', userId)
  .maybeSingle();

const timezone = profile?.timezone || 'America/New_York';
const todayStart = getUserMidnight(timezone);

const { count: todayCount } = await supabaseAdmin
  .from('aria_messages')
  .select('*', { count: 'exact', head: true })
  .eq('user_id', userId)
  .eq('role', 'user')
  .gte('created_at', todayStart.toISOString());
```

**Note:** Since the profile is already being fetched for subscription tier, adding `timezone` to the select is free — no extra query needed.

---

### Improvement 4: Streaming Responses

**The Problem:**
ARIA's response arrives all at once after the LLM finishes generating the entire response. For a 300-word response, this means 3-8 seconds of "ARIA is thinking..." followed by a wall of text appearing instantly. This feels slow and unnatural.

**The Fix: Server-Sent Events (SSE)**

**New endpoint:** `POST /api/aria/message/stream`

```typescript
router.post('/message/stream', async (req, res) => {
  // ... rate limit check, save user message (same as before) ...

  // Set SSE headers
  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');
  res.flushHeaders();

  const userContext = await getAriaContext(userId);
  const systemPrompt = buildAriaSystemPrompt(userContext);

  const stream = await client.chat.completions.create({
    model: process.env.ARIA_MODEL || 'anthropic/claude-sonnet-4',
    max_tokens: 1024,
    stream: true, // Enable streaming
    messages: [
      { role: 'system', content: systemPrompt },
      ...conversationHistory,
    ],
  });

  let fullResponse = '';

  for await (const chunk of stream) {
    const content = chunk.choices[0]?.delta?.content || '';
    if (content) {
      fullResponse += content;
      // Send each chunk as an SSE event
      res.write(`data: ${JSON.stringify({ type: 'chunk', content })}\n\n`);
    }
  }

  // Save complete response to database
  const { data: ariaMessage } = await supabaseAdmin
    .from('aria_messages')
    .insert({
      user_id: userId,
      role: 'aria',
      content: fullResponse,
      tokens_used: 0, // OpenRouter doesn't report usage in streaming mode
    })
    .select()
    .single();

  // Send final event with message ID and rate limit info
  res.write(`data: ${JSON.stringify({
    type: 'done',
    message_id: ariaMessage?.id,
    rate_limit: { used: used + 1, limit: dailyLimit, remaining: remaining }
  })}\n\n`);

  res.end();
});
```

**Frontend (React):**
```typescript
async function sendMessageStreaming(content: string) {
  const response = await fetch('/api/aria/message/stream', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
    body: JSON.stringify({ content }),
  });

  const reader = response.body!.getReader();
  const decoder = new TextDecoder();
  let ariaText = '';

  // Add a placeholder ARIA message that we'll update as chunks arrive
  const placeholderId = crypto.randomUUID();
  setMessages(prev => [...prev, { id: placeholderId, role: 'aria', text: '', timestamp: Date.now() }]);

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;

    const lines = decoder.decode(value).split('\n');
    for (const line of lines) {
      if (!line.startsWith('data: ')) continue;
      const event = JSON.parse(line.slice(6));

      if (event.type === 'chunk') {
        ariaText += event.content;
        // Update the placeholder message with accumulated text
        setMessages(prev => prev.map(m =>
          m.id === placeholderId ? { ...m, text: ariaText } : m
        ));
      }

      if (event.type === 'done') {
        // Update with final message ID from database
        setMessages(prev => prev.map(m =>
          m.id === placeholderId ? { ...m, id: event.message_id } : m
        ));
        setRateLimit(event.rate_limit);
      }
    }
  }
}
```

---

### Improvement 5: Long-Term Conversation Memory

**The Problem:**
ARIA loads the last 20 messages as conversation context. But if a user told ARIA last week "I'm training for a half marathon in October" or "my knee has been bothering me lately", that information is lost once it scrolls past the 20-message window. The system prompt has the user's profile data, but not the nuances and goals they've discussed conversationally.

**The Fix: Periodic Conversation Summarization**

**New table:**
```sql
CREATE TABLE aria_memory (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id     uuid NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  memory_type text NOT NULL CHECK (memory_type IN ('conversation_summary', 'user_preference', 'goal', 'concern')),
  content     text NOT NULL,
  source_date timestamptz NOT NULL,  -- When the original conversation happened
  created_at  timestamptz DEFAULT now(),
  expires_at  timestamptz           -- Optional: auto-expire old memories
);

CREATE INDEX idx_aria_memory_user_id ON aria_memory(user_id);
```

**Summarization process** (runs after every 10 new messages, or daily via cron):

```typescript
async function summarizeConversation(userId: string) {
  // Get messages not yet summarized
  const { data: messages } = await supabaseAdmin
    .from('aria_messages')
    .select('role, content, created_at')
    .eq('user_id', userId)
    .order('created_at', { ascending: true })
    .limit(50);

  if (!messages || messages.length < 10) return; // Not enough to summarize

  const summarizationPrompt = `Analyze this conversation between a user and ARIA (wellness AI assistant).
Extract ONLY information that would be useful in future conversations:
- Goals the user mentioned (training for an event, weight target, etc.)
- Concerns or struggles they shared (knee pain, poor sleep, stress at work)
- Preferences they expressed (likes yoga, hates running, prefers morning workouts)
- Important life context (new job, injury recovery, pregnant, etc.)

Return a JSON array of memories:
[
  { "type": "goal", "content": "Training for a half marathon in October 2024" },
  { "type": "concern", "content": "Right knee pain that flares up during running" },
  { "type": "user_preference", "content": "Prefers bodyweight exercises at home, no gym access" }
]

Only include genuinely useful information. Skip greetings, generic questions, and routine check-ins.
Return ONLY valid JSON.`;

  const response = await client.chat.completions.create({
    model: 'anthropic/claude-haiku-4-5-20251001', // Use a fast/cheap model for summarization
    max_tokens: 500,
    messages: [
      { role: 'system', content: summarizationPrompt },
      { role: 'user', content: messages.map(m => `[${m.role}]: ${m.content}`).join('\n') },
    ],
  });

  const memories = JSON.parse(response.choices[0].message.content);

  for (const memory of memories) {
    await supabaseAdmin.from('aria_memory').insert({
      user_id: userId,
      memory_type: memory.type,
      content: memory.content,
      source_date: messages[0].created_at,
    });
  }
}
```

**Inject memories into system prompt:**

```typescript
// In buildAriaSystemPrompt(), add a new section:
const { data: memories } = await supabaseAdmin
  .from('aria_memory')
  .select('memory_type, content, source_date')
  .eq('user_id', userId)
  .order('source_date', { ascending: false })
  .limit(20);

// Add to system prompt:
## WHAT YOU REMEMBER FROM PAST CONVERSATIONS
${memories.map(m => `- [${m.memory_type}] ${m.content} (from ${new Date(m.source_date).toLocaleDateString()})`).join('\n')}

Use these memories naturally — reference them when relevant, but don't force them.
If a memory seems outdated, ask the user if it's still accurate.
```

---

### Improvement 6: Response Feedback Loop

**The Problem:**
There's no mechanism to know whether ARIA's responses are helpful. Without feedback data, you can't:
- Identify which system prompt rules produce good vs bad responses
- Tune the model or prompt based on real user satisfaction
- Detect when ARIA is consistently unhelpful on certain topics

**The Fix:**

**New table:**
```sql
CREATE TABLE aria_feedback (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id     uuid NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  message_id  uuid NOT NULL REFERENCES aria_messages(id) ON DELETE CASCADE,
  rating      smallint NOT NULL CHECK (rating IN (-1, 1)), -- thumbs down / up
  feedback    text,                                         -- optional written feedback
  created_at  timestamptz DEFAULT now(),
  UNIQUE(user_id, message_id)                               -- one rating per message
);
```

**New endpoint:**
```typescript
// POST /api/aria/feedback
router.post('/feedback', async (req, res) => {
  const userId = req.user!.id;
  const { message_id, rating, feedback } = req.body;

  // Verify the message belongs to this user and is an ARIA response
  const { data: message } = await supabaseAdmin
    .from('aria_messages')
    .select('role')
    .eq('id', message_id)
    .eq('user_id', userId)
    .eq('role', 'aria')
    .maybeSingle();

  if (!message) {
    res.status(404).json({ error: 'Message not found' });
    return;
  }

  await supabaseAdmin.from('aria_feedback').upsert({
    user_id: userId,
    message_id,
    rating,        // 1 = helpful, -1 = not helpful
    feedback,      // optional text: "this didn't account for my knee injury"
  }, { onConflict: 'user_id, message_id' });

  res.status(200).json({ message: 'Feedback recorded' });
});
```

**Frontend: Thumbs up/down on each ARIA message:**
```tsx
{msg.role === 'aria' && (
  <div className="flex gap-1 mt-1">
    <button onClick={() => submitFeedback(msg.id, 1)} className="text-text-muted hover:text-accent">
      <ThumbsUp className="h-3.5 w-3.5" />
    </button>
    <button onClick={() => submitFeedback(msg.id, -1)} className="text-text-muted hover:text-red-400">
      <ThumbsDown className="h-3.5 w-3.5" />
    </button>
  </div>
)}
```

**How to use the data:**
- Dashboard analytics: % positive ratings over time, by topic
- If a topic consistently gets thumbs-down, revise the system prompt rules for that area
- Feed negative-rated exchanges into prompt improvement iterations

---

### Improvement 7: Sentiment-Aware Prompting

**The Problem:**
ARIA's system prompt instructs "adapt your tone to their current state (if they're stressed, be calming; if they're energized, match their energy)" — but the prompt itself doesn't tell ARIA what state the user is in. It relies entirely on Claude's inference from the raw message text.

This works reasonably well, but explicit sentiment hints improve consistency, especially for short or ambiguous messages like "whatever" or "fine I guess."

**The Fix: Lightweight Sentiment Analysis Before Prompt Building**

```typescript
interface SentimentHint {
  mood: 'positive' | 'neutral' | 'negative' | 'distressed';
  energy: 'high' | 'medium' | 'low';
  intent: 'question' | 'venting' | 'celebration' | 'request' | 'greeting' | 'unknown';
}

function detectSentiment(message: string): SentimentHint {
  const lower = message.toLowerCase();

  // Distress signals (highest priority)
  const distressPatterns = /\b(can't take|give up|hopeless|hate my|what's the point|worthless|breaking down|falling apart)\b/;
  if (distressPatterns.test(lower)) {
    return { mood: 'distressed', energy: 'low', intent: 'venting' };
  }

  // Negative signals
  const negativePatterns = /\b(frustrated|angry|sad|tired|exhausted|stressed|anxious|worried|struggling|failed|sucks|horrible|terrible|ugh|can't|won't)\b/;
  const negativeCount = (lower.match(negativePatterns) || []).length;

  // Positive signals
  const positivePatterns = /\b(great|awesome|amazing|excited|proud|happy|love|nailed|crushed it|personal best|pb|pr|finally|yes!|let's go)\b/;
  const positiveCount = (lower.match(positivePatterns) || []).length;

  // Energy signals
  const highEnergyPatterns = /!{2,}|\b(let's go|pumped|fired up|ready|bring it|crush)\b/;
  const lowEnergyPatterns = /\b(tired|exhausted|drained|low energy|sluggish|meh|whatever|idk)\b/;

  // Intent detection
  let intent: SentimentHint['intent'] = 'unknown';
  if (/\?/.test(message) || /\b(how|what|why|when|should|can|could|is it|do you)\b/.test(lower)) intent = 'question';
  else if (negativeCount > 0 && !/\?/.test(message)) intent = 'venting';
  else if (positiveCount > 0) intent = 'celebration';
  else if (/\b(help|show|give|log|set|create|make|find)\b/.test(lower)) intent = 'request';
  else if (/^(hi|hello|hey|good morning|good evening)/.test(lower)) intent = 'greeting';

  return {
    mood: positiveCount > negativeCount ? 'positive' : negativeCount > 0 ? 'negative' : 'neutral',
    energy: highEnergyPatterns.test(lower) ? 'high' : lowEnergyPatterns.test(lower) ? 'low' : 'medium',
    intent,
  };
}
```

**Inject into system prompt:**

```typescript
// Before calling the LLM, analyze the latest message:
const sentiment = detectSentiment(content.trim());

// Add as a hint at the end of the system prompt:
const sentimentHint = `
## CURRENT MESSAGE CONTEXT
The user's message suggests: ${sentiment.mood} mood, ${sentiment.energy} energy, intent: ${sentiment.intent}.
${sentiment.mood === 'distressed' ? 'IMPORTANT: The user may be in distress. Be extra gentle, validate their feelings, and suggest professional support if appropriate.' : ''}
${sentiment.mood === 'negative' ? 'Be empathetic and validating before offering advice.' : ''}
${sentiment.intent === 'celebration' ? 'Match their excitement! Celebrate with them.' : ''}
${sentiment.intent === 'venting' ? 'Listen first. Don\'t jump to solutions unless asked.' : ''}
`;
```

---

### Improvement 8: Proactive Outreach / Nudges

**The Problem:**
ARIA is entirely reactive — she only responds when the user opens the chat and types. She misses opportunities to engage: a user whose streak is about to break, someone who hasn't logged a workout in 5 days, or a user whose sleep scores have been declining.

**The Fix: Scheduled Nudge Engine**

**New table:**
```sql
CREATE TABLE aria_nudges (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id     uuid NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  nudge_type  text NOT NULL,        -- 'streak_warning', 'inactivity', 'sleep_decline', 'celebration'
  title       text NOT NULL,        -- Short headline
  message     text NOT NULL,        -- ARIA's nudge message
  action_url  text,                 -- Deep link (e.g., '/aria' or '/workouts/log')
  read        boolean DEFAULT false,
  created_at  timestamptz DEFAULT now()
);
```

**Nudge generator (runs via cron, e.g., daily at 8 AM user-local-time):**

```typescript
async function generateNudges() {
  // Get all active users
  const { data: users } = await supabaseAdmin
    .from('profiles')
    .select('id, display_name, timezone')
    .eq('onboarding_complete', true);

  for (const user of users || []) {
    const context = await buildAriaContext(user.id);

    // Streak about to break (active streak but no activity today)
    if (context.gamification.current_streak >= 3 && !context.recentActivity.lastWorkout) {
      await createNudge(user.id, 'streak_warning',
        `Don't lose your ${context.gamification.current_streak}-day streak!`,
        `Hey ${context.profile.name}, you've got a ${context.gamification.current_streak}-day streak going strong. Even a quick 10-minute session counts. Want me to suggest something fast?`,
        '/aria'
      );
    }

    // Inactivity (no workout in 3+ days)
    if (context.recentActivity.lastWorkout) {
      const daysSince = (Date.now() - new Date(context.recentActivity.lastWorkout.date).getTime()) / (1000 * 60 * 60 * 24);
      if (daysSince >= 3) {
        await createNudge(user.id, 'inactivity',
          'Your body misses you',
          `It's been ${Math.floor(daysSince)} days since your last workout, ${context.profile.name}. No pressure — want to start with something light today?`,
          '/workouts/log'
        );
      }
    }

    // Sleep declining (3-day average below 6 hours)
    if (context.recentActivity.weeklyStats.avg_sleep_hours > 0 && context.recentActivity.weeklyStats.avg_sleep_hours < 6) {
      await createNudge(user.id, 'sleep_decline',
        'Let\'s talk about your sleep',
        `${context.profile.name}, your average sleep this week is ${context.recentActivity.weeklyStats.avg_sleep_hours} hours. That can affect everything from mood to recovery. Want to chat about what's going on?`,
        '/aria'
      );
    }

    // Milestone celebration
    if (context.gamification.current_streak === 7 || context.gamification.current_streak === 30) {
      await createNudge(user.id, 'celebration',
        `${context.gamification.current_streak}-day streak!`,
        `${context.profile.name}, ${context.gamification.current_streak} days in a row! That is incredible consistency. You should be proud of yourself.`,
        '/dashboard'
      );
    }
  }
}
```

**Delivery channels:**
- Dashboard notification badge
- In-app notification center
- Push notification (via web push API or service worker)
- Email digest (optional)

---

### Improvement 9: Topic Guardrailing

**The Problem:**
ARIA's system prompt says "never break character" but there's no enforcement layer. If a user asks "what stocks should I buy?" or "write me a Python script", ARIA's response depends entirely on Claude's base behavior. She might answer, might not — it's inconsistent.

**The Fix: Pre-LLM Topic Filter**

```typescript
interface TopicCheck {
  allowed: boolean;
  redirect_message?: string;
}

function checkTopicRelevance(message: string): TopicCheck {
  const lower = message.toLowerCase();

  // Explicit off-topic patterns
  const offTopicPatterns = [
    { pattern: /\b(stock|invest|crypto|bitcoin|trading|portfolio)\b/, topic: 'finance' },
    { pattern: /\b(code|program|debug|javascript|python|sql|html|css|api)\b/, topic: 'programming' },
    { pattern: /\b(politics|election|vote|democrat|republican|trump|biden)\b/, topic: 'politics' },
    { pattern: /\b(recipe for disaster|bomb|weapon|hack|exploit)\b/, topic: 'harmful' },
    { pattern: /\b(write me a story|poem|essay|song lyrics)\b/, topic: 'creative writing' },
  ];

  for (const { pattern, topic } of offTopicPatterns) {
    if (pattern.test(lower)) {
      const redirectMessages: Record<string, string> = {
        finance: "I'm flattered you'd ask, but financial advice is outside my expertise! I'm all about wellness — fitness, nutrition, sleep, and mindset. What can I help you with on that front?",
        programming: "Ha, I wish I could help with code, but my superpowers are in wellness, not software! If you have questions about training, nutrition, or recovery, I'm your person.",
        politics: "I stay in my lane on that one! I'm here for your physical and mental wellness. Want to talk about something fitness or health related instead?",
        harmful: "That's not something I can help with. I'm here to support your wellness journey — fitness, nutrition, sleep, and mindset. What would you like to work on?",
        'creative writing': "I'm more of a wellness coach than a writer! But I can definitely help you journal about your fitness journey, set goals, or reflect on your progress. Interested?",
      };

      return {
        allowed: false,
        redirect_message: redirectMessages[topic] || "That's a bit outside my wheelhouse! I'm best at helping with fitness, nutrition, sleep, recovery, and mindset. What wellness topic can I help with?",
      };
    }
  }

  return { allowed: true };
}

// In the message handler, before calling the LLM:
const topicCheck = checkTopicRelevance(content.trim());
if (!topicCheck.allowed) {
  ariaResponse = topicCheck.redirect_message!;
  // Skip LLM call entirely — save tokens and ensure consistent behavior
}
```

**Why filter before the LLM instead of relying on prompt rules:**
- Saves API cost (no LLM call needed for obvious off-topic)
- Consistent behavior (prompt rules are suggestions to the model, not guarantees)
- Faster response (no API latency)
- Still falls through to the LLM for ambiguous cases

---

### Improvement 10: Multimodal Support (Vision)

**The Problem:**
ARIA can't see. Users can't share:
- Progress photos ("How's my form on this squat?")
- Food photos ("Estimate the macros in this meal")
- Screenshots of their wearable data
- Photos of supplement labels ("Is this a good protein powder?")

**The Fix: Image Upload + Vision Model**

**Backend changes:**

```typescript
// Accept base64 images or file uploads
router.post('/message', upload.single('image'), async (req, res) => {
  const { content } = req.body;
  const image = req.file;

  // Build messages array
  const userContent: any[] = [];

  if (content) {
    userContent.push({ type: 'text', text: content.trim() });
  }

  if (image) {
    const base64 = image.buffer.toString('base64');
    const mimeType = image.mimetype;
    userContent.push({
      type: 'image_url',
      image_url: { url: `data:${mimeType};base64,${base64}` },
    });
  }

  // Use a vision-capable model
  const response = await client.chat.completions.create({
    model: 'anthropic/claude-sonnet-4', // Claude supports vision natively
    max_tokens: 1024,
    messages: [
      { role: 'system', content: systemPrompt },
      ...conversationHistory,
      { role: 'user', content: userContent },
    ],
  });

  // ... save and return as before
});
```

**System prompt addition:**
```
## IMAGE ANALYSIS
When the user shares an image:
- Food photos: Estimate portion sizes and macronutrients. Be honest about uncertainty.
- Exercise form: Point out what looks good AND what could be improved. Be encouraging.
- Progress photos: Focus on visible improvements. Never make negative comments about body appearance.
- Supplement labels: Analyze ingredients, highlight evidence-based ones, flag anything concerning.
- Always ask follow-up questions for context you can't determine from the image alone.
```

**Frontend: Image upload in chat input:**
```tsx
<div className="flex items-center gap-2">
  <label className="cursor-pointer">
    <Camera className="h-5 w-5 text-text-muted hover:text-primary" />
    <input type="file" accept="image/*" className="hidden" onChange={handleImageSelect} />
  </label>
  <input type="text" value={input} onChange={...} placeholder="Ask ARIA anything..." />
  <Button onClick={handleSend}><Send /></Button>
</div>
```

---

### Implementation Priority Matrix

For developers looking to implement these improvements, here's the recommended order:

**Phase 1 — Fix What's Broken (Week 1)**
1. Timezone-aware rate limiting (1 hour — smallest change, biggest correctness impact)
2. Event-driven context invalidation (2-3 hours — add `invalidateAriaContext()` calls to existing routes)

**Phase 2 — Core Intelligence Upgrades (Weeks 2-3)**
3. Tool use / function calling (1-2 days — transforms ARIA from chatbot to assistant)
4. Streaming responses (1 day — dramatically improves perceived speed)
5. Response feedback (half day — simple but enables data-driven improvement)

**Phase 3 — Deep Personalization (Weeks 4-5)**
6. Long-term memory (1-2 days — conversation summarization + prompt injection)
7. Sentiment-aware prompting (half day — lightweight detection, big tone improvement)
8. Topic guardrailing (half day — pre-LLM filter with graceful redirects)

**Phase 4 — Engagement & Vision (Weeks 6+)**
9. Proactive nudges (2-3 days — cron job + notification system + delivery)
10. Multimodal / vision (1-2 days — image upload + vision model config)

---

## Summary

ARIA is ~1,400 lines of TypeScript across 6 files. She is not a framework — she is a **pattern**:

> **Gather context -> Inject into personality prompt -> Call LLM -> Persist history -> Degrade gracefully**

That pattern is domain-agnostic. The fitness-specific parts (what data to gather, what expertise to claim, what topics to fall back on) are cleanly separated from the universal parts (personality, caching, rate limiting, history management, LLM orchestration).

To put ARIA in a new app, you don't fork the code — you implement the same pattern with your domain's context, expertise, and rules.

With the 10 improvements outlined above, ARIA evolves from a personalized chatbot into a proactive, action-taking, emotionally intelligent assistant with long-term memory, visual understanding, and a data-driven feedback loop for continuous improvement.
