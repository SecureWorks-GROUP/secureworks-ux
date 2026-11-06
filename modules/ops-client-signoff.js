// Extends the existing client sign-off ledger and public link. Sends nothing.
(function () {
  'use strict';
  var jobId='', generation=0, draft={}, busy=false, latest=null, jobData=null;
  function host() {
    var root=document.getElementById('jdOverview'); if(!root)return null;
    var el=root.querySelector('[data-office-client-signoff]');
    if(!el){el=document.createElement('div');el.setAttribute('data-office-client-signoff','');root.appendChild(el);}
    return el;
  }
  function message(text) { var h=host(), el=h&&h.querySelector('[data-client-so-message]');if(el)el.textContent=text; }
  function capture() {
    var h=host(), f=h&&h.querySelector('[data-client-so-form]');if(!f)return;
    var fields={};['signed_name','client_confirmed_on','work_done','outstanding_items','client_accepts','confirmation_kind','confirmation_reference'].forEach(function(k){fields[k]=f.elements[k].value;});
    fields.current_client_confirmation=f.elements.current_client_confirmation.checked;
    draft.fields=fields;
    if(f.elements.signed_file.files[0])draft.file=f.elements.signed_file.files[0];
  }
  function css() {
    if(document.getElementById('clientSignoffCss'))return;
    var el=document.createElement('style');el.id='clientSignoffCss';
    el.textContent='.client-so{margin:0 0 16px;padding:16px;border:1px solid var(--sw-border,#d4dee4);border-radius:12px;background:var(--sw-card,#fff);overflow-wrap:anywhere}.client-so [hidden]{display:none!important}.client-so h3{font-size:16px;margin:0 0 8px}.client-so p{line-height:1.5}.client-so-actions{display:flex;gap:8px;flex-wrap:wrap}.client-so button{padding:10px 14px;min-height:44px;font:inherit;cursor:pointer;border:1px solid var(--sw-border,#d4dee4);border-radius:8px;background:var(--sw-card,#fff);color:var(--sw-dark,#293C46)}.client-so button:focus-visible,.client-so input:focus-visible,.client-so textarea:focus-visible,.client-so select:focus-visible,.client-so summary:focus-visible{outline:2px solid var(--sw-orange,#F15A29);outline-offset:3px}.client-so button:disabled{opacity:.6;cursor:wait}.client-so label{display:block;font-weight:600;margin-top:12px}.client-so input:not([type=checkbox]),.client-so textarea,.client-so select{display:block;width:100%;box-sizing:border-box;font:inherit;font-size:16px;padding:9px;margin-top:5px;border:1px solid var(--sw-border,#d4dee4);border-radius:8px;background:var(--sw-card,#fff);color:inherit}.client-so textarea{min-height:80px;resize:vertical}.client-so .client-so-check{display:flex;align-items:flex-start;gap:8px;line-height:1.5}.client-so-check input{margin-top:5px}.client-so form>button{margin-top:16px;background:var(--sw-dark,#293C46);color:#fff}.client-so-help{font-size:13px;color:var(--sw-text-sec,#4C6A7C)}.client-so details{margin-top:16px}.client-so summary{cursor:pointer;font-weight:600;min-height:44px}.client-so [data-client-so-current]{margin-top:16px;padding-top:12px;border-top:1px solid var(--sw-border,#d4dee4)}';
    document.head.appendChild(el);
  }
  function paint(data) {
    var next=String(data&&data.job&&data.job.id||''), h=host();if(!h)return;
    if(next===jobId)capture();else{draft={};busy=false;latest=null;}
    jobId=next;jobData=data;var seq=++generation;
    if(!next || !data.job || ['fencing','patio'].indexOf(data.job.type)===-1){h.innerHTML='';return;}
    h.innerHTML='<p role="status">Checking client sign-off…</p>';css();
    opsFetch('client_signoff_office',{job_id:next}).then(function(read){
      if(seq!==generation||next!==jobId)return;
      latest=read;host().innerHTML=ClientSignoffUI.officeHtml(read,draft);
    }).catch(function(e){if(seq!==generation||next!==jobId)return;host().innerHTML='<section class="client-so"><h3>Client sign-off</h3><p role="alert">'+ClientSignoffUI.esc(e.message||'Client sign-off could not be checked.')+'</p><button type="button" data-client-so-retry>Retry</button></section>';});
  }
  function fileBase64(file) {
    return new Promise(function(resolve,reject){var reader=new FileReader();reader.onerror=function(){reject(Error('The selected file could not be read.'));};reader.onload=function(){resolve(String(reader.result).split(',')[1]||'');};reader.readAsDataURL(file);});
  }
  document.addEventListener('change',function(ev){
    var h=ev.target.closest&&ev.target.closest('[data-office-client-signoff]');if(!h)return;
    capture();
    if(ev.target.name==='confirmation_kind'){
      var copy=ev.target.value==='signed_copy';h.querySelector('[data-client-so-file]').hidden=!copy;h.querySelector('[data-client-so-reference]').hidden=copy;
      if(!copy){draft.file=null;h.querySelector('[name=signed_file]').value='';var selected=h.querySelector('[data-client-so-selected]');if(selected)selected.remove();}
    }
  });
  document.addEventListener('click',function(ev){
    var btn=ev.target.closest&&ev.target.closest('[data-office-client-signoff] button');if(!btn)return;
    if(btn.hasAttribute('data-client-so-retry')){paint(jobData);return;}
    if(btn.hasAttribute('data-client-so-link')){var url=new URL('group-sign.html',location.href);url.searchParams.set('token',latest.share_token);window.open(url.href,'_blank','noopener');return;}
    var action=btn.hasAttribute('data-client-so-pdf')?'client_signoff_form_pdf':btn.hasAttribute('data-client-so-copy')?'client_signoff_copy':null;
    if(!action)return;btn.disabled=true;var current=jobId;
    opsFetch(action,{job_id:current,signoff_id:btn.getAttribute('data-client-so-copy')||undefined}).then(function(file){ClientSignoffUI.downloadFile(file);}).catch(function(e){if(current===jobId)message(e.message||'The file could not be read.');}).finally(function(){btn.disabled=false;});
  });
  document.addEventListener('submit',function(ev){
    var form=ev.target.closest&&ev.target.closest('[data-client-so-form]');if(!form)return;ev.preventDefault();if(busy)return;
    capture();var fields=draft.fields||{}, current=jobId, button=form.querySelector('button[type=submit]');
    if(!form.reportValidity())return;
    var copy=fields.confirmation_kind==='signed_copy';
    if(copy&&(!draft.file||draft.file.size>8*1024*1024)){message('Choose the client’s signed PDF, PNG or JPEG, no larger than 8 MB.');return;}
    if(!copy&&String(fields.confirmation_reference||'').trim().length<5){message('Give the reference to the client’s written confirmation and how to find it.');return;}
    draft.requestId=draft.requestId||crypto.randomUUID();busy=true;button.disabled=true;message('Recording the client’s confirmation…');
    var body=Object.assign({},fields,{job_id:current,request_id:draft.requestId,client_accepts:fields.client_accepts==='true'});
    var file=draft.file;
    (copy?fileBase64(file):Promise.resolve(null)).then(function(base64){if(base64){body.file_base64=base64;body.file_name=file.name;}return opsPostJwt('record_client_signoff',body);}).then(function(){
      if(current!==jobId)return;draft={};busy=false;
      if(window.GroupWorkOrderOffice)GroupWorkOrderOffice.paint(jobData);else paint(jobData);
    }).catch(function(e){if(current!==jobId)return;busy=false;button.disabled=false;message((e.message||'The recording could not be confirmed.')+' Your entries are kept. Check the job before starting a different recording request.');});
  });
  window.ClientSignoffOffice={paint:paint};
})();
