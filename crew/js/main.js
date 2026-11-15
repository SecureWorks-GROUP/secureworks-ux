// SecureWorks Crew: app shell. Signs in, picks the screen, draws the tabs.
import { html, render, useEffect, useState, cx } from './lib/h.js';
import { getState, setState, useStore, local, invalidate } from './lib/store.js';
import { initAuth, decorate } from './lib/auth.js';
import { setDemoHandler } from './lib/api.js';
import { useRoute, go, ROOTS } from './lib/router.js';
import { startOutbox, flushOutbox } from './lib/outbox.js';
import { setNow } from './lib/dates.js';
import { Icon } from './ui/icons.js';
import { Overlays, Toasts, toast, Skel, Empty, Button, Page } from './ui/kit.js';
import { ClockBar, restoreClock } from './screens/clock.js';
import { Login } from './screens/login.js';
import { Today } from './screens/today.js';
import { Jobs } from './screens/jobs.js';
import { Job } from './screens/job.js';
import { Pay } from './screens/pay.js';
import { Profile } from './screens/profile.js';

// Screens loaded when first opened.
const lazy = {
  schedule: () => import('./screens/schedule.js').then((m) => m.Schedule),
  booking: () => import('./screens/booking.js').then((m) => m.Booking),
  timesheet: () => import('./screens/timesheet.js').then((m) => m.Timesheet),
  review: () => import('./screens/review.js').then((m) => m.Review),
  invoices: () => import('./screens/invoices.js').then((m) => m.Invoices),
  invoice: () => import('./screens/invoice.js').then((m) => m.Invoice),
  receipt: () => import('./screens/receipt.js').then((m) => m.Receipt),
  receipts: () => import('./screens/receipt.js').then((m) => m.Receipts),
  group: () => import('./screens/group.js').then((m) => m.Group),
  workorders: () => import('./screens/workorders.js').then((m) => m.WorkOrders),
  finish: () => import('./screens/finish.js').then((m) => m.Finish),
  report: () => import('./screens/report.js').then((m) => m.Report),
  roof: () => import('./screens/roof.js').then((m) => m.RoofReport),
  service: () => import('./screens/service.js').then((m) => m.ServiceReport),
  details: () => import('./screens/details.js').then((m) => m.Details),
  availability: () => import('./screens/availability.js').then((m) => m.Availability),
  board: () => import('./screens/board.js').then((m) => m.Board),
  charges: () => import('./screens/charges.js').then((m) => m.Charges)
};
const loaded = {};
function Lazy({ name, ...props }) {
  const [C, setC] = useState(() => loaded[name] || null);
  const [failed, setFailed] = useState(false);
  useEffect(() => {
    if (loaded[name]) { setC(() => loaded[name]); return; }
    let on = true;
    lazy[name]().then((Comp) => { loaded[name] = Comp; if (on) setC(() => Comp); }).catch(() => on && setFailed(true));
    return () => { on = false; };
  }, [name]);
  if (failed) return html`<${Page} title=""><${Empty} title="Could not open that" action=${html`<${Button} kind="line" small onClick=${() => location.reload()}>Reload<//>`}>Check your signal and try again.<//><//>`;
  if (!C) return html`<${Page} title=""><div class="block" style="display:grid;gap:12px"><${Skel} w="55%" h=${24} /><${Skel} h=${120} /><${Skel} w="80%" /></div><//>`;
  return html`<${C} ...${props} />`;
}

