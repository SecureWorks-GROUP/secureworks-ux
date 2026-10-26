# One scope reader for the job page

`modules/job-scope-record.js` reads what a scoping tool saved on a job (`jobs.scope_json` and `jobs.pricing_json`, both already in `job_detail`) and returns one plain object. Every job view reads the scope through it, so a new tool is taught in one place.

## Shapes it knows

| Kind | Saved by | How it is told apart |
|---|---|---|
| `engine-patio` | Scope Engine patio (scope-engine-v2 `patio/scoper/src/jobsystem.ts`, `ScopeRecord` v2.0) | `tool: 'patio-scoper'` with `draft` and `revision` |
| `fence` | fence designer and Scope Engine fence (same shape) | `job.runs` or `job.gates`, or `sections` |
| `old-patio` | the older patio page | `config`, `patios[]`, or `length`/`projection` at the root |
| `none` / `unknown` | nothing saved, unreadable, or another shape | |

## What `read(job)` returns

`kind`, `tool`, `trade`, `revision` (engine only: `n`, `sealedAt`, `savedAt`, `frozenId`, `catalogue`, `outputsAgree`, `earlier[]`, `options[]`), `inputs[]` (`group`, `label`, `value`, in words), `notes[]`, `lines[]` (engine material lines), `documents[]` (the five Scope Engine documents of the sealed revision), `toolUrl`, and `money`.

`money` holds each figure as a number or `null`. `null` means not known and is shown as "Not known yet" or "Not priced yet", never `$0`. A total cost with a part missing is `costIsPartial` and reads "so far". `estimatedMargin(rec)` is the ex GST margin of the sealed costs, or null when the sale or the cost is not known.

## Where the job page uses it

- `scopeToolUrlFor(jobType, job)`: a Scope Engine record (or a job list row whose `pj_tool` is `patio-scoper`) opens `https://marninms98-dotcom.github.io/patio/scope-engine/`; everything else opens the tool it always has.
- Overview: the summary line, an estimated margin when there are no purchase orders, and the Scope card (`scopeCardHtml`: revision, inputs, notes, documents).
- Money: the quote card's one line and revision, the Costs column's `costsCardHtml`, the margin bar from the sealed estimate when there are no purchase orders (never "Margin: 100%"), and the frozen copy named by the engine's revision.
- Build: the sealed scope and its material lines. The old patio tool is not embedded for an engine job.
- Files: the Scope Engine documents above the photos.
- Dispatch `scopeFacts` and Overview v2 `scopeMeta` read engine records through it.

The module only reads. It never writes a job, an order or a document.

## Tests

- `modules/job-scope-record.test.cjs` (`npm run test:job-scope-record`): every shape, money rules, escaping.
- `tests/e2e/ops-job-page-scope-engine.spec.js`: the real `ops.html` on a Scope Engine job (`tests/fixtures/scope-engine-patio.js`), tab by tab.
