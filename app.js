// ── CONFIGURATION ──
// Remplacez cette valeur par l'URL de votre Google Apps Script déployé
const CONFIG = {
  SHEETS_URL: '', // Ex: 'https://script.google.com/macros/s/XXXXX/exec'
};

// ── PWA INITIALIZATION ──

if ('serviceWorker' in navigator) {
  navigator.serviceWorker.register('sw.js').then(reg => {
    setInterval(() => reg.update(), 60 * 60 * 1000);
    reg.addEventListener('updatefound', () => {
      const newWorker = reg.installing;
      if (!newWorker) return;
      newWorker.addEventListener('statechange', () => {
        if (newWorker.state === 'installed' && navigator.serviceWorker.controller) {
          showUpdateBanner();
        }
      });
    });
    if (reg.waiting && navigator.serviceWorker.controller) showUpdateBanner();
  }).catch(err => console.error('Service Worker registration failed:', err));

  let refreshing = false;
  navigator.serviceWorker.addEventListener('controllerchange', () => {
    if (!refreshing) { refreshing = true; window.location.reload(); }
  });
}

function showUpdateBanner() {
  const b = document.getElementById('pwa-update-banner');
  if (b) b.style.display = 'flex';
}
document.getElementById('pwa-update-btn')?.addEventListener('click', () => {
  navigator.serviceWorker.getRegistration().then(reg => {
    if (reg?.waiting) reg.waiting.postMessage({ type: 'SKIP_WAITING' });
  });
});
document.getElementById('pwa-update-dismiss-btn')?.addEventListener('click', () => {
  document.getElementById('pwa-update-banner').style.display = 'none';
});

// ── PWA INSTALL BANNER ──

const INSTALL_DISMISSED_KEY = 'pwa_install_dismissed_at';
const DISMISS_DURATION_MS   = 30 * 24 * 60 * 60 * 1000;
const isIOS = /iphone|ipad|ipod/i.test(navigator.userAgent);
const isInStandaloneMode = window.matchMedia('(display-mode: standalone)').matches || navigator.standalone === true;

function wasRecentlyDismissed() {
  const ts = localStorage.getItem(INSTALL_DISMISSED_KEY);
  return ts && (Date.now() - parseInt(ts, 10) < DISMISS_DURATION_MS);
}
function markDismissed() {
  localStorage.setItem(INSTALL_DISMISSED_KEY, Date.now().toString());
}

let deferredPrompt;
const installBanner = document.getElementById('pwa-install-banner');
const installBtn    = document.getElementById('pwa-install-btn');
const dismissBtn    = document.getElementById('pwa-dismiss-btn');

window.addEventListener('beforeinstallprompt', (e) => {
  e.preventDefault();
  deferredPrompt = e;
  if (window.innerWidth < 900 && !isInStandaloneMode && !wasRecentlyDismissed()) {
    setTimeout(showInstallBanner, 2000);
  }
});
function showInstallBanner() {
  installBanner.style.display = 'block';
  document.querySelector('.content').style.paddingBottom = (60 + 80) + 'px';
}
function hideInstallBanner() {
  installBanner.style.display = 'none';
  document.querySelector('.content').style.paddingBottom = '60px';
}
installBtn.addEventListener('click', async () => {
  if (!deferredPrompt) return;
  deferredPrompt.prompt();
  const { outcome } = await deferredPrompt.userChoice;
  deferredPrompt = null;
  hideInstallBanner();
});
dismissBtn.addEventListener('click', () => { deferredPrompt = null; markDismissed(); hideInstallBanner(); });

const iosModal     = document.getElementById('pwa-ios-modal');
const iosDismissBtn = document.getElementById('pwa-ios-dismiss-btn');
if (isIOS && !isInStandaloneMode && window.innerWidth < 900 && !wasRecentlyDismissed()) {
  setTimeout(() => { iosModal.style.display = 'flex'; }, 2000);
}
iosDismissBtn.addEventListener('click', () => { markDismissed(); iosModal.style.display = 'none'; });
window.addEventListener('appinstalled', () => { hideInstallBanner(); iosModal.style.display = 'none'; });

