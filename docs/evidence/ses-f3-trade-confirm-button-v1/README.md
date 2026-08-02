# F3 trade portal-confirmation evidence

Generated 2026-08-02 AWST. This verification was read-only. The confirmation control was never clicked, no production record was changed, and the query selected no client name, phone, email, or street-address field.

## Live cohort measurement

The production read used the Supabase Management API `/database/query` endpoint with `read_only: true`. It applied the named active-board population shape and selected only job reference, suburb, portal workflow state, cycle, and verification fields.

```sql
with roof as (
  select
    j.id, j.job_number, j.site_suburb, d.substatus,
    d.report_received_at, d.cycle_number, d.attendance_cycle_id,
    d.portal_verified_at, d.portal_verified_cycle
  from jobs j
  join makesafe_job_details d on d.job_id = j.id
  where j.status not in ('cancelled', 'lost')
    and (
      j.type = 'makesafe'
      or (j.type = 'insurance' and j.metadata->>'insurance_job_type' = 'restoration')
      or exists (
        select 1 from makesafe_job_details d2 where d2.job_id = j.id
      )
    )
    and not exists (
      select 1 from ses_synthetic_livefire_runs r
      where r.state = 'terminal' and r.job_ids ? j.id::text
    )
    and (
      coalesce(j.metadata->>'makesafe_job_family', '') in
        ('ordinary_roof_portal', 'own_template_roof', 'roof_report')
      or d.report_type = 'roof_report'
    )
), measured as (
  select *,
    (
      report_received_at is not null
      or lower(coalesce(substatus, '')) in
        ('admin_to_send_report', 'ready_to_invoice', 'complete')
    ) as legacy_done,
    (
      portal_verified_at is not null
      and portal_verified_cycle = coalesce(cycle_number, 1)
    ) as verified_this_cycle
  from roof
)
select
  count(*) as roof_cards,
  count(*) filter (where legacy_done) as legacy_hidden,
  count(*) filter (
    where legacy_done and not verified_this_cycle
  ) as previously_hidden_now_visible,
  count(*) filter (
    where verified_this_cycle
  ) as genuinely_verified_still_hidden,
  count(*) filter (
    where verified_this_cycle and not legacy_done
  ) as verified_previously_showing_button
from measured;
```

Result:

```text
roof_cards                         60
legacy_hidden                     33
previously_hidden_now_visible     19
genuinely_verified_still_hidden   14
verified_previously_showing_button 0
```

The same read-only endpoint returned `capture_rows = 0` and `sealed_done_capture_rows = 0` for:

```sql
select
  count(*) as capture_rows,
  count(*) filter (
    where capture_result = 'done'
      and status = 'verified'
      and screenshot_object_key is not null
  ) as sealed_done_capture_rows
from makesafe_portal_capture_revisions;
```

The 19-card list matched the audit cohort exactly, including `SWMS-261114` in White Gum Valley and `SWMS-261116` in Morley. Both remained `ready_to_invoice`, cycle 1, with `portal_verified_at = null` and `portal_verified_cycle = null`. Passing the redacted live rows through the exact patched sentinel module returned `{"cohort":19,"button_visible":19,"all_visible":true}`. The same check over the 14 current-cycle-verified roof rows returned `{"cohort":14,"button_hidden":14,"all_hidden":true}`.

## Browser acceptance

`chrome-devtools-axi` opened the live production Trade App URL. The DevTools bridge had no authenticated trade profile, so no production detail endpoint was called from the browser. Instead, the allowed redacted fields from the read-only query were passed through the exact patched `// <trade-reportdone>` module extracted from this checkout and rendered in the live Trade App page.

The acceptance result was:

```json
{
  "productionUrl": "https://secureworks-group.github.io/secureworks-ux/trade.html",
  "previouslyHiddenDone": false,
  "verifiedDone": true,
  "buttonPresent": true,
  "buttonEnabled": true,
  "verifiedPanelHasButton": false
}
```

The redacted browser surface showed `SWMS-261114` with an enabled **Report completed on builder portal** button and a genuinely current-cycle-verified roof card with the green completed state and no confirmation button. The confirmation control was not clicked. End-to-end production authorization of a real trade JWT remains **UNVERIFIED**, matching the audit boundary.

## Expired share links

The client cannot determine Prime share-token expiry from the stored URL and does not treat it as an app failure. When a URL exists, the trade still sees the portal link, the enabled confirmation control, and explicit guidance to use **Note for admin** to request a fresh builder link and to confirm only after the report is completed. No live share token was opened or captured.
