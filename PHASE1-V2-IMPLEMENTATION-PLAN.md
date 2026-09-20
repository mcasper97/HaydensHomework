# Hayden's Homework — Phase 1 v2 Implementation Plan

**Status: PROPOSED — awaiting review. No slice in this plan has been implemented.**
Built from `PHASE1-V2-GAP-ANALYSIS.md`. Ordered as vertical slices, each producing one testable user-visible outcome. Security/data-integrity prerequisites are sequenced before anything cosmetic, per the audit brief.

**Revision note (this version):** incorporates five product decisions made after the initial audit review — see "Product Decisions Incorporated" immediately below. The most consequential change: Slice 3 was redesigned (not just re-sequenced) to remove any mechanism by which ingestion could write to an existing canonical Item, and Slices 4-6 (study/practice/readiness) were moved out of the active near-term sequence into an explicit "Deferred" section.

---

## Product Decisions Incorporated

| # | Decision | Where it lands in this plan |
|---|---|---|
| 1 | Review Inbox remains the recommended next slice; build the smallest durable surface over the existing candidate lifecycle, no redesign. | Slice 1 — unchanged from the prior revision; already matched this direction. |
| 2 | Candidate-to-Item idempotency immediately follows Review Inbox, closed before larger feature work. | Slice 2 — unchanged, still immediately after Slice 1. |
| 3 | One-time obligation reconciliation must not let ingestion silently modify an existing authoritative Item. Same trust principle as recurring reconciliation: strong match → corroborate; duplicate → no new Item; changed/uncertain → Parent Review; never a silent overwrite. | Slice 3 — **redesigned** (see below). The previous draft's `"possible_update"`/`relatedItemId` auto-apply-as-update mechanism is removed entirely. |
| 4 | Google Calendar remains in Phase 1 scope. Hayden's Homework stays the system of record; Calendar is an additional visibility channel. Sequenced after the trust/data-integrity slices, not removed. | Slice 7 — unchanged in content, confirmed still in the active sequence, explicitly not cut. |
| 5 | Defer study/practice/readiness implementation. Document the `App.jsx` gamified system as a reuse candidate, but do not wire it into the canonical Item/ingestion architecture yet. Near-term priority is Calendar + Organizer + Data Ingestion. | Slices 4, 5, 6 — **moved** out of the active sequence into a new "Deferred" section below. No design decision within them is being made now, including the Slice 5 reuse-vs-new-activity fork — that fork is itself deferred, not resolved. |

---

## Active Sequence (do these, in this order)

```
Slice 1 (Review Inbox)
        │
Slice 2 (Commit idempotency) ── immediately after 1, per decision #2
        │
Slice 3 (One-time reconciliation, corroboration-only) ── shares the same
        │                                                  ingestion code path as 1-2
        │
Slice 7 (Google Calendar one-way publish) ── independent of 1-3; kept in scope
                                              per decision #4, sequenced after the
                                              trust/data-integrity work closes
```

Slices 8 (chore weekday scheduling) and 9 (dead-file removal) remain optional/lowest-priority side items, unchanged from the prior revision, and can be picked up at any time without affecting the sequence above.

Slices 4-6 (study task suggestion, source-grounded practice, readiness) are **not** in this sequence — see "Deferred Slices" below.

---

## Slice 1 — Standing Review Inbox

**Closes:** AC-04 (partial → done).
**Why first:** the biggest *already-shipped* trust gap — an unresolved candidate is currently unreachable once its transient modal closes.

**Approach:** Add a new Parent-only page/section that calls the already-existing `listIngestionCandidates(ctx, {})` (or a filtered `reviewStatus === "pending"` view) and renders each one through the **same `ItemForm.jsx`/approve-reject flow `CandidateReviewModal.jsx` already uses** — this is a new entry point into existing logic, not new review logic. No backend change; no new Firestore field. Reachable from the Parent Page, gated the same way ingestion/CSV import already are (behind Parent Unlock in Child Mode).

