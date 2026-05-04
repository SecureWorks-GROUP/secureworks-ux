---
playbook_id: nithin.booking.v1
rep_profile_id: nithin.patio.calm-tradie.v1
rep_first_name: Nithin
covers_action_types:
  - book_scope
  - appointment_confirm
default_tone: helpful_service
tone_overrides:
  appointment_confirm: helpful_service
constraints:
  scope_minutes_normal: 45
  scope_minutes_same_day_reserve: 60
  same_day_priority_threshold: 90
  orange_zone_value_gate: 15000
  orange_zone_priority_gate: 75
  max_scopes_per_day: 4
  drive_buffer_default_minutes: 20
forbidden_phrases:
  - "leverage"
  - "as per"
  - "best regards"
  - "kind regards"
  - "Sent from my iPhone"
sms_budget: 160
email_subject_budget: 80
email_body_budget: 350
---

# Nithin · Booking loop

## Voice

Calm direct Aussie tradie. First-name basis. No corporate signoffs. No
exclamation overload (one max). Em dash gets scrubbed by the playbook
engine before send. Sign-off: bare " - Nithin" on its own line for
email; absent for SMS (160-char budget).

## Templates

### book_scope · sms_primary
Thanks {first_name} - we normally run scopes on Tuesdays and Thursdays. What availability do you have around then? I'll line up the best window with the scoper.

### book_scope · sms_fallback
Hey {first_name} - Tue or Thu work for a site visit? Reply with a window and I'll lock it in.  - Nithin

### book_scope · sms_primary_same_day
Hey {first_name}, Nithin here. Got a window today around {same_day_window} if it suits. Quick site visit, 45 min on the clock. Reply "yes" or send your preferred time.

### book_scope · sms_fallback_same_day
Same-day window today {same_day_window}. 45 min on site. Reply yes/no.  - Nithin

### book_scope · email_subject
Site visit for your {suburb} job - what suits Tue or Thu?

### book_scope · email_body
Hey {first_name},

Nithin from SecureWorks. We normally run scopes on Tuesdays and Thursdays for the {job_number} job at {suburb}. What availability do you have around then? Reply with a window and I'll line up the best fit with the scoper.

 - Nithin

### appointment_confirm · sms_primary
Confirming the site visit at {suburb} on {site_visit_window}. Anything I should know about access (gate code, dog, parking)?  - Nithin

### appointment_confirm · sms_fallback
Confirming {site_visit_window}, {suburb}. Reply OK or update.  - Nithin

### appointment_confirm · email_subject
Site visit confirmed - {site_visit_window}

### appointment_confirm · email_body
Hey {first_name},

Confirming the site visit at {suburb} on {site_visit_window}. Anything I should know about access (gate code, dog, parking)?

 - Nithin

## Rationale

The booking message defaults to an open question, not fixed slots, so
the rep and client work out the best middle ground rather than the
client picking from a list and the proposer doing a round-trip. The
two main scope days (Tue + Thu) are stated up front so the client
self-selects toward them.

Same-day variant only fires when the upstream card carries
`priority >= 90` AND the proposer found a same-day green/orange block
of at least `scope_minutes_same_day_reserve + 2 * drive_buffer`.
