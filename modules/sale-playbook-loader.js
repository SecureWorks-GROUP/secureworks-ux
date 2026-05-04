// ════════════════════════════════════════════════════════════
// SecureWorks — Secure Sale (Loop 4) — Playbook loader
//
// Pure module. Loads the four operating-loop playbooks (Nithin
// booking + follow-up, Khairo booking + follow-up) from markdown
// files with YAML frontmatter. Parses + caches in memory.
//
// The architecture (Marnin direction §B.3):
//   • CODE handles scheduling mechanics, evidence, ranking, safety.
//   • MARKDOWN handles rep-specific tone, constraints, templates,
//     cadence ladders. Marnin / a rep edits a .md file, deploys,
//     change picked up on next page load.
//
// Hard rules:
//   • Same-origin static GET only. Path is relative to wherever
//     this module loads from (cockpit page is at securedash/
//     sale-preview.html; playbooks/ sits beside it). v9 lock
//     unchanged.
//   • Tiny YAML parser inline — covers the subset our playbooks
//     use (scalars, nested objects, arrays of scalars, arrays of
//     inline objects). Refuses unknown YAML constructs by failing
//     loud, never silently corrupting config.
//   • No fetch in Node test paths — the module accepts an
//     `inject` opt that bypasses fetch and feeds raw markdown
//     directly. Tests use this.
//
// Public API:
//   SALE_PLAYBOOK_LOADER.parse(rawMarkdown)
//     → ParsedPlaybook
//   SALE_PLAYBOOK_LOADER.loadAll(opts?)
//     → Promise<{ [playbook_id]: ParsedPlaybook }>
//   SALE_PLAYBOOK_LOADER.resolveForCard(card, loadedPlaybooks)
//     → ParsedPlaybook | null
//   SALE_PLAYBOOK_LOADER.templateFor(playbook, action_type, key)
//     → string | null
//
// ParsedPlaybook shape:
//   {
//     playbook_id:        string,
//     rep_profile_id:     string,
//     rep_first_name:     string,
//     covers_action_types: string[],
//     default_tone:       string,
//     tone_overrides:     { [action_type]: tone_variant },
//     constraints:        { [key]: number | string },
//     followup_ladder:    LadderRung[]?,
//     forbidden_phrases:  string[],
//     sms_budget:         number,
//     email_subject_budget: number,
//     email_body_budget:  number,
//     templates:          { [action_type]: { [template_key]: string } },
//     talk_tracks:        { [bucket_key]: string[] },
//     raw_body:           string,
//   }
// ════════════════════════════════════════════════════════════

