// ════════════════════════════════════════════════════════════
// DEPOSIT INVOICE (legacy stubs — unified modal handles this now)
// Old create_deposit_invoice backend endpoint still works for auto-deposit on acceptance.
// ════════════════════════════════════════════════════════════

var _depJobId = null;
var _depQuotedTotal = 0;
var _depExtraLines = [];

// ════════════════════════════════════════════════════════════
// FEATURE 1: AI CHAT SIDEBAR
// ════════════════════════════════════════════════════════════

var _chatMessages = [];
var _chatOpen = false;
var _chatSending = false;
var _pendingActionCards = [];
var _opsAiBase = window.SUPABASE_URL + '/functions/v1/ops-ai';

// Load chat history from localStorage
(function() {
  try {
    var saved = localStorage.getItem('sw_ops_chat');
    if (saved) _chatMessages = JSON.parse(saved);
  } catch(e) {}
})();

function toggleChat() {
  _chatOpen = !_chatOpen;
  document.getElementById('chatPanel').classList.toggle('open', _chatOpen);
  document.getElementById('chatBackdrop').classList.toggle('open', _chatOpen);
  if (_chatOpen && _chatMessages.length > 0) renderChatHistory();
  if (_chatOpen) document.getElementById('chatInput').focus();
}

function clearChat() {
  _chatMessages = [];
  localStorage.removeItem('sw_ops_chat');
  document.getElementById('chatMessages').innerHTML =
    '<div style="text-align:center; padding: 20px 0;">' +
      '<div style="font-size:28px; margin-bottom:8px;">&#9889;</div>' +
      '<div style="font-size:13px; color:var(--sw-text-sec); margin-bottom:12px;">Ask me anything about today\'s operations</div>' +
      '<div class="chat-quick-prompts">' +
        '<button class="chat-quick-prompt" onclick="sendQuickPrompt(\'What should I focus on today?\')">Morning brief</button>' +
        '<button class="chat-quick-prompt" onclick="sendQuickPrompt(\'What needs my attention?\')">Attention items</button>' +
        '<button class="chat-quick-prompt" onclick="sendQuickPrompt(\'Which jobs are complete but not invoiced?\')">Stale invoicing</button>' +
        '<button class="chat-quick-prompt" onclick="sendQuickPrompt(\'Show me this weeks schedule\')">This week</button>' +
      '</div>' +
    '</div>';
}

function sendQuickPrompt(text) {
  document.getElementById('chatInput').value = text;
  sendChat();
}

function renderChatHistory() {
  var container = document.getElementById('chatMessages');
  var html = '';
  _chatMessages.forEach(function(msg) {
    if (msg.role === 'user') {
      html += '<div class="chat-msg user">' + escapeHtml(msg.content) + '</div>';
    } else {
      html += '<div class="chat-msg assistant">' + renderMarkdown(msg.content) + '</div>';
      if (msg.action_cards) {
        msg.action_cards.forEach(function(card) {
          html += renderActionCard(card, msg._cardIndex);
        });
      }
    }
  });
  container.innerHTML = html;
  container.scrollTop = container.scrollHeight;
}

function escapeHtml(str) {
  return str.replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');
}

function renderMarkdown(text) {
  if (!text) return '';
  // Simple markdown: **bold**, *italic*, bullet lists, numbered lists, `code`
  return text
    .replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;')
    .replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>')
    .replace(/\*(.+?)\*/g, '<em>$1</em>')
    .replace(/`(.+?)`/g, '<code>$1</code>')
    .replace(/^\s*[-•]\s+(.+)$/gm, '<li>$1</li>')
    .replace(/^\s*\d+\.\s+(.+)$/gm, '<li>$1</li>')
    .replace(/(<li>.*<\/li>)/s, '<ul>$1</ul>')
    .replace(/\n/g, '<br>');
}