**Files expected to change:**
- New: `src/organizer/ReviewInboxView.jsx` (or similar) — lists pending candidates, opens `CandidateReviewModal.jsx` per-candidate or reuses it with a pending-list source instead of a just-captured one.
- `src/AuthShell.jsx` or `src/App.jsx` (whichever owns the Parent Page nav) — add an entry point + pending-count badge.
- No change to `ingestionCandidatesRepository.js`'s schema; `listIngestionCandidates` already exists and is already tested indirectly by every repository-level test that exercises candidate creation.

**Tests to add:** one new Playwright file (`tests/review-inbox.playwright.cjs`, guest/local-demo path, same pattern as existing suites) — create a candidate via the existing photo-ingestion path, close the modal without resolving it, navigate to the new inbox, confirm it's still there and resolvable (approve → committed, reject → rejected), confirm a `"corroborated"` candidate is correctly excluded from the inbox (it should never appear — matches its documented "never enters the parent's review queue" contract).

**Rollback/migration:** none — purely additive UI over an existing read path. Reverting is deleting the new file(s) and the nav entry.

**Definition of done:** a pending candidate created outside an active review session is visible and actionable from the Parent Page at any later time; existing transient per-capture review flow is unchanged; full existing suite + the new Playwright file green.

---

## Slice 2 — Candidate-to-item commit idempotency

**Closes:** AC-05 (latent risk half).
**Why now:** small, self-contained, and Slice 1 is about to make "come back to an approved-but-not-committed candidate later" an actually-reachable user flow for the first time (via the Review Inbox) — better to close this before that flow exists than after. Per decision #2, this is a trust/data-integrity issue and stays immediately after Slice 1, ahead of any larger feature work.

