const {test,expect}=require('@playwright/test');
const path=require('node:path');
for (const width of [1280,390]) test(`Clear Debt invoice context and proposal only at ${width}px`,async({page})=>{
 await page.setViewportSize({width,height:900});
 await page.setContent('<main id="subCleardebt"><div id="clearDebtStats"></div><div id="clearDebtFilters"></div><div id="clearDebtCards"></div></main>');
 await page.addScriptTag({path:path.resolve('modules/ops-clear-debt-v2.js')});
 await page.evaluate(()=>{
  window.posted=[];window.showToast=()=>{};
  const row=id=>({xero_invoice_id:id,invoice_number:'INV-'+id,xero_contact_id:'payer',contact_name:'Sample Company',amount_due:100,days_overdue:12,debt_classification:'genuine_debt',debt_type:'deposit',debt_owner:'DEBT',debt_classification_reason:'Work complete, payment pending',debt_next_action:'Review reply',debt_as_of:'2026-09-11T00:00:00Z'});
  window.opsFetch=async(action,args)=>action==='list_debt_picture'?{rows:[row('a'),row('b')]}:action==='debt_context_coverage'?{as_of:'2026-09-11',rows:[{xero_invoice_id:'a',complete:true}]}:action==='debt_notes'?{thread:[]}: {invoice:{},job:{client_phone:'+61491570156',client_email:'accounts@example.test'},sources:{invoice:{ok:true},conversation:{ok:true}},conversation:{messages:[],last_client_message:{preview:'Reply for '+args.xero_invoice_id}},bank:{xero_payments:[]},blockers:[]};
  window.opsPost=async(action,body)=>{window.posted.push({action,body});return {status:'pending'}};
  loadClearDebt();
 });
 await expect(page.getByText('1 of 2',{exact:true})).toBeVisible();
 await page.getByRole('button',{name:'Chase now',exact:true}).click();
 await page.getByRole('button',{name:/Sample Company/}).click();
 await expect(page.getByText('Reply for a',{exact:true})).toBeVisible();
 await page.getByLabel('Invoice context',{exact:true}).selectOption('b');
 await expect(page.getByText('Reply for b',{exact:true})).toBeVisible();
 await page.getByLabel('Text proposal',{exact:true}).fill('Please review the invoice with Marnin.');
 await page.getByRole('button',{name:'Save proposal for Marnin',exact:true}).first().click();
 const posts=await page.evaluate(()=>window.posted);
 expect(posts).toEqual([{action:'debt_proposal_save',body:{xero_invoice_id:'b',kind:'sms',text:'Please review the invoice with Marnin.',to:'+61491570156'}}]);
 expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
 await page.screenshot({path:`/private/tmp/clear-debt-${width}.png`,fullPage:true});
});