function renderActionCard(card, idx) {
  var cardIdx = _pendingActionCards.length;
  _pendingActionCards.push(card);
  return '<div class="chat-action-card">' +
    '<p>' + escapeHtml(card.message) + '</p>' +
    '<div class="chat-action-btns">' +
      '<button class="btn-confirm" onclick="confirmChatAction(' + cardIdx + ')">Confirm</button>' +
      '<button class="btn-cancel-action" onclick="this.parentElement.parentElement.remove()">Cancel</button>' +
    '</div>' +
  '</div>';
}

async function sendChat() {
  if (_chatSending) return;
  var input = document.getElementById('chatInput');
  var text = input.value.trim();
  if (!text) return;

  _chatSending = true;
  input.value = '';
  document.getElementById('chatSendBtn').disabled = true;

  // Add user message
  _chatMessages.push({ role: 'user', content: text });
  saveChatHistory();

  // Render user message
  var container = document.getElementById('chatMessages');
  // Remove welcome screen if present
  var welcome = container.querySelector('[style*="text-align:center"]');
  if (welcome) welcome.remove();

  container.innerHTML += '<div class="chat-msg user">' + escapeHtml(text) + '</div>';
  container.innerHTML += '<div class="chat-typing" id="chatTyping"><div class="dots"><span>.</span><span>.</span><span>.</span></div></div>';
  container.scrollTop = container.scrollHeight;

  try {
    // Send last 20 messages to keep context manageable
    var msgs = _chatMessages.slice(-20).map(function(m) {
      return { role: m.role, content: m.content };
    });

    var resp = await fetch(_opsAiBase, {
      method: 'POST',
      headers: await _getAuthHeaders(),
      body: JSON.stringify({ messages: msgs, view: 'ops' }),
    });
    var data = await resp.json();

    // Remove typing indicator
    var typing = document.getElementById('chatTyping');
    if (typing) typing.remove();

    if (data.error) {
      container.innerHTML += '<div class="chat-msg assistant" style="color:var(--sw-red);">Error: ' + escapeHtml(data.error) + '</div>';
    } else {
      var assistantMsg = { role: 'assistant', content: data.content || '' };
      if (data.action_cards) assistantMsg.action_cards = data.action_cards;
      _chatMessages.push(assistantMsg);
      saveChatHistory();

      container.innerHTML += '<div class="chat-msg assistant">' + renderMarkdown(data.content || '') + '</div>';
      if (data.action_cards) {
        data.action_cards.forEach(function(card) {
          container.innerHTML += renderActionCard(card);
        });
      }
    }
  } catch (e) {
    var typing = document.getElementById('chatTyping');
    if (typing) typing.remove();
    container.innerHTML += '<div class="chat-msg assistant" style="color:var(--sw-red);">Connection error. Please try again.</div>';
  }

  _chatSending = false;
  document.getElementById('chatSendBtn').disabled = false;
  container.scrollTop = container.scrollHeight;

  // Trim history to 50 messages
  if (_chatMessages.length > 50) _chatMessages = _chatMessages.slice(-50);
  saveChatHistory();
}

async function confirmChatAction(cardIdx) {
  var card = _pendingActionCards[cardIdx];
  if (!card) return;
  try {
    var resp = await fetch(_opsAiBase, {
      method: 'POST',
      headers: await _getAuthHeaders(),
      body: JSON.stringify({ confirm_action: card, view: 'ops' }),
    });
    var data = await resp.json();

    var container = document.getElementById('chatMessages');
    container.innerHTML += '<div class="chat-msg assistant" style="background:#F0FFF0; border-color:var(--sw-green);">' +
      '&#9989; ' + renderMarkdown(data.content || 'Action completed.') + '</div>';
    container.scrollTop = container.scrollHeight;

    // Refresh views after write action
    refreshActiveView();
  } catch (e) {
    alert('Action failed: ' + e.message);
  }
}

function saveChatHistory() {
  try {
    // Only save last 50, strip action_cards from saved messages
    var toSave = _chatMessages.slice(-50).map(function(m) {
      return { role: m.role, content: m.content };
    });
    localStorage.setItem('sw_ops_chat', JSON.stringify(toSave));
  } catch(e) {}
}