// ── HELPERS ──

function formatEuro(n) {
  return (isNaN(n) ? 0 : Math.round(n)).toLocaleString('fr-FR') + ' \u20ac';
}
function formatDateFR(ds) {
  if (!ds) return '';
  try { return new Date(ds + 'T12:00:00').toLocaleDateString('fr-FR', { day: 'numeric', month: 'short' }); }
  catch { return ds; }
}

const STATUS_PILL = { 'Signé': 'pill-green', 'Devis envoyé': 'pill-gold', 'Nouveau': 'pill-terra', 'Terminé': 'pill-gray' };
const STATUS_LABEL = { 'Nouveau': 'Demande reçue', 'Devis envoyé': 'Devis envoyé', 'Signé': 'Confirmé', 'Terminé': 'Terminé' };
const STATUS_DOT   = { 'Signé': 'green', 'Devis envoyé': '', 'Nouveau': 'terra', 'Terminé': 'gray' };

// ── SHEETS API ──

const SheetsAPI = {
  async load() {
    if (!CONFIG.SHEETS_URL) return null;
    const res = await fetch(CONFIG.SHEETS_URL + '?action=getAll');
    return res.json();
  },
  async add(row) {
    if (!CONFIG.SHEETS_URL) return { error: 'Non configuré' };
    const res = await fetch(CONFIG.SHEETS_URL, { method: 'POST', body: JSON.stringify({ action: 'add', row }) });
    return res.json();
  },
  async update(rowIndex, fields) {
    if (!CONFIG.SHEETS_URL) return { error: 'Non configuré' };
    const res = await fetch(CONFIG.SHEETS_URL, { method: 'POST', body: JSON.stringify({ action: 'update', rowIndex, fields }) });
    return res.json();
  },
};

// ── APP DATA ──

let appData = [];

async function loadData() {
  if (!CONFIG.SHEETS_URL) { renderAll(); return; }
  setLoading(true);
  try {
    const result = await SheetsAPI.load();
    if (result && result.rows) {
      appData = result.rows;
      renderAll();
    } else {
      showNotification('Erreur de chargement des données', 'error');
    }
  } catch (err) {
    console.error('loadData:', err);
    showNotification('Impossible de contacter le serveur', 'error');
  } finally {
    setLoading(false);
  }
}

function setLoading(on) {
  document.querySelectorAll('.btn-refresh').forEach(b => {
    b.textContent = on ? '\u2026' : '\u21bb';
    b.disabled = on;
  });
}

function renderAll() {
  renderDashboard();
  renderPipeline();
  Calendar.refresh();
  renderClients();
  renderFinances();
}

// ── RENDER: DASHBOARD ──