**Approach:** Give `createItem()` (or its caller in `CandidateReviewModal.jsx`) a deterministic idempotency key derived from the candidate id (same pattern already proven in this codebase — `itemCompletionsRepository.js`'s `completionIdFor(itemId, occurrenceDate)`), so re-approving a candidate already at `"approved"`/`"committed"` never creates a second Item. Two implementation options, pick based on a 30-minute spike rather than guessing:
  - **(a)** Store the resulting `itemId` back onto the candidate the moment `createItem()` succeeds (`committedItemId` field), and check-before-create on any re-entry.
  - **(b)** Use a deterministic Firestore doc id for the Item itself (`items/{candidateId}` instead of an auto-id) when the Item originates from a candidate — simpler, but touches `itemsRepository.js`'s id-generation path, which is used by every creation path (manual, CSV, all ingestion), so it needs care not to change manual-creation behavior.

Recommend **(a)** — smaller blast radius, doesn't touch the shared `createItem()` id scheme at all.

**Files expected to change:**
- `src/data/ingestionCandidatesRepository.js` — add `committedItemId: null` to `EMPTY_DEFAULTS`.
- `src/organizer/CandidateReviewModal.jsx`'s `handleApprove` — check for an existing `committedItemId` before calling `createItem()`; write it immediately after success, before the `"committed"` status flip (so even a failure on that last write still leaves a resumable, non-duplicating state).

**Tests to add:** extend `tests/candidate-to-draft-item.unit.mjs` or a new focused unit file simulating the approve-twice sequence against the guest/local repository path (same pattern as `tests/item-completions-repository.unit.mjs`'s guest-path testing approach).

**Rollback/migration:** additive field, defaults to `null` for every existing candidate — no backfill needed, no behavior change for any candidate that only ever gets approved once (the overwhelmingly common case today).

**Definition of done:** simulating "approve, then approve again" (e.g. a double-click, or a future resumed-from-inbox retry) provably creates exactly one Item; existing single-approval flow unchanged and still green across all existing tests.

---

## Slice 3 — One-time obligation reconciliation (corroboration only — REDESIGNED)

**Closes:** AC-05 (second half).
**Depends on:** nothing functionally, but shares the `AuthShell.jsx` ingestion loop with Slices 1-2 — sequenced after them to avoid merge conflicts in the same function.

**This slice was redesigned per product decision #3.** The prior draft proposed a `"possible_update"` review status that, once a parent chose "apply as update" in the Review Inbox, would have ingestion code write new field values onto an existing canonical Item. That mechanism is **removed**. Ingestion never writes to an existing Item under this design — full stop, no exception, matching the same guarantee the recurring-obligation model already provides today.

**Approach — generalizes the existing recurring-obligation corroboration mechanism, does not invent a second one:**
1. Extend `recurringObligationMatch.js`'s `buildObligationSignature`/`canReconcile` so the `recurring` hard gate compares *equal* flags (`true`==`true` or `false`==`false`) instead of requiring both `true`. This lets the exact same deterministic, filler-stripped title-normalization + type/target hard-gate logic serve one-time obligations too, with zero new matching code.
2. For the one-time case specifically, add one more hard gate: **exact date equality.** Two one-time obligations only corroborate if they share type, target, normalized title/action, *and* the same date. This is deliberately the strictest possible bar — it is the "obviously the same obligation, restated" case (e.g. a teacher's weekly newsletter repeating "Math Test Friday Oct 3" that was already emailed once) — not an attempt to detect date *changes*.
3. On a strong match: create a `reviewStatus: "corroborated"` candidate exactly as the recurring path already does — `reconciledItemId` set, full provenance kept, **never enters the Review Inbox, never touches the existing Item.** This satisfies "duplicate should not create another Item."
4. **Any difference at all — including a changed date — is, by construction, not a strong match.** It falls through to the existing, completely unchanged default path: a normal `"pending"` candidate, surfaced in Slice 1's Review Inbox like any other new candidate. This satisfies "materially changed or uncertain information goes to Parent Review." The parent recognizes the relationship to the existing obligation themselves (the Review Inbox can show the candidate's title/date next to it, but this is *display*, not automation) and decides what to do using tools that already exist and are already trusted: reject the new candidate and manually edit the existing Item via `ItemForm.jsx` if it's the same obligation with a real date change, or approve it as a new, separate Item if it genuinely is a new one.

This design is materially simpler than the prior draft: no new `reviewStatus` value, no `relatedItemId` field, no new Review Inbox visual treatment, and no code path that ever mutates an existing Item from ingestion. It fully satisfies decision #3's four bullet points with the smallest possible change.

**Files expected to change:**
- `src/organizer/recurringObligationMatch.js` — relax the `recurring`-must-be-true gate to `recurring`-must-match; add the exact-date hard gate, applied only when both sides are non-recurring (a recurring Item has no single date to compare, so this gate is a no-op for that case — the existing recurring behavior is unaffected).
- `src/AuthShell.jsx`'s `handleCheckEmail` — remove the `if (o.recurring)` guard around the reconciliation call, so one-time obligations now flow through the same (now-generalized) check. No new branch, no new status.
- No change to `src/data/ingestionCandidatesRepository.js` — `"corroborated"`/`reconciledItemId` already exist and already do exactly what's needed.

**Tests to add:** extend `tests/recurring-obligation-match.unit.mjs` (or split into a sibling file if it gets unwieldy) to cover the one-time case: exact-match-including-date → corroborates; same-title-different-date → does **not** corroborate (falls through to normal candidate creation, proving no update path exists); different type/target/title → does not corroborate, exactly as today. Playwright coverage for "the same one-time obligation emailed twice with identical details → only one candidate ever needs action" and, separately, "a changed date shows up as a second, independently-reviewable candidate, and the original Item is provably untouched."

**Rollback/migration:** none — this reuses existing fields (`reviewStatus`, `reconciledItemId`) with a generalized matching rule. No backfill, no new schema.

**Definition of done:** re-extracting the identical obligation is silently corroborated (no duplicate, no re-ask); re-extracting a changed obligation always produces a new, independently reviewable candidate and never touches the original Item's stored fields; full existing one-time ingestion behavior (the common case: a genuinely new obligation) is unchanged and still green.

---

## Slice 7 — Google Calendar one-way publish

**Closes:** AC-12, AC-13, AC-14.
**Depends on:** nothing above — kept in Phase 1 scope per decision #4, sequenced after the trust/data-integrity slices (1-3) close, ahead of the deferred study/practice work.

**Approach, per spec §5.7 and the Gap Analysis's Google Calendar Audit:**
1. New OAuth flow, modeled directly on the existing Gmail one (`api/gmail-oauth-start.js`/`-callback.js`/`-status.js`/`-disconnect.js`, `_googleOAuth.js`, `_gmailConnectionsStore.js`) but with its own least-privilege Calendar scope and its own server-private token collection (`googleCalendarConnections`, same `if false` client-rule pattern as `gmailConnections` — copy the security boundary exactly, don't improvise a new one).
2. A parent-facing toggle per eligible Item ("publish to Google Calendar") — reuses the existing opt-in-section UI pattern once more.
3. On publish: create the Google Calendar event, store the returned event id as `googleCalendarEventId` directly on the Item (same "one canonical Item + metadata" pattern as `schedule`/`sourceRecordId`).
4. On edit of a published Item: update the same event via its stored id — never create a second one.
5. On unpublish or delete: explicitly delete the Google event and clear `googleCalendarEventId`; define (and test) what happens if the Google-side event was already deleted out-of-band (should not throw, should just clear the local mapping).
6. **No sync in the other direction.** Hayden's Homework's own `items` collection remains authoritative, per spec and per decision #4 — this is a one-way push, never a pull, never conflict resolution. Planner/Organizer remains the primary native visibility surface; Google Calendar is additional.

**Files expected to change:**
- New: `api/google-calendar-oauth-start.js`, `-callback.js`, `-status.js`, `-disconnect.js`, `_googleCalendarConnectionsStore.js`, `_googleCalendarClient.js` (mirrors the existing Gmail file set 1:1).
- `firestore.rules` — add the new top-level `googleCalendarConnections/{document=**}: allow read, write: if false;` block, exactly matching the existing `gmailConnections` block.
- `src/data/itemsRepository.js` — `googleCalendarEventId: null`, `googleCalendarPublishStatus: null` (or similar) added to `EMPTY_DEFAULTS`.
- `src/organizer/ItemForm.jsx` and/or `ParentOrganizer.jsx` — publish/unpublish control.

**Tests to add:** unit tests mirroring the existing `gmail-oauth.unit.mjs` suite's structure (69 assertions there is the bar to match, not necessarily the count) for the new OAuth/token-store module; a mocked-API test for publish/update/unpublish idempotency (never double-creates, never throws on an already-gone remote event).

**Rollback/migration:** fully additive; a household that never connects Google Calendar sees zero behavior change. No backfill.

**Definition of done:** parent can connect a Google Calendar account, publish an eligible obligation, see it appear as one event; editing the obligation updates that same event; unpublishing removes it cleanly; nothing in this flow can make Google Calendar the source of truth for anything.

---

## Deferred Slices — Study / Practice / Readiness (NOT started, per decision #5)

**Do not implement any of the following until a further, deliberate decision is made.** They are documented here in full so the design thinking isn't lost, and so this plan remains a complete map of the AC-09/10/11 gap — but current implementation priority is Calendar + Organizer + Data Ingestion (Slices 1-3 and 7 above), not this section.

### Slice 4 (deferred) — Auto-suggest a study task from a test/quiz

**Closes:** AC-09, if and when undeferred.

**Approach (unchanged from the original draft, preserved for later):** Reuse the "opt-in section, advisory suggestion, parent edits/confirms before it's authoritative" pattern already proven twice in this codebase (recurrence suggestions in `ItemForm.jsx`'s Repeats section; `recurrenceSuggestion` on `IngestionCandidate`). When a `test`/`quiz` Item is created or approved with `preparationRequired: true`, propose — never silently create — a linked `study_task` (pre-filled `parentItemId`, a simple default date offset, subject/topic carried over). Explicit non-goal even when undeferred: no scheduling intelligence, no spacing algorithm, no multiple study sessions.

### Slice 5 (deferred) — Minimum viable source-grounded practice activity

**Closes:** AC-10, if and when undeferred. **Depends on Slice 4** (needs a `study_task` to ground the activity in).

**The `App.jsx` gamified system (WorldMap/flashcards/game/loot, ~4,760 lines) is documented here as the primary reuse candidate**, per decision #5 — it is real, working, and the natural place to look first when this work resumes. It is **not wired into the canonical Item/ingestion architecture, and this plan does not propose doing so now.** The open design fork identified during the audit — (a) seed the existing flashcard engine from an assessment's topic string vs. (b) build one new, small, topic-driven activity type — remains genuinely open and is **also deferred**, not resolved by this revision. Whoever resumes this work should re-validate both the reuse assumption and the fork against whatever the product's priorities are at that time, rather than treating this plan's original leaning (toward option b) as a standing decision.

### Slice 6 (deferred) — Basic readiness state

**Closes:** AC-11, if and when undeferred. **Depends on Slice 5** (needs practice-attempt evidence to derive a readiness value from).

**Approach (unchanged from the original draft, preserved for later):** A simple, explicitly-non-predictive derivation (`needs_review` / `in_progress` / `ready`) stored on the `study_task` Item, surfaced as a small badge in Parent and Child views. Explicit non-goal even when undeferred: this is never presented as a validated mastery score.

---

## Slice 8 — Chore weekday scheduling (optional, lowest priority — unchanged)

**Closes:** the specific gap under AC-07 (no weekday/day-of-week concept for chores at all today).

**Not sequenced with confidence** because it's a judgment call whether "due every day" already satisfies spec §5.6's "minimum viable recurrence" — flagging rather than assuming. If the user wants this closed:

**Approach:** migrate a chore template's shape from `{id, text, points}` to reuse the exact `schedule` object already built and tested for recurring reminders (`{recurring, weekdays[], timeMode, daypart, time, active}`), via `src/organizer/itemBuckets.js`'s existing `normalizeSchedule`/`isRecurringDueOn`. This is explicitly "give the existing chore model the existing recurring-Item schedule concept," not a new recurrence engine — the two systems the audit flagged as parallel/duplicated would become one.

**This is the largest and riskiest slice in this plan** if attempted — it touches the one part of the app (`FamilyBoard.jsx`'s chore CRUD) that has never been migrated into the canonical `items` model at all, and every other slice in this plan deliberately avoided doing that same migration for chores (Phase 1 decision, preserved throughout this session's work). Doing it now would be the first departure from that decision. **Recommend leaving chores as-is for Phase 1 v2 unless the user explicitly prioritizes it.**

---

## Slice 9 — Remove confirmed-dead files (optional, zero functional risk, unchanged)

**Not a Phase 1 capability gap** — pure hygiene, listed because the audit found it and it's a trivial, safe win whenever the user wants it.

**Files:** `App copy.txt`, `App_Copy_V2.2.txt`, `src/App 2.jsx`, `src/App 2:7v1.jsx`, `src/Appv1.jsx`, `src/main 2.jsx`, `vite.config 2.js` (all confirmed git-tracked, confirmed unreferenced by any active import — see `CURRENT-STATE.md` §10). Optionally also `api/parse-homework.js` + `App.jsx`'s `handleAiDocumentUpload()` (self-documented as deferred/unreachable) — recommend leaving this one alone unless the user confirms the "AI Document Import" feature is truly abandoned, since it's dead-but-intentionally-scaffolded rather than dead-by-accident.

**Definition of done:** `git rm` the confirmed-accidental files; build and full test suite still green (trivially expected, since nothing imports them); one commit, clearly labeled as cleanup only.

---

## Explicitly Deferred (unchanged from Product Spec v2 §8 — permanent, not a priority call)

Full bidirectional Google Calendar sync, native mobile apps, Alexa/voice, adaptive mastery engine, longitudinal analytics, multi-household complexity, bespoke LMS integrations, dedicated hardware, and any non-schoolwork family-management domain remain out of scope for every slice above. No slice in this plan introduces any of them. This is distinct from the "Deferred Slices" section above, which is a *for-now* prioritization call (decision #5), not a permanent scope exclusion.

## What This Plan Does Not Decide For The User

One open call remains, called out explicitly rather than silently resolved, per the brief's "stop at the plan and explain the tradeoff" instruction — and it is itself deferred along with the slice it belongs to:

1. **Slice 5's design fork** (reuse the existing game engine vs. build one small new activity type) — genuinely open, and per decision #5, intentionally not being decided now. Revisit when Slice 5 is undeferred.

Nothing in the active sequence (Slices 1, 2, 3, 7) has an open design fork blocking it.
