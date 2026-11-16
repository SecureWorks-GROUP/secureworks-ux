# SecureWorks Crew: decisions

What was decided while building the new trades' app, the options, why, and how
to reverse each one. Marnin's own calls come first. The money rules are the CFO
thread's contract (secureworks-projects `job-profit/trade-app/contract.md`).

## Marnin's calls

- 13 Nov 2026. A new app beside the old one; the old one stays on. Any trade
  can find and open any job (prices hidden; the customer's phone only once on
  the job). A trade can add themselves to a job for today or a future day. A
  trade can change their hourly rate for a job, flagged to the office. No
  location tracking. iPhone first.
- 15 Nov 2026. Five tabs: Today, Schedule, Jobs, Pay, Profile. It must read
  like business software. Light only. The SecureScope look. A trade sees only
  their own bookings in Schedule; managers and scopers see everyone. Pay is the
  timesheet first, then the invoice. Build the full app and get it live beside
  the old one.

## Decisions made in the build

1. **Today is only "now"; the calendar is its own tab.**
   Options: keep the week strip on Today; split them. Why: Today was doing two
   jobs, and the month was buried. Reverse: put a week strip back on Today.

2. **The slate top bar stays, as the one dark area.**
   Options: a white bar; the style guide's slate bar. Why: it carries the brand
   and the screen title, and it is small. Marnin asked for light only, so it is
   the only dark block besides the on-site bar and toasts. Reverse: one colour
   change in `css/app.css` (`.appbar`).

3. **Clock on is a plain large button, not a slide.**
   Options: slide to confirm; a button. Why: the style guide has nothing that
   slides, and clocking off confirms the times anyway. Reverse: restore the
   slide in `js/ui/kit.js`.

4. **Slate means chosen; orange is only the next thing to do.**
   The active tab, a chosen segment and a chosen filter are slate. One orange
   button a screen. From the style guide. Reverse: token change.

5. **One set of status words.**
   Bookings: To confirm, Confirmed, On site, Done. Jobs: To schedule,
   Scheduled, In progress, Complete. Invoices use the server's own words.
   Amber needs you, slate is happening now, green is settled. Reverse: the
   `STATUS` list in `js/ui/kit.js`.

6. **The job number is drawn the same everywhere (the square job tag).**
   Borrowed from SecureScope's part tag. Reverse: `JobTag` in `js/ui/kit.js`.

7. **Booking levels without location tracking.**
   Allocated (the office booked you), Confirmed (you said yes, or booked
   yourself), On site (clocked on), Done (clocked off), On timesheet. Tapping
   Navigate tells the office you are on the way. "Cannot make it" raises an
   alert to the office. Reverse: none needed; it uses existing server actions.

8. **Who sees Everyone.**
   Office, anyone who manages a kind of work, and anyone the office has marked
   as seeing all jobs (`users.trade_sees_all_jobs`), which is how a scoper is
   given it. A plain trade who opens the managers' view gets their own week.
   Reverse: `decorate` in `js/lib/auth.js`.

9. **The app never picks how a job is paid.**
   It shows the server's answer. A job with no answer says "Ask the office how
   this job is billed" and stays off the invoice. Commission is offered only
   where the server allows it. An agreed work order amount is shown, not typed.
   Reverse: not advised; it is the contract's rule R2 to R4.

10. **The week's draft is shared with the old app.**
    It is saved on the account (the same saved draft the old app uses), so a
    trade can start a week in one app and finish it in the other. The phone
    keeps a copy only for when there is no signal. Known limits: amount-only
    extra lines added here are kept but the old app does not show them; a draft
    holding the old app's own extra-hours rows cannot be sent from here, and
    the screen says so. Reverse: set the draft to phone-only in
    `js/lib/invoice.js`.

11. **Expenses are not in the invoice total.**
    Options: add them to "You are paid" as the first mockup did; show them as
    repaid separately. Why: an expense is its own record and its own bill in
    Xero, so the invoice total has to equal the invoice's bill. Reverse: needs
    a server field for "expenses approved and unpaid"; see the contract, D-3.

12. **Days booked but not yet worked are not on the timesheet.**
    They were clutter. One line says how many are still to come. Reverse: list
    them again in `js/screens/timesheet.js`.

13. **The owner can view the app as any trade, read only.**
    The same server feature the old app has. Nothing can be changed or sent in
    that view. Reverse: remove the picker from Profile.

14. **Clock events wait for signal; refusals never wait.**
    A clock on or off made with no signal is kept and sent later, as the old
    app does. Anything the server refuses is shown in words and dropped. Money
    never waits. The contract's R8 reads stricter (no queue for clock actions);
    this keeps the old app's behaviour so a trade in a dead spot can still
    clock on. Reverse: stop queueing clock events in `js/screens/clock.js`.

15. **Three server switches stay off until Marnin turns them on.**
    Opening a job you are not on, booking yourself ahead, typing your rate
    (secureworks-backend `docs/trade-open-access-v1.md`). With them off the app
    still works and says so in words.

## Not built

- The customer confirming a date as a further "locked in" level.
- A sign-later link sent to the customer for ordinary jobs.
- Texting the customer automatically at sign-off. Nothing is ever sent to a
  customer without a person pressing send.

## Not proven yet

- It has run only on made-up data in a phone-sized Chrome. It has not run on a
  real iPhone in Safari, or against the real server with a real sign-in.
- The owner's read-only view and the shared weekly draft follow the server's
  documented shapes but have not been exercised against the real server.
