// Connected student app. The original local-only prototype remains available at ?demo=1.
const root = document.querySelector('#app');
const esc = v => String(v ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
let authDraft = {};
let me = null, loading = true, message = '', failure = '', busy = false, epoch = 0, timer = null, pageData = null, cooldown = 0;
const date = v => v ? new Date(v).toLocaleString() : '—';
function route() {
    const [path, query = ''] = location.hash.slice(1).split('?');
    return { path: path || 'parcels', params: new URLSearchParams(query) };
}
async function api(path, init = {}) {
    const response = await fetch(`/api${path}`, { ...init, credentials: 'same-origin', headers: { 'Content-Type': 'application/json', ...init.headers }, signal: AbortSignal.timeout(15000) });
    const data = await response.json().catch(() => ({}));
    if (!response.ok) {
        if (response.status === 401)
            me = null;
        throw new Error(data.error || `Request failed (${response.status})`);
    }
    return data;
}
const go = path => {
    if (location.hash === `#${path}`)
        void load();
    else
        location.hash = path;
};
const button = (label, path, style = 'secondary') => `<a class="${style}" href="#${path}">${label}</a>`;
const field = (name, label, type = 'text', value = '', extra = '') => `<div class="account-field wide"><label for="${name}">${label}</label><div class="account-input"><input id="${name}" name="${name}" type="${type}" value="${esc(value)}" required ${extra}></div></div>`;
const status = p => p.workflow_status !== 'ACTIVE' ? p.workflow_status : p.parcel_status;
const locationText = p => p.slot_no ? `Slot ${p.slot_no} · Compartment ${p.compartment_no}` : 'Awaiting storage assignment';
function parcelCard(p) {
    return `<a class="live-parcel card" href="#parcel/${esc(p.parcel_id)}"><div><h2>${esc(p.tracking_id)}</h2><p>${esc(locationText(p))}</p></div><span class="pill">${esc(status(p))}</span><span>View →</span></a>`;
}
function authView(mode) {
    const register = mode === 'register', forgot = mode === 'forgot', resend = mode === 'resend', reset = mode === 'reset';
    return `<section class="account-panel card"><h1>${register ? 'Create your account' : forgot ? 'Reset your password' : resend ? 'Verify your email' : reset ? 'Choose a new password' : 'Welcome back'}</h1><p class="muted">${register ? 'Verify your email, then have the parcel desk approve your student ID.' : reset ? 'Use at least 12 characters. Your other sessions will be signed out.' : 'Use your SmartPick account to continue.'}</p><form id="auth-form" data-mode="${mode}" class="account-fields">${register ? field('fullName', 'Full name', 'text', authDraft.fullName || '', 'maxlength="80" autocomplete="name"') + field('registrationNo', 'Student registration number', 'text', authDraft.registrationNo || '', 'maxlength="30"') : ''}${!reset ? field('email', 'Email', 'email', me?.email || authDraft.email || '', 'autocomplete="email"') : ''}${!forgot && !resend ? field('password', 'Password', 'password', '', 'minlength="12" maxlength="128" autocomplete="' + (register || reset ? 'new-password' : 'current-password') + '"') : ''}${register || reset ? field('confirm', 'Confirm password', 'password', '', 'minlength="12" maxlength="128" autocomplete="new-password"') : ''}<button class="primary" ${busy || resend && Date.now() < cooldown ? 'disabled' : ''}>${busy ? 'Please wait…' : register ? 'Register' : forgot ? 'Send reset link' : resend ? 'Send verification link' : reset ? 'Update password' : 'Log in'}</button></form><div class="live-actions">${button('Log in', 'login')}${button('Create account', 'register')}${button('Forgot password', 'forgot')}${button('Resend verification', 'resend')}</div></section>`;
}
function gate() {
    if (!me)
        return `<section class="empty card"><h1>Your parcels, in one place.</h1><p>Log in to see your deliveries and follow your pickup.</p>${button('Log in', 'login', 'primary')}${button('Create account', 'register')}</section>`;
    if (!me.email_verified_at)
        return `<section class="empty card"><h1>Check your inbox.</h1><p>Verify ${esc(me.email)} to continue. Links expire after 30 minutes.</p>${button('Resend verification', 'resend', 'primary')}</section>`;
    if (!me.approved_at)
        return `<section class="empty card"><h1>Email verified.</h1><p>Bring your campus ID to the parcel desk. Staff must approve the link to ${esc(me.registration_no)} before your parcels are visible.</p><button class="primary" id="refresh">Check approval status</button>${button('Contact the parcel desk', 'help')}</section>`;
    return '';
}
function detailView(p) {
    const can = p.parcel_status === 'STORED' && p.workflow_status === 'ACTIVE';
    const unpaid = p.payment_type === 'COD' && p.payment_status !== 'PAID';
    return `<section class="card live-detail"><p class="eyebrow">YOUR DELIVERY</p><h1>${esc(p.tracking_id)}</h1><span class="pill">${esc(status(p))}</span><dl class="profile-data"><div><dt>${p.parcel_status === 'COLLECTED' ? 'Previous location' : 'Pickup location'}</dt><dd>${esc(locationText(p))}</dd></div><div><dt>Payment</dt><dd>${esc(p.payment_type)} · ${esc(p.payment_status)}</dd></div><div><dt>Stored</dt><dd>${date(p.stored_at)}</dd></div><div><dt>Collected</dt><dd>${date(p.collected_at)}</dd></div></dl>${unpaid ? '<p class="notice">Settle cash on delivery at the parcel desk before starting pickup.</p>' : ''}${can ? `<button class="primary" id="start-pickup" data-parcel="${esc(p.parcel_id)}" ${busy || unpaid ? 'disabled' : ''}>${busy ? 'Starting…' : 'Start pickup'}</button>` : ''}<div class="live-actions">${button('My parcels', 'parcels')}${button('Need help?', 'help')}</div></section>`;
}
function pickupView(p) {
    const complete = p.status === 'COLLECTED' || p.parcel_status === 'COLLECTED';
    const active = p.status === 'ACTIVE';
    const title = complete ? 'Parcel collected.' : !active ? `Pickup ${p.status.toLowerCase()}.` : p.command_status === 'EXECUTED' ? 'Your compartment light is on.' : p.command_status === 'ACKNOWLEDGED' ? 'Device is activating the light…' : 'Waiting for the device…';
    return `<section class="card live-detail" aria-live="polite"><p class="eyebrow">${esc(p.tracking_id)}</p><h1>${title}</h1><p>${complete ? 'Your collection was confirmed.' : active ? 'Find your compartment and collect your parcel. Collection is confirmed by the sensor.' : 'Your parcel stays stored. You can retry or ask the parcel desk for help.'}</p><h2>${esc(locationText(p))}</h2><dl class="profile-data"><div><dt>Pickup reference</dt><dd>${esc(p.pickup_id)}</dd></div><div><dt>${complete ? 'Completed' : 'Expires'}</dt><dd>${date(complete ? (p.collected_at || p.completed_at) : p.expires_at)}</dd></div></dl>${active ? `<button class="secondary" id="cancel-pickup" data-pickup="${esc(p.pickup_id)}" ${busy ? 'disabled' : ''}>Cancel pickup attempt</button>` : ''}${!active && !complete && p.workflow_status === 'ACTIVE' ? `<button class="primary" id="start-pickup" data-parcel="${esc(p.parcel_id)}" ${busy ? 'disabled' : ''}>Try again</button>` : ''}<div class="live-actions">${button('My parcels', 'parcels', 'primary')}${button('Contact the parcel desk', 'help')}</div></section>`;
}
function content() {
    const { path } = route();
    if (['login', 'register', 'forgot', 'resend', 'reset'].includes(path))
        return authView(path);
    if (path === 'verify')
        return `<section class="card live-detail"><h1>Verify your email.</h1><p>Confirm to use this verification link. It can only be used once.</p><button class="primary" id="verify" ${busy ? 'disabled' : ''}>${busy ? 'Verifying…' : 'Verify email and continue'}</button>${button('Request a new link', 'resend')}</section>`;
    if (path === 'help')
        return `<section class="card live-detail"><h1>Need a hand?</h1><p>Visit the campus parcel desk with your student ID and tracking number. Staff can check payment, verify your identity and resolve device or sensor problems.</p><p>A scanned registration number alone does not authorize collection. Collection on someone else’s behalf requires the desk’s approval.</p>${button('My parcels', 'parcels', 'primary')}</section>`;
    if (!me)
        return gate();
    if (path === 'profile')
        return `<section class="card live-detail"><h1>Your profile.</h1><p>${esc(me.email)} · ${esc(me.registration_no)}</p><p class="muted">Contact the desk to correct your verified email or student identity.</p><form id="profile-form" class="account-fields">${field('fullName', 'Full name', 'text', me.full_name, 'maxlength="80"')}<div class="account-field wide"><label for="phone">Phone (optional)</label><input id="phone" name="phone" type="tel" maxlength="30" value="${esc(me.phone)}"></div><label><input name="notificationsEnabled" type="checkbox" ${me.notifications_enabled ? 'checked' : ''}> Email me when parcels are ready</label><button class="primary" ${busy ? 'disabled' : ''}>Save profile</button></form></section>`;
    const blocked = gate();
    if (blocked)
        return blocked;
    if (path === 'activity')
        return `<h1>Your activity.</h1><section class="card live-detail">${(pageData || []).map(a => `<article class="live-log"><strong>${esc(a.event_type.replaceAll('_', ' '))}</strong><p>${esc(a.tracking_id || '')} · ${date(a.created_at)}</p></article>`).join('') || '<p>No activity yet.</p>'}</section>${pagination()}`;
    if (path === 'notifications')
        return `<h1>Your notifications.</h1><section class="card live-detail">${(pageData || []).map(n => `<article class="live-log"><h2>${esc(n.subject)}</h2><p>${esc(n.body)}</p><small>${date(n.created_at)}</small>${!n.read_at ? `<button class="text-button" data-read="${esc(n.notification_id)}">Mark as read</button>` : '<span> · Read</span>'}</article>`).join('') || '<p>No notifications yet.</p>'}</section>`;
    if (path.startsWith('parcel/'))
        return pageData ? detailView(pageData) : '';
    if (path.startsWith('pickup/'))
        return pageData ? pickupView(pageData) : '';
    if (path !== 'parcels')
        return `<section class="card live-detail"><h1>Page not found.</h1>${button('My parcels', 'parcels')}</section>`;
    return `<div class="page-heading"><div><p class="eyebrow">GOOD TO SEE YOU, ${esc(me.full_name)}</p><h1>Your parcels.</h1><p class="muted">Choose a delivery to see its location and start pickup.</p></div><button class="text-button" id="refresh">Refresh</button></div><div class="live-list">${(pageData || []).map(parcelCard).join('') || '<section class="card empty"><h2>No parcels here yet.</h2><p>New deliveries appear after the parcel desk registers them.</p></section>'}</div>${pagination()}`;
}
function pagination() {
    const { path, params } = route();
    const page = Math.max(0, Number(params.get('page')) || 0);
    return `<div class="live-actions">${page ? button('Previous', `${path}?page=${page - 1}`) : ''}${Array.isArray(pageData) && pageData.length === 50 ? button('Next', `${path}?page=${page + 1}`) : ''}</div>`;
}
function render() {
    root.innerHTML = `<div class="app-shell live-app"><header><a href="#parcels" class="brand">smartpick<span class="brand-period">.</span></a><div class="header-right"><button id="theme" class="theme-toggle" aria-label="Toggle theme">◐</button>${me ? `<a href="#profile">${esc(me.full_name)}</a><button class="text-button" id="logout">Sign out</button>` : button('Log in', 'login')}</div></header><main>${message ? `<p class="account-feedback" role="status">${esc(message)}</p>` : ''}${failure ? `<div class="notice" role="alert"><p>${esc(failure)}</p><button class="text-button" id="refresh">Retry</button>${button('Help', 'help')}</div>` : ''}${loading ? '<section class="empty card" role="status">Loading your account…</section>' : content()}<footer>Small moments. Smarter pickups.</footer></main><nav aria-label="Main navigation">${[['parcels', 'My parcels'], ['activity', 'Activity'], ['notifications', 'Updates'], ['help', 'Help']].map(([p, l]) => `<a href="#${p}" ${route().path === p ? 'aria-current="page" class="active"' : ''}>${l}</a>`).join('')}</nav></div>`;
    bind();
}
async function action(fn) {
    if (busy)
        return;
    busy = true;
    root.querySelectorAll('button').forEach(button => {
        button.disabled = true;
    });
    failure = '';
    try {
        await fn();
    }
    catch (e) {
        failure = e.name === 'TimeoutError' ? 'Connection timed out. Please retry.' : e.message;
    }
    finally {
        busy = false;
        render();
    }
}
function bind() {
    root.querySelector('#theme')?.addEventListener('click', () => {
        const theme = document.documentElement.dataset.theme === 'dark' ? 'light' : 'dark';
        document.documentElement.dataset.theme = theme;
        try {
            localStorage.setItem('smartpick-theme', theme);
        }
        catch {
        }
    });
    root.querySelector('#refresh')?.addEventListener('click', () => void load());
    root.querySelector('#logout')?.addEventListener('click', () => void action(async () => {
        await api('/auth/logout', { method: 'POST' });
        me = null;
        pageData = null;
        go('login');
    }));
    root.querySelector('#auth-form')?.addEventListener('submit', e => {
        e.preventDefault();
        const f = new FormData(e.currentTarget), mode = e.currentTarget.dataset.mode;
        authDraft = { email: f.get('email') || '', fullName: f.get('fullName') || '', registrationNo: f.get('registrationNo') || '' };
        void action(async () => {
            if (f.has('confirm') && f.get('confirm') !== f.get('password'))
                throw new Error('Passwords do not match.');
            const body = Object.fromEntries(f);
            delete body.confirm;
            if (mode === 'reset')
                body.token = route().params.get('token') || '';
            const out = await api(`/auth/${mode}`, { method: 'POST', body: JSON.stringify(body) });
            message = out.message || '';
            if (mode === 'login') {
                await load();
                go('parcels');
            }
            else if (mode === 'reset') {
                go('login');
            }
            else if (mode === 'resend') {
                cooldown = Date.now() + 60000;
                setTimeout(() => {
                    if (route().path === 'resend')
                        render();
                }, 60000);
            }
            else if (mode === 'register') {
                go('resend');
            }
        });
    });
    root.querySelector('#verify')?.addEventListener('click', () => void action(async () => {
        await api('/auth/verify', { method: 'POST', body: JSON.stringify({ token: route().params.get('token') || '' }) });
        history.replaceState(null, '', '#parcels');
        message = 'Email verified. Continue below.';
        await load();
    }));
    root.querySelector('#profile-form')?.addEventListener('submit', e => {
        e.preventDefault();
        const f = new FormData(e.currentTarget);
        void action(async () => {
            await api('/me', { method: 'PATCH', body: JSON.stringify({ fullName: f.get('fullName'), phone: f.get('phone'), notificationsEnabled: f.has('notificationsEnabled') }) });
            message = 'Profile saved.';
            await load();
        });
    });
    root.querySelector('#start-pickup')?.addEventListener('click', e => {
        const parcel = e.currentTarget.dataset.parcel;
        void action(async () => {
            const p = await api(`/parcels/${parcel}/pickups`, { method: 'POST' });
            go(`pickup/${p.pickup_id}`);
        });
    });
    root.querySelector('#cancel-pickup')?.addEventListener('click', e => {
        const pickup = e.currentTarget.dataset.pickup;
        void action(async () => {
            await api(`/pickups/${pickup}/cancel`, { method: 'POST', body: JSON.stringify({ reason: 'Student cancelled pickup' }) });
            await load();
        });
    });
    root.querySelectorAll('[data-read]').forEach(b => b.addEventListener('click', () => void action(async () => {
        await api(`/me/notifications/${b.dataset.read}/read`, { method: 'POST' });
        await load();
    })));
}
async function load(poll = false) {
    const current = ++epoch;
    clearTimeout(timer);
    failure = '';
    if (!poll) {
        loading = true;
        pageData = null;
        render();
    }
    try {
        if (!poll) {
            try {
                me = await api('/auth/session');
            }
            catch (e) {
                if (!/log in|session expired/i.test(e.message))
                    throw e;
                me = null;
            }
        }
        const { path, params } = route();
        let data = null;
        if (me?.email_verified_at && me?.approved_at) {
            const page = params.get('page') || '0';
            if (path === 'parcels')
                data = await api(`/me/parcels?page=${encodeURIComponent(page)}`);
            else if (path === 'activity')
                data = await api(`/me/activity?page=${encodeURIComponent(page)}`);
            else if (path === 'notifications')
                data = await api('/me/notifications');
            else if (path.startsWith('parcel/'))
                data = await api(`/me/parcels/${encodeURIComponent(path.slice(7))}`);
            else if (path.startsWith('pickup/'))
                data = await api(`/pickups/${encodeURIComponent(path.slice(7))}`);
        }
        if (current !== epoch)
            return;
        pageData = data;
        if (path.startsWith('pickup/') && data?.status === 'ACTIVE')
            timer = setTimeout(() => void load(true), 2000);
    }
    catch (e) {
        if (current !== epoch)
            return;
        failure = e.message;
        if (route().path.startsWith('pickup/'))
            timer = setTimeout(() => void load(true), 5000);
    }
    finally {
        if (current === epoch) {
            loading = false;
            render();
        }
    }
}
window.addEventListener('hashchange', () => {
    message = '';
    void load();
});
void load();
