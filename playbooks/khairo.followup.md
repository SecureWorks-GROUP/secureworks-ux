---
playbook_id: khairo.followup.v1
rep_profile_id: khairo.fencing.calm-tradie.v1
rep_first_name: Khairo
covers_action_types:
  - send_follow_up
  - reply_needed
  - stale_quote_recovery
  - deposit_follow_up
  - call_client
  - holding_sms
default_tone: helpful_service
tone_overrides:
  send_follow_up: helpful_service
  reply_needed: objection_response
  stale_quote_recovery: nurture
  deposit_follow_up: helpful_service
  call_client: internal
  holding_sms: helpful_service
constraints:
  reply_response_max_hours: 4
  high_value_threshold: 20000
  stale_quote_days: 17
  followup_ladder_offset_days: [0, 2, 5, 10, 17]
  nurture_after_attempt: 5
followup_ladder:
  - { offset_days: 0,  channel: sms,    template_id: t0_sent }
  - { offset_days: 2,  channel: sms,    template_id: t1_check_in }
  - { offset_days: 5,  channel: sms,    template_id: t2_value_frame }
  - { offset_days: 10, channel: call,   template_id: t3_phone_prompt }
  - { offset_days: 17, channel: email,  template_id: t4_close_or_archive }
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

# Khairo · Follow-up loop

## Voice

Calm direct Aussie tradie. Fencing-focused. Reframes price to spec
(galvanised post depth, post centres, post vs panel cost) rather
than discount.

## Templates

### send_follow_up · sms_primary
Hey {first_name}, Khairo - quote landed OK? Happy to walk through anything that's not clear.

### send_follow_up · sms_fallback
Hey {first_name}, quote OK? Any questions?  - Khairo

### send_follow_up · sms_primary_nurture
Hey {first_name}, Khairo. No rush on the {job_number} quote - happy to keep it on file. Ping me if anything changes.

### send_follow_up · sms_fallback_nurture
Hey {first_name}, no rush on {job_number}. Ping me anytime.  - Khairo

### send_follow_up · email_subject
{job_number} - quick check-in

### send_follow_up · email_body
Hey {first_name},

Just a quick check that the quote landed OK. Happy to walk you through any of it on a call.

 - Khairo

### reply_needed · sms_primary_objection
Hey {first_name}, Khairo. Good question on {job_number} - I'll send a proper answer in the next hour.

### reply_needed · sms_fallback_objection
Hey {first_name}, got your question - reply incoming shortly.  - Khairo

### reply_needed · sms_primary_helpful
Hey {first_name}, got your message - Khairo on it. Reply incoming shortly.

### reply_needed · sms_fallback_helpful
Hey {first_name}, on it. Reply shortly.  - Khairo

### reply_needed · email_subject
Re: {job_number}

### reply_needed · email_body
Hey {first_name},

Thanks for the message. Khairo here - I'll get back to you with a proper answer in the next hour.

 - Khairo

### stale_quote_recovery · sms_primary_nurture
Hey {first_name}, no pressure - happy to keep {job_number} on file. Ping me if anything changes.  - Khairo

### stale_quote_recovery · sms_fallback_nurture
Hey {first_name}, no pressure on {job_number}. Ping me anytime.  - Khairo

### stale_quote_recovery · sms_primary_value
Hey {first_name}, on the {value} {job_number} - that's galvanised posts at proper depth + Colorbond panels, not a quick fix. Worth a 5-min call?

### stale_quote_recovery · sms_fallback_value
Hey {first_name}, {value} covers galvanised posts + Colorbond. 5-min call?  - Khairo

### stale_quote_recovery · email_subject_value
{job_number} - what {value} actually covers

### stale_quote_recovery · email_body_value
Hey {first_name},

Quick one on {job_number}. The {value} covers galvanised steel posts at proper depth (so it doesn't lean in 5 years), full Colorbond panels, and clean finish on both sides.

Worth a 5-min call to walk through what makes the difference?

 - Khairo

### stale_quote_recovery · email_subject_nurture
{job_number} - keeping it on file

### stale_quote_recovery · email_body_nurture
Hey {first_name},

No pressure on {job_number} - happy to keep it on file. If anything changes, ping me.

 - Khairo

### holding_sms · sms_primary
Hey {first_name}, {rep_first_name} here from SecureWorks - got your fencing enquiry. I'll call within the hour to lock in a site visit.

### holding_sms · sms_fallback
Hey {first_name}, {rep_first_name} here - got your enquiry, will call shortly.

### deposit_follow_up · sms_primary
Hey {first_name}, Khairo here. Quote accepted {hours_since_accepted} ago - when works for the deposit so I can lock in materials?

### deposit_follow_up · sms_fallback
Hey {first_name}, deposit when? Need to lock in materials.  - Khairo

### deposit_follow_up · email_subject
Deposit for {job_number} - materials lock-in

### deposit_follow_up · email_body
Hey {first_name},

Thanks again for accepting the {job_number} quote. To lock in materials we need the deposit (50% standard).

Reply OK and I'll send a payment link.

 - Khairo

## Talk-track templates (call_client)

### call_client · no_first_contact
- "First contact: introduce yourself, reference the enquiry source."
- "Confirm site address + suburb, get a feel for what they want."
- "Lock in a site visit window before hanging up."
- "If they prefer SMS, follow up within the hour."

### call_client · viewed_no_reply
- "Reference the total ({value}) + what they liked at the visit."
- "Ask: 'does anything in the quote not sit right?'"
- "Don't push price - offer to walk through panel choice."
- "If they say wait, get a date and lock it in."

### call_client · site_visit_no_scope
- "Coaching call: ask if they hit a blocker on the scoping tool."
- "Offer to walk through pricing on a call rather than typed scope."
- "If decision delayed, agree on a follow-up date."

### call_client · default
- "Open: warm hello, reference job number {job_number}."
- "Ask: 'anything in the quote not sit right?'"
- "Don't push - listen for hesitation cues."
- "Close: agree on next step + date."
