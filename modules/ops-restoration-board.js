// Restoration board: the Restoration pipeline tab (secureworks-backend
// docs/restoration-board-v1.md). Restoration work (insurance restoration jobs
// from builders such as ML Builders) has its own simple seven-column board and
// no longer sits on the make-safe board. The back end owns every stage: this
// screen paints ops-api restoration_board and moves a card only through
// restoration_set_stage. It derives no stage itself.
//
// Office only: a card carries invoice amounts. One read per board open; a move
// is one POST, then the card is repainted from the card the server returns.
// A failed read says so in words and never draws an empty board as if there
// were no jobs. A refused move shows the back end's own words, never a code.
(function (root) {
  'use strict';

  // <restoration-board-core>
  var Core = {};

  Core.STAGES = [
    { key: 'new', label: 'New', accent: '#4C6A7C' },
    { key: 'booked', label: 'Booked', accent: '#3498DB' },
    { key: 'report_due', label: 'Report due', accent: '#F39C12' },
    { key: 'quote_with_builder', label: 'Quote with builder', accent: '#1ABC9C' },
    { key: 'works', label: 'Works in progress', accent: '#F15A29' },
    { key: 'invoiced', label: 'Invoiced', accent: '#9B59B6' },
    { key: 'closed', label: 'Closed', accent: '#27AE60' },
  ];
  var STAGE_KEYS = Core.STAGES.map(function (s) { return s.key; });

  function text(value) {
    return typeof value === 'string' ? value.trim() : (value == null ? '' : String(value).trim());
  }

  Core.money = function (amount) {
    var n = Number(amount);
    if (amount === null || amount === undefined || amount === '' || !isFinite(n)) return '';
    var fixed = Math.abs(n).toFixed(2).split('.');
    return (n < 0 ? '-' : '') + '$' + fixed[0].replace(/\B(?=(\d{3})+(?!\d))/g, ',') + '.' + fixed[1];
  };

  // The board's columns: always the seven stages in order. Label and count come
  // from the server's `columns` when it sends them; the count falls back to the
  // cards in that stage. A card in a stage the page does not know is never
  // dropped: it goes in a "Stage unknown" column drawn only when non-empty.
  Core.columns = function (payload) {
    var cards = (payload && Array.isArray(payload.cards)) ? payload.cards : [];
    var sent = {};
    ((payload && Array.isArray(payload.columns)) ? payload.columns : []).forEach(function (c) {
      if (c && c.key) sent[c.key] = c;
    });
    var out = Core.STAGES.map(function (s) {
      var server = sent[s.key] || {};
      var mine = cards.filter(function (c) { return c && c.stage === s.key; });
      var count = Number(server.count);
      return {
        key: s.key,
        label: text(server.label) || s.label,
        accent: s.accent,
        count: isFinite(count) && server.count !== null && server.count !== undefined ? count : mine.length,
        cards: mine,
      };
    });
    var unknown = cards.filter(function (c) { return c && STAGE_KEYS.indexOf(c.stage) < 0; });
    if (unknown.length) {
      out.push({ key: 'unknown', label: 'Stage unknown', accent: '#E74C3C', count: unknown.length, cards: unknown });
    }
    return out;
  };

  // After a move: swap the one card for the server's copy and recount from the
  // cards (the server counts the same way: cards per stage).
  Core.withCard = function (payload, card) {
    if (!payload || !card || !card.id) return payload;
    var cards = (Array.isArray(payload.cards) ? payload.cards : []).slice();
    var at = -1;
    cards.forEach(function (c, i) { if (c && c.id === card.id) at = i; });
    if (at >= 0) cards[at] = card; else cards.unshift(card);
    var columns = Core.STAGES.map(function (s) {
      return {
        key: s.key,
        label: s.label,
        count: cards.filter(function (c) { return c && c.stage === s.key; }).length,
      };
    });
    (Array.isArray(payload.columns) ? payload.columns : []).forEach(function (c) {
      columns.forEach(function (mine) { if (c && c.key === mine.key && text(c.label)) mine.label = text(c.label); });
    });
    return Object.assign({}, payload, { cards: cards, columns: columns });
  };

  // Case-insensitive search over the words on a card.
  Core.matches = function (card, query) {
    var q = text(query).toLowerCase();
    if (!q) return true;
    var hay = [card.job_number, card.site, card.site_suburb, card.client_name, card.builder,
      card.builder_reference, card.builder_purchase_order, card.quote && card.quote.number]
      .concat((card.invoices || []).map(function (i) { return i && i.invoice_number; }))
      .concat((card.crew || []).map(function (c) { return c && c.name; }))
      .map(text).join(' ').toLowerCase();
    return hay.indexOf(q) >= 0;
  };

  var QUOTE_WORDS = { draft: 'draft', sent: 'with builder', approved: 'approved', declined: 'declined' };

  // "Q1 with builder", "Q1 approved". Empty when no quote is recorded.
  Core.quoteChip = function (quote) {
    if (!quote || !text(quote.number)) return '';
    var status = text(quote.status).toLowerCase();
    var approved = text(quote.approved_number);
    if (approved && approved === text(quote.number)) status = 'approved';
    var words = QUOTE_WORDS[status] || status.replace(/_/g, ' ');
    return text(quote.number) + (words ? ' ' + words : '');
  };

  var INVOICE_WORDS = { DRAFT: 'Draft', SUBMITTED: 'Awaiting approval', AUTHORISED: 'Sent', PAID: 'Paid', VOIDED: 'Voided', DELETED: 'Deleted' };

  // "INV-0912 Sent $1,320.00", and ", $500.00 owing" when part paid.
  Core.invoiceChip = function (inv) {
    if (!inv) return '';
    var status = text(inv.status).toUpperCase();
    var parts = [text(inv.invoice_number) || 'Invoice'];
    parts.push(INVOICE_WORDS[status] || (status ? status.charAt(0) + status.slice(1).toLowerCase() : 'Status not known'));
    var total = Core.money(inv.total);
    if (total) parts.push(total);
    var due = Number(inv.amount_due);
    var total$ = Number(inv.total);
    if (status === 'AUTHORISED' && isFinite(due) && due > 0 && isFinite(total$) && due < total$) {
      return parts.join(' ') + ', ' + Core.money(due) + ' owing';
    }
    return parts.join(' ');
  };

  Core.crewLine = function (crew) {
    var names = [];
    (crew || []).forEach(function (c) {
      var n = text(c && c.name);
      if (n && names.indexOf(n) < 0) names.push(n);
    });
    return names.join(', ');
  };

  // A move to Closed that the server says needs something (nothing invoiced, or
  // a draft still open) asks for a no-charge reason. Every other refused move
  // is disabled with the server's words.
  Core.needsNoChargeReason = function (move) {
    return !!(move && move.stage === 'closed' && text(move.needs));
  };

  Core.isUnknownAction = function (err) {
    var message = text(err && err.message) || text(err && err.body && err.body.error);
    return /^Unknown action/i.test(message);
  };

  // What a failed read says. Never "no jobs".
  Core.readFailedText = function (err) {
    if (Core.isUnknownAction(err)) {
      return 'The Restoration board is not switched on yet: the server does not know it. Nothing has been lost.';
    }
    var detail = text(err && err.message);
    return 'The Restoration board could not be read, so no jobs are shown.' + (detail ? ' ' + detail : '');
  };

  Core.refusalText = function (err) {
    var detail = text(err && err.message);
    return detail || 'The move did not go through. Try again.';
  };

  function attr(esc, v) { return esc(v); }

  Core.cardHtml = function (card, esc, openMenuId) {
    esc = esc || function (v) { return String(v == null ? '' : v); };
    var id = text(card.id);
    var html = '<div class="kanban-card rb-card" data-rb-card="' + attr(esc, id) + '" data-job-id="' + attr(esc, id) + '"'
      + ' onclick="RestorationBoard.openJob(\'' + attr(esc, id) + '\')">';
    html += '<div class="kanban-card-header">';
    html += '<span class="kanban-client" data-rb-site>' + esc(text(card.site_suburb) || text(card.site) || 'Site not recorded') + '</span>';
    if (card.mode_label) html += '<span class="rb-mode" data-rb-mode>' + esc(card.mode_label) + '</span>';
    html += '</div>';
    if (card.job_number) html += '<div class="kanban-jobnum" data-rb-jobnum>' + esc(card.job_number) + '</div>';
    var builder = [text(card.builder), text(card.builder_reference)].filter(Boolean).join(' · ');
    if (builder) html += '<div class="kanban-suburb" data-rb-builder>' + esc(builder) + '</div>';
    if (card.next_step) html += '<div class="rb-next" data-rb-next>' + esc(card.next_step) + '</div>';
    var chips = '';
    var quote = Core.quoteChip(card.quote);
    if (quote) chips += '<span class="kanban-meta-badge rb-chip-quote" data-rb-quote>' + esc(quote) + '</span>';
    (card.invoices || []).forEach(function (inv) {
      var chip = Core.invoiceChip(inv);
      if (chip) chips += '<span class="kanban-meta-badge rb-chip-invoice" data-rb-invoice>' + esc(chip) + '</span>';
    });
    if (card.builder_purchase_order) {
      chips += '<span class="kanban-meta-badge" data-rb-po>' + esc(card.builder_purchase_order) + '</span>';
    }
    if (chips) html += '<div class="kanban-meta">' + chips + '</div>';
    var crew = Core.crewLine(card.crew);
    if (crew) html += '<div class="rb-crew" data-rb-crew>Crew: ' + esc(crew) + '</div>';
    var moves = Array.isArray(card.moves) ? card.moves : [];
    if (moves.length) {
      var open = openMenuId === id;
      html += '<div class="rb-move" onclick="event.stopPropagation()">';
      html += '<button type="button" class="rb-move-btn" data-rb-move-toggle aria-expanded="' + (open ? 'true' : 'false') + '"'
        + ' onclick="RestorationBoard.toggleMoves(\'' + attr(esc, id) + '\')">Move to&hellip;</button>';
      if (open) {
        html += '<div class="rb-move-list" data-rb-moves>';
        moves.forEach(function (m) {
          var allowed = m.allowed !== false;
          var askReason = allowed && Core.needsNoChargeReason(m);
          html += '<div class="rb-move-item">';
          html += '<button type="button" data-rb-move="' + attr(esc, m.stage) + '"' + (allowed ? '' : ' disabled')
            + ' onclick="RestorationBoard.move(\'' + attr(esc, id) + '\',\'' + attr(esc, m.stage) + '\')">'
            + esc(text(m.label) || m.stage) + '</button>';
          if (!allowed && text(m.needs)) {
            html += '<div class="rb-move-needs" data-rb-needs>' + esc(m.needs) + '</div>';
          } else if (askReason) {
            html += '<div class="rb-move-needs" data-rb-needs>' + esc(m.needs) + ' You will be asked why it is closed with no charge.</div>';
          }
          html += '</div>';
        });
        html += '</div>';
      }
      html += '</div>';
    }
    html += '</div>';
    return html;
  };

  Core.boardHtml = function (payload, esc, ui) {
    esc = esc || function (v) { return String(v == null ? '' : v); };
    ui = ui || {};
    var cols = Core.columns(payload);
    var html = '<div class="rb-board" data-rb-board>';
    html += '<div class="rb-bar">';
    html += '<label class="rb-closed-toggle"><input type="checkbox" data-rb-include-closed' + (ui.includeClosed ? ' checked' : '')
      + ' onchange="RestorationBoard.setIncludeClosed(this.checked)"> Show every closed, cancelled and lost job</label>';
    if (ui.notice) html += '<div class="rb-notice" data-rb-notice role="alert">' + esc(ui.notice) + '</div>';
    html += '</div>';
    html += '<div class="kanban-container rb-kanban" style="flex:1;">';
    cols.forEach(function (col) {
      var shown = col.cards.filter(function (c) { return Core.matches(c, ui.search); });
      html += '<div class="kanban-col" data-status="restoration_' + esc(col.key) + '" data-rb-col="' + esc(col.key) + '">';
      html += '<div class="kanban-col-header" style="border-bottom-color:' + col.accent + ';">' + esc(col.label)
        + '<span class="count" data-rb-count>' + esc(col.count) + '</span></div>';
      html += '<div class="kanban-body">';
      if (!shown.length) {
        html += '<div class="rb-empty">' + (col.cards.length ? 'No jobs match the search' : 'No jobs') + '</div>';
      } else {
        shown.forEach(function (c) { html += Core.cardHtml(c, esc, ui.openMenuId); });
      }
      html += '</div></div>';
    });
    html += '</div></div>';
    return html;
  };

  Core.failedHtml = function (err, esc) {
    esc = esc || function (v) { return String(v == null ? '' : v); };
    return '<div class="rb-failed" data-rb-failed role="alert">'
      + '<strong>Restoration board not shown.</strong> ' + esc(Core.readFailedText(err))
      + ' <button type="button" class="btn btn-secondary btn-sm" onclick="RestorationBoard.reload()">Try again</button></div>';
  };
  // </restoration-board-core>

  if (typeof module !== 'undefined' && module.exports) {
    module.exports = Core;
    return;
  }

  var CSS = ''
    + '.rb-board{display:flex;flex-direction:column;height:100%;min-height:0;}'
    + '.rb-bar{display:flex;align-items:center;gap:12px;flex-wrap:wrap;padding:0 0 10px;font-size:12px;color:var(--sw-text-sec);}'
    + '.rb-closed-toggle{display:inline-flex;align-items:center;gap:6px;cursor:pointer;}'
    + '.rb-notice{background:#FFF7ED;border:1px solid #FED7AA;color:#9A3412;border-radius:10px;padding:6px 10px;font-size:12px;}'
    + '.rb-failed{background:#FFF7ED;border:1px solid #FED7AA;color:#9A3412;border-radius:12px;padding:14px 16px;font-size:13px;margin:8px 0;}'
    + '.rb-empty{text-align:center;padding:20px;color:var(--sw-text-sec);font-size:12px;}'
    + '.rb-mode{font-size:10px;font-weight:700;color:#0F766E;background:#CCFBF1;padding:2px 7px;border-radius:20px;white-space:nowrap;margin-left:6px;}'
    + '.rb-next{font-size:11px;color:var(--sw-dark,#293C46);margin-top:5px;line-height:1.35;}'
    + '.rb-crew{font-size:11px;color:#5a6068;margin-top:5px;}'
    + '.rb-chip-quote{background:rgba(26,188,156,0.12);color:#0F766E;font-weight:600;}'
    + '.rb-chip-invoice{background:rgba(155,89,182,0.10);color:#6C3483;font-weight:600;}'
    + '.rb-move{margin-top:8px;}'
    + '.rb-move-btn{font-size:11px;font-weight:600;border:1px solid rgba(0,0,0,0.10);background:#fff;color:var(--sw-dark,#293C46);border-radius:14px;padding:3px 10px;cursor:pointer;}'
    + '.rb-move-list{margin-top:6px;display:flex;flex-direction:column;gap:4px;background:#fff;border:1px solid rgba(0,0,0,0.08);border-radius:10px;padding:6px;}'
    + '.rb-move-item button{width:100%;text-align:left;font-size:12px;border:none;background:transparent;padding:4px 6px;border-radius:6px;cursor:pointer;color:var(--sw-dark,#293C46);}'
    + '.rb-move-item button:hover:not([disabled]){background:rgba(41,60,70,0.06);}'
    + '.rb-move-item button[disabled]{color:#9AA4AB;cursor:not-allowed;}'
    + '.rb-move-needs{font-size:10px;color:#8A6D3B;padding:0 6px 3px;line-height:1.35;}';

  function ensureStyle() {
    if (document.getElementById('restorationBoardStyle')) return;
    var s = document.createElement('style');
    s.id = 'restorationBoardStyle';
    s.textContent = CSS;
    document.head.appendChild(s);
  }

  function esc(value) {
    return typeof root.escapeHtml === 'function'
      ? root.escapeHtml(value == null ? '' : String(value))
      : String(value == null ? '' : value).replace(/[&<>"']/g, function (c) {
        return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
      });
  }

  var state = { payload: null, includeClosed: false, openMenuId: '', notice: '', busy: false, readSeq: 0 };

  function container() { return document.getElementById('jobsBody'); }
  function onBoard() { return typeof root._pipelineTab === 'undefined' || root._pipelineTab === 'restoration'; }
  function search() { return typeof root._jobSearch === 'string' ? root._jobSearch : ''; }

  function paint() {
    var el = container();
    if (!el || !onBoard() || !state.payload) return;
    ensureStyle();
    el.innerHTML = Core.boardHtml(state.payload, esc, {
      includeClosed: state.includeClosed,
      openMenuId: state.openMenuId,
      notice: state.notice,
      search: search(),
    });
    if (typeof root.setupKanbanHorizontalScroll === 'function') root.setupKanbanHorizontalScroll();
  }

  function remember(payload) {
    state.payload = payload;
    // ops.html's other screens read _pipelineData.columns as a map of arrays.
    try { root._pipelineData = { columns: {}, _restoration: payload }; } catch (e) { /* not on ops.html */ }
  }

  function load(opts) {
    opts = opts || {};
    var el = container();
    var seq = ++state.readSeq;
    if (el && !state.payload) {
      ensureStyle();
      el.innerHTML = '<div class="rb-empty" data-rb-loading>Loading the Restoration board&hellip;</div>';
    }
    var params = state.includeClosed ? { include_closed: '1' } : {};
    return Promise.resolve().then(function () { return root.opsFetch('restoration_board', params); }).then(function (res) {
      if (seq !== state.readSeq) return;
      if (!res || !Array.isArray(res.cards)) {
        throw new Error('The server answered without a list of jobs.');
      }
      remember(res);
      if (!opts.background || !(typeof root.jobDetailIsOpen === 'function' && root.jobDetailIsOpen())) paint();
    }).catch(function (err) {
      if (seq !== state.readSeq) return;
      // A failed read never leaves an old board on screen as if it were current.
      state.payload = null;
      try { root._pipelineData = null; } catch (e) { /* not on ops.html */ }
      var box = container();
      if (box && onBoard()) { ensureStyle(); box.innerHTML = Core.failedHtml(err, esc); }
    });
  }

  function findMove(card, stage) {
    var moves = (card && Array.isArray(card.moves)) ? card.moves : [];
    for (var i = 0; i < moves.length; i++) if (moves[i] && moves[i].stage === stage) return moves[i];
    return null;
  }

  function findCard(id) {
    var cards = (state.payload && state.payload.cards) || [];
    for (var i = 0; i < cards.length; i++) if (cards[i] && cards[i].id === id) return cards[i];
    return null;
  }

  function move(jobId, stage) {
    if (state.busy) return Promise.resolve();
    var card = findCard(jobId);
    var m = findMove(card, stage);
    if (!card || !m || m.allowed === false) return Promise.resolve();
    var body = { job_id: jobId, stage: stage };
    if (Core.needsNoChargeReason(m)) {
      var answer = root.prompt(m.needs + '\n\nTo close ' + (card.job_number || 'this job') + ' with no charge, say why:', '');
      if (answer === null) return Promise.resolve();
      answer = String(answer).trim();
      if (!answer) {
        state.notice = 'Not moved: a reason is needed to close a job with no charge.';
        paint();
        return Promise.resolve();
      }
      body.no_charge_reason = answer;
    }
    state.busy = true;
    state.notice = '';
    return Promise.resolve().then(function () { return root.opsPost('restoration_set_stage', body); }).then(function (res) {
      state.busy = false;
      state.openMenuId = '';
      if (res && res.card && res.card.id) {
        remember(Core.withCard(state.payload, res.card));
        paint();
        if (typeof root.showToast === 'function') {
          root.showToast((res.card.job_number || 'Job') + ' is now ' + (res.card.stage_label || stage) + '.', 'success');
        }
      } else {
        load();
      }
    }).catch(function (err) {
      state.busy = false;
      state.notice = (card.job_number ? card.job_number + ' not moved. ' : 'Not moved. ') + Core.refusalText(err);
      paint();
    });
  }

  root.RestorationBoardCore = Core;
  root.RestorationBoard = {
    load: load,
    reload: function () { return load(); },
    // Repaint from the board already read (ops.html renderJobs, the search box).
    render: function (payload) { if (payload) state.payload = payload; paint(); },
    move: move,
    toggleMoves: function (id) {
      state.openMenuId = state.openMenuId === id ? '' : id;
      state.notice = '';
      paint();
    },
    setIncludeClosed: function (on) {
      state.includeClosed = !!on;
      state.openMenuId = '';
      return load();
    },
    openJob: function (id) {
      if (typeof root.openJobDetail === 'function') root.openJobDetail(id);
    },
  };
})(typeof window !== 'undefined' ? window : globalThis);
