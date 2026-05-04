---
playbook_id: khairo.booking.v1
rep_profile_id: khairo.fencing.calm-tradie.v1
rep_first_name: Khairo
covers_action_types:
  - book_scope
  - appointment_confirm
default_tone: helpful_service
tone_overrides:
  appointment_confirm: helpful_service
constraints:
  scope_minutes_normal: 30
  scope_minutes_same_day_reserve: 60
  same_day_priority_threshold: 90
  orange_zone_value_gate: 15000
  orange_zone_priority_gate: 75
  max_scopes_per_day: 4
  drive_buffer_default_minutes: 15
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

# Khairo · Booking loop

## Voice

Calm direct Aussie tradie. Fencing-focused. Quick on the phone. Likes
the visit short and sharp - 30 minutes on a normal scope is plenty.

## Templates

### book_scope · sms_primary
Thanks {first_name} - we normally run scopes on Tuesdays and Thursdays. What availability do you have around then? I'll line up the best window with the scoper.

### book_scope · sms_fallback
Hey {first_name} - Tue or Thu OK for a quick site visit? Reply with a window.  - Khairo

### book_scope · sms_primary_same_day
Hey {first_name}, Khairo. Got a window today around {same_day_window} if it suits. Quick measure-up, 30 min on site. Reply "yes" or send your preferred time.

### book_scope · sms_fallback_same_day
Same-day window today {same_day_window}. 30 min on site. Reply yes/no.  - Khairo

### book_scope · email_subject
Site visit for your {suburb} fence - what suits Tue or Thu?

### book_scope · email_body
Hey {first_name},

Khairo from SecureWorks. We normally run scopes on Tuesdays and Thursdays for the {job_number} job at {suburb}. What availability do you have around then? Reply with a window and I'll line up the best fit with the scoper.

 - Khairo

### appointment_confirm · sms_primary
Confirming the site visit at {suburb} on {site_visit_window}. Anything I should know about access (gate code, dog, parking)?  - Khairo

### appointment_confirm · sms_fallback
Confirming {site_visit_window}, {suburb}. Reply OK or update.  - Khairo

### appointment_confirm · email_subject
Site visit confirmed - {site_visit_window}

### appointment_confirm · email_body
Hey {first_name},

Confirming the site visit at {suburb} on {site_visit_window}. Anything I should know about access (gate code, dog, parking)?

 - Khairo

## Rationale

Same shape as Nithin's booking loop, tuned for fencing: 30 minutes on
site is the default scope time. Same-day variant fires when upstream
priority crosses 90 AND a green/orange block of (60 + 2 * drive)
minutes is available today.