function pick(route) {
  const [a, b, c, d] = route.parts;
  if (a === 'schedule' || a === 'team') {
    if (b === 'booking' && c) return html`<${Lazy} key=${route.key} name="booking" bookingId=${c} />`;
    if (b === 'availability') return html`<${Lazy} key=${route.key} name="availability" />`;
    // /schedule, /schedule/month, /schedule/everyone (managers); ?day=YYYY-MM-DD picks the day shown
    return html`<${Lazy} key="schedule" name="schedule" view=${a === 'team' ? 'everyone' : b || 'week'} day=${route.query.day} />`;
  }
  if (a === 'jobs') {
    if (b === 'board') return html`<${Lazy} key=${route.key} name="board" vertical=${c} />`;
    return html`<${Jobs} key="jobs" />`;
  }
  if (a === 'board') return html`<${Lazy} key=${route.key} name="board" vertical=${b} />`;
  if (a === 'job' && b) {
    if (c === 'finish') return html`<${Lazy} key=${route.key} name="finish" jobId=${b} />`;
    if (c === 'report') return html`<${Lazy} key=${route.key} name="report" jobId=${b} />`;
    if (c === 'roof') return html`<${Lazy} key=${route.key} name="roof" jobId=${b} />`;
    if (c === 'service') return html`<${Lazy} key=${route.key} name="service" jobId=${b} />`;
    return html`<${Job} key=${'job:' + b} jobId=${b} tab=${route.query.tab} />`;
  }
  if (a === 'pay') {
    // /pay/week/<monday> is the timesheet; /pay/week/<monday>/invoice is the invoice made from it
    if (b === 'week' && d === 'invoice') return html`<${Lazy} key=${route.key} name="review" monday=${c} />`;
    if (b === 'week') return html`<${Lazy} key=${route.key} name="timesheet" monday=${c} />`;
    if (b === 'invoice' && c) return html`<${Lazy} key=${route.key} name="invoice" invoiceId=${c} />`;
    if (b === 'invoices' || b === 'money') return html`<${Lazy} key=${route.key} name="invoices" />`;
    if (b === 'receipt') return html`<${Lazy} key=${route.key} name="receipt" jobId=${route.query.job} poId=${route.query.po} />`;
    if (b === 'receipts') return html`<${Lazy} key=${route.key} name="receipts" />`;
    if (b === 'group' && c) return html`<${Lazy} key=${route.key} name="group" jobId=${c} />`;
    if (b === 'work-orders') return html`<${Lazy} key=${route.key} name="workorders" openId=${c} />`;
    if (b === 'charges') return html`<${Lazy} key=${route.key} name="charges" />`;
    return html`<${Pay} key="pay" />`;
  }
  if (a === 'profile' || a === 'me') {
    if (b === 'details') return html`<${Lazy} key=${route.key} name="details" />`;
    if (b === 'availability') return html`<${Lazy} key=${route.key} name="availability" />`;
    return html`<${Profile} key="profile" />`;
  }
  return html`<${Today} key="today" />`;
}
// Screens that take the whole phone: one job to finish, no tabs underneath.
const FOCUS = ['finish', 'report', 'roof', 'service', 'receipt', 'group'];
const TAB_OF = { today: 'today', schedule: 'schedule', team: 'schedule', jobs: 'jobs', job: 'jobs', board: 'jobs', pay: 'pay', profile: 'profile', me: 'profile' };

function Nav({ route }) {
  const outbox = useStore((s) => s.outbox);
  const tabs = [['today', 'Today', 'clock'], ['schedule', 'Schedule', 'calendar'], ['jobs', 'Jobs', 'briefcase'], ['pay', 'Pay', 'cash'], ['profile', 'Profile', 'me']];
  const active = TAB_OF[route.parts[0]] || 'today';
  return html`<nav class="nav" aria-label="Main">
    ${tabs.map(([id, label, icon]) => html`<button type="button" aria-current=${active === id ? 'page' : 'false'} onClick=${() => go('/' + id, { tab: true })}>
      <${Icon} name=${icon} size=${24} stroke=${active === id ? 2.2 : 1.8} /><span>${label}</span>
      ${id === 'profile' && outbox > 0 ? html`<i class="dot" />` : null}
    </button>`)}
  </nav>`;
}

