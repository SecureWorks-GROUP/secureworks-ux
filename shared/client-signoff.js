(function (root, factory) {
  var api = factory();
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  root.ClientSignoffUI = api;
})(typeof window !== 'undefined' ? window : globalThis, function () {
  'use strict';
  function esc(v) { return String(v == null ? '' : v).replace(/[&<>"']/g, function(c) { return {'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]; }); }
  function recordedAt(value) {
    var at=new Date(value);if(!Number.isFinite(at.getTime()))return 'at an unknown time';
    return new Intl.DateTimeFormat('en-AU',{timeZone:'Australia/Perth',day:'numeric',month:'short',year:'numeric',hour:'numeric',minute:'2-digit'}).format(at)+' (Perth time)';
  }
  function field(label, name, value, extra) {
    return '<label>'+esc(label)+'<input name="'+name+'" value="'+esc(value || '')+'" '+(extra || '')+'></label>';
  }
  function officeHtml(read, draft) {
    draft = draft || {}; var f = draft.fields || {}, form = read.form || {}, row = read.current;
    var h = '<section class="client-so" aria-label="Client sign-off"><h3>Client sign-off</h3>';
    h += '<p>'+esc(form.job_number)+(form.address ? ' · '+esc(form.address) : '')+'</p>';
    h += '<div class="client-so-actions"><button type="button" data-client-so-pdf>Download blank PDF form</button>';
    if (read.share_token) h += '<button type="button" data-client-so-link>Open client form</button>';
    h += '</div><p class="client-so-help">The office prints or shares the form with the client. Nothing is sent automatically.</p>';
    if (row) {
      var method = row.method === 'office_waiver' ? 'Historical office waiver' : row.method === 'office_on_behalf' ? 'Office entry on the client’s behalf' : row.method === 'revoked' ? 'Sign-off revoked' : 'Client signature';
      h += '<div data-client-so-current><strong>'+esc(method)+'</strong>';
      h += '<p>Recorded '+esc(recordedAt(row.created_at))+' by '+esc(row.entered_by_name || row.captured_by_actor || 'an unrecorded person')+'.</p>';
      if (row.client_confirmed_on) h += '<p>Client confirmed on '+esc(row.client_confirmed_on)+'.</p>';
      if (row.happy === false) h += '<p><strong>The client has not accepted the work.</strong></p>';
      if (row.confirmation_reference) h += '<p>Written confirmation: '+esc(row.confirmation_reference)+'</p>';
      if (row.work_done) h += '<p>Work completed: '+esc(row.work_done)+'</p>';
      if (row.outstanding_items) h += '<p>Outstanding items: '+esc(row.outstanding_items)+'</p>';
      if (row.has_signed_copy) h += '<button type="button" data-client-so-copy="'+esc(row.id)+'">Download signed copy</button>';
      h += '</div>';
    }
    if (read.counts_for_group === false) h += '<p data-client-so-needed>A current client confirmation is needed before the work can be ended or group shares finalised.</p>';
    if (read.split_frozen) {
      h += '<p>This group is already frozen. Its existing approval is unchanged. Reopening it will require fresh client confirmation.</p>';
    } else if (!read.can_record_copy) {
      h += '<p>Sign in with your own office account to record the client’s confirmation.</p>';
    } else {
      h += '<details'+(draft.fields ? ' open' : '')+'><summary>Record confirmation on the client’s behalf</summary>';
      h += '<form data-client-so-form><p>Record what the client confirmed and how to find the evidence. This is not an office waiver.</p>';
      h += field('Client’s name', 'signed_name', f.signed_name, 'required maxlength="120" autocomplete="off"');
      h += field('Date the client confirmed', 'client_confirmed_on', f.client_confirmed_on, 'type="date" required');
      h += '<label>Work completed<textarea name="work_done" required maxlength="10000">'+esc(f.work_done || '')+'</textarea></label>';
      h += '<label>Outstanding items or comments<textarea name="outstanding_items" maxlength="10000">'+esc(f.outstanding_items || '')+'</textarea></label>';
      h += '<label>Did the client accept the work?<select name="client_accepts" required><option value="">Choose an answer</option><option value="true"'+(f.client_accepts === 'true' ? ' selected' : '')+'>Yes</option><option value="false"'+(f.client_accepts === 'false' ? ' selected' : '')+'>No</option></select></label>';
      var kind = f.confirmation_kind || 'signed_copy';
      h += '<label>How the client confirmed<select name="confirmation_kind"><option value="signed_copy"'+(kind === 'signed_copy' ? ' selected' : '')+'>Client-signed copy</option><option value="written_confirmation"'+(kind === 'written_confirmation' ? ' selected' : '')+'>Client’s written confirmation</option></select></label>';
      h += '<div data-client-so-file'+(kind !== 'signed_copy' ? ' hidden' : '')+'><label>Signed PDF, PNG or JPEG (up to 8 MB)<input name="signed_file" type="file" accept="application/pdf,image/png,image/jpeg"></label>';
      if (draft.file) h += '<p data-client-so-selected>Selected: '+esc(draft.file.name)+'</p>';
      h += '</div><label data-client-so-reference'+(kind !== 'written_confirmation' ? ' hidden' : '')+'>Reference to the client’s written confirmation<textarea name="confirmation_reference" maxlength="2000" placeholder="For example, the email date, subject and message reference, or the job’s recorded client message.">'+esc(f.confirmation_reference || '')+'</textarea></label>';
      h += '<label class="client-so-check"><input name="current_client_confirmation" type="checkbox"'+(f.current_client_confirmation ? ' checked' : '')+' required> This is the client’s current confirmation, including any changes since the last sign-off.</label>';
      h += '<button type="submit">Record client confirmation</button><p class="client-so-help">Recording keeps who entered this, when, and the evidence. It does not complete the job, finalise shares or submit an invoice.</p></form></details>';
    }
    return h+'<p data-client-so-message role="status" aria-live="polite"></p></section>';
  }
  function downloadFile(file) {
    if (!file || !file.file_base64 || !['application/pdf','image/png','image/jpeg'].includes(file.content_type)) throw Error('The file could not be read.');
    var raw = atob(file.file_base64), bytes = new Uint8Array(raw.length);
    for (var i=0;i<raw.length;i++) bytes[i]=raw.charCodeAt(i);
    var url = URL.createObjectURL(new Blob([bytes], {type:file.content_type}));
    var a = document.createElement('a'); a.href=url; a.download=file.file_name || 'client-signoff.pdf';
    document.body.appendChild(a); a.click(); a.remove(); setTimeout(function(){URL.revokeObjectURL(url);},10000);
  }
  return {officeHtml:officeHtml,downloadFile:downloadFile,esc:esc};
});