// ════════════════════════════════════════════════════════════
// FEATURE 2: MORNING BRIEF
// ════════════════════════════════════════════════════════════

var _briefCacheKey = 'sw_morning_brief';
var _briefCacheTTL = 30 * 60 * 1000; // 30 minutes

async function loadMorningBrief() {
  var briefEl = document.getElementById('morningBrief');
  var contentEl = document.getElementById('briefContent');

  // Check cache
  try {
    var cached = JSON.parse(localStorage.getItem(_briefCacheKey) || '{}');
    if (cached.html && cached.ts && (Date.now() - cached.ts < _briefCacheTTL)) {
      contentEl.innerHTML = cached.html;
      briefEl.style.display = '';
      return;
    }
  } catch(e) {}

  briefEl.style.display = '';
  contentEl.innerHTML = '<div class="brief-loading">Generating today\'s brief...</div>';

  try {
    // Get morning brief data from ops-api
    var briefData = await opsFetch('morning_brief');

    // Send to AI for narration
    var resp = await fetch(_opsAiBase, {
      method: 'POST',
      headers: await _getAuthHeaders(),
      body: JSON.stringify({
        messages: [{ role: 'user', content: 'Generate a concise morning brief from this data. Use bullet points, be specific with names, numbers, and actions needed. Keep it under 8 bullet points:\n\n' + JSON.stringify(briefData) }],
        view: 'ops',
      }),
    });
    var data = await resp.json();

    if (data.content) {
      var html = renderMarkdown(data.content);
      contentEl.innerHTML = html;
      // Cache it
      try {
        localStorage.setItem(_briefCacheKey, JSON.stringify({ html: html, ts: Date.now() }));
      } catch(e) {}
    } else {
      // Fallback: render static summary
      renderStaticBrief(briefData, contentEl);
    }
  } catch (e) {
    console.error('Morning brief error:', e);
    // Fallback to static
    try {
      var briefData = await opsFetch('ops_summary');
      renderStaticBrief(briefData, contentEl);
    } catch(e2) {
      contentEl.innerHTML = '<div class="brief-loading">Could not load brief</div>';
    }
  }
}

function renderStaticBrief(data, el) {
  var html = '<ul>';
  var sched = data.today_schedule || [];
  html += '<li><strong>' + sched.length + ' job' + (sched.length !== 1 ? 's' : '') + '</strong> scheduled today</li>';

  var att = data.attention || [];
  if (att.length > 0) {
    html += '<li><strong>' + att.length + ' item' + (att.length !== 1 ? 's' : '') + '</strong> need attention</li>';
  }

  var cni = data.complete_not_invoiced || [];
  if (cni.length > 0) {
    var totalVal = cni.reduce(function(s, j) { return s + (j.value || 0); }, 0);
    html += '<li><strong>' + cni.length + ' completed job' + (cni.length !== 1 ? 's' : '') + '</strong> not yet invoiced' +
      (totalVal > 0 ? ' (' + fmt$(totalVal) + ')' : '') + '</li>';
  }

  html += '</ul>';
  el.innerHTML = html;
}

function toggleBrief() {
  var briefEl = document.getElementById('morningBrief');
  briefEl.classList.toggle('collapsed');
  var btn = briefEl.querySelector('.brief-toggle');
  btn.innerHTML = briefEl.classList.contains('collapsed') ? '&#9660;' : '&#9650;';
}


// ════════════════════════════════════════════════════════════
// FEATURE 4: COMPLETION CASCADE MODAL
// ════════════════════════════════════════════════════════════

var _cascadeJobId = null;