function App() {
  const ready = useStore((s) => s.ready);
  const user = useStore((s) => s.user);
  const online = useStore((s) => s.online);
  const demo = useStore((s) => s.demo);
  const route = useRoute();
  useEffect(() => { if (user) { restoreClock(); setTimeout(flushOutbox, 3000); } }, [user && user.id]);
  // Coming back to the app after a while: quietly check for changes.
  useEffect(() => {
    let away = 0;
    const fn = () => { if (document.hidden) { away = Date.now(); return; } if (away && Date.now() - away > 30000) { invalidate('myjobs'); invalidate('hours'); invalidate('job:'); invalidate('invoices'); } };
    document.addEventListener('visibilitychange', fn);
    return () => document.removeEventListener('visibilitychange', fn);
  }, []);
  if (!ready) return html`<div class="boot"><span><i />SecureWorks Crew</span></div>`;
  if (!user) return html`<${Login} /><${Toasts} />`;
  const focus = FOCUS.some((f) => route.parts.includes(f));
  return html`<div class="shell">
    <div class="stage">
      ${pick(route)}
    </div>
    <div>
      ${!online ? html`<div class="strip"><${Icon} name="cloudoff" size=${15} />No signal. You can keep working.</div>` : null}
      ${demo ? html`<div class="strip">Demo with made-up jobs. Nothing here is real.</div>` : null}
      ${focus || (TAB_OF[route.parts[0]] || 'today') === 'today' ? null : html`<${ClockBar} />`}
    </div>
    ${focus ? html`<span />` : html`<${Nav} route=${route} />`}
    <${Overlays} /><${Toasts} />
  </div>`;
}

window.addEventListener('beforeinstallprompt', (e) => { e.preventDefault(); window.__crewInstall = e; window.dispatchEvent(new Event('crew:installable')); });

async function boot() {
  const params = new URLSearchParams(location.search);
  const forced = window.CREW_CONFIG.forceDemo;
  if (params.has('demo') || forced) {
    const demo = await import('./demo/server.js');
    await Promise.all([import('./demo/extra-pay.js'), import('./demo/extra-reports.js'), import('./demo/extra-manager.js')]);
    if (params.get('now')) setNow(new Date(params.get('now')));
    const persona = params.get('demo') || local.get('demoPersona', '') || (forced === true ? 'crew' : forced) || 'crew';
    local.set('demoPersona', persona);
    const server = demo.createDemoServer(persona);
    // ?switches=off shows the app as it behaves before the three server switches are turned on.
    if (params.get('switches') === 'off') Object.assign(server.db.flags, { companyView: false, selfBooking: false, rateEditable: false });
    setDemoHandler(server);
    setState({ demo: true, ready: true, user: params.has('signedout') ? null : decorate(demo.demoProfile(persona)) });
    window.__crewDemoSignIn = () => setState({ user: decorate(demo.demoProfile(persona)) });
  }
  const jobId = params.get('jobId');
  if (jobId && /^[0-9a-f-]{36}$/i.test(jobId)) history.replaceState({ d: 0 }, '', location.pathname + (params.has('demo') ? '?demo=' + params.get('demo') : '') + '#/job/' + jobId);
  await initAuth();
  startOutbox();
  window.addEventListener('crew:outbox-flushed', (e) => {
    const { sent, dropped } = e.detail;
    if (sent) toast(sent === 1 ? 'Sent the one that was waiting.' : `Sent ${sent} that were waiting.`, { kind: 'ok' });
    dropped.forEach(({ item }) => toast(`"${item.label || 'A saved change'}" was not accepted by the office system.`, { kind: 'bad', ms: 6000 }));
  });
  const root = document.getElementById('app');
  root.textContent = '';
  render(html`<${App} />`, root);
  if ('serviceWorker' in navigator && !getState().demo && location.protocol === 'https:') {
    navigator.serviceWorker.register('sw.js', { scope: './' }).catch(() => {});
  }
  local.set('opened', Date.now());
}
boot();
