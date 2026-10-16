# Trade App job work order, live (16 Oct 2026)

Captured offline from `tests/e2e/trade-job-work-order.spec.js` fixtures (no live data),
with a stale switch left in the browser: `?wo=live` in the address and
`localStorage.sw_wo_preview = '0'`. The allocated installer still sees the approved work
order on the Scope tab, tasks with hours and no dollar figure.

- `trade-scope-work-order-stale-switch.png`: the job page, Scope tab.
- `trade-work-order-section.png`: the work order section alone.