function renderDashboard() {
  const confirmes = appData.filter(e => e['Statut traitement'] === 'Signé');
  const devisEnv  = appData.filter(e => e['Statut traitement'] === 'Devis envoyé');
  const caConf    = confirmes.reduce((s, e) => s + (parseFloat(e['Budget estimé (€)']) || 0), 0);

  const nouveaux = appData.filter(e => e['Statut traitement'] === 'Nouveau');

  const set = (id, v) => { const el = document.getElementById(id); if (el) el.textContent = v; };
  set('kpi-ca-val',          formatEuro(caConf));
  set('kpi-confirmes-val',   confirmes.length || '—');
  set('kpi-confirmes-delta', devisEnv.length + ' en cours de devis');
  set('kpi-devis-val',       devisEnv.length || '—');
  set('kpi-leads-val',       nouveaux.length || '—');

  const badge = document.getElementById('topbar-badge');
  if (badge) badge.textContent = appData.length ? appData.length + ' événement' + (appData.length > 1 ? 's' : '') : '';

  // Prochains événements
  const today   = new Date().toISOString().split('T')[0];
  const upcoming = appData
    .filter(e => e['Date de l\'événement'] >= today && e['Statut traitement'] !== 'Terminé')
    .sort((a, b) => (a['Date de l\'événement'] || '').localeCompare(b['Date de l\'événement'] || ''))
    .slice(0, 6);

  const tbody = document.getElementById('upcoming-tbody');
  if (!tbody) return;

  if (!CONFIG.SHEETS_URL) {
    tbody.innerHTML = '<tr><td colspan="5" class="tbl-empty">\u2699 Configurez <code>CONFIG.SHEETS_URL</code> dans app.js pour connecter le Google Sheet</td></tr>';
    return;
  }
  if (!upcoming.length) {
    tbody.innerHTML = '<tr><td colspan="5" class="tbl-empty">Aucun événement à venir</td></tr>';
    return;
  }
  tbody.innerHTML = upcoming.map(e => `
    <tr style="cursor:pointer" onclick="openEventModal(${e._row})">
      <td><strong>${formatDateFR(e['Date de l\'événement'])}</strong></td>
      <td>${e['Nom client']}</td>
      <td>${e['Type d\'événement']}</td>
      <td>${e['Nb convives']}</td>
      <td><span class="pill ${STATUS_PILL[e['Statut traitement']] || 'pill-gray'}">${STATUS_LABEL[e['Statut traitement']] || e['Statut traitement']}</span></td>
    </tr>`).join('');

  // Activité récente
  const recent = [...appData]
    .sort((a, b) => (b['Date de la demande'] || '').localeCompare(a['Date de la demande'] || ''))
    .slice(0, 5);
  const actEl = document.getElementById('recent-activity');
  if (actEl && recent.length) {
    actEl.innerHTML = recent.map(e => {
      const dot = STATUS_DOT[e['Statut traitement']] || '';
      return `<div class="activity-item" style="cursor:pointer" onclick="openEventModal(${e._row})">
        <div class="act-dot ${dot}"></div>
        <div class="act-body">
          <div class="act-text">Demande <strong>${e['Nom client']}</strong> — ${e['Type d\'événement']}, ${e['Nb convives']} pers.</div>
          <div class="act-time">${formatDateFR(e['Date de la demande'])} · ${e['Canal']}</div>
        </div>
      </div>`;
    }).join('');
  }
}

// ── RENDER: PIPELINE ──

const PIPELINE_COLS = [
  { label: 'Demande reçue', status: 'Nouveau'      },
  { label: 'Devis envoyé',  status: 'Devis envoyé' },
  { label: 'Confirmé',      status: 'Signé'         },
  { label: 'Terminé',       status: 'Terminé'       },
];

function renderPipeline() {
  const el = document.getElementById('pipeline');
  if (!el) return;

  if (!CONFIG.SHEETS_URL) {
    el.innerHTML = '<div class="pipe-empty-state">\u2699 Renseignez <code>CONFIG.SHEETS_URL</code> dans app.js</div>';
    return;
  }

  el.innerHTML = PIPELINE_COLS.map(col => {
    const events  = appData.filter(e => e['Statut traitement'] === col.status);
    const options = PIPELINE_COLS.map(c =>
      `<option value="${c.status}"${c.status === col.status ? ' selected' : ''}>${c.label}</option>`
    ).join('');

    const cards = events.map(e => `
      <div class="pipe-card" onclick="openEventModal(${e._row})">
        <div class="pipe-client">${e['Nom client']}</div>
        <div class="pipe-event">${e['Type d\'événement']} \xb7 ${e['Nb convives']} pers.${e['Date de l\'événement'] ? ' \xb7 ' + formatDateFR(e['Date de l\'événement']) : ''}</div>
        <div class="pipe-footer">
          <span class="pipe-amount">${formatEuro(parseFloat(e['Budget estimé (€)']) || 0)}</span>
          <select class="pipe-status-sel" onchange="updateEventStatus(this,${e._row})" onclick="event.stopPropagation()">
            ${options}
          </select>
        </div>
      </div>`).join('') || '<div class="pipe-card-empty">\u2014</div>';

    return `<div class="pipe-col">
      <div class="pipe-header">${col.label} <span class="pipe-count">${events.length}</span></div>
      ${cards}
    </div>`;
  }).join('');
}

