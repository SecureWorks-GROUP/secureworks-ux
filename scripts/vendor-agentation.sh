#!/usr/bin/env bash
# Rebuilds dev/annotate/vendor/ from pinned npm tarballs (npm pack checks each
# tarball against the registry's integrity hash). Dev-only: see dev/annotate/README.md.
# The agentation module imports "react", "react-dom" and "react/jsx-runtime" by bare
# name; this page has no bundler or import map, so those three names are rewritten
# to the small shims beside it, which hand over the React 18 UMD globals.
set -euo pipefail
REACT=18.3.1
AGENTATION=3.1.2
root="$(cd "$(dirname "$0")/.." && pwd)"
out="$root/dev/annotate/vendor"
tmp="$(mktemp -d)"
trap 'rm -rf "$tmp"' EXIT
cd "$tmp"
for pkg in "react@$REACT" "react-dom@$REACT" "agentation@$AGENTATION"; do
  name="${pkg%@*}"
  mkdir -p "$name"
  npm pack "$pkg" --silent >/dev/null
  tar xzf "$name"-*.tgz -C "$name" --strip-components 1
done
cp react/umd/react.production.min.js "$out/react.production.min.js"
cp react-dom/umd/react-dom.production.min.js "$out/react-dom.production.min.js"
cp react/LICENSE "$out/LICENSE-react"
cp agentation/LICENSE "$out/LICENSE-agentation"
sed -e 's#from "react/jsx-runtime"#from "./jsx-runtime.js"#g' \
    -e 's#from "react-dom"#from "./react-dom.js"#g' \
    -e 's#from "react"#from "./react.js"#g' \
    agentation/dist/index.mjs > "$out/agentation.js"
if grep -E 'from "react' "$out/agentation.js" >/dev/null; then
  echo "vendor-agentation: a bare react import is left in agentation.js" >&2
  exit 1
fi
echo "vendored react@$REACT react-dom@$REACT agentation@$AGENTATION into dev/annotate/vendor"