async function openCascadeModal(jobId) {
  _cascadeJobId = jobId;
  var infoEl = document.getElementById('cascadeJobInfo');
  var itemsEl = document.getElementById('cascadeLineItems');
  infoEl.textContent = 'Loading job data...';
  itemsEl.innerHTML = '';

  document.getElementById('cascadeModal').classList.add('active');

  try {
    var data = await opsFetch('job_detail', { jobId: jobId });
    var job = data.job || data;

    infoEl.innerHTML = '<strong>' + (job.client_name || 'Unknown') + '</strong>' +
      (job.job_number ? ' &middot; ' + job.job_number : '') +
      (job.site_suburb ? ' &middot; ' + job.site_suburb : '') +
      '<br><span style="color:var(--sw-mid); font-size:12px;">' + (job.type || '') + ' &middot; Status: ' + (job.status || '') + '</span>';

    // Show line items from pricing_json
    var pricing = job.pricing_json;
    if (typeof pricing === 'string') pricing = JSON.parse(pricing);
    if (pricing && (pricing.items || pricing.total)) {
      var items = pricing.items || [{ description: 'Total', quantity: 1, unit_price: pricing.total || pricing.amount || 0 }];
      var html = '';
      var total = 0;
      items.forEach(function(li) {
        var qty = li.quantity || li.qty || 1;
        var price = li.unit_price || li.unitPrice || li.price || li.amount || 0;
        var subtotal = qty * price;
        total += subtotal;
        html += '<div class="li-row">' +
          '<span>' + (li.description || li.name || 'Item') + ' &times; ' + qty + '</span>' +
          '<span>' + fmt$(subtotal) + '</span>' +
        '</div>';
      });
      html += '<div class="li-total"><span>Total</span><span>' + fmt$(total) + '</span></div>';
      itemsEl.innerHTML = html;
    } else {
      itemsEl.innerHTML = '<div style="padding:12px; color:var(--sw-yellow); font-size:13px;">No pricing data on this job. Invoice will need manual line items.</div>';
    }
  } catch (e) {
    infoEl.textContent = 'Error loading job: ' + e.message;
  }
}

async function cascadeCompleteOnly() {
  if (!_cascadeJobId) return;
  closeModal('cascadeModal');
  try {
    await opsPost('update_job_status', { jobId: _cascadeJobId, status: 'complete' });
    openJobPeek(_cascadeJobId);
    refreshActiveView();
  } catch (e) {
    alert('Failed: ' + e.message);
  }
}

async function cascadeCompleteAndInvoice() {
  if (!_cascadeJobId) return;
  closeModal('cascadeModal');
  try {
    var result = await opsPost('complete_and_invoice', { job_id: _cascadeJobId });
    if (result.error) {
      alert('Error: ' + result.error);
      return;
    }
    showToast('Invoice ' + (result.invoice_number || '') + ' created — ' + fmt$(result.total || 0), 'success');
    openJobPeek(_cascadeJobId);
    refreshActiveView();
  } catch (e) {
    alert('Failed to complete & invoice: ' + e.message);
  }
}


// ════════════════════════════════════════════════════════════
// FEATURE 5: SCOPE-TO-PO AUTO-POPULATE
// ════════════════════════════════════════════════════════════

async function autoPOFromScope(jobId) {
  if (!jobId) return;
  try {
    var data = await opsFetch('scope_to_po', { jobId: jobId });
    var materials = data.materials || [];
    if (materials.length === 0) return;

    // Clear existing line items and populate from scope
    var container = document.getElementById('poLineItems');
    container.innerHTML = '';
    materials.forEach(function(m) {
      addPOLine(m.description, m.quantity, m.unit || 'ea', m.unit_price);
    });
  } catch(e) {
    console.error('autoPOFromScope error:', e);
  }
}


// ════════════════════════════════════════════════════════════
// FEATURE 6: ASSIGNMENT CASCADE — mark assignment complete → check all_complete
// ════════════════════════════════════════════════════════════