async function updateEventStatus(selectEl, rowIndex) {
  const newStatus = selectEl.value;
  selectEl.disabled = true;
  try {
    const result = await SheetsAPI.update(rowIndex, { 'Statut traitement': newStatus });
    if (result.success) {
      const row = appData.find(e => e._row === rowIndex);
      if (row) row['Statut traitement'] = newStatus;
      renderPipeline(); renderDashboard(); renderFinances();
      showNotification('Statut mis à jour', 'success');
    } else {
      selectEl.disabled = false;
      showNotification('Erreur : ' + (result.error || 'inconnue'), 'error');
    }
  } catch {
    selectEl.disabled = false;
    showNotification('Erreur réseau', 'error');
  }
}

// ── RENDER: CLIENTS ──

function renderClients() {
  const tbody = document.getElementById('clients-tbody');
  const sub   = document.getElementById('clients-sub');
  if (!tbody) return;

  if (!CONFIG.SHEETS_URL || !appData.length) {
    if (sub) sub.textContent = 'Non connecté';
    tbody.innerHTML = '<tr><td colspan="4" class="tbl-empty">Aucune donnée</td></tr>';
    return;
  }

  const clientMap = {};
  appData.forEach(e => {
    const n = e['Nom client'];
    if (!clientMap[n]) clientMap[n] = [];
    clientMap[n].push(e);
  });

  const clients = Object.entries(clientMap)
    .map(([name, events]) => ({ name, events }))
    .sort((a, b) => {
      const dA = Math.max(...a.events.map(e => new Date(e['Date de l\'événement'] || 0).getTime()));
      const dB = Math.max(...b.events.map(e => new Date(e['Date de l\'événement'] || 0).getTime()));
      return dB - dA;
    });

  if (sub) sub.textContent = `${clients.length} client${clients.length > 1 ? 's' : ''} · ${appData.length} événement${appData.length > 1 ? 's' : ''}`;

  tbody.innerHTML = clients.map(c => {
    const last   = c.events.sort((a, b) => (b['Date de l\'événement'] || '').localeCompare(a['Date de l\'événement'] || ''))[0];
    const ca     = c.events.reduce((s, e) => s + (parseFloat(e['Budget estimé (€)']) || 0), 0);
    const status = last['Statut traitement'];
    return `<tr style="cursor:pointer" onclick="openEventModal(${last._row})">
      <td><strong>${c.name}</strong>${c.events.length > 1 ? ` <span style="color:var(--muted);font-size:10px;">(${c.events.length})</span>` : ''}</td>
      <td>${last['Type d\'événement'] || '\u2014'}</td>
      <td>${formatEuro(ca)}</td>
      <td><span class="pill ${STATUS_PILL[status] || 'pill-gray'}">${STATUS_LABEL[status] || status}</span></td>
    </tr>`;
  }).join('');
}

// ── RENDER: FINANCES ──

