# JARVIS — What It Is and How It Works
> For Shaun | April 2026

---

## What Is JARVIS?

JARVIS is an AI operations agent that Marnin built to progressively run the business. It watches everything, flags problems, drafts actions, and (with your approval) executes them.

The goal: JARVIS handles routine ops so you can focus on growth, relationships, and system building. Right now it's at 2.5 out of 10 on the autonomy scale — it can see everything and do things when asked, but can't act on its own yet.

---

## Two AI Layers

JARVIS runs as two separate systems that work together.

LAYER 1: DASHBOARD CHAT
- The chat panel you open with Shift+J in ops or CEO dashboard
- You ask a question, it answers in real-time
- 31 tools available (search jobs, check schedule, create POs, etc.)
- Write actions need your confirmation (Confirm/Cancel buttons)
- Runs on Railway (secureworks-agent-production.up.railway.app)

LAYER 2: BACKGROUND AGENT
- Runs on Railway in the background
- 101+ MCP tools — reads and writes across ALL business systems
- Monitors on schedules (morning brief at 7am, auto-checks throughout day)
- Generates nudges, alerts, job intelligence
- Outputs go to Telegram (once delivery is fixed)

---

## What JARVIS Can See (50+ Read Tools)

Complete visibility across the business:

- JOBS: List, search, detail, intelligence, profitability, risk scoring
- MONEY: Invoices, overdue AR, bank balances, cash waterfall, aged payables
- SCHEDULE: Calendar, crew availability, scheduling capacity
- CONTACTS: Search, view, GHL conversation history
- MATERIALS: Purchase orders, supplier performance, price ledger
- SALES: Pipeline, leads, quotes, performance, marketing summary
- REPORTS: CEO report, trends, sales breakdown, benchmarks

---

## What JARVIS Can Do (47 Write Tools)

With your approval, JARVIS can:

COMMS:
- Send SMS, email, client updates
- Send review requests
- Send invoice emails, PO emails
- Send Telegram messages

JOBS:
- Update job status
- Complete + invoice (cascade)
- Create work orders
- Create variations

SCHEDULING:
- Create crew assignments
- Update assignments
- Delete assignments

PURCHASING:
- Create POs
- Update POs
- Push POs to Xero
- Email POs to suppliers

INVOICING:
- Send invoices
- Void invoices
- Reconcile payments
- Send payment links

CONTACTS:
- Update contact details
- Add/remove tags
- Add notes

COUNCIL:
- Create submissions
- Update status
- Send council emails

---

## Daily Digest (15 Fire-Prevention Rules)

Every morning at 7am AWST, JARVIS runs 15 automated checks.

CRITICAL (RED) — Revenue/Cash at Risk:
1. Jobs complete but not invoiced
2. Deposits not received after 5 days
3. Invoices overdue 30+ days
4. Quotes aging more than 7 days
5. Missing POs on jobs in progress
6. Crew double-booked
7. High-value POs pending

WARNINGS (AMBER) — Needs Attention:
8. Quotes aging 3-7 days
9. Deposits due soon
10. Idle crews this week
11. Supplier responses pending
12. Council submissions stale
13. Materials not ready for scheduled jobs
14. Travel time conflicts
15. Price variance alerts

JARVIS generates a plain-English summary ("Good morning. Two urgent items today..."). The ops dashboard Today tab that showed it is hidden (6 Oct 2026); the ambient bar still shows the urgent and warning counts on every tab.

---

## Smart Nudges

JARVIS generates proactive suggestions like:
- "Chase this stale quote — it's been 8 days"
- "This invoice is 35 days overdue — send a reminder"
- "SWP-25047 has no deposit — follow up"

119+ nudges have been generated but ZERO have been delivered to Telegram. This is the number 1 thing that needs fixing. The ops dashboard Today tab that listed them is hidden (6 Oct 2026), and you don't get push notifications on your phone yet.

---

## Job Intelligence (JARVIS Tab)

When you open any job in the ops dashboard, there's a JARVIS tab that shows:

- RISK LEVEL: LOW / MEDIUM / HIGH / CRITICAL with health score
- AI SUMMARY: What JARVIS thinks about this job
- THINGS TO KNOW: Key context bullets
- NEXT ACTIONS: What should happen next
- MARGIN FORECAST: Predicted profit margin and dollar amount
- ACTIVITY TIMELINE: Last 10 events from all sources

TELL JARVIS INPUT:
At the bottom of the JARVIS tab there's a text input. You type context like:
- "Don't chase — payment plan agreed"
- "Client on holiday until April 20"
- "Dispute in progress, hold all comms"

JARVIS respects this for 30 days across all automations. So if you tell it not to chase, it won't send automated follow-ups to that client.

---

## The Ambient Bar

Dark bar fixed to the bottom of your screen. Always visible.

LEFT SIDE: Pulsing lightning bolt + "Jarvis" + status (Live or 3m ago)

MIDDLE: Changes based on which tab you're on:
- Jobs tab: "24 active jobs in pipeline"
- Calendar tab: "12 events this week"
- Financials tab: "$24,612 outstanding"
- Dispatch tab: "15 purchase orders tracked"

RIGHT SIDE: Chat button + keyboard shortcut (Shift+J)

Colour-coded badges on every tab: red = urgent, amber = warnings, green = all clear.
Auto-refreshes every 30 seconds. Full dashboard auto-refreshes every 5 minutes.

---

## The Trust System (How JARVIS Earns Autonomy)

Each action type earns autonomy independently through 4 tiers:

T1 — HUMAN APPROVAL (where everything starts)
JARVIS drafts, you approve/edit/skip before anything sends.

