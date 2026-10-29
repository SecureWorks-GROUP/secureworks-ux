# Paid close-out on the Ops screens (fencing and patio)

The screen side of the paid close-out (secureworks-backend PR 1029,
`docs/job-closeout-v1.md` there): a paid fencing or patio job goes to **Get Review**,
one review text goes out, and the card archives 24 hours later. This page owns what
the Ops Dash shows about that. Code: `modules/ops-job-closeout.js` (pure rules between
`// <job-closeout-core>` sentinels), hooked into `ops.html` at `// <job-closeout-tags>`
(board card and job page) and `// <job-closeout-ladder>` (status buttons).

## Preview switch

The tags and the Review text switch (below) are live for every staff user and do not
need it. The preview now gates only the Get Review status buttons (see Get Review as
a stage). Off unless `?closeout=preview` (remembered as
`localStorage.sw_closeout_preview = '1'`); `?closeout=live` turns it off again. It is a
sibling of the work order screens' `?wo=preview`, not the same switch, because this has
nothing to do with work orders and the captain may make one live without the other.
With it off, the status buttons are exactly as before.

The tags were preview-only until 29 Oct 2026. Fencing and patio cards always went
through the same renderer, so a browser that had once opened `?closeout=preview`
showed "Archives in Xh" on both while every other browser showed it on neither.

## The read-only block it draws from

Each fencing and patio row of `pipeline`, and `job_detail` (beside `job`, or on it),
may carry:

```
closeout: {
  paid_less_than_quoted: boolean,
  shortfall_inc: number | null,          // dollars inc GST, for the tag's tooltip
  review: { status, reason } | null,     // status: sent | claimed | skipped | unconfirmed | anything else = not sent
  get_review_entered_at: ISO time | null,
  archive_due_at: ISO time | null,       // when the sweep will archive it; null = it will not
  held: 'rectification' | 'callback' | null
}
```

The backend sends this block; a row without it draws nothing. The screen never
works a tag out for itself: no block, no tags, and a job type other than fencing or
patio gets no tags at all.

## The tags (small, in the card's `kanban-meta-badge` style)

| Tag | When |
|---|---|
| Paid less than quoted | `paid_less_than_quoted` is true. The card stays where it is (usually Invoiced); the tooltip names the shortfall. |
| Held: callback / Held: rectification | `held` is set. Rectification is not repeated on a Rectification card, which already shows RECT. No countdown while held. |
| Review sent | `review.status` is `sent`. |
| Review sending | `claimed` (a send in flight). |
| Review not confirmed | `unconfirmed`: a text could not be confirmed and is never re-sent. |
| Review not sent: reason | any other status, reason in words (`asked_recently` "asked in the last 90 days", `no_contact` "no contact linked", `paid_too_long_ago` "paid over 30 days ago", `refused` "text refused"; an unknown reason is shown with its underscores as spaces; with no reason, `skipped` included, it reads plain "Review not sent"). |
| Archives in Xh / Archives in under 1h / Archive due | the card is in Get Review, not held, and `archive_due_at` is a time. Hours round up. Only the backend's due time draws it: an entry time alone does not, because the sweep decides whether a card archives at all (an unpaid card dragged into Get Review never does). |

The job page shows the same tags under Next Actions.

## The Review text switch

The review text always goes out once a fencing or patio job is fully paid, unless
someone turns it off for that job first. Live (no preview needed), fencing and patio cards
in **Complete, Invoiced, Final Payment and Get Review** (and the job page, under Next
Actions) carry a small on/off **Review text** switch. On is the default: the text
sends. It must be turned off before the final payment lands, because the text goes
out within about 15 minutes of the job showing fully paid.

Whether it is off, and any claim, come ONLY from the closeout block (the same block
as the tags: the `pipeline` row's, or `job_detail`'s beside `job`, else on it); top-level
copies are never read. Who and when come from the row (or `job_detail`'s job), where
they are the job's own columns:

```
closeout.review_opt_out: boolean          // no boolean here = the back end has not shipped it: no switch
closeout.review_claim_status: text | null // the job's job_review_claims status
review_opt_out_at: ISO time | null        // on the row / job
review_opt_out_by: text | null            // on the row / job
```

A press calls ops-api `set_review_opt_out` with `{ job_id, opt_out }` and draws only
what it answers (`{ success, review_opt_out, review_opt_out_at, review_opt_out_by }`),
never an optimistic flip. The answer is written into every read the job's switch
has already been drawn from (each `pipeline` row and `job_detail` answer: the
closeout block's `review_opt_out` / `review_claim_status`, the row's who and when),
so the board and the job page both keep it when they are redrawn from their cache.
A read made after the press is drawn as it is, so another operator's change always
shows. Off shows "Review text off", and who turned it off and when (Perth
time) in the tooltip and, on the job page, as a line under the switch. Once
`review_claim_status` is set the switch is locked: `sent` reads "Review text sent",
`claimed` "Review text sending", `unconfirmed` "Review text not confirmed", and any
other status names itself ("Review text: skipped") without saying it was sent. A
refusal whose `code` or `error` is `review_already_sent` locks it and says so, drawn
with the refusal's own `review_claim_status` (else as sent).
Any other failure, another 409 included, leaves the switch as it was and says nothing
was changed.

## Get Review as a stage

`modules/sw-state-machine.js` mirrors the backend state machine: `get_review` is in
`FENCING_STAGES` and `PATIO_STAGES` after `invoiced` and is no longer a derived view.
The board columns were already Invoiced, Get Review, Archived, so this changes no
column. With the preview on, the status buttons for fencing and patio follow the
same order: Invoiced offers Get Review, Get Review offers Archived (Final Payment
offers Invoiced; a fencing Complete card offers Invoiced or Archived for the old
backlog). Moving a card into Get Review by hand asks the backend's one review sender,
under its own switches.

Guards: `tests/e2e/ops-job-closeout-core.spec.js` (pure rules) and
`tests/e2e/ops-job-closeout.spec.js` (the real page: the tags and the switch without
the preview, the ladder with the preview off and on, `set_review_opt_out` mocked).