function renderFinances() {
  const confirmes = appData.filter(e => e['Statut traitement'] === 'Signé');
  const actifs    = appData.filter(e => e['Statut traitement'] !== 'Terminé');
  const caConf    = confirmes.reduce((s, e) => s + (parseFloat(e['Budget estimé (€)']) || 0), 0);
  const caPot     = actifs.reduce((s, e) => s + (parseFloat(e['Budget estimé (€)']) || 0), 0);

  const set = (id, v) => { const el = document.getElementById(id); if (el) el.textContent = v; };
  set('fin-ca-confirme',  formatEuro(caConf));
  set('fin-ca-potentiel', formatEuro(caPot));

  const encTbody = document.getElementById('fin-encaissements');
  if (encTbody) {
    encTbody.innerHTML = confirmes.length
      ? confirmes.map(e => `<tr>
          <td>${e['Nom client']}</td>
          <td><strong>${formatEuro(parseFloat(e['Budget estimé (€)']) || 0)}</strong></td>
          <td><span class="pill pill-gold">À recevoir</span></td>
        </tr>`).join('')
      : '<tr><td colspan="3" class="tbl-empty">Aucun encaissement confirmé</td></tr>';
  }
}

// ── EVENT MODAL ──

let editingRow = null;

function openEventModal(rowIndex = null) {
  editingRow = rowIndex;
  const modal = document.getElementById('event-modal');
  document.getElementById('modal-title').textContent = rowIndex ? "Modifier l'événement" : 'Nouvel événement';

  const form = document.getElementById('event-form');
  form.reset();

  if (rowIndex) {
    const data = appData.find(e => e._row === rowIndex);
    if (data) {
      for (const el of form.elements) {
        if (el.name && data[el.name] !== undefined) el.value = data[el.name];
      }
    }
  } else {
    form.elements['Date de la demande'].value = new Date().toISOString().split('T')[0];
    form.elements['Statut traitement'].value  = 'Nouveau';
  }

  modal.style.display = 'flex';
  form.querySelector('input,select,textarea')?.focus();
}

function closeEventModal() {
  document.getElementById('event-modal').style.display = 'none';
  editingRow = null;
}

document.getElementById('event-modal').addEventListener('click', e => {
  if (e.target === document.getElementById('event-modal')) closeEventModal();
});
document.addEventListener('keydown', e => { if (e.key === 'Escape') closeEventModal(); });

document.getElementById('event-form').addEventListener('submit', async e => {
  e.preventDefault();
  const form = e.target;
  const data = {};
  new FormData(form).forEach((val, key) => { data[key] = val; });

  const btn = form.querySelector('.btn-primary');
  btn.disabled = true; btn.textContent = '\u2026';

  try {
    let result;
    if (editingRow) {
      result = await SheetsAPI.update(editingRow, data);
      if (result.success) {
        const row = appData.find(r => r._row === editingRow);
        if (row) Object.assign(row, data);
        renderAll();
        closeEventModal();
        showNotification('Événement mis à jour', 'success');
      }
    } else {
      result = await SheetsAPI.add(data);
      if (result.success) {
        await loadData();
        closeEventModal();
        showNotification('Événement ajouté', 'success');
        return;
      }
    }
    if (!result.success) showNotification('Erreur : ' + (result.error || 'inconnue'), 'error');
  } catch {
    showNotification('Erreur réseau', 'error');
  } finally {
    btn.disabled = false; btn.textContent = 'Enregistrer';
  }
});

// ── CALENDAR ──

