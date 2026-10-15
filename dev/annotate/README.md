# Click-to-annotate notes on the Ops Dash (dev only)

The [agentation](https://agentation.com) toolbar lets the owner click on a screen of
`ops.html` and leave a note that reaches the coding agent through the agentation MCP
server (`agentation_get_all_pending`). It is a development tool. Staff never load it.

## When it loads

Only when ALL of these hold (gate: `// <ops-annotate-gate>` at the top of `ops.html`'s `<head>`):

- the address is `localhost` or `127.0.0.1` (any port), and
- the address carries `?annotate`.

Anywhere else, including the live GitHub Pages site and `file://`, the gate writes
nothing and no file in this folder is fetched. Guard: `scripts/test-ops-annotate-gate.js`
(in `npm run test:e2e`).

## Sample data only

A note carries the text of what was clicked, and the agentation server keeps notes on
disk (`~/.agentation/store.db`). So with `?annotate` the page never sees a real job
(`boot.js`):

1. a Content-Security-Policy lets the page connect only to itself and `localhost:4747`;
2. Supabase is replaced by an in-memory stand-in with a made-up session: no real
   sign-in, no real token;
3. `fetch` answers ops-api reads from `sample-data.js` (invented jobs), refuses every
   write with a plain message, and refuses any other host;
4. if this browser already holds a real sign-in or cached job on that address, the
   toolbar refuses to start and says so. Use a port you have never signed in on.

Nothing the page does changes: same screens, same code, sample answers.

## Use it

1. Keep a Claude Code session running that has the agentation MCP server
   (`claude mcp add agentation -- npx -y agentation-mcp server`, port 4747).
2. Serve the repo: `python3 -m http.server 4791 --bind 127.0.0.1`.
3. Open `http://127.0.0.1:4791/ops.html?annotate` and click the toolbar (bottom right).
4. Click anything, type the note, press Enter. Ask the agent to read
   `agentation_get_all_pending`.

## Vendored files

`vendor/` holds React 18.3.1 and react-dom 18.3.1 (UMD, MIT) and agentation 3.1.2
(PolyForm Shield 1.0.0: internal use only, not for redistribution in a competing
product). The page has no bundler or import map, so agentation's three bare imports
are rewritten to the small shims beside it. Rebuild with `scripts/vendor-agentation.sh`.