async function markAssignmentComplete(assignmentId, jobId) {
  try {
    var result = await opsPost('update_assignment', { assignmentId: assignmentId, status: 'complete' });

    // Refresh whichever detail view is open
    if (document.getElementById('jobDetailView').classList.contains('active')) {
      refreshJobDetail();
    } else {
      openJobPeek(jobId);
    }
    refreshActiveView();

    // Check if all assignments for this job are now complete
    if (result.all_complete && result.suggest_status === 'complete') {
      showToast('All assignments complete — mark job as complete?', 'warning', [
        { label: 'Complete + Invoice', primary: true, onclick: "openCascadeModal('" + jobId + "')" },
        { label: 'Complete Only', primary: false, onclick: "_cascadeJobId='" + jobId + "'; cascadeCompleteOnly()" },
        { label: 'Not Yet', primary: false, onclick: "" },
      ]);
    }
  } catch (e) {
    alert('Failed to update assignment: ' + e.message);
  }
}


// ════════════════════════════════════════════════════════════
// FEATURE 7: CREW UTILIZATION SIDEBAR
// ════════════════════════════════════════════════════════════

function renderCrewUtilization() {
  var container = document.getElementById('crewUtilBars');
  if (!_calEvents || _calEvents.length === 0) {
    container.innerHTML = '<span style="font-size:12px; color:var(--sw-text-sec);">No events this period</span>';
    return;
  }

  // Count unique working days per crew member
  var crewDays = {};
  _calEvents.forEach(function(ev) {
    var crew = cleanCrewName(ev.crew_name || ev.user_name) || 'Unassigned';
    if (crew === 'Unassigned') return;
    if (!crewDays[crew]) crewDays[crew] = new Set();
    crewDays[crew].add(ev.scheduled_date);
  });

  // Calculate total weekdays in the calendar range
  var range = getCalRange();
  var totalDays = 0;
  var d = new Date(range.from);
  var endD = new Date(range.to);
  while (d <= endD) {
    var dow = d.getDay();
    if (dow !== 0 && dow !== 6) totalDays++;
    d.setDate(d.getDate() + 1);
  }
  if (totalDays === 0) totalDays = 5;

  var entries = Object.entries(crewDays).map(function(pair) {
    return { name: pair[0], days: pair[1].size };
  }).sort(function(a, b) { return b.days - a.days; });

  if (entries.length === 0) {
    container.innerHTML = '<span style="font-size:12px; color:var(--sw-text-sec);">No crew data</span>';
    return;
  }

  var html = '';
  entries.forEach(function(e) {
    var pct = Math.min(100, Math.round(e.days / totalDays * 100));
    var color = pct >= 80 ? 'green' : pct >= 60 ? 'amber' : 'red';
    html += '<div class="crew-bar">' +
      '<div class="crew-bar-name" title="' + e.name + '">' + e.name + '</div>' +
      '<div class="crew-bar-track"><div class="crew-bar-fill ' + color + '" style="width:' + pct + '%;"></div></div>' +
      '<div class="crew-bar-label">' + e.days + '/' + totalDays + 'd</div>' +
    '</div>';
  });
  container.innerHTML = html;
}


// ════════════════════════════════════════════════════════════
// TOAST NOTIFICATIONS
// ════════════════════════════════════════════════════════════

function showToast(message, type, actions) {
  var container = document.getElementById('toastContainer');
  var toast = document.createElement('div');
  toast.className = 'toast';
  if (type === 'success') toast.style.borderLeft = '3px solid var(--sw-green)';
  if (type === 'warning') toast.style.borderLeft = '3px solid var(--sw-yellow)';

  var html = '<span>' + message + '</span>';
  if (actions) {
    html += '<div class="toast-btns">';
    actions.forEach(function(a) {
      html += '<button class="toast-btn ' + (a.primary ? 'toast-btn-yes' : 'toast-btn-no') + '" onclick="' + a.onclick + '; this.closest(\'.toast\').remove();">' + a.label + '</button>';
    });
    html += '</div>';
  }
  toast.innerHTML = html;
  container.appendChild(toast);

  // Auto-dismiss after 8 seconds unless it has actions
  if (!actions) {
    setTimeout(function() { if (toast.parentElement) toast.remove(); }, 8000);
  }
}


// ════════════════════════════════════════════════════════════