const Calendar = (() => {
  const MONTHS_FR = ['Janvier','Février','Mars','Avril','Mai','Juin',
                     'Juillet','Août','Septembre','Octobre','Novembre','Décembre'];
  const DAYS_FR   = ['Lu','Ma','Me','Je','Ve','Sa','Di'];

  const now = new Date();
  let currentYear  = now.getFullYear();
  let currentMonth = now.getMonth();
  let selectedDate = null;

  function toStr(y, m, d) {
    return `${y}-${String(m+1).padStart(2,'0')}-${String(d).padStart(2,'0')}`;
  }
  function eventsForDate(ds) {
    return appData.filter(e => e['Date de l\'événement'] === ds);
  }
  function eventsForMonth(y, m) {
    const pfx = `${y}-${String(m+1).padStart(2,'0')}`;
    return appData.filter(e => typeof e['Date de l\'événement'] === 'string' && e['Date de l\'événement'].startsWith(pfx));
  }

  function renderGrid() {
    const grid = document.getElementById('cal-grid');
    if (!grid) return;
    const todayStr     = toStr(now.getFullYear(), now.getMonth(), now.getDate());
    const firstWkd     = (new Date(currentYear, currentMonth, 1).getDay() + 6) % 7;
    const daysInMonth  = new Date(currentYear, currentMonth + 1, 0).getDate();
    const daysInPrev   = new Date(currentYear, currentMonth, 0).getDate();

    let html = DAYS_FR.map(d => `<div class="cal-hd">${d}</div>`).join('');
    for (let i = firstWkd - 1; i >= 0; i--)
      html += `<div class="cal-day other-month">${daysInPrev - i}</div>`;
    for (let d = 1; d <= daysInMonth; d++) {
      const ds  = toStr(currentYear, currentMonth, d);
      const cls = ['cal-day',
        ds === todayStr          ? 'today'     : '',
        eventsForDate(ds).length ? 'has-event' : '',
        ds === selectedDate      ? 'selected'  : '',
      ].filter(Boolean).join(' ');
      html += `<div class="${cls}" data-date="${ds}">${d}</div>`;
    }
    const tail = (firstWkd + daysInMonth) % 7;
    for (let d = 1; d <= (tail ? 7 - tail : 0); d++)
      html += `<div class="cal-day other-month">${d}</div>`;

    grid.innerHTML = html;
    grid.querySelectorAll('.cal-day[data-date]').forEach(el => {
      el.addEventListener('click', () => {
        const ds = el.getAttribute('data-date');
        selectedDate = selectedDate === ds ? null : ds;
        renderGrid(); renderDetail();
      });
    });
  }

  function renderDetail() {
    const titleEl = document.getElementById('cal-detail-title');
    const listEl  = document.getElementById('cal-detail-list');
    if (!titleEl || !listEl) return;
    let events;
    if (selectedDate) {
      events = eventsForDate(selectedDate);
      titleEl.textContent = events.length ? `Événements \u2014 ${formatDateFR(selectedDate)}` : `Aucun événement \u2014 ${formatDateFR(selectedDate)}`;
    } else {
      events = eventsForMonth(currentYear, currentMonth);
      titleEl.textContent = events.length
        ? `${events.length} événement${events.length > 1 ? 's' : ''} ce mois`
        : 'Aucun événement ce mois';
    }
    if (!events.length) { listEl.innerHTML = '<div class="cal-empty">Aucun événement.</div>'; return; }
    listEl.innerHTML = events.map(e => `
      <div class="activity-item" style="cursor:pointer" onclick="openEventModal(${e._row})">
        <div class="act-dot terra"></div>
        <div class="act-body">
          <div class="act-text"><strong>${formatDateFR(e['Date de l\'événement'])} \u2014 ${e['Nom client']}</strong></div>
          <div class="act-text" style="color:var(--muted);font-size:11px;">${e['Type d\'événement']} \xb7 ${e['Nb convives']} pers. \xb7 ${formatEuro(parseFloat(e['Budget estimé (€)']) || 0)}</div>
        </div>
      </div>`).join('');
  }

  function updateHeader() {
    const hEl = document.getElementById('agenda-heading');
    const sEl = document.getElementById('agenda-sub');
    const mSel = document.getElementById('cal-month-sel');
    const ySel = document.getElementById('cal-year-sel');
    if (hEl) hEl.textContent = `Agenda \u2014 ${MONTHS_FR[currentMonth]} ${currentYear}`;
    const count = eventsForMonth(currentYear, currentMonth).length;
    if (sEl) sEl.textContent = count ? `${count} événement${count > 1 ? 's' : ''}` : 'Aucun événement';
    if (mSel) mSel.value = currentMonth;
    if (ySel) ySel.value = currentYear;
  }

  function render() { renderGrid(); renderDetail(); updateHeader(); }

  function init() {
    const mSel = document.getElementById('cal-month-sel');
    if (mSel) {
      MONTHS_FR.forEach((m, i) => {
        const o = document.createElement('option');
        o.value = i; o.textContent = m; mSel.appendChild(o);
      });
      mSel.addEventListener('change', () => { currentMonth = parseInt(mSel.value); selectedDate = null; render(); });
    }
    const ySel = document.getElementById('cal-year-sel');
    if (ySel) {
      for (let y = 2023; y <= now.getFullYear() + 3; y++) {
        const o = document.createElement('option');
        o.value = y; o.textContent = y; ySel.appendChild(o);
      }
      ySel.addEventListener('change', () => { currentYear = parseInt(ySel.value); selectedDate = null; render(); });
    }
    document.getElementById('cal-prev')?.addEventListener('click', () => {
      if (--currentMonth < 0) { currentMonth = 11; currentYear--; }
      selectedDate = null; render();
    });
    document.getElementById('cal-next')?.addEventListener('click', () => {
      if (++currentMonth > 11) { currentMonth = 0; currentYear++; }
      selectedDate = null; render();
    });
    render();
  }

  return { init, refresh: render };
})();

