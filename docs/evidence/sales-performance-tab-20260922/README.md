# Sales Performance integration evidence

Captured with `chrome-devtools-axi` against the real `ops.html#performance` host through `scripts/sales-performance-preview.py` on this worktree (port 4188; 4187 was another checkout). The offline envelope is derived from the supplied 14 September example, with all customer names removed. No live systems or credentials were used.

| Check | Result |
| --- | --- |
| Desktop | 1320px viewport, 1320px document width |
| Phone, light and dark | 390px viewport, 390px document width |
| Smallest visible report text | 11px |
| Host | Sales active, Performance selected, actual module and authenticated opsFetch |
| All KPIs | Quotes sent, Quoted value and Won show the fencing figures with `(fencing)` because patio is a gap |
| Per-rep table | Khairo 3 / $11,037 / 18 waiting / 2 over a week; Nithin 0 / 10; Marnin 0 / 2; quotes “not in store yet” |
| Lane filter | Fencing keeps Khairo’s three wins; patio waiting stays with Nithin and won stays a dash |
| Fencing figures | 17 enquiries, 18.1h elapsed reply, 18 quotes, $171k quoted, 3 won, 20 waiting |
| Patio figures | 8 enquiries, 27.8h elapsed reply, unavailable quote/win measures, 10 waiting |
| Stratco filter, fencing | 7 enquiries, 0 quotes and wins, 7 waiting; unsegmented measures unavailable |
| Quote expansion | Six visible rows expanded to all 18 |
| Section link | Scrolls to section while preserving `#performance` |
| Error and recovery | Synthetic failure shown, empty store shown, selected-week read recovered |
| Read authentication | Synthetic bearer token passed by the real opsFetch; selected week `2026-09-14` |

Screenshots: [desktop light](desktop-light.png), [desktop dark](desktop-dark.png), [phone light](phone-light.png), [phone dark](phone-dark.png). These are viewport captures: the host's offscreen translated SMS drawer appears spuriously in full-page captures, so those were replaced with viewport captures. Phone shots are scrolled to the per-rep table. The drawer was not opened or changed.

The Impeccable detector found one warning: the red left border on the urgent strip. It is deliberately retained from the reviewed source design and its explicit urgent-strip requirement. All other reporting sections use neutral borders.

Design desk rating and no-mistakes validation remain for firstmate's next stage. No claim of final design approval, CI or live-data verification is made here.
