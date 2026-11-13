# SecureWorks Crew

The new trades' app. A from-scratch front end that talks to the same server as
`trade.html` (ops-api and ghl-proxy), with the same sign-in. The two run side by
side: a trade can use either on the same day.

Open it at `/secureworks-ux/crew/`. Add `?demo` to run it on made-up jobs with
no sign-in (`?demo=crew`, `?demo=lead`, `?demo=office`).

## How it is built

No build step. Plain ES modules, served as they are by GitHub Pages.

- `index.html` config (Supabase URL and public key), fonts, styles.
- `vendor/` Preact, htm and supabase-js, copied in so the app opens offline.
- `css/app.css` tokens and shared components. `css/more.css`, `pay.css`,
  `reports.css`, `manager.css` hold styles for their screens only.
- `js/lib/` no screens in here.
  - `h.js` the one import for `html`, hooks and `cx`.
  - `api.js` `api(action, params, body)` for ops-api, `ghl(...)` for ghl-proxy.
    A body means POST. Errors are `ApiError` with `.refused` (server said no)
    and `.offline`. `friendly(err)` gives words for a toast.
  - `store.js` `useStore`, `useQuery(key, fetcher, { ttl, persist })`,
    `invalidate(prefix)`, `local` (namespaced localStorage).
  - `auth.js` sign-in and the decorated user (`office`, `manager`, `managed`,
    `seesMoney`, `perMetre`, `details`, `label`).
  - `dates.js` everything is Perth time. `model.js` turns server rows into
    bookings and labels. `invoice.js` is the weekly invoice as plain data.
  - `outbox.js` writes that wait for signal (notes, problems, clock, photos).
    Money never queues.
  - `router.js` hash routes, `go(path)`, `back(fallback)`.
- `js/ui/kit.js` Page, Button, Sheet, Slide, toast, ask, PhotoGrid and the rest.
  `js/ui/icons.js` the icon set. `js/ui/logo.js` the SecureWorks Group logo.
  `js/ui/paybits.js` pieces the pay screens share (done screen, server money
  rows, signature pad, stars).
- `js/lib/roster.js` shared reads for the manager screens (everyone's
  bookings, people, days off), keeping only the fields those screens draw.
- `js/screens/` one file per screen. `main.js` maps routes to screens.
- `js/demo/` the in-browser demo server. Each screen group adds its answers in
  its own `extra-*.js` through `registerDemo`.
- `sw.js` offline shell, scoped to `/secureworks-ux/crew/` only.

## Rules that must hold

- The server owns every money figure. Show `trade_payable`, `gross_earned`,
  `my_share` and the rest as sent. Anything worked out here is labelled an
  estimate. An invoice is never sent twice: after an unclear failure, look for
  it in `my_trade_invoices` first.
- A refusal from the server is shown in plain words and never queued.
- Prices never reach a trade who is not office: free text goes through
  `noPrices`, and no priced document is linked.
- Notes are always sent `visibility: 'internal_only'`.
- This app has its own storage keys (`crew:` prefix) and its own outbox. It
  never reads or writes the old app's queues.
- Do not put the word `trade` in a file name or path here: the old app's
  service worker caches any path that contains it.
- Words on screen: short, plain, no jargon, no emoji, no long dashes. One
  obvious action per screen. Hours are computed from start, finish and break;
  nobody types hours.

## Checking it

`?demo` is the test bed. `tests/e2e/crew-*.spec.js` drive it with Playwright.
