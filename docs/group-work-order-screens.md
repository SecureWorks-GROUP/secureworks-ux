# Group work order screens

Backend: secureworks-backend `docs/group-work-orders-v1.md` (PR 1131). A 401, 403, 404 or any other error paints nothing on the trade card, the client page and the office Overview. Create and Join appear only after a successful read says the switch is on (`enabled: true`). The share read is not requested when that switch is absent.

A trade on the job's Work and Scope tabs can Create, Join, and save a day's date, start, finish and break. After hours are in, the card shows **Total** (`pot_total`) and **Your share** (`my_share`) only. Another person's share, the token, and agreed labour are dropped even if a response carries them. Before hours, those two amounts stay hidden.

The public page is `group-sign.html?token=`. It shows the job number and suburb, a drawn signature, and five ratings: sales process, communication, cleanliness, punctuality, crew on site. It tells the client: "These ratings go to the office. They are not viewed by the installers." It never shows a dollar amount.

The office job Overview shows the total, every share, and the ratings. Reopen the split posts `unfreeze_group_work_order`. Nothing on these screens sends a text or an email.
