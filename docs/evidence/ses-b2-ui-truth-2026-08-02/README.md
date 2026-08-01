# PLAN v2 Batch 2 — UI truth, verified on the live board (2026-08-02)

Branch `fm/ses-b2-ui-truth-v1`. Authority: `ses-plan-v2-synthesis-v1` §D "Batch 2" + §D.0.
Ground truth being corrected: `ses-ui-ground-truth-v1` (2026-08-01, 417 rendered cards).

## How this was verified

Read-only session against the live production board, always
`ops.html?noAutoIntake=1#jobs` so opening the board fires no intake write
(§7.1 of the ground-truth report). The branch's changed renderers were injected
into the live page (`chrome-devtools-axi`, isolated Chrome), the board reloaded
from the real feeds, and the result measured card-by-card.

**Write safety:** every request in the session was a GET —
`makesafe_board`, `makesafe_pipeline`, `list_intake_drafts`, `makesafe_audit`,
`job_detail`, `annotations`, `list_users`, `pipeline`. Zero POST/PUT/PATCH/DELETE,
no `auto_approve_clean_intake_drafts`, no state-changing control clicked.
Client names were DOM-redacted before every capture; job refs, builder refs and
suburbs are retained.

## Results

| Check (Batch 2 exit criteria) | Result |
|---|---|
| Family-tag agreement vs canonical `ses_family` | **440 / 440 job cards agree, 0 disagree** (was 74 wrong of 407). The 407-card figure is the same population with Cancelled collapsed; Cancelled was expanded here. |
| Detail badge vs board column | **0 / 440 contradict.** The pre-change client derivation, emulated over the same 440 rows, reproduces the report's **325** disagreements (**80** material). |
| `ses_family_label` vocabulary | one spelling per family across all 440 rows (`MakeSafe` 176, `Temporary Fence MakeSafe` 126, `Roof Report` 61, `Assessment / Quote Report` 54, `Restoration` 1, `unknown` 22 → rendered "Family not determined"). |
| Docs Ready honesty | 24 cards, **0** with a drafted pack; 24 "No pack drafted" chips, column note "0 of 24 with a drafted pack". |
| Links on the card face | **94 anchors** on the visible board (was 0 on 407 cards). |
| Acceptance shot per family | 6 shots below, one per `ses_family` present on the board. |
| Console | no errors. |

### The 6 ground-truth spot-checks, re-verified

| Job | Board column | Detail badge before (ground truth) | Detail badge now | Forward-move button now |
|---|---|---|---|---|
| SWMS-261099 | Archive | New · "4 days old" + move button | **Archive · archived** | none — "moving it would undo the archive ruling" |
| SWMS-261059 | Docs Ready | New · "8 days old" | **Docs Ready** | its own live next step only |
| SWMS-26980 | Trade Report In | Docs Ready | **Trade Report In** | its own live next step only |
| SWMS-261109 | Trade Report In | Docs Ready | **Trade Report In** | its own live next step only |
| SWMS-26934 | Allocated | New · "24 days old" | **Allocated** | its own live next step only |
| SWMS-26597 | Archive | Completed This Week | **Archive** | none |

## Screenshots

| File | Shows |
|---|---|
| `00-board-docs-ready-honesty.png` | Board-wide: Docs Ready 24 with "0 of 24 with a drafted pack", every Docs Ready card marked "No pack drafted", correct family tags, link chips on card faces |
| `01-family-physical-makesafe.png` | `physical_makesafe` (SWMS-261121) — tag "MakeSafe", 3 builder links + "+2 more" |
| `02-family-temporary-fencing.png` | `temporary_fencing` (SWMS-261119) |
| `03-family-ordinary-roof-portal.png` | `ordinary_roof_portal` (SWMS-261123) |
| `04-family-assessment-quote.png` | `assessment_quote` (SWMS-26853) — the card the ground truth found tagged "Roof Report"; now "Assessment / Quote Report", with the full triad (Assessment Report / Photo Schedule / Quote) clickable on the face |
| `05-family-restoration.png` | `restoration` (SWMS-26936) — tag "Restoration" |
| `06-family-not-determined.png` | refused family (SWMS-26597) — "Family not determined", not a text guess |
| `10-detail-archived-SWMS-261099-header.png` | The counterpart to ground truth `shots/13`: the archived card now opens **Archive · archived**, not "New · 4 days old" |
| `11-detail-archived-SWMS-261099-next-step.png` | Next step on the same card: no forward move, against the trade note saying it must stay archived |

## Out of scope here (unchanged on purpose)

- The per-family **evidence/chip recipe** and any per-family required-link rule —
  captain decision C.4, deliberately not implemented (D "what could go wrong").
- Roof primary-link selection / classifying `builder_portal` links (G5, C.4);
  the card renders every link the row carries, including undifferentiated ones.
- The Docs Ready column keeps its name and meaning; only the false implication
  that a pack exists was removed.