T2 — HUMAN REVIEW
JARVIS auto-sends low-risk stuff. You review daily. 30-second recall window.

T3 — HUMAN ON LOOP
Auto for routine. Manual only for high-risk/high-value. You spot-check 5%.

T4 — AUTONOMOUS
Full auto. You monitor weekly. Auto-reverts to T3 if performance drops.

To graduate from one tier to the next, JARVIS needs:
- 30+ approvals at the current tier
- Less than 5% edit/rejection rate
- No safety incidents

So as you approve nudges and actions over time, JARVIS gradually earns more autonomy for that specific action type. Sending a quote follow-up SMS might reach T3 while creating invoices stays at T1.

Currently everything is at T1. The trust system is built but in shadow mode (evaluating, not enforcing yet).

---

## The Autonomy Scale (Where JARVIS Is Heading)

Level 1 — EYES OPEN: Can see all business data (DONE)
Level 2 — HANDS WORKING: Can take actions when asked (80% done)
Level 3 — MEMORY FORMING: Remembers job history, learns from outcomes (20%)
Level 4 — EARS LISTENING: Monitors email, GHL, supplier replies in real-time (10%)
Level 5 — MOUTH SPEAKING: Sends the right message at the right time (10%)
Level 6 — BRAIN CONNECTING: Links cause and effect across the business (5%)
Level 7 — EARLY WARNINGS: Spots problems before they blow up (0%)
Level 8 — TEAM PLAYER: Works with the whole team, not just Marnin (0%)
Level 9 — RUNNING THE SHOW: Operates the business autonomously (0%)
Level 10 — FRANCHISE ENGINE: Someone runs a SecureWorks branch with just JARVIS and a crew (0%)

Current level: 2.5

---

## The AI Database (What JARVIS Remembers)

business_events — Immutable log of everything that happens. Active.
ai_alerts — Daily digest outputs. Active, shows in dashboard.
smart_nudges — Proactive suggestions (119+ records). Generated but delivery broken.
ai_proposed_actions — Pending approval queue. Table exists but empty.
action_permissions — Autonomy tiers per action type. Shadow mode.
ai_reasoning_traces — Every AI decision logged with full context. Infrastructure exists.
ai_feedback_outcomes — Your approve/reject/edit responses. Exists but nothing writes to it.
financial_snapshots — Daily pre-computed business intelligence. Active.
material_price_ledger — Supplier prices extracted from POs. Active.
daily_digests — Stored morning briefings. Active, stored at 7am.
weekly_reports — Executive pulse (Mondays). Active.

The DUAL-WRITE PATTERN: Every key action (create assignment, update status, create PO, complete job, add note) writes to BOTH the legacy job_events table AND the new business_events table. This gives JARVIS a complete event history.

---

## What's Working Right Now

- Dashboard chat (Shift+J) — ask anything, get real answers
- Morning brief generation (the Today tab that displayed it is hidden, 6 Oct 2026)
- Daily digest with 15 alert rules (7am trigger)
- Smart nudge generation (shows in dashboard)
- Job intelligence and risk scoring
- JARVIS tab in job detail with AI assessment
- "Tell JARVIS" manual context annotations
- Ambient bar with live context summaries
- Action cards with Confirm/Cancel for write operations
- 101+ MCP tools connected and routing
- Prompt caching (90% cost reduction on AI calls)
- Auto-refresh every 5 minutes

---

## What's Broken Right Now

NUDGE DELIVERY TO TELEGRAM — Number 1 blocker.
119 nudges generated, 0 delivered to your phone.

FEEDBACK LOOPS — chase_outcomes table exists but nothing writes to it.
JARVIS can't learn from what works and what doesn't.

PROPOSED ACTIONS — Table is empty. No approval cards being generated for proactive actions.

TRUST ENFORCEMENT — Shadow mode only. Not actually blocking unsafe actions.

EMAIL TO JOB ROUTING — Emails are classified but don't show up in job timelines.

2 MAILBOXES NOT FLOWING — shaun@ and khairo@ not connected yet.

These are all being fixed in the Cohesion Sprint.

---

## Your Daily JARVIS Workflow

1. MORNING: Check Telegram for the morning brief. Review attention items.

2. OPEN OPS DASHBOARD: Glance at the ambient bar — tells you instantly if anything needs attention.

3. BADGES: If the bar shows a red or amber badge, click it to open the chat and ask what it is. The Today tab and its nudges panel are hidden (6 Oct 2026).

4. THROUGHOUT THE DAY: Press Shift+J to chat with JARVIS. Ask anything:
   - "What invoices are overdue?"
   - "What should I focus on today?"
   - "What's the status of SWP-25029?"
   - "Who's working tomorrow?"
   - "Which jobs need POs?"

5. JOB DETAIL: Click the JARVIS tab on any job to see risk level, AI assessment, and next actions. Use the "Tell JARVIS" input to add context that controls automations.

6. END OF DAY: Spot-check a few automated messages to make sure tone is right.

---

## The Big Picture

Marnin has built the skeleton of an autonomous operations system. The eyes (reading all data), the hands (101 tools to take action), and the brain (AI reasoning with Claude) are all there.

What's missing is the nervous system — the wiring that connects nudge generation to delivery, captures your feedback so JARVIS learns, and enforces trust tiers so JARVIS can graduate from "ask permission for everything" to "handle routine stuff automatically."

That's what the Cohesion Sprint is fixing. Once nudge delivery works and feedback loops close, JARVIS starts learning from your decisions and progressively takes over routine ops.

This is exactly what your role spec describes: your ops work shrinks from 70% to 20% over 12 months as JARVIS takes over the routine stuff.