(function (root, factory) {
  'use strict';
  var exports = factory();
  if (typeof module !== 'undefined' && module.exports) {
    module.exports = exports;
  } else {
    root.SALE_PLAYBOOK_LOADER = exports;
  }
})(typeof window !== 'undefined' ? window : this, function () {
  'use strict';

  // ── Default playbook list (Loop 4) ─────────────────────────

  var DEFAULT_PLAYBOOKS = [
    'nithin.booking.md',
    'nithin.followup.md',
    'khairo.booking.md',
    'khairo.followup.md',
  ];

  var TEMPLATE_HEADING_RE = /^#{3}\s+([a-z0-9_]+)\s+·\s+([a-z0-9_]+)\s*$/i;
  var TALK_HEADING_RE     = /^#{3}\s+call_client\s+·\s+([a-z0-9_]+)\s*$/i;
  var FRONTMATTER_RE      = /^---\s*\n([\s\S]+?)\n---\s*\n([\s\S]*)$/;

  // ── Tiny YAML subset parser ────────────────────────────────
  //
  // Supports:
  //   key: value                     (scalar)
  //   key: "value with: colons"
  //   key:                           (block child)
  //     nested: value
  //   key:
  //     - item                       (array of scalars)
  //     - item
  //   key:
  //     - { offset_days: 0, channel: sms }   (array of inline objects)
  //
  // Unsupported (refused):
  //   - multi-line scalars / |  / >
  //   - anchors / aliases
  //   - flow-style maps that span lines
  //
  // Returns a plain object. Throws on unknown construct so we never
  // silently corrupt config.

  function parseYamlBlock(yaml) {
    var lines = yaml.replace(/\r\n/g, '\n').split('\n');
    var idx = 0;

    function peek() { return idx < lines.length ? lines[idx] : null; }
    function consume() { return lines[idx++]; }
    function indentOf(line) {
      var m = line.match(/^(\s*)/);
      return m ? m[1].length : 0;
    }
    function isEmpty(line) { return /^\s*(#.*)?$/.test(line); }

    function stripQuotes(s) {
      if (typeof s !== 'string') return s;
      var t = s.trim();
      if ((t.charAt(0) === '"' && t.charAt(t.length - 1) === '"') ||
          (t.charAt(0) === "'" && t.charAt(t.length - 1) === "'")) {
        return t.substring(1, t.length - 1);
      }
      return t;
    }
    function coerceScalar(s) {
      var t = stripQuotes(s);
      if (t === 'true') return true;
      if (t === 'false') return false;
      if (t === 'null' || t === '~') return null;
      if (/^-?\d+$/.test(t)) return parseInt(t, 10);
      if (/^-?\d+\.\d+$/.test(t)) return parseFloat(t);
      return t;
    }

    function parseInlineObject(s) {
      // { key: val, key2: val2 }
      var t = s.trim();
      if (t.charAt(0) !== '{' || t.charAt(t.length - 1) !== '}') {
        throw new Error('parseInlineObject: not a flow map: ' + s);
      }
      var inner = t.substring(1, t.length - 1).trim();
      if (!inner) return {};
      // Split on top-level commas (no nesting expected in our use).
      var parts = inner.split(',');
      var obj = {};
      parts.forEach(function (p) {
        var kv = p.split(':');
        if (kv.length < 2) throw new Error('parseInlineObject: malformed pair: ' + p);
        var key = kv.shift().trim();
        var val = kv.join(':').trim();
        obj[key] = coerceScalar(val);
      });
      return obj;
    }

    function parseValueLine(rest) {
      // rest = the part after "key: "
      var t = rest.trim();
      if (!t) return undefined;                // signals block continuation
      if (t.charAt(0) === '{') return parseInlineObject(t);
      if (t.charAt(0) === '[') {
        var inner2 = t.substring(1, t.length - 1).trim();
        if (!inner2) return [];
        return inner2.split(',').map(function (x) { return coerceScalar(x); });
      }
      return coerceScalar(t);
    }

    function parseBlock(parentIndent) {
      var obj = {};
      while (idx < lines.length) {
        var line = peek();
        if (line === null) break;
        if (isEmpty(line)) { consume(); continue; }
        var ind = indentOf(line);
        if (ind <= parentIndent) break;
        // List?
        var listMatch = line.match(/^(\s*)-\s+(.*)$/);
        if (listMatch) {
          // Caller handled list parsing — break.
          break;
        }
        var kvMatch = line.match(/^(\s*)([\w\-]+)\s*:\s*(.*)$/);
        if (!kvMatch) {
          throw new Error('YAML parse: unrecognised line (indent=' + ind + '): "' + line + '"');
        }
        consume();
        var key = kvMatch[2];
        var valuePart = kvMatch[3];
        var v = parseValueLine(valuePart);
        if (v !== undefined) {
          obj[key] = v;
        } else {
          // Block continuation. Look at next non-empty.
          var next = peek();
          while (next !== null && isEmpty(next)) { consume(); next = peek(); }
          if (next === null) { obj[key] = null; continue; }
          var nextIndent = indentOf(next);
          if (nextIndent <= ind) { obj[key] = null; continue; }
          // Is it a list?
          if (/^(\s*)-\s+/.test(next)) {
            obj[key] = parseList(ind);
          } else {
            obj[key] = parseBlock(ind);
          }
        }
      }
      return obj;
    }

    function parseList(parentIndent) {
      var arr = [];
      while (idx < lines.length) {
        var line = peek();
        if (line === null) break;
        if (isEmpty(line)) { consume(); continue; }
        var ind = indentOf(line);
        if (ind <= parentIndent) break;
        var m = line.match(/^(\s*)-\s+(.*)$/);
        if (!m) break;
        consume();
        var rest = m[2];
        if (rest.charAt(0) === '{') {
          arr.push(parseInlineObject(rest));
        } else {
          // Could be scalar or "- key: value" syntax. Inline scalar
          // is the only form we use.
          var asKv = rest.match(/^([\w\-]+)\s*:\s*(.*)$/);
          if (asKv) {
            // Treat as inline single-key map. Not used by our playbooks
            // but kept for safety — same as inline obj with one entry.
            var o = {};
            o[asKv[1]] = coerceScalar(asKv[2]);
            arr.push(o);
          } else {
            arr.push(coerceScalar(rest));
          }
        }
      }
      return arr;
    }

    return parseBlock(-1);
  }

  // ── Markdown body parser ───────────────────────────────────
  //
  // We extract two structures from the body:
  //   • templates[action_type][template_key] = "string body"
  //     (e.g. templates.book_scope.sms_primary = "...")
  //   • talk_tracks[bucket] = ["bullet 1", "bullet 2", ...]
  //     (e.g. talk_tracks.no_first_contact = [...])
  //
  // A template heading is "### action_type · template_key".
  // A talk-track heading is "### call_client · bucket_key".
  // The body of each section is the content until the next heading
  // of equal or shallower depth, with leading/trailing blank lines
  // trimmed.

  function parseMarkdownBody(body) {
    var templates = {};
    var talk_tracks = {};
    var lines = body.replace(/\r\n/g, '\n').split('\n');

    var current = null; // { kind: 'template' | 'talk', a: action_type, k: template_key, buf: [] }
    function flush() {
      if (!current) return;
      var content = current.buf.join('\n').replace(/^\s+|\s+$/g, '');
      if (current.kind === 'template') {
        if (!templates[current.a]) templates[current.a] = {};
        templates[current.a][current.k] = content;
      } else if (current.kind === 'talk') {
        // Parse bullets: lines starting with "- "
        var bullets = content.split('\n').map(function (l) {
          var m = l.match(/^\s*-\s+(.*)$/);
          return m ? stripQuotesIfWrapped(m[1]) : null;
        }).filter(Boolean);
        talk_tracks[current.k] = bullets;
      }
      current = null;
    }

    function stripQuotesIfWrapped(s) {
      var t = s.trim();
      if ((t.charAt(0) === '"' && t.charAt(t.length - 1) === '"') ||
          (t.charAt(0) === "'" && t.charAt(t.length - 1) === "'")) {
        return t.substring(1, t.length - 1);
      }
      return t;
    }

    for (var i = 0; i < lines.length; i++) {
      var line = lines[i];
      // Stop a section on any heading h1..h3 boundary.
      var talkM = line.match(TALK_HEADING_RE);
      var tplM  = !talkM ? line.match(TEMPLATE_HEADING_RE) : null;
      if (talkM) {
        flush();
        current = { kind: 'talk', k: talkM[1].toLowerCase(), buf: [] };
        continue;
      }
      if (tplM) {
        flush();
        var actionType = tplM[1].toLowerCase();
        var templateKey = tplM[2].toLowerCase();
        // Skip the call_client templates here — those go through the
        // talk-track parser (the regex for talk preempts on the call_client
        // prefix). Defensive: if action_type is call_client and key doesn't
        // match a template-shape, skip.
        if (actionType === 'call_client' && /^(no_first_contact|viewed_no_reply|site_visit_no_scope|default)$/.test(templateKey)) {
          current = { kind: 'talk', k: templateKey, buf: [] };
        } else {
          current = { kind: 'template', a: actionType, k: templateKey, buf: [] };
        }
        continue;
      }
      // Any other heading flushes the section.
      if (/^#{1,6}\s+/.test(line)) {
        flush();
        continue;
      }
      if (current) current.buf.push(line);
    }
    flush();

    return { templates: templates, talk_tracks: talk_tracks };
  }

  // ── Public: parse one full markdown file ───────────────────

  function parse(rawMarkdown) {
    var m = String(rawMarkdown || '').match(FRONTMATTER_RE);
    if (!m) throw new Error('playbook: no YAML frontmatter delimited by --- found');
    var fm = parseYamlBlock(m[1]);
    var body = m[2];
    var parsedBody = parseMarkdownBody(body);
    var pb = {
      playbook_id:          fm.playbook_id,
      rep_profile_id:       fm.rep_profile_id,
      rep_first_name:       fm.rep_first_name,
      covers_action_types:  fm.covers_action_types || [],
      default_tone:         fm.default_tone || 'helpful_service',
      tone_overrides:       fm.tone_overrides || {},
      constraints:          fm.constraints || {},
      followup_ladder:      fm.followup_ladder || null,
      forbidden_phrases:    fm.forbidden_phrases || [],
      sms_budget:           fm.sms_budget          || 160,
      email_subject_budget: fm.email_subject_budget || 80,
      email_body_budget:    fm.email_body_budget   || 350,
      templates:            parsedBody.templates,
      talk_tracks:          parsedBody.talk_tracks,
      raw_body:             body,
    };
    if (!pb.playbook_id || !pb.rep_profile_id || !pb.rep_first_name) {
      throw new Error('playbook: missing required frontmatter (playbook_id / rep_profile_id / rep_first_name)');
    }
    return pb;
  }

  // ── Public: loadAll ────────────────────────────────────────
  //
  // Browser path: fetches each .md file relative to opts.basePath
  // (default './playbooks/'). Same-origin static GETs; v9 lock
  // unchanged.
  //
  // Test path: opts.injected = { 'nithin.booking.v1': rawMd, ... }
  // skips fetch entirely and parses provided strings.

  function loadAll(opts) {
    opts = opts || {};
    if (opts.injected && typeof opts.injected === 'object') {
      var out = {};
      Object.keys(opts.injected).forEach(function (id) {
        var pb = parse(opts.injected[id]);
        out[pb.playbook_id] = pb;
      });
      return Promise.resolve(out);
    }
    if (typeof fetch !== 'function') {
      return Promise.reject(new Error('sale-playbook-loader: fetch not available'));
    }
    var base = opts.basePath || './playbooks/';
    var files = opts.files || DEFAULT_PLAYBOOKS;
    return Promise.all(files.map(function (f) {
      return fetch(base + f, { credentials: 'omit', cache: 'no-cache' })
        .then(function (resp) {
          if (!resp.ok) throw new Error('playbook load ' + resp.status + ' for ' + f);
          return resp.text();
        })
        .then(function (md) { return parse(md); });
    })).then(function (parsed) {
      var byId = {};
      parsed.forEach(function (pb) { byId[pb.playbook_id] = pb; });
      return byId;
    });
  }

  // ── Public: resolveForCard ─────────────────────────────────
  //
  // Given a SalesActionCard + the loaded playbooks map, picks the
  // single playbook that covers (a) the rep_profile_id implied by
  // card.job_type AND (b) covers card.action_type.

  function resolveForCard(card, playbooks) {
    if (!card || !playbooks) return null;
    var jt = (card.job_type || '').toLowerCase();
    var expectedRep =
      jt === 'fencing'
        ? 'khairo.fencing.calm-tradie.v1'
        : (jt === 'patio' || jt === 'combo' || jt === 'decking' || jt === 'general'
            ? 'nithin.patio.calm-tradie.v1'
            : null);
    if (!expectedRep) return null;
    var ids = Object.keys(playbooks);
    for (var i = 0; i < ids.length; i++) {
      var pb = playbooks[ids[i]];
      if (!pb) continue;
      if (pb.rep_profile_id !== expectedRep) continue;
      if ((pb.covers_action_types || []).indexOf(card.action_type) === -1) continue;
      return pb;
    }
    return null;
  }

  // ── Public: templateFor ────────────────────────────────────

  function templateFor(playbook, actionType, templateKey) {
    if (!playbook || !playbook.templates) return null;
    var bucket = playbook.templates[actionType];
    if (!bucket) return null;
    return typeof bucket[templateKey] === 'string' ? bucket[templateKey] : null;
  }

  function talkTrackFor(playbook, bucketKey) {
    if (!playbook || !playbook.talk_tracks) return null;
    var entry = playbook.talk_tracks[bucketKey];
    return Array.isArray(entry) ? entry.slice() : null;
  }

  return {
    parse: parse,
    loadAll: loadAll,
    resolveForCard: resolveForCard,
    templateFor: templateFor,
    talkTrackFor: talkTrackFor,
    DEFAULT_PLAYBOOKS: DEFAULT_PLAYBOOKS,
    // Exposed for tests:
    _parseYaml: parseYamlBlock,
    _parseMarkdownBody: parseMarkdownBody,
  };
});
