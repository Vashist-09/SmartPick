import { lookupParcel, validateAccountForm, validateProfile, cleanProfile, initials } from './data.js';
const paths = {
 box: '<path d="m3 7 9-5 9 5v10l-9 5-9-5V7Zm0 0 9 5 9-5M12 12v10M7 4.8l9 5"/>',
 home: '<path d="m3 10 9-7 9 7v11h-6v-7H9v7H3Z"/>',
 scan: '<path d="M8 3H3v5m13-5h5v5M3 16v5h5m13-5v5h-5M7 8v8m4-8v8m3-8v8m3-8v8"/>',
 clock: '<circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/>',
 arrow: '<path d="M4 12h16m-6-6 6 6-6 6"/>',
 sun: '<circle cx="12" cy="12" r="4"/><path d="M12 2v2m0 16v2M2 12h2m16 0h2M5 5l1 1m12 12 1 1M5 19l1-1M18 6l1-1"/>',
 moon: '<path d="M20 15A9 9 0 0 1 9 4a9 9 0 1 0 11 11Z"/>',
 check: '<path d="m5 12 4 4L19 6"/>',
 link: '<path d="m10 13 4-4m-6 7-1 1a4 4 0 0 1-6-6l4-4a4 4 0 0 1 6 0m2 1 1-1a4 4 0 0 1 6 6l-4 4a4 4 0 0 1-6 0"/>',
 alert: '<path d="m12 3 10 18H2L12 3Zm0 6v5m0 3v1"/>'
};
const icon = (name, cls = '') => `<svg class="icon ${cls}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${paths[name]}</svg>`;
const illustration = () => `<div class="parcel-art" aria-hidden="true"><div class="orbit orbit-one"></div><div class="orbit orbit-two"></div><div class="spark spark-one">+</div><div class="spark spark-two">+</div><svg viewBox="0 0 240 210"><ellipse cx="120" cy="181" rx="72" ry="12" fill="currentColor" opacity=".07"/><path d="m45 73 74-38 77 38-76 41Z" fill="#e6b98b"/><path d="m45 73 75 41v70l-75-41Z" fill="#d9a675"/><path d="m120 114 76-41v70l-76 41Z" fill="#bd8556"/><path d="m91 49 77 39-24 13-77-40Z" fill="#fae2bd"/><path d="m144 101 24-13v36l-24 13Z" fill="#ebc798"/><path d="m58 119 29 16v20l-29-16Z" fill="#fff8ed"/><path d="m63 126 18 10m-18-4 12 7" stroke="#b78c65" stroke-width="2"/><circle cx="184" cy="44" r="23" fill="#e7753b"/><path d="m174 44 7 7 13-14" fill="none" stroke="white" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"/></svg></div>`;
const getSaved = (key, fallback) => { try { return JSON.parse(localStorage.getItem(key)) ?? fallback; } catch { return fallback; } };
let history = getSaved('smartpick-activity', []);
if (!Array.isArray(history)) history = [];
history = history.filter(x => x && typeof x.id === 'string' && ['FOUND','NOT_FOUND'].includes(x.status)).slice(0,20);
let savedProfile = getSaved('smartpick-demo-profile', null);
if (!savedProfile || Object.keys(validateProfile(savedProfile)).length) savedProfile = null;
let user = null;
try { if (sessionStorage.getItem('smartpick-demo-session') === 'active') user = savedProfile; } catch {}
let accountDraft = {};
let profileEditing = false;
let accountMessage = '';
let accountMessageRoute = null;
function setAccountMessage(message, route = page()) {
 accountMessage = message;
 accountMessageRoute = message ? route : null;
}
let lookupGeneration = 0;
let connection = 'connected';
let result = null;
let error = '';
let busy = false;
let draft = '';
const escape = value => String(value).replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const save = (key, value) => { try { localStorage.setItem(key, value); } catch {} };
const page = () => ['home','scan','activity','result','login','register','forgot','profile','settings'].includes(location.hash.slice(1)) ? location.hash.slice(1) : 'home';
const go = name => { if (page() === name) render(); else location.hash = name; };
function statusCard() {
 const connected = connection === 'connected';
 return `<section class="connection" aria-live="polite"><div class="connection-icon ${connected ? '' : 'offline'}">${icon('link')}</div><div class="connection-copy"><strong>${connected ? 'Demo ESP32 ready' : connection === 'connecting' ? 'Demo reconnecting…' : 'Demo ESP32 offline'}</strong><span>Simulation only · No BLE connection</span></div><span class="status-dot ${connected ? '' : 'offline'}"></span></section>`;
}
function activityRows(items) {
 return items.map((item, index) => `<button class="activity-row" data-history="${index}"><span class="row-icon ${item.status === 'FOUND' ? 'found' : 'missing'}">${icon(item.status === 'FOUND' ? 'box' : 'alert')}<i>${icon(item.status === 'FOUND' ? 'check' : 'alert')}</i></span><span class="row-copy"><strong>${escape(item.id)}</strong><small>${escape(item.carrier || 'No matching parcel')} · ${escape(item.time || 'Just now')}</small></span><span class="row-result ${item.status === 'FOUND' ? '' : 'not-found'}">${item.status === 'FOUND' ? `<strong>${escape(item.slot)}</strong><small>Ready to pick up</small>` : '<strong>Not found</strong><small>Check ID</small>'}</span>${icon('arrow')}</button>`).join('');
}
function home() {
 return `${accountMessage ? `<p class="account-feedback" role="status">${escape(accountMessage)}</p>` : ''}<div class="home-welcome"><div><p>Good to see you,</p><h1>Hello, ${escape(user ? user.fullName.split(/\s+/)[0] : 'there')}<span>✳</span></h1></div><span class="welcome-note">Less searching.<br>More getting on with your day.</span></div><section class="hero"><div class="hero-copy"><span class="hero-kicker">The last stop for your delivery.</span><h2>Good things.<br><em>Easy pickups.</em></h2><p>Your parcel has a place.<br>Let’s find yours.</p><button class="primary" data-go="scan">${icon('scan')} Scan ID ${icon('arrow')}</button></div><div class="hero-scene"><span class="scene-tag">Handle with a little happiness.</span><div class="scene-rack" aria-hidden="true"><span>01</span><span>02</span><span>03</span><span class="open">04</span><span>05</span><span>06</span></div>${illustration()}<div class="scene-ticket" aria-hidden="true"><span>Special delivery</span><strong>Just for you.</strong><div class="ticket-bars"></div></div></div><div class="hero-foot">${icon('box')} From arrived to in your hands.<span>SmartPick / 01</span></div></section>${statusCard()}<section class="home-activity"><div class="section-title"><div><h2>Your parcel trail</h2><p>Recent searches, ready when you are.</p></div><button class="text-button" data-go="activity">View all ${icon('arrow')}</button></div>${history.length ? activityRows(history.slice(0,3)) : `<div class="first-parcel"><span class="row-icon">${icon('clock')}</span><div><strong>Your next pickup starts here.</strong><p>Scan an ID to start your parcel trail.</p></div><button class="round-button" data-go="scan" aria-label="Scan your first parcel">${icon('arrow')}</button></div>`}</section><section class="device-tools"><span>Demo device · ESP32</span><button class="text-button" id="connection-toggle">${connection === 'connected' ? 'Simulate disconnect' : connection === 'connecting' ? 'Connecting…' : 'Retry demo'} ${icon('arrow')}</button></section>`;
}
function scan() {
 return `<div class="page-heading"><div><p class="eyebrow">One scan. One less thing.</p><h1>Your ID. Your parcel.</h1><p class="muted intro">Use the barcode on your VIT ID to find your pickup slot.</p></div></div>${statusCard()}${connection !== 'connected' ? `<div class="notice" role="alert">${icon('alert')}<div><strong>Resume the demo</strong><p>The simulated device is offline. Retry to continue testing. No physical device is connected.</p><button class="text-button" id="retry">Retry demo ${icon('arrow')}</button></div></div>` : ''}<section class="scanner card" aria-labelledby="scanner-title"><div class="scanner-top"><span class="pill" id="scanner-title">${icon('scan')} Scan your VIT ID</span><span class="demo-label">Demo preview</span></div><div class="viewfinder"><i aria-hidden="true"></i><div class="vit-preview" aria-hidden="true"><div class="vit-card-top"><strong>VIT</strong><span>Student identification</span></div><div class="vit-card-body"><span class="id-portrait"></span><div><span>Registration number</span><strong>SP1024</strong><div class="barcode"></div></div></div></div><div class="scan-line" aria-hidden="true"></div></div><div class="scan-guidance"><span class="scan-step">1</span><p>Place your VIT ID inside the frame, with the barcode facing the scanner.</p></div><div class="scan-guidance"><span class="scan-step">2</span><p>Keep the barcode flat, clear and free of glare.</p></div><button class="scan-demo-button" id="demo-scan" ${busy || connection !== 'connected' ? 'disabled' : ''}>${icon('scan')} Try a demo ID scan ${icon('arrow')}</button><p class="scanner-disclaimer">Preview only · Uses SP1024 mock data. Camera and BLE are off.</p></section><div class="scan-fallback"><span></span>or enter it yourself<span></span></div><section class="manual card" aria-labelledby="manual-title"><div class="section-title"><h2 id="manual-title">Registration number</h2></div><p class="muted">No scan? Type the number from your VIT ID.</p><form id="lookup-form" novalidate aria-busy="${busy}"><label for="parcel-id">VIT registration number</label><input id="parcel-id" name="parcelId" value="${escape(draft)}" placeholder="e.g. SP1024 (demo)" maxlength="30" autocomplete="off" autocapitalize="characters" spellcheck="false" ${busy ? 'disabled' : ''} aria-describedby="registration-hint input-error" ${error ? 'aria-invalid="true"' : ''}><p id="registration-hint" class="registration-hint">Demo IDs below use the existing mock parcel records.</p><p id="input-error" class="field-error" role="alert">${error ? `${icon('alert')} ${escape(error)}` : ''}</p><button class="primary" ${busy || connection !== 'connected' ? 'disabled' : ''}>${busy ? '<span class="lookup-spinner" aria-hidden="true"></span> Finding your parcel…' : `${icon('box')} Find my parcel ${icon('arrow')}`}</button><p class="lookup-progress" role="status" aria-live="polite">${busy ? 'Checking the mock parcel records. Your slot will appear here shortly.' : ''}</p></form><div class="demo-ids"><span>Try a registration</span><button data-id="SP1024" ${busy ? 'disabled' : ''}>SP1024</button><button data-id="SP2048" ${busy ? 'disabled' : ''}>SP2048</button><button data-id="SP0000" ${busy ? 'disabled' : ''}>Not found</button></div></section>`;
}
function submitLookup(value) {
 if (busy || connection !== 'connected') return;
 draft = value;
 try {
  const pending = lookupParcel(value);
  const generation = lookupGeneration;
  error = '';
  busy = true;
  render();
  document.querySelector('.lookup-progress')?.scrollIntoView({block:'nearest'});
  setTimeout(() => {
   if (generation !== lookupGeneration) return;
   busy = false;
   result = pending;
   draft = '';
   result.time = new Date().toLocaleString([], {month:'short',day:'numeric',hour:'2-digit',minute:'2-digit'});
   history.unshift({...result});
   history = history.slice(0,20);
   save('smartpick-activity', JSON.stringify(history));
   if (page() === 'scan') go('result');
   else render();
  }, 700);
 } catch(e) {
  error = e.message;
  render();
  document.querySelector('#parcel-id')?.focus();
 }
}
function slotRack(slot) {
 const [zone, number] = slot.split('-');
 const selected = Number(number);
 const start = Math.max(1, Math.floor((selected - 1) / 6) * 6 + 1);
 return `<div class="rack-scene"><div class="rack-heading"><span>SmartPick lockers</span><span>Zone ${escape(zone)}</span></div><div class="locker" role="img" aria-label="Locker rack with slot ${escape(slot)} highlighted">${Array.from({length:6}, (_, i) => { const n = start+i; const active = n === selected; return `<div class="locker-door ${active ? 'selected' : ''}"><span class="door-number">${escape(zone)}-${String(n).padStart(2,'0')}</span><span class="door-vent"></span><span class="door-handle"></span>${active ? `<span class="door-parcel">${icon('box')}</span><span class="door-light"></span>` : ''}</div>`; }).join('')}</div><div class="rack-base"></div><span class="rack-caption"><i></i> Your parcel is in the highlighted slot</span></div>`;
}
function resultScreen() {
 if (!result) return `<div class="empty card">${icon('scan')}<h1>A parcel awaits.</h1><p>Scan or enter an ID to find its home.</p><button class="primary" data-go="scan">Find a parcel ${icon('arrow')}</button></div>`;
 const found = result.status === 'FOUND';
 return `<div class="page-heading result-heading"><div><p class="eyebrow">${found ? 'Right where it belongs.' : 'A little detour.'}</p><h1>${found ? 'Hello, parcel.' : 'No parcel just yet.'}</h1></div><span class="result-check ${found ? '' : 'missing'}">${icon(found ? 'check' : 'alert')}</span></div><section class="result ${found ? 'is-found' : 'is-missing'}">${found ? `<div class="slot-focus"><div><span class="slot-label">Your pickup slot</span><div class="slot">${escape(result.slot)}</div></div><div class="pickup-note"><span class="ready-dot"></span><strong>Ready for pickup</strong><p>Find the highlighted door.<br>Your parcel is waiting.</p></div></div>${slotRack(result.slot)}` : `<div class="missing-scene">${illustration()}<span class="missing-code">NOT_FOUND</span></div><p class="missing-message">We couldn’t find a parcel with this ID.<br>Check the registration number and give it another go.</p>`}<div class="parcel-details"><div class="details-heading">${icon('box')}<h2>Parcel details</h2></div><dl><div><dt>Registration ID</dt><dd>${escape(result.id)}</dd></div><div><dt>Pickup status</dt><dd class="${found ? 'ready-text' : ''}">${found ? 'Ready to pick up' : 'Not found'}</dd></div>${found ? `<div><dt>Carrier</dt><dd>${escape(result.carrier)}</dd></div><div><dt>Arrival time</dt><dd>${escape(result.arrived)}</dd></div>` : ''}</dl></div><button class="primary" data-go="scan">${icon('scan')}${found ? 'Scan Another ID' : 'Try another ID'} ${icon('arrow')}</button><button class="secondary" data-go="home">Back to home</button></section>`;
}
function activity() {
 return `<div class="page-heading"><div><p class="eyebrow">Every parcel has a story.</p><h1>Your activity.</h1><p class="muted intro">A little trail of things you’ve found.</p></div></div><section class="card activity"><div class="section-title"><h2>Recent lookups</h2><span>${history.length} searches</span></div>${history.length ? activityRows(history) : `<div class="empty">${icon('clock')}<h2>A fresh start.</h2><p>Your parcel searches will appear here.</p><button class="primary" data-go="scan">Find your first parcel ${icon('arrow')}</button></div>`}</section>`;
}
const demoNotice = () => `<div class="demo-account-notice">${icon('alert')}<p><strong>Local demo account</strong>No secure authentication is connected. Use sample details and a disposable password. Passwords are never stored or verified.</p></div>`;
function accountField(name, label, type = 'text', options = {}) {
 const value = accountDraft[name] ?? '';
 const password = type === 'password';
 return `<div class="account-field ${options.wide ? 'wide' : ''}"><label for="account-${name}">${label}${options.optional ? ' <span>(optional)</span>' : ''}</label><div class="account-input"><input id="account-${name}" name="${name}" type="${type}" value="${escape(value)}" autocomplete="${options.autocomplete || 'off'}" ${options.maxlength ? `maxlength="${options.maxlength}"` : ''} ${options.optional ? '' : 'required'} aria-describedby="error-${name}" ${name === 'phone' ? 'inputmode="tel"' : ''}>${password ? `<button class="password-toggle" type="button" data-password="${name}" aria-label="Show ${label.toLowerCase()}" aria-pressed="false">Show</button>` : ''}</div><p class="account-field-error" id="error-${name}" aria-live="polite"></p></div>`;
}
function authScreen(mode) {
 const registration = mode === 'register';
 const forgot = mode === 'forgot';
 return `<div class="account-layout"><section class="account-intro"><p class="eyebrow">A little less searching.</p><h1>${registration ? 'Make room for<br>easy pickups.' : forgot ? 'Let’s find your<br>way back.' : 'Good to have<br>you back.'}</h1><p class="muted">${registration ? 'Your student details, all in one place.' : forgot ? 'Password recovery belongs to a connected account service.' : 'Your parcel’s last stop. Your day’s next chapter.'}</p>${illustration()}<a class="text-button" href="#home">Explore the parcel demo ${icon('arrow')}</a></section><section class="account-panel card"><div class="section-title"><h2>${registration ? 'Create a demo account' : forgot ? 'Forgot password?' : 'Log in to the demo'}</h2></div>${demoNotice()}<form id="account-form" data-mode="${mode}" novalidate><p id="account-errors" class="account-summary" role="alert"></p><div class="account-fields">${registration ? `${accountField('fullName','Full name','text',{autocomplete:'name',maxlength:80,wide:true})}${accountField('registration','VIT registration number','text',{maxlength:30})}${accountField('email','Email address','email',{autocomplete:'email'})}${accountField('phone','Phone number','tel',{autocomplete:'tel',optional:true,wide:true})}` : accountField('identity','Email or student ID','text',{autocomplete:'username',wide:true})}${forgot ? '' : accountField('password','Password','password',{autocomplete:registration ? 'new-password' : 'current-password',wide:true})}${registration ? accountField('confirmPassword','Confirm password','password',{autocomplete:'new-password',wide:true}) : ''}</div>${!registration && !forgot ? '<a class="forgot-link" href="#forgot">Forgot password?</a>' : ''}<button class="primary" type="submit">${registration ? 'Create demo account' : forgot ? 'View recovery options' : 'Enter demo account'} ${icon('arrow')}</button><p id="account-feedback" class="account-feedback" role="status">${escape(accountMessage)}</p></form><p class="account-switch">${registration ? 'Already tried the demo? <a href="#login">Log in</a>' : forgot ? '<a href="#login">Back to login</a>' : 'New around here? <a href="#register">Create a demo account</a>'}</p></section></div>`;
}
function profile() {
 if (!user) return signedOutAccount();
 if (profileEditing && !Object.keys(accountDraft).length) accountDraft = {...user};
 return `<div class="page-heading"><div><p class="eyebrow">The person behind the pickup.</p><h1>My profile.</h1></div><span class="profile-initials">${escape(initials(user.fullName))}</span></div><section class="profile-panel card"><div class="profile-title"><div><h2>${escape(user.fullName)}</h2><span>Local demo profile · This browser only</span></div>${!profileEditing ? '<button class="text-button" id="edit-profile">Edit profile</button>' : ''}</div><p class="account-feedback" role="status">${escape(accountMessage)}</p>${profileEditing ? `<form id="account-form" data-mode="profile" novalidate><p id="account-errors" class="account-summary" role="alert"></p><div class="account-fields">${accountField('fullName','Full name','text',{autocomplete:'name',maxlength:80,wide:true})}${accountField('registration','VIT registration number','text',{maxlength:30})}${accountField('email','Email address','email',{autocomplete:'email'})}${accountField('phone','Phone number','tel',{autocomplete:'tel',optional:true,wide:true})}</div><div class="form-actions"><button class="primary" type="submit">Save demo profile ${icon('check')}</button><button class="secondary" type="button" id="cancel-profile">Cancel</button></div></form>` : `<dl class="profile-data"><div><dt>Full name</dt><dd>${escape(user.fullName)}</dd></div><div><dt>VIT registration number</dt><dd>${escape(user.registration)}</dd></div><div><dt>Email address</dt><dd>${escape(user.email)}</dd></div><div><dt>Phone number</dt><dd>${escape(user.phone || 'Not provided')}</dd></div></dl>`}<div class="profile-foot"><p>Demo details are stored locally, without a backend account.</p><button class="text-button" data-signout>Sign out ${icon('arrow')}</button></div></section>`;
}
function signedOutAccount() {
 return `<div class="empty card"><h1>Your own little corner.</h1><p>Enter a demo account to view and edit a local student profile.</p><button class="primary" data-go="login">Log in to the demo ${icon('arrow')}</button><a class="text-button" href="#register">Create a demo account</a></div>`;
}
function settings() {
 if (!user) return signedOutAccount();
 return `<div class="page-heading"><div><p class="eyebrow">Make yourself at home.</p><h1>Account settings.</h1></div></div><section class="settings-panel card"><h2>Appearance</h2><p class="muted">A warm welcome, day or night. Saved on this browser.</p><div class="theme-options">${['light','dark'].map(theme => `<button data-theme-choice="${theme}" aria-pressed="${(document.documentElement.dataset.theme || 'light') === theme}">${icon(theme === 'light' ? 'sun' : 'moon')}${theme === 'light' ? 'Warm light' : 'Charcoal dark'}</button>`).join('')}</div><h2>Your demo account</h2><p class="muted">Profile details and parcel activity are stored in this browser. Activity is shared across demo sessions on this device. Signing out ends this tab’s demo session; it does not delete local data.</p><p class="muted">There is no secure login, password reset, camera access or BLE connection. Use sample information only.</p><div class="settings-actions"><a class="text-button" href="#profile">Edit your profile ${icon('arrow')}</a><button class="text-button" data-signout>Sign out ${icon('arrow')}</button></div></section>`;
}
function persistProfile(value) {
 user = cleanProfile(value);
 savedProfile = user;
 try { localStorage.setItem('smartpick-demo-profile', JSON.stringify(user)); return true; }
 catch { return false; }
}
function signOut() {
 try { sessionStorage.removeItem('smartpick-demo-session'); } catch {}
 user = null; result = null; draft = ''; busy = false; lookupGeneration++;
 accountDraft = {}; profileEditing = false;
 setAccountMessage('Signed out of the local demo. No server session was used.', 'login');
 go('login');
}
function showAccountErrors(errors) {
 const form = document.querySelector('#account-form');
 form.querySelector('#account-errors').textContent = Object.keys(errors).length ? 'Check the highlighted fields below.' : '';
 for (const input of form.querySelectorAll('input')) {
  const message = errors[input.name] || '';
  input.setAttribute('aria-invalid', String(Boolean(message)));
  form.querySelector(`#error-${input.name}`).textContent = message;
 }
 if (Object.keys(errors).length) form.elements[Object.keys(errors)[0]]?.focus();
}
function bindAccountForm() {
 const form = document.querySelector('#account-form');
 if (!form) return;
 form.oninput = event => { if (event.target.name) accountDraft[event.target.name] = event.target.value; };
 form.onsubmit = event => {
  event.preventDefault();
  const values = Object.fromEntries(new FormData(form));
  const mode = form.dataset.mode;
  const errors = validateAccountForm(mode, values);
  showAccountErrors(errors);
  if (Object.keys(errors).length) return;
  if (mode === 'forgot') {
   document.querySelector('#account-feedback').textContent = 'No reset email was sent. This demo does not store passwords. Return to login and use any disposable password of 8 or more characters, or create a new demo profile.';
   return;
  }
  if (mode === 'profile' || mode === 'register') {
   const stored = persistProfile(values);
   setAccountMessage(stored ? (mode === 'profile' ? 'Demo profile saved in this browser.' : 'Demo account created locally. Password was not saved.') : 'Demo profile is available for this session only; browser storage is unavailable.', mode === 'profile' ? 'profile' : 'home');
  } else {
   const identity = values.identity.trim().toLowerCase();
   const matches = savedProfile && [savedProfile.email.toLowerCase(),savedProfile.registration.toLowerCase()].includes(identity);
   if (savedProfile && !matches) {
    showAccountErrors({identity:'A different demo profile is saved in this browser. Log in with its email or student ID, or use registration to explicitly replace it.'});
    return;
   }
   user = matches ? {...savedProfile} : {fullName:'Demo Student',registration:identity.includes('@') ? 'SP1024' : identity.toUpperCase(),email:identity.includes('@') ? identity : 'student@example.test',phone:''};
   if (!savedProfile) persistProfile(user);
   setAccountMessage('Demo session started. Your password was not verified or saved.', 'home');
  }
  try { sessionStorage.setItem('smartpick-demo-session','active'); } catch {}
  accountDraft = {}; profileEditing = false;
  if (mode === 'profile') render(); else go('home');
 };
 document.querySelectorAll('[data-password]').forEach(button => button.onclick = () => {
  const input = form.elements[button.dataset.password];
  const showing = input.type === 'password';
  input.type = showing ? 'text' : 'password';
  button.textContent = showing ? 'Hide' : 'Show';
  button.setAttribute('aria-pressed', String(showing));
  button.setAttribute('aria-label', `${showing ? 'Hide' : 'Show'} ${button.dataset.password === 'confirmPassword' ? 'confirm password' : 'password'}`);
 });
}
function bindProfileMenu() {
 const trigger = document.querySelector('#profile-trigger');
 const menu = document.querySelector('#profile-menu');
 const items = [...menu.querySelectorAll('[role=menuitem]')];
 const close = (focus = false) => { menu.hidden = true; trigger.setAttribute('aria-expanded','false'); if (focus) trigger.focus(); };
 const open = (last = false) => { menu.hidden = false; trigger.setAttribute('aria-expanded','true'); (last ? items.at(-1) : items[0]).focus(); };
 trigger.onclick = () => menu.hidden ? open() : close(true);
 trigger.onkeydown = event => { if (['ArrowDown','ArrowUp'].includes(event.key)) { event.preventDefault(); open(event.key === 'ArrowUp'); } };
 menu.onkeydown = event => {
  const index = items.indexOf(document.activeElement);
  if (event.key === 'Escape') { event.preventDefault(); close(true); }
  if (event.key === 'Tab') close();
  if (['ArrowDown','ArrowUp','Home','End'].includes(event.key)) {
   event.preventDefault();
   const next = event.key === 'Home' ? 0 : event.key === 'End' ? items.length-1 : (index + (event.key === 'ArrowDown' ? 1 : -1) + items.length) % items.length;
   items[next].focus();
  }
 };
 document.onclick = event => { if (!event.target.closest('.profile-control')) close(); };
 document.onkeydown = event => { if (event.key === 'Escape' && !menu.hidden) close(true); };
 document.onfocusin = event => { if (!event.target.closest('.profile-control')) close(); };
}
function render() {
 const scrollTop = document.querySelector('main')?.scrollTop || 0;
 const active = page();
 document.querySelector('#app').innerHTML = `<div class="app-shell page-${active}"><header><a href="#home" class="brand" aria-label="SmartPick home"><span class="brand-mark">${icon('box')}</span>smartpick<span class="brand-period">.</span></a><div class="header-right"><button class="theme-toggle" id="theme" aria-label="Switch to ${document.documentElement.dataset.theme === 'dark' ? 'light' : 'dark'} theme">${icon(document.documentElement.dataset.theme === 'dark' ? 'sun' : 'moon')}</button><div class="profile-control"><button class="avatar" id="profile-trigger" aria-label="${user ? `Account menu for ${escape(user.fullName)}` : 'Open account menu'}" aria-haspopup="menu" aria-expanded="false" aria-controls="profile-menu">${escape(initials(user?.fullName))}</button><div id="profile-menu" role="menu" aria-labelledby="profile-trigger" hidden><div class="menu-identity">${escape(user?.fullName || 'Guest explorer')}<small>${user ? 'Local demo account' : 'Explore or enter a demo account'}</small></div><a role="menuitem" href="#profile">My Profile</a><a role="menuitem" href="#settings">Account Settings</a>${user ? '<button role="menuitem" data-signout>Sign Out</button>' : '<a role="menuitem" href="#login">Log in to demo</a>'}</div></div></div></header><main id="screen-content">${({home, scan, activity, result:resultScreen, login:()=>authScreen('login'), register:()=>authScreen('register'), forgot:()=>authScreen('forgot'), profile, settings}[active])()}<footer>Small moments. Smarter pickups.</footer></main><nav aria-label="Main navigation">${[['home','home','Home'],['scan','scan','Scan'],['activity','clock','Activity']].map(([route, symbol, label]) => `<a href="#${route}" class="${active === route || (active === 'result' && route === 'scan') ? 'active' : ''}" ${active === route || (active === 'result' && route === 'scan') ? 'aria-current="page"' : ''}>${icon(symbol)}<span>${label}</span></a>`).join('')}</nav></div>`;
 document.querySelector('main').scrollTop = scrollTop;
 document.querySelector('meta[name="theme-color"]').content = getComputedStyle(document.documentElement).getPropertyValue('--bg').trim();
 bindAccountForm();
 bindProfileMenu();
 document.querySelectorAll('[data-signout]').forEach(button => button.onclick = signOut);
 const edit = document.querySelector('#edit-profile');
 if (edit) edit.onclick = () => { profileEditing = true; accountDraft = {...user}; setAccountMessage(''); render(); document.querySelector('#account-fullName').focus(); };
 const cancel = document.querySelector('#cancel-profile');
 if (cancel) cancel.onclick = () => { profileEditing = false; accountDraft = {}; render(); document.querySelector('#edit-profile').focus(); };
 document.querySelectorAll('[data-theme-choice]').forEach(button => button.onclick = () => { document.documentElement.dataset.theme = button.dataset.themeChoice; save('smartpick-theme', button.dataset.themeChoice); render(); });
 document.querySelectorAll('[data-go]').forEach(el => el.onclick = () => go(el.dataset.go));
 document.querySelector('#theme').onclick = () => { const theme = document.documentElement.dataset.theme === 'dark' ? 'light' : 'dark'; document.documentElement.dataset.theme = theme; save('smartpick-theme', theme); render(); document.querySelector('#theme').focus(); };
 document.querySelectorAll('#retry, #connection-toggle').forEach(el => el.onclick = () => { if (connection === 'connecting') return; if (connection === 'connected') {connection = 'disconnected'; render();} else {connection = 'connecting'; render(); setTimeout(() => {connection = 'connected';render();}, 650);} });
 document.querySelectorAll('[data-id]').forEach(el => el.onclick = () => { const input = document.querySelector('#parcel-id');draft = el.dataset.id;input.value = draft;error = '';input.removeAttribute('aria-invalid');document.querySelector('#input-error').textContent = '';input.focus(); });
 document.querySelectorAll('[data-history]').forEach(el => el.onclick = () => { result = history[Number(el.dataset.history)];go('result'); });
 const form = document.querySelector('#lookup-form');
 if (form) document.querySelector('#parcel-id').oninput = event => { draft = event.target.value; if (error) { error = ''; event.target.removeAttribute('aria-invalid'); document.querySelector('#input-error').textContent = ''; } };
 if (form) form.onsubmit = event => { event.preventDefault(); submitLookup(new FormData(form).get('parcelId')); };
 const demoScan = document.querySelector('#demo-scan');
 if (demoScan) demoScan.onclick = () => submitLookup('SP1024');
}
window.addEventListener('hashchange', () => {error = '';accountDraft = {};profileEditing = false;if (accountMessageRoute !== page()) setAccountMessage('');render();document.querySelector('main').scrollTo(0,0);});
render();