Calendar.init();

// ── SIDEBAR MOBILE TOGGLE ──

const sidebar        = document.getElementById('sidebar');
const sidebarOverlay = document.getElementById('sidebar-overlay');
const menuBtn        = document.getElementById('menu-btn');
const sidebarClose   = document.querySelector('.sidebar-close');

function toggleSidebar() {
  sidebar.classList.toggle('open');
  sidebarOverlay.classList.toggle('open');
}
menuBtn.addEventListener('click', toggleSidebar);
sidebarClose.addEventListener('click', toggleSidebar);
document.querySelectorAll('.nav-item').forEach(item => {
  item.addEventListener('click', () => {
    if (window.innerWidth < 900) {
      setTimeout(() => { sidebar.classList.remove('open'); sidebarOverlay.classList.remove('open'); }, 100);
    }
  });
});

// ── PANEL NAVIGATION ──

function showPanel(panelName, element) {
  document.querySelectorAll('.panel').forEach(p => p.classList.remove('active'));
  document.querySelectorAll('.nav-item').forEach(n => n.classList.remove('active'));
  const panel = document.getElementById('panel-' + panelName);
  if (panel) panel.classList.add('active');
  if (element) element.classList.add('active');
  document.querySelector('.content').scrollTop = 0;
}

// ── RESPONSIVE HANDLING ──

let isDesktop = window.innerWidth >= 900;
window.addEventListener('resize', () => {
  const newIsDesktop = window.innerWidth >= 900;
  if (newIsDesktop !== isDesktop) {
    isDesktop = newIsDesktop;
    if (isDesktop) { sidebar.classList.remove('open'); sidebarOverlay.classList.remove('open'); }
  }
});

// ── NOTIFICATIONS ──

function showNotification(message, type = 'info', duration = 3000) {
  const n = document.createElement('div');
  n.style.cssText = 'position:fixed;bottom:80px;left:12px;right:12px;background:#2E2018;color:#fff;padding:14px 16px;border-radius:6px;font-size:13px;z-index:600;box-shadow:0 4px 12px rgba(0,0,0,.2);animation:slideUp .3s ease-out;';
  if (type === 'success') n.style.background = '#4A6741';
  if (type === 'error')   n.style.background = '#C0453A';
  n.textContent = message;
  document.body.appendChild(n);
  setTimeout(() => { n.style.transition = 'opacity .3s'; n.style.opacity = '0'; setTimeout(() => n.remove(), 300); }, duration);
}

// ── INIT ──

loadData();

// ── EXPORT ──

window.ChezPapi = { SheetsAPI, Calendar, showPanel, toggleSidebar, showNotification, loadData, openEventModal };
console.log('Chez Papi PWA initialized \u2713');
