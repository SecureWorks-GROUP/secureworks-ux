# Group work-order repair, 27 October 2026

Owner requested visible group cards for the Zoo crew and an office override because client approval was already given. Acceptance: show group status, crew hours to office, and an office-only reasoned override; preserve individual-share privacy and do not freeze or submit invoices. Backend change supplies the feature marker and counts fresh attributed waivers.

## Run checkpoint
Local implementation and verification complete; see verify/evidence/20261027-group-office-signoff.md. Next: publish reviewed backend and UX changes, verify live response, then record the owner-authorised office waiver on the Zoo job through the existing API. No live override has been recorded yet.

### 2026-11-06 08:35 Perth · Firstmate crewmate (Codex)
- Project: Trade App · invoice job selection integration. Existing six-part project pointer and records custodian remain unlocated; no replacement project created.
- Asked: integrate the owner-authorised named-installer invoice picker with the backend's protected, default-off capability. Frontend source only.
- Did: classified all four current search request sites; only the weekly day picker and older manual-invoice datalist request invoice_picker=1. Exempted authenticated own-invoice generation from the last-opened foreign-job detail guard; ordinary job writes, selection payloads, allocations, pay/rates/tax/super, money stripping and preview/auth/weekly confirmation guards remain unchanged.
- Evidence: source commit containing this record; trade.html and trade-app.md; private firstmate task SOURCE-TRACE.md, source.diff and js-syntax.log. Exact pushed head and ready PR readback belong in the private final receipt.
- Verified: bounded static syntax by self, both inline JS blocks parsed with Node v22.23.1; git diff --check passed. Feature none; no established invoice verify feature found. No browser, suite, live affected-user or administrative UI proof. Native hooks and existing required PR Sanity Checks remain enabled.
- Result: frontend source handoff only. Backend release, named capability grants and affected-user live journey remain firstmate-owned; no invoice/draft/send/Xero/payment or live change performed. The existing backend extra-items writer does not enforce allocated-only membership; this work changes discovery, not that pre-existing write contract.
- Resume: firstmate serialises backend then frontend release, reads exact deployed versions back, commissions exact named grants and affected-user proof. Granny taxonomy and unresolved staff identity remain outside this source slice. tools/live-state.py not run because the owning six-part/live-state pointer is missing; final forge observations retained privately.
