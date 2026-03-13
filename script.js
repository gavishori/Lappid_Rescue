// ════════════════════════════════════════════════════════
//  script.js — חפ"ק לפיד: אפליקציה ישובית + יומן מאוחד
// ════════════════════════════════════════════════════════

import {
  db, auth, appId, initialAuthToken,
  onAuthStateChanged, signInWithCustomToken,
  signInWithEmailAndPassword, signOut,
  collection, doc, addDoc, setDoc, getDoc, getDocs, updateDoc, deleteDoc,
  onSnapshot, query, where, writeBatch, serverTimestamp, Timestamp
} from './firebase.js';

// ── URL params ──────────────────────────────────────────
const params      = new URLSearchParams(location.search);
const MODE        = params.get('mode');
const SHARE_TOKEN = params.get('token');
const REPORT_KEY  = params.get('rkey');

// ── helpers ─────────────────────────────────────────────
const $   = (s)  => document.querySelector(s);
const $$  = (s)  => Array.from(document.querySelectorAll(s));
const safe = (id) => document.getElementById(id);

const storage = {
  get (k, fb) { try { return JSON.parse(localStorage.getItem(k)) ?? fb; } catch { return fb; } },
  set (k, v)  { localStorage.setItem(k, JSON.stringify(v)); }
};

// ════════════════════════════════════════════════════════
//  ① VILLAGE APP STATE
// ════════════════════════════════════════════════════════
let activeEventId   = null;
let existingReportId = REPORT_KEY || null;
let currentStatus   = [];
let locationType    = 'address';
let gpsCoords       = null;
let sortDirection   = 'desc';
let map             = null;
let residentMarkers = {};
let layerMarkers    = {};
let reportCache     = [];   // village reports (Firestore events/reports)
let unsubReports    = null;
let unsubEvent      = null; // להאזנה לנתוני האירוע (כמו שעת הערכת מצב)

let eventTypes    = storage.get('hamal_event_types', ['ביטחוני','שריפה','נעדר','נפילת טיל']);
let managedLayers = storage.get('hamal_layers', ['דיווחי תושבים','נקודות דיווח','מצלמות','הידרנטים','מספרי בתים']);
let activeLayers  = new Set(storage.get('hamal_active_layers', ['דיווחי תושבים']));
let managedInfoButtons = storage.get('hamal_info_buttons', [
  { title: 'פיקוד העורף', url: 'https://www.oref.org.il/' },
  { title: 'מפת יישוב', url: '#' }
]);
let managedHouses = storage.get('hamal_houses', []);
let gpxItems      = storage.get('hamal_gpx_items', []);
let editingHouseIndex = null;

function persistAll() {
  storage.set('hamal_event_types',    eventTypes);
  storage.set('hamal_layers',         managedLayers);
  storage.set('hamal_active_layers',  Array.from(activeLayers));
  storage.set('hamal_info_buttons',   managedInfoButtons);
  storage.set('hamal_houses',         managedHouses);
  storage.set('hamal_gpx_items',      gpxItems);
  syncConfigToFirestore();
}

function syncConfigToFirestore() {
  if (!db) return;
  const payload = {
    houses: managedHouses,
    infoButtons: managedInfoButtons,
    updatedAt: serverTimestamp()
  };
  setDoc(getConfigDoc(), payload, { merge: true })
    .then(() => console.log('Config synced to Firestore'))
    .catch(e => console.error('Failed to sync config to Firestore:', e));
}

async function loadConfigFromFirestore() {
  if (!db) return;
  try {
    const snap = await getDoc(getConfigDoc());
    if (!snap.exists()) return;
    const d = snap.data() || {};
    if (Array.isArray(d.houses) && d.houses.length && !managedHouses.length) managedHouses = d.houses;
    if (Array.isArray(d.infoButtons) && d.infoButtons.length) {
      managedInfoButtons = d.infoButtons;
      storage.set('hamal_info_buttons', managedInfoButtons);
    }
  } catch (e) {
    console.warn('Failed to load config from Firestore:', e);
  }
}

// ════════════════════════════════════════════════════════
//  ② JOURNAL STATE
// ════════════════════════════════════════════════════════
let journalReports          = [];
let isSharedLinkView        = false; // הגדרה המזהה תצוגה דרך קישור משותף
let editingReportId         = null;
let lastAddedReportId       = null;
let collapsedGroups         = new Set();
let forceAllOpen            = false;
let currentUserId           = null;
let definedLogTypes         = [];
let completedTasks          = {};
let currentReporters        = [];
let mobilePaneMode          = null;

let reportsColRef           = null;
let reportersColRef         = null;
let tasksCompletionDocRef   = null;
let logTypesColRef          = null;

let unsubJournalReports     = null;
let unsubReporters          = null;
let unsubTasksCompletion    = null;
let unsubLogTypes           = null;

function teardownJournalAccess() {
  journalReports = [];
  currentReporters = [];
  definedLogTypes = [];
  completedTasks = {};
  renderTable();
  populateReportersDropdown([]);
  populateLogTypesDropdowns([]);
  updateTasksButtonStates();
  renderLogtypesList();
  renderCurrentTasksForSettings('');
  if(unsubJournalReports){unsubJournalReports();unsubJournalReports=null;}
  if(unsubReporters){unsubReporters();unsubReporters=null;}
  if(unsubTasksCompletion){unsubTasksCompletion();unsubTasksCompletion=null;}
  if(unsubLogTypes){unsubLogTypes();unsubLogTypes=null;}
}

function setJournalLockedState(locked) {
  const loginPage = safe('login-page');
  const shouldShowGate = !SHARE_TOKEN && MODE !== 'report' && !REPORT_KEY;
  if (safe('screen-admin')?.classList.contains('active') && shouldShowGate) {
    loginPage?.classList.toggle('hidden', !locked);
  }
  const journalControls = [
    'generalTextInput','filterLogType','filterReporter','mainActionBtn','cancelEditBtn',
    'showDateTimeToggle','newDate','newTime','searchLogBtn','searchInput','toggleAllGroupsBtn'
  ];
  journalControls.forEach(id => {
    const el = safe(id);
    if (!el) return;
    if ('disabled' in el) el.disabled = locked;
  });
  const inputError = safe('inputErrorMessage');
  if (inputError) {
    inputError.textContent = locked ? 'יש להתחבר כדי לגשת ליומן.' : '';
  }
}

// auth-ready promise
let firebaseAuthReadyResolve;
const firebaseAuthReady = new Promise(r => { firebaseAuthReadyResolve = r; });

// assessment clock
let assessmentTime          = new Date();
let assessmentTimeIsManual  = false;
let isSearchInputVisible    = false;

const publicDataRoot = `artifacts/${appId}/public/data`;
const getEventsCol = () => collection(db, `${publicDataRoot}/events`);
const getReportsCol = () => reportsColRef || collection(db, `${publicDataRoot}/reports`);
const getSharesCol = () => collection(db, `${publicDataRoot}/shares`);
const getReportDoc = (reportId) => doc(getReportsCol(), reportId);
const getEventDoc = (eventId) => doc(getEventsCol(), eventId);
const getShareDoc = (shareId) => doc(getSharesCol(), shareId);
// Houses stored inside the existing public/data document (same path already used by the app)
const getConfigDoc = () => doc(db, 'artifacts', appId, 'public', 'data');
const hasJournalAccess = (user) => Boolean(user?.email && !user?.isAnonymous);

// ════════════════════════════════════════════════════════
//  VILLAGE HELPERS
// ════════════════════════════════════════════════════════
function formatTs(ts) {
  if (!ts) return '';
  const d = ts.toDate ? ts.toDate() : new Date(ts);
  return d.toLocaleString('he-IL',{day:'2-digit',month:'2-digit',year:'2-digit',hour:'2-digit',minute:'2-digit'});
}
function dotClass(statuses=[]) {
  if (statuses.includes('injury'))   return 'danger';
  if (statuses.includes('property')) return 'warn';
  return 'ok';
}
function statusLabel(statuses=[]) {
  const labels = [];
  if (statuses.includes('injury'))   labels.push('פגיעה בגוף');
  if (statuses.includes('property')) labels.push('נזק לרכוש');
  if (statuses.includes('ok') && !statuses.includes('injury') && !statuses.includes('property')) labels.push('תקין');
  if (!labels.length) labels.push('תקין');
  return labels.join(' + ');
}
function iconColor(kind) {
  if (kind==='danger')     return '#ff5d66';
  if (kind==='warn')       return '#f4c246';
  if (kind==='ok')         return '#49c96b';
  if (kind==='מצלמות')    return '#61b7ff';
  if (kind==='הידרנטים') return '#ff7f57';
  return '#9e7cff';
}
function makeMarkerIcon(color) {
  return L.divIcon({
    className:'',
    html:`<div style="width:16px;height:16px;border-radius:50%;background:${color};border:2px solid #fff;box-shadow:0 0 10px ${color}99"></div>`,
    iconSize:[16,16], iconAnchor:[8,8]
  });
}
function popupHtml(title, sub='', extra='') {
  return `<div style="direction:rtl;font-family:Heebo,sans-serif"><strong>${title}</strong><div>${sub}</div>${extra?`<div style='color:#8da8c5;margin-top:4px'>${extra}</div>`:''}</div>`;
}

function defaultMapCenter() {
  const valid = managedHouses
    .map(h => [Number(h.lat), Number(h.lng)])
    .filter(([lat,lng]) => Number.isFinite(lat) && Number.isFinite(lng));
  return valid[0] || [31.918,35.033];
}
function fitMapToHouseBounds() {
  if (!map) return;
  const pts = managedHouses
    .map(h => [Number(h.lat), Number(h.lng)])
    .filter(([lat,lng]) => Number.isFinite(lat) && Number.isFinite(lng));
  if (!pts.length) return;
  if (pts.length === 1) {
    map.setView(pts[0], Math.max(map.getZoom(), 17));
    return;
  }
  map.fitBounds(pts, {padding:[36,36], maxZoom:18});
}
function fitMapToLayerBounds(layerName) {
  if (!map) return;
  let pts = [];
  if (layerName === 'מספרי בתים') {
    pts = managedHouses
      .map(h => [Number(h.lat), Number(h.lng)])
      .filter(([lat,lng]) => Number.isFinite(lat) && Number.isFinite(lng));
  } else if (layerName === 'דיווחי תושבים') {
    pts = reportCache
      .filter(r => r.lat && r.lng)
      .map(r => [Number(r.lat), Number(r.lng)])
      .filter(([lat,lng]) => Number.isFinite(lat) && Number.isFinite(lng));
  } else {
    // GPX layer
    const item = gpxItems.find(x => x.type === layerName);
    if (item) pts = (item.points||[]).map(p => [p.lat, p.lng]).filter(([lat,lng]) => Number.isFinite(lat) && Number.isFinite(lng));
  }
  if (!pts.length) return;
  if (pts.length === 1) { map.setView(pts[0], Math.max(map.getZoom(), 17)); return; }
  map.fitBounds(pts, {padding:[36,36], maxZoom:18});
}
function initMap() {
  if (map) return;
  map = L.map('map',{zoomControl:true}).setView(defaultMapCenter(),15);
  L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png',{
    attribution:'&copy; OpenStreetMap contributors', maxZoom:19
  }).addTo(map);
  if (managedHouses.length) setTimeout(fitMapToHouseBounds, 0);
}

async function geocodeAddress(city, street, house) {
  const q = `${street||''} ${house||''}, ${city||'לפיד'}, ישראל`;
  try {
    const res  = await fetch(`https://nominatim.openstreetmap.org/search?format=json&q=${encodeURIComponent(q)}`, {headers:{'Accept-Language':'he'}});
    const data = await res.json();
    if (Array.isArray(data) && data[0]) return {lat:Number(data[0].lat), lng:Number(data[0].lon)};
  } catch {}
  return null;
}
async function reverseGeocode(lat, lng) {
  try {
    const res  = await fetch(`https://nominatim.openstreetmap.org/reverse?format=json&lat=${lat}&lon=${lng}`,{headers:{'Accept-Language':'he'}});
    const data = await res.json();
    const a    = data?.address||{};
    return {city:a.city||a.town||a.village||'לפיד', street:a.road||a.pedestrian||'', house:a.house_number||''};
  } catch { return {city:'לפיד',street:'',house:''}; }
}

async function getOrCreateActiveEvent() {
  const qy   = query(getEventsCol(), where('locked','==',false));
  const snap = await getDocs(qy);
  if (!snap.empty) {
    const sorted = snap.docs.sort((a,b)=>(b.data().createdAt?.toMillis?.()||0)-(a.data().createdAt?.toMillis?.()||0));
    activeEventId = sorted[0].id; return activeEventId;
  }
  const ref = await addDoc(getEventsCol(), {createdAt:serverTimestamp(),locked:false,category:eventTypes[0]||'נפילת טיל'});
  activeEventId = ref.id; return activeEventId;
}
async function verifyShareToken(token) {
  const snap = await getDoc(getShareDoc(token));
  if (!snap.exists()) return null;
  const d = snap.data();
  if (d.expiresAt?.toDate && d.expiresAt.toDate()<new Date()) return null;
  return { eventId: d.eventId||null, type: d.type||'map' };
}
async function createTimedShare(untilDate) {
  if (!activeEventId) await getOrCreateActiveEvent();
  const token = crypto.randomUUID();
  await setDoc(getShareDoc(token), {eventId:activeEventId, expiresAt:Timestamp.fromDate(untilDate), createdAt:serverTimestamp()});
  return `${location.origin}${location.pathname}?token=${token}`;
}
async function createUnifiedShare(untilDate, includeMap, includeJournal) {
  if (!activeEventId) await getOrCreateActiveEvent();
  const token = crypto.randomUUID();
  const type = (includeMap && includeJournal) ? 'both' : includeJournal ? 'journal' : 'map';
  await setDoc(getShareDoc(token), {
    eventId: activeEventId,
    type,
    expiresAt: Timestamp.fromDate(untilDate),
    createdAt: serverTimestamp()
  });
  return `${location.origin}${location.pathname}?token=${token}`;
}
function getResidentReportUrl() {
  return `${location.origin}${location.pathname}?mode=report`;
}

async function submitVillageReport(data) {
  if (!activeEventId) await getOrCreateActiveEvent();
  const payload = {...data, eventId:activeEventId, updatedAt:serverTimestamp()};
  if (existingReportId) {
    const snap = await getDoc(getReportDoc(existingReportId));
    if (snap.exists() && snap.data().createdAt) payload.createdAt = snap.data().createdAt;
    else payload.createdAt = serverTimestamp();
    await setDoc(getReportDoc(existingReportId), payload, {merge:true});
  } else {
    payload.createdAt = serverTimestamp();
    const ref = await addDoc(getReportsCol(), payload);
    existingReportId = ref.id;
    const u = new URL(location.href);
    u.searchParams.set('rkey', ref.id);
    history.replaceState(null,'',u.toString());
  }
}

function getFilterFlags() {
  return {
    ok:       safe('filterOk')?.checked ?? true,
    property: safe('filterProperty')?.checked ?? true,
    injury:   safe('filterInjury')?.checked ?? true,
    noReport: safe('filterNoReport')?.checked ?? false,
  };
}
function passesFilters(report) {
  const q    = safe('searchReports')?.value?.trim().toLowerCase()||'';
  const f    = getFilterFlags();
  const text = `${report.city||''} ${report.street||''} ${report.house||''} ${report.note||''}`.toLowerCase();
  const kind = dotClass(report.statuses||[]);
  const stOk = (f.ok && kind==='ok') || (f.property && kind==='warn') || (f.injury && kind==='danger');
  return stOk && (!q||text.includes(q));
}

function clearLayerMarkers() {
  Object.values(layerMarkers).flat().forEach(m=>map?.removeLayer(m));
  layerMarkers={};
}
function makeHouseNumberIcon(label) {
  return L.divIcon({
    className:'house-marker',
    html:`<div class="house-badge">${label}</div>`,
    iconSize:[28,20],
    iconAnchor:[14,10]
  });
}
let editingLayerPoint = null; // {itemId, ptIndex, marker}

function makeLayerPointPopupHtml(pt, itemType, itemId, ptIndex) {
  return `<div style="direction:rtl;font-family:Heebo,sans-serif;min-width:160px">
    <strong>${pt.name||itemType}</strong>
    <div style="color:#666;font-size:12px;margin:4px 0">${itemType}</div>
    <div style="color:#8da8c5;font-size:11px;margin-bottom:8px">${Number(pt.lat).toFixed(6)}, ${Number(pt.lng).toFixed(6)}</div>
    <div style="display:flex;gap:6px">
      <button onclick="startEditLayerPoint('${itemId}',${ptIndex})" style="background:#2893ff;color:#fff;border:none;border-radius:8px;padding:4px 10px;cursor:pointer;font-size:12px">עריכה</button>
      <button onclick="deleteLayerPoint('${itemId}',${ptIndex})" style="background:#d45b6e;color:#fff;border:none;border-radius:8px;padding:4px 10px;cursor:pointer;font-size:12px">מחיקה</button>
    </div>
  </div>`;
}

window.startEditLayerPoint = function(itemId, ptIndex) {
  // Close any previous edit
  if (editingLayerPoint) cancelEditLayerPoint();
  const item = gpxItems.find(x => x.id === itemId);
  if (!item || !item.points[ptIndex]) return;
  const pt = item.points[ptIndex];
  const markerArr = layerMarkers[itemId];
  if (!markerArr || !markerArr[ptIndex]) return;
  const marker = markerArr[ptIndex];
  marker.closePopup();
  // Set edit icon (orange/yellow)
  marker.setIcon(L.divIcon({
    className:'',
    html:`<div style="width:18px;height:18px;border-radius:50%;background:#f4c246;border:3px solid #fff;box-shadow:0 0 12px #f4c24699;cursor:grab"></div>`,
    iconSize:[18,18],iconAnchor:[9,9]
  }));
  marker.dragging.enable();
  editingLayerPoint = {itemId, ptIndex, marker, item};

  // Show save button in popup
  marker.bindPopup(`<div style="direction:rtl;font-family:Heebo,sans-serif">
    <strong>מצב עריכה</strong>
    <div style="color:#666;font-size:12px;margin:4px 0">גרור את הנקודה למיקום חדש</div>
    <div style="display:flex;gap:6px;margin-top:6px">
      <button onclick="saveEditLayerPoint('${itemId}',${ptIndex})" style="background:#45bf64;color:#fff;border:none;border-radius:8px;padding:4px 10px;cursor:pointer;font-size:12px">שמור</button>
      <button onclick="cancelEditLayerPoint()" style="background:#888;color:#fff;border:none;border-radius:8px;padding:4px 10px;cursor:pointer;font-size:12px">ביטול</button>
    </div>
  </div>`).openPopup();
};

window.saveEditLayerPoint = function(itemId, ptIndex) {
  if (!editingLayerPoint) return;
  const {marker, item} = editingLayerPoint;
  const latlng = marker.getLatLng();
  item.points[ptIndex].lat = latlng.lat;
  item.points[ptIndex].lng = latlng.lng;
  persistAll();
  editingLayerPoint = null;
  renderGpxMarkers();
};

window.cancelEditLayerPoint = function() {
  if (!editingLayerPoint) return;
  editingLayerPoint = null;
  renderGpxMarkers();
};

window.deleteLayerPoint = function(itemId, ptIndex) {
  const item = gpxItems.find(x => x.id === itemId);
  if (!item) return;
  item.points.splice(ptIndex, 1);
  persistAll();
  renderGpxMarkers();
};

function renderGpxMarkers() {
  if (!map) return;
  clearLayerMarkers();

  if (activeLayers.has('מספרי בתים')) {
    layerMarkers.houses = managedHouses
      .filter(h => Number.isFinite(Number(h.lat)) && Number.isFinite(Number(h.lng)))
      .map((h, idx) => {
        const m = L.marker([Number(h.lat), Number(h.lng)], {icon: makeHouseNumberIcon(h.house || '')})
          .addTo(map);
        const popupContent = `<div style="direction:rtl;font-family:Heebo,sans-serif;min-width:160px">
          <strong>${(h.street||'')+' '+(h.house||'')}</strong>
          <div style="color:#666;font-size:12px;margin:4px 0">מספר בית</div>
          <div style="color:#8da8c5;font-size:11px;margin-bottom:8px">${Number(h.lat).toFixed(6)}, ${Number(h.lng).toFixed(6)}</div>
          <div style="display:flex;gap:6px">
            <button onclick="editHouseFromMap(${idx})" style="background:#2893ff;color:#fff;border:none;border-radius:8px;padding:4px 10px;cursor:pointer;font-size:12px">עריכה</button>
            <button onclick="deleteHouseFromMap(${idx})" style="background:#d45b6e;color:#fff;border:none;border-radius:8px;padding:4px 10px;cursor:pointer;font-size:12px">מחיקה</button>
          </div>
        </div>`;
        m.bindPopup(popupContent);
        return m;
      });
  }

  for (const item of gpxItems) {
    if (!activeLayers.has(item.type)) continue;
    layerMarkers[item.id]=(item.points||[]).map((pt,pi)=>{
      const m = L.marker([pt.lat,pt.lng],{icon:makeMarkerIcon(iconColor(item.type))})
        .addTo(map)
        .bindPopup(makeLayerPointPopupHtml(pt, item.type, item.id, pi));
      return m;
    });
  }
}

let editingHouseMarker = null; // {idx, marker, originalLatLng}

function makeHouseEditPopupHtml(idx) {
  return `<div style="direction:rtl;font-family:Heebo,sans-serif">
    <strong>מצב עריכה — גרור למיקום חדש</strong>
    <div style="color:#666;font-size:12px;margin:4px 0">${(managedHouses[idx]?.street||'')} ${(managedHouses[idx]?.house||'')}</div>
    <div style="display:flex;gap:6px;margin-top:8px">
      <button onclick="saveHouseMarkerEdit(${idx})" style="background:#45bf64;color:#fff;border:none;border-radius:8px;padding:4px 10px;cursor:pointer;font-size:12px">שמור</button>
      <button onclick="cancelHouseMarkerEdit()" style="background:#888;color:#fff;border:none;border-radius:8px;padding:4px 10px;cursor:pointer;font-size:12px">ביטול</button>
    </div>
  </div>`;
}

window.editHouseFromMap = function(idx) {
  if (editingHouseMarker) cancelHouseMarkerEdit();
  const h = managedHouses[idx];
  if (!h) return;
  const markerArr = layerMarkers.houses;
  if (!markerArr) return;
  // Find the marker that matches this house index in the filtered list
  const validHouses = managedHouses
    .map((house, i) => ({house, i}))
    .filter(({house}) => Number.isFinite(Number(house.lat)) && Number.isFinite(Number(house.lng)));
  const posInFiltered = validHouses.findIndex(({i}) => i === idx);
  if (posInFiltered === -1 || !markerArr[posInFiltered]) return;
  const marker = markerArr[posInFiltered];
  marker.closePopup();
  const originalLatLng = marker.getLatLng();
  // Set edit icon (yellow)
  marker.setIcon(L.divIcon({
    className:'',
    html:`<div style="width:22px;height:22px;border-radius:50%;background:#f4c246;border:3px solid #fff;box-shadow:0 0 14px #f4c24699;cursor:grab;display:flex;align-items:center;justify-content:center;font-size:10px;font-weight:700;color:#333">${h.house||''}</div>`,
    iconSize:[22,22],iconAnchor:[11,11]
  }));
  marker.dragging.enable();
  editingHouseMarker = {idx, marker, originalLatLng};
  marker.bindPopup(makeHouseEditPopupHtml(idx)).openPopup();
};

window.saveHouseMarkerEdit = function(idx) {
  if (!editingHouseMarker) return;
  const {marker} = editingHouseMarker;
  const latlng = marker.getLatLng();
  managedHouses[idx].lat = latlng.lat;
  managedHouses[idx].lng = latlng.lng;
  persistAll();
  editingHouseMarker = null;
  renderGpxMarkers();
};

window.cancelHouseMarkerEdit = function() {
  if (!editingHouseMarker) return;
  editingHouseMarker = null;
  renderGpxMarkers();
};

window.deleteHouseFromMap = function(idx) {
  managedHouses = managedHouses.filter((_,i) => i !== idx);
  if (editingHouseIndex === idx) resetHouseForm();
  else if (editingHouseIndex !== null && idx < editingHouseIndex) editingHouseIndex -= 1;
  persistAll(); renderHouses(); syncStreetOptions(); updateHouseStats(); renderGpxMarkers();
};
function lookupHouseCoords(street, house) {
  if (!street || !house) return null;
  const s = String(street).trim().toLowerCase();
  const h = String(house).trim().toLowerCase();
  const match = managedHouses.find(mh =>
    String(mh.street||'').trim().toLowerCase() === s &&
    String(mh.house||'').trim().toLowerCase()  === h &&
    Number.isFinite(Number(mh.lat)) && Number.isFinite(Number(mh.lng))
  );
  return match ? {lat: Number(match.lat), lng: Number(match.lng)} : null;
}

async function renderResidentMarkers() {
  if (!map) return;
  updateMapStatusBar();
  const reps = reportCache.filter(passesFilters);
  const f    = getFilterFlags();

  if (!activeLayers.has('דיווחי תושבים')) {
    Object.values(residentMarkers).forEach(m=>map.removeLayer(m));
    residentMarkers={};
  } else {
    // ── reported houses ──
    for (const r of reps) {
      let lat=r.lat, lng=r.lng;
      if (r.street||r.house) {
        const local = lookupHouseCoords(r.street||'', r.house||'');
        if (local) {
          lat=local.lat; lng=local.lng;
          if (local.lat !== r.lat || local.lng !== r.lng) {
            updateDoc(getReportDoc(r.id), {lat,lng}).catch(()=>{});
          }
        } else if (r.locationType === 'gps' && lat && lng) {
          // GPS — use as-is
        } else {
          if (residentMarkers[r.id]) { map.removeLayer(residentMarkers[r.id]); delete residentMarkers[r.id]; }
          continue;
        }
      }
      if (!lat||!lng) continue;
      const color = iconColor(dotClass(r.statuses||[]));
      if (!residentMarkers[r.id]) {
        residentMarkers[r.id]=L.marker([lat,lng],{icon:makeMarkerIcon(color)}).addTo(map);
      } else {
        residentMarkers[r.id].setLatLng([lat,lng]).setIcon(makeMarkerIcon(color));
      }
      residentMarkers[r.id].bindPopup(popupHtml(`${r.city||''}, ${r.street||''} ${r.house||''}`,`${statusLabel(r.statuses||[])} · ${r.souls||0} נפשות`,r.note||''));
    }
    const ids=new Set(reps.map(r=>r.id));
    Object.keys(residentMarkers).forEach(id=>{ if(!ids.has(id)&&!id.startsWith('noreport_')){map.removeLayer(residentMarkers[id]);delete residentMarkers[id];} });

    // ── no-report houses ──
    // Remove old no-report markers first
    Object.keys(residentMarkers).filter(id=>id.startsWith('noreport_')).forEach(id=>{
      map.removeLayer(residentMarkers[id]); delete residentMarkers[id];
    });
    if (f.noReport) {
      const q = safe('searchReports')?.value?.trim().toLowerCase()||'';
      const reportedAddresses = new Set(
        reportCache.map(r=>`${String(r.street||'').trim().toLowerCase()}|${String(r.house||'').trim().toLowerCase()}`)
      );
      managedHouses.forEach((h, idx) => {
        if (!Number.isFinite(Number(h.lat)) || !Number.isFinite(Number(h.lng))) return;
        const key = `${String(h.street||'').trim().toLowerCase()}|${String(h.house||'').trim().toLowerCase()}`;
        if (reportedAddresses.has(key)) return;
        if (q && !`${h.street} ${h.house}`.toLowerCase().includes(q)) return;
        const markerId = `noreport_${idx}`;
        const noRepIcon = L.divIcon({
          className:'',
          html:`<div style="width:14px;height:14px;border-radius:50%;background:#94a3b8;border:2px solid #fff;opacity:0.75"></div>`,
          iconSize:[14,14],iconAnchor:[7,7]
        });
        if (!residentMarkers[markerId]) {
          residentMarkers[markerId] = L.marker([Number(h.lat),Number(h.lng)],{icon:noRepIcon}).addTo(map);
        } else {
          residentMarkers[markerId].setLatLng([Number(h.lat),Number(h.lng)]).setIcon(noRepIcon);
        }
        residentMarkers[markerId].bindPopup(popupHtml(`${h.street} ${h.house}`,'לא דיווח',''));
      });
    }
  }
  renderGpxMarkers();
}

function renderInfoView() {
  const wrap=safe('infoButtonsView'); if(!wrap) return;
  wrap.innerHTML=managedInfoButtons.map(item=>`<button class="manage-card info-link-btn" data-url="${item.url}"><strong>${item.title}</strong><span>${item.url}</span></button>`).join('');
  $$('#infoButtonsView .info-link-btn').forEach(btn=>btn.addEventListener('click',()=>{
    const u=btn.dataset.url; if(!u||u==='#') return; window.open(u,'_blank','noopener');
  }));
}

function renderLayersModal() {
  const wrap=safe('layersOptions'); if(!wrap) return;
  wrap.innerHTML=managedLayers.map(name=>`<div class="layer-item live-layer-item"><label><span>${name}</span><input type="checkbox" data-layer="${name}" ${activeLayers.has(name)?'checked':''}></label></div>`).join('');
  $$('#layersOptions input').forEach(cb=>cb.onchange=()=>{
    const l=cb.dataset.layer;
    if(cb.checked) activeLayers.add(l); else activeLayers.delete(l);
    persistAll();
    renderResidentMarkers();
    if(cb.checked) fitMapToLayerBounds(l);
  });
}
function renderManagedLayers() {
  const wrap=safe('managedLayersList'); if(!wrap) return;
  wrap.innerHTML=managedLayers.map((name,idx)=>`<div class="simple-item"><div class="item-main"><span>${name}</span><span class="item-sub">מיקום ${idx+1}</span></div><div class="item-actions"><button class="icon-btn move-up" data-idx="${idx}" type="button">↑</button><button class="icon-btn move-down" data-idx="${idx}" type="button">↓</button><button class="delete-btn remove-layer" data-name="${name}" type="button">הסר</button></div></div>`).join('');
  $$('#managedLayersList .move-up').forEach(b=>b.onclick=()=>moveLayer(+b.dataset.idx,-1));
  $$('#managedLayersList .move-down').forEach(b=>b.onclick=()=>moveLayer(+b.dataset.idx,1));
  $$('#managedLayersList .remove-layer').forEach(b=>b.onclick=()=>{
    managedLayers=managedLayers.filter(x=>x!==b.dataset.name); activeLayers.delete(b.dataset.name);
    persistAll(); renderManagedLayers(); renderLayersModal(); renderGpxMarkers();
  });
}
function moveLayer(idx,delta) {
  const nx=idx+delta; if(nx<0||nx>=managedLayers.length) return;
  [managedLayers[idx],managedLayers[nx]]=[managedLayers[nx],managedLayers[idx]];
  persistAll(); renderManagedLayers(); renderLayersModal();
}
function renderGpxList() {
  const wrap=safe('gpxList'); if(!wrap) return;
  wrap.innerHTML=gpxItems.length?gpxItems.map(item=>`<div class="simple-item"><div class="item-main"><span>${item.type}</span><span class="item-sub">${item.name} · ${item.points.length} נק׳</span></div><div class="item-actions"><button class="delete-btn remove-gpx" data-id="${item.id}" type="button">הסר</button></div></div>`).join(''):'<div class="simple-item"><span>אין קבצים</span></div>';
  $$('#gpxList .remove-gpx').forEach(b=>b.onclick=()=>{ gpxItems=gpxItems.filter(x=>x.id!==b.dataset.id); persistAll(); renderGpxList(); renderGpxMarkers(); });
}
function populateHouseForm(house={}, idx=null) {
  editingHouseIndex = idx;
  safe('houseStreetInput').value = house.street || '';
  safe('houseNumberInput').value = house.house || '';
  safe('houseLatInput').value = house.lat ?? '';
  safe('houseLngInput').value = house.lng ?? '';
  const title = safe('housesFormTitle');
  const hint = safe('housesFormHint');
  const btn = safe('addHouseBtn');
  if (title) title.textContent = idx===null ? 'הוספת בית ידנית' : 'עריכת בית';
  if (hint) hint.textContent = idx===null ? 'הקלד רחוב, מספר וקואורדינטות או ייבא מאקסל.' : 'עדכן את הפרטים ולחץ על שמירה.';
  if (btn) btn.textContent = idx===null ? 'הוסף בית' : 'שמור שינויים';
}
function resetHouseForm() {
  populateHouseForm({}, null);
}
function syncStreetOptions() {
  const streetSel = safe('street');
  if (!streetSel) return;
  const current = streetSel.value;
  const streets = [...new Set(managedHouses.map(h => (h.street || '').trim()).filter(Boolean))].sort((a,b)=>a.localeCompare(b,'he'));
  streetSel.innerHTML = '<option value="">בחר רחוב...</option>' + streets.map(s=>`<option value="${s}">${s}</option>`).join('');
  if (streets.includes(current)) streetSel.value = current;
  window.updateHouseOptions();
}
function updateHouseStats() {
  const housesCount = safe('housesCountChip');
  const streetsCount = safe('streetsCountChip');
  const coordsCount = safe('coordsCountChip');
  const validCoords = managedHouses.filter(h => Number.isFinite(Number(h.lat)) && Number.isFinite(Number(h.lng))).length;
  if (housesCount) housesCount.textContent = `${managedHouses.length} בתים`;
  if (streetsCount) streetsCount.textContent = `${new Set(managedHouses.map(h => h.street).filter(Boolean)).size} רחובות`;
  if (coordsCount) coordsCount.textContent = `${validCoords} עם קואורדינטות`;
}
function renderHouses(searchTerm='') {
  const wrap=safe('housesList'); if(!wrap) return;
  const term = searchTerm.toLowerCase().trim();
  const filtered = term
    ? managedHouses.map((h,i)=>({h,i})).filter(({h})=>`${h.street} ${h.house}`.toLowerCase().includes(term))
    : managedHouses.map((h,i)=>({h,i}));
  if (!filtered.length) {
    wrap.innerHTML = managedHouses.length
      ? '<div class="empty-state-card"><strong>לא נמצאו תוצאות</strong></div>'
      : '<div class="empty-state-card"><strong>אין בתים עדיין</strong><span>אפשר להוסיף ידנית או לייבא מקובץ אקסל.</span></div>';
    return;
  }
  wrap.innerHTML = filtered.map(({h,i})=>`<div class="house-item-card${editingHouseIndex===i?' is-editing':''}">
    <div class="item-main"><span>${h.street} ${h.house}</span><span class="item-sub">${Number.isFinite(Number(h.lat))?Number(h.lat).toFixed(6):'—'}, ${Number.isFinite(Number(h.lng))?Number(h.lng).toFixed(6):'—'}</span></div>
    <div class="item-actions">
      ${(Number.isFinite(Number(h.lat))&&Number.isFinite(Number(h.lng)))?`<button class="icon-btn show-house-on-map" data-idx="${i}" type="button" title="הצג במפה">🗺️</button>`:''}
      <button class="icon-btn edit-house" data-idx="${i}" type="button">ערוך</button>
      <button class="delete-btn remove-house" data-idx="${i}" type="button">הסר</button>
    </div>
  </div>`).join('');
  $$('#housesList .edit-house').forEach(b=>b.onclick=()=>{ const idx=+b.dataset.idx; populateHouseForm(managedHouses[idx], idx); renderHouses(safe('housesSearchInput')?.value||''); });
  $$('#housesList .remove-house').forEach(b=>b.onclick=()=>{
    const idx = +b.dataset.idx;
    managedHouses=managedHouses.filter((_,i)=>i!==idx);
    if (editingHouseIndex === idx) resetHouseForm();
    else if (editingHouseIndex !== null && idx < editingHouseIndex) editingHouseIndex -= 1;
    persistAll(); renderHouses(safe('housesSearchInput')?.value||''); syncStreetOptions(); updateHouseStats(); renderGpxMarkers();
  });
  $$('#housesList .show-house-on-map').forEach(b=>b.onclick=()=>{
    const h = managedHouses[+b.dataset.idx];
    if (!h || !map) return;
    // Close houses panel and fly to location
    safe('housesPanel')?.classList.add('hidden');
    map.setView([Number(h.lat), Number(h.lng)], 18);
    // Find the marker and open its popup
    setTimeout(()=>{
      const markerArr = layerMarkers.houses;
      if (!markerArr) return;
      const validHouses = managedHouses.map((house,i)=>({house,i})).filter(({house})=>Number.isFinite(Number(house.lat))&&Number.isFinite(Number(house.lng)));
      const pos = validHouses.findIndex(({i})=>i===+b.dataset.idx);
      if (pos !== -1 && markerArr[pos]) markerArr[pos].openPopup();
    }, 300);
  });
  updateHouseStats();
}
function renderInfoAdmin() {
  const wrap=safe('infoAdminList'); if(!wrap) return;
  wrap.innerHTML=managedInfoButtons.length?managedInfoButtons.map((item,idx)=>`<div class="simple-item"><div class="item-main"><span>${item.title}</span><span class="item-sub">${item.url}</span></div><div class="item-actions"><button class="delete-btn remove-info" data-idx="${idx}" type="button">הסר</button></div></div>`).join(''):'<div class="simple-item"><span>אין כפתורים</span></div>';
  $$('#infoAdminList .remove-info').forEach(b=>b.onclick=()=>{ managedInfoButtons=managedInfoButtons.filter((_,i)=>i!==+b.dataset.idx); persistAll(); renderInfoAdmin(); renderInfoView(); });
}
function renderEventTypes() {
  const wrap=safe('eventTypesList'); if(!wrap) return;
  wrap.innerHTML=eventTypes.length?eventTypes.map((name,idx)=>`<div class="simple-item"><div class="item-main"><span>${name}</span></div><div class="item-actions"><button class="delete-btn remove-type" data-idx="${idx}" type="button">הסר</button></div></div>`).join(''):'<div class="simple-item"><span>אין סוגים</span></div>';
  $$('#eventTypesList .remove-type').forEach(b=>b.onclick=()=>{ eventTypes=eventTypes.filter((_,i)=>i!==+b.dataset.idx); if(!eventTypes.length) eventTypes=['נפילת טיל']; persistAll(); renderEventTypes(); });
}

function setupNavigation() {
  // ניהול ניווט הטאבים הקיים
  $$('.rail-btn').forEach(btn=>btn.addEventListener('click',()=>{
    const view=btn.dataset.view;
    if (view==='layers') { openLayersModal(); return; }
    $$('.rail-btn').forEach(b=>b.classList.remove('active'));
    btn.classList.add('active');
    $$('.view').forEach(v=>v.classList.remove('active'));
    safe(`view-${view}`)?.classList.add('active');
    if (view==='reports') setTimeout(()=>map?.invalidateSize(),80);
  }));

  // לוגיקת תפריט המבורגר (מובייל)
  const hamBtn = safe('hamburgerMenuBtn');
  const hamBtnMobile = safe('hamburgerMenuBtnMobile');
  const sideRail = document.querySelector('.side-rail');
  const overlay = safe('mobileMenuOverlay');

  if(sideRail && overlay) {
    const toggleMenu = () => {
      sideRail.classList.toggle('is-open');
      overlay.classList.toggle('is-open');
      const isOpen = sideRail.classList.contains('is-open');
      // שינוי אייקון מ-X לתפריט ולהפך
      const icon = isOpen ? '<i class="fas fa-times"></i>' : '<i class="fas fa-bars"></i>';
      if(hamBtn) hamBtn.innerHTML = icon;
      if(hamBtnMobile) hamBtnMobile.innerHTML = icon;
    };

    if(hamBtn) hamBtn.addEventListener('click', toggleMenu);
    if(hamBtnMobile) hamBtnMobile.addEventListener('click', toggleMenu);
    overlay.addEventListener('click', toggleMenu);

    // סגירת התפריט בלחיצה על אחד מכפתורי הניווט (רק במובייל)
    $$('.rail-btn').forEach(btn => {
      btn.addEventListener('click', () => {
        if(window.innerWidth <= 800 && sideRail.classList.contains('is-open')) {
          toggleMenu();
        }
      });
    });
  }
}

const openModal  = sel => $(sel)?.classList.remove('hidden');
const closeModal = sel => $(sel)?.classList.add('hidden');

function openLayersModal() {
  renderLayersModal();
  safe('layersPanel')?.classList.remove('hidden');
}
function setupModals() {
  $$('[data-close]').forEach(btn=>btn.addEventListener('click',()=>closeModal(btn.dataset.close)));
  ['#layersPanel','#sharePanel','#uploadsPanel','#housesPanel','#layersManagerPanel',
   '#infoManagerPanel','#eventTypesPanel','#lockPanel','#journalManagerPanel','#customAlert'].forEach(sel=>{
    $(sel)?.addEventListener('click',e=>{ if(e.target===$(sel)) closeModal(sel); });
  });
  safe('openLinksManagerBtn')?.addEventListener('click',()=>openModal('#sharePanel'));
  safe('openUploadsManagerBtn')?.addEventListener('click',()=>openModal('#uploadsPanel'));
  safe('openHousesManagerBtn')?.addEventListener('click',()=>openModal('#housesPanel'));
  safe('openLayersManagerBtn')?.addEventListener('click',()=>openModal('#layersManagerPanel'));
  safe('openInfoManagerBtn')?.addEventListener('click',()=>openModal('#infoManagerPanel'));
  safe('openEventTypesManagerBtn')?.addEventListener('click',()=>openModal('#eventTypesPanel'));
  safe('openJournalManagerBtn')?.addEventListener('click',()=>openModal('#journalManagerPanel'));
  safe('openResidentReportsManagerBtn')?.addEventListener('click',()=>{ openModal('#residentReportsManagerPanel'); updateRrmStats(); renderRrmSnapshots(); });
  safe('lockEventBtn')?.addEventListener('click',()=>openModal('#lockPanel'));

  // ── Status popup toggle ──
  const statusToggleBtn = safe('statusBarToggleBtn');
  const statusPopup = safe('statusPopup');
  const statusPopupClose = safe('statusPopupCloseBtn');
  if(statusToggleBtn && statusPopup) {
    statusToggleBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      statusPopup.classList.toggle('hidden');
    });
    if(statusPopupClose) statusPopupClose.addEventListener('click', () => statusPopup.classList.add('hidden'));
    document.addEventListener('click', (e) => {
      if(!statusPopup.classList.contains('hidden') && !statusPopup.contains(e.target) && e.target !== statusToggleBtn) {
        statusPopup.classList.add('hidden');
      }
    });
  }

  // ── Mobile refresh button ──
  safe('mobileRefreshBtn')?.addEventListener('click', () => {
    const btn = safe('mobileRefreshBtn');
    if(btn) { btn.classList.add('spinning'); setTimeout(()=>btn.classList.remove('spinning'), 700); }
    location.reload();
  });

  safe('toggleMapPaneBtn')?.addEventListener('click', () => togglePaneMode('map'));
  safe('toggleJournalPaneBtn')?.addEventListener('click', () => togglePaneMode('journal'));
  window.addEventListener('resize', () => {
    applyMobileReadOnlyMode();
    renderTable(safe('searchInput')?.value || '');
    setTimeout(() => map?.invalidateSize(), 120);
  });

  // ── Resident Reports Manager ──
  ['#residentReportsManagerPanel'].forEach(sel=>{
    $(sel)?.addEventListener('click',e=>{ if(e.target===$(sel)) closeModal(sel); });
  });

  safe('rrmSaveBtn')?.addEventListener('click', async ()=>{
    if(!reportCache||reportCache.length===0){ showCustomAlert('אין דיווחים לשמירה.'); return; }
    const now=new Date();
    const dateLabel=`${String(now.getDate()).padStart(2,'0')}/${String(now.getMonth()+1).padStart(2,'0')}/${now.getFullYear()} ${String(now.getHours()).padStart(2,'0')}:${String(now.getMinutes()).padStart(2,'0')}`;
    const ok=reportCache.filter(r=>(r.statuses||[]).includes('ok')||(r.statuses||[]).length===0&&!r.statuses).length;
    const injury=reportCache.filter(r=>(r.statuses||[]).includes('injury')).length;
    const property=reportCache.filter(r=>(r.statuses||[]).includes('property')).length;
    const snapshot={ dateLabel, total:reportCache.length, ok, injury, property, ts:now.getTime(), reports: reportCache.map(r=>({...r})) };
    const existing=JSON.parse(localStorage.getItem('rrmSnapshots')||'[]');
    existing.unshift(snapshot);
    localStorage.setItem('rrmSnapshots', JSON.stringify(existing.slice(0,20)));
    renderRrmSnapshots();
    showCustomAlert('הדיווחים נשמרו בהצלחה ✓');
  });

  safe('rrmResetBtn')?.addEventListener('click',()=>{
    const el=safe('customAlert'); const mel=safe('customAlertMessage');
    if(el&&mel){
      mel.textContent='האם אתה בטוח שברצונך לאפס את כל דיווחי התושבים?';
      el.classList.remove('hidden');
      safe('customAlertCancelBtn')?.classList.remove('hidden');
      const confirmBtn=safe('customAlertCloseBtn');
      const orig=confirmBtn.textContent;
      confirmBtn.textContent='אפס';
      const handler=async()=>{
        confirmBtn.textContent=orig;
        confirmBtn.removeEventListener('click',handler);
        if(!activeEventId) return;
        try {
          const snap=await getDocs(query(getReportsCol(), where('eventId','==',activeEventId)));
          if(!snap.empty){
            const batch=writeBatch(db);
            snap.docs.forEach(d=>batch.delete(getReportDoc(d.id)));
            await batch.commit();
          }
          reportCache=[];
          await renderResidentMarkers();
          closeModal('#residentReportsManagerPanel');
          showCustomAlert('הדיווחים אופסו ✓');
        } catch(e){ console.error(e); showCustomAlert('שגיאה באיפוס הדיווחים'); }
      };
      confirmBtn.addEventListener('click',handler);
    }
  });

  safe('showSnapshotOnMapBtn')?.addEventListener('click',()=>{
    const btn=safe('showSnapshotOnMapBtn');
    if(btn.dataset.snapshotActive==='1'){
      btn.dataset.snapshotActive='0'; btn.classList.remove('active-snapshot');
      btn.textContent='📍 הצג על המפה';
      // restore live data
      renderResidentMarkers();
    }
  });
}

function normalizeHouseItem(item) {
  return {
    street: String(item.street ?? '').trim(),
    house: String(item.house ?? '').trim(),
    lat: item.lat === '' || item.lat == null ? '' : Number(item.lat),
    lng: item.lng === '' || item.lng == null ? '' : Number(item.lng)
  };
}
function upsertHouse(item) {
  const normalized = normalizeHouseItem(item);
  if (!normalized.street || !normalized.house) return false;
  const existing = managedHouses.findIndex(h => `${h.street}`.trim() === normalized.street && `${h.house}`.trim() === normalized.house);
  if (existing >= 0) managedHouses[existing] = {...managedHouses[existing], ...normalized};
  else managedHouses.unshift(normalized);
  return true;
}
function extractCell(row, aliases) {
  const key = Object.keys(row).find(k => aliases.includes(String(k).trim().toLowerCase()));
  return key ? row[key] : undefined;
}
async function importHousesFromExcel(file) {
  const status = safe('housesImportStatus');
  try {
    const data = await file.arrayBuffer();
    const wb = XLSX.read(data, {type:'array'});
    const sheet = wb.Sheets[wb.SheetNames[0]];
    const rows = XLSX.utils.sheet_to_json(sheet, {defval:''});
    const parsed = rows.map(row => ({
      street: extractCell(row, ['street','רחוב','street name','street_name','st']),
      house: extractCell(row, ['house','house number','house_number','number','מספר','מס בית','מספר בית']),
      lat: extractCell(row, ['lat','latitude','קו רוחב','רוחב','y']),
      lng: extractCell(row, ['lng','lon','long','longitude','קו אורך','אורך','x'])
    })).filter(item => String(item.street ?? '').trim() && String(item.house ?? '').trim());

    let changed = 0;
    parsed.forEach(item => { if (upsertHouse(item)) changed += 1; });
    managedLayers = Array.from(new Set([...managedLayers, 'מספרי בתים']));
    activeLayers.add('מספרי בתים');
    persistAll();
    renderHouses();
    syncStreetOptions();
    renderLayersModal();
    renderResidentMarkers();
    if (changed) fitMapToHouseBounds();
    if (status) status.textContent = changed ? `יובאו ${changed} בתים מקובץ ${file.name}` : 'לא נמצאו שורות תקינות לייבוא.';
  } catch (e) {
    console.error(e);
    if (status) status.textContent = 'שגיאה בקריאת הקובץ. ודא שיש עמודות רחוב, מספר, lat, lng.';
  }
}
function setupManagement() {
  managedLayers = Array.from(new Set([...managedLayers, 'מספרי בתים']));
  safe('saveGpxBtn')?.addEventListener('click',async()=>{
    const file=safe('gpxFileInput').files?.[0]; if(!file) return;
    const text=await file.text();
    const xml=new DOMParser().parseFromString(text,'application/xml');
    const points=Array.from(xml.querySelectorAll('wpt')).map((wpt,i)=>({
      lat:Number(wpt.getAttribute('lat')), lng:Number(wpt.getAttribute('lon')),
      name:wpt.querySelector('name')?.textContent||`${safe('gpxLayerType').value} ${i+1}`
    })).filter(p=>Number.isFinite(p.lat)&&Number.isFinite(p.lng));
    gpxItems.unshift({id:crypto.randomUUID(), type:safe('gpxLayerType').value, name:file.name, points});
    persistAll(); renderGpxList(); renderGpxMarkers(); safe('gpxFileInput').value='';
  });
  safe('addHouseBtn')?.addEventListener('click',()=>{
    const street=safe('houseStreetInput').value.trim();
    const house=safe('houseNumberInput').value.trim();
    const lat=safe('houseLatInput').value.trim();
    const lng=safe('houseLngInput').value.trim();
    if(!street||!house) return;
    const item = {street, house, lat: lat==='' ? '' : Number(lat), lng: lng==='' ? '' : Number(lng)};
    if (editingHouseIndex===null) upsertHouse(item);
    else managedHouses[editingHouseIndex] = normalizeHouseItem(item);
    managedLayers = Array.from(new Set([...managedLayers, 'מספרי בתים']));
    persistAll(); renderHouses(); syncStreetOptions(); renderLayersModal(); renderGpxMarkers(); resetHouseForm();
  });
  safe('cancelHouseEditBtn')?.addEventListener('click', resetHouseForm);

  // House search
  safe('housesSearchInput')?.addEventListener('input', e => renderHouses(e.target.value));

  // Pick on map
  let pickMap = null;
  let pickMarker = null;
  safe('pickOnMapBtn')?.addEventListener('click', () => {
    const container = safe('pickMapContainer');
    if (!container) return;
    container.classList.remove('hidden');
    if (!pickMap) {
      const center = defaultMapCenter();
      pickMap = L.map('pickMap').setView(center, 15);
      L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
        attribution: '&copy; OpenStreetMap', maxZoom: 19
      }).addTo(pickMap);
      pickMap.on('click', e => {
        const {lat, lng} = e.latlng;
        if (safe('houseLatInput')) safe('houseLatInput').value = lat.toFixed(7);
        if (safe('houseLngInput')) safe('houseLngInput').value = lng.toFixed(7);
        if (pickMarker) pickMap.removeLayer(pickMarker);
        pickMarker = L.marker([lat, lng]).addTo(pickMap);
      });
    } else {
      setTimeout(() => pickMap.invalidateSize(), 100);
    }
  });
  safe('closePickMapBtn')?.addEventListener('click', () => {
    safe('pickMapContainer')?.classList.add('hidden');
  });

  safe('importHousesBtn')?.addEventListener('click',()=>{
    const file = safe('housesExcelInput')?.files?.[0];
    if (file) importHousesFromExcel(file);
  });
  safe('housesExcelInput')?.addEventListener('change', e=>{
    const file = e.target.files?.[0];
    const nameBox = safe('housesSelectedFileName');
    if (nameBox) nameBox.textContent = file ? file.name : 'לא נבחר קובץ';
  });
  safe('addLayerBtn')?.addEventListener('click',()=>{
    const v=safe('newLayerName').value.trim(); if(!v||managedLayers.includes(v)) return;
    managedLayers.push(v); persistAll(); safe('newLayerName').value=''; renderManagedLayers(); renderLayersModal();
  });
  safe('addInfoBtn')?.addEventListener('click',()=>{
    const title=safe('infoTitleInput').value.trim(); const url=safe('infoUrlInput').value.trim();
    if(!title||!url) return;
    managedInfoButtons.unshift({title,url}); persistAll(); renderInfoAdmin(); renderInfoView();
    safe('infoTitleInput').value=''; safe('infoUrlInput').value='';
  });
  safe('addEventTypeBtn')?.addEventListener('click',()=>{
    const v=safe('newEventTypeInput').value.trim(); if(!v||eventTypes.includes(v)) return;
    eventTypes.push(v); persistAll(); renderEventTypes(); safe('newEventTypeInput').value='';
  });
  renderManagedLayers(); renderGpxList(); renderHouses(); renderInfoAdmin(); renderEventTypes(); syncStreetOptions(); resetHouseForm(); renderLayersModal();
}
function setupControls() {
  safe('toggleSortBtn')?.addEventListener('click',()=>{ sortDirection=sortDirection==='desc'?'asc':'desc'; renderResidentMarkers(); });
  safe('searchReports')?.addEventListener('input',()=>renderResidentMarkers());

  // Filter checkboxes
  ['filterOk','filterProperty','filterInjury','filterNoReport'].forEach(id=>{
    safe(id)?.addEventListener('change',()=>{ updateFilterBtnLabel(); renderResidentMarkers(); });
  });

  // Dropdown toggle
  safe('mapFilterBtn')?.addEventListener('click', e=>{
    e.stopPropagation();
    safe('mapFilterDropdown')?.classList.toggle('hidden');
  });
  document.addEventListener('click', e=>{
    if (!safe('mapFilterWrap')?.contains(e.target)) {
      safe('mapFilterDropdown')?.classList.add('hidden');
    }
  });

  safe('confirmLockBtn')?.addEventListener('click',async()=>{
    if(!activeEventId) return;
    await updateDoc(getEventDoc(activeEventId), {locked:true});
    closeModal('#lockPanel'); showCustomAlert('האירוע ננעל');
  });
}

function updateFilterBtnLabel() {
  const btn = safe('mapFilterBtn'); if (!btn) return;
  const f = getFilterFlags();
  const active = [f.ok&&'תקין', f.property&&'נזק', f.injury&&'פגיעה', f.noReport&&'לא דיווחו'].filter(Boolean);
  const allOn = f.ok && f.property && f.injury && !f.noReport;
  btn.textContent = allOn ? 'סינון ▾' : (active.length ? active.join(', ') + ' ▾' : 'ללא ▾');
}
function setupShareUi() {
  const setUrlDisplay = (displayId, hiddenId, url) => {
    const d = safe(displayId); const h = safe(hiddenId);
    if (d) d.textContent = url || '';
    if (h) h.textContent = url || '';
  };
  const copyWithFeedback = async (hiddenId, btnId) => {
    const url = safe(hiddenId)?.textContent?.trim();
    if (!url || url === 'עדיין לא נוצר קישור') return;
    await navigator.clipboard.writeText(url);
    const btn = safe(btnId); const t = btn.textContent;
    btn.textContent = 'הועתק ✓'; setTimeout(() => btn.textContent = t, 1500);
  };

  // Resident report URL
  const refreshReportUrl = () => setUrlDisplay('residentReportUrlDisplay', 'residentReportUrl', getResidentReportUrl());
  refreshReportUrl();
  safe('openLinksManagerBtn')?.addEventListener('click', refreshReportUrl);
  safe('copyResidentLinkBtn')?.addEventListener('click', () => copyWithFeedback('residentReportUrl', 'copyResidentLinkBtn'));

  // Unified share (map + journal checkboxes)
  const now = new Date(); now.setHours(now.getHours() + 3);
  if (safe('shareDateInput')) safe('shareDateInput').value = now.toISOString().slice(0,10);
  if (safe('shareTimeInput')) safe('shareTimeInput').value = `${String(now.getHours()).padStart(2,'0')}:${String(now.getMinutes()).padStart(2,'0')}`;

  safe('createShareBtn')?.addEventListener('click', async () => {
    const date = safe('shareDateInput').value; const time = safe('shareTimeInput').value || '23:59';
    if (!date) return;
    const includeMap     = safe('shareIncludeMap')?.checked !== false;
    const includeJournal = safe('shareIncludeJournal')?.checked === true;
    if (!includeMap && !includeJournal) {
      safe('createShareBtn').textContent = 'בחר לפחות אחד'; setTimeout(() => safe('createShareBtn').textContent = '✨ צור קישור', 1500); return;
    }
    const url = await createUnifiedShare(new Date(`${date}T${time}:00`), includeMap, includeJournal);
    setUrlDisplay('generatedShareUrlDisplay', 'generatedShareUrl', url);
  });
  safe('copyShareBtn')?.addEventListener('click', () => copyWithFeedback('generatedShareUrl', 'copyShareBtn'));
}
async function subscribeVillageReports() {
  if (unsubReports) unsubReports();
  if (!activeEventId) return;
  const qy=query(getReportsCol(), where('eventId','==',activeEventId));
  unsubReports=onSnapshot(qy,async snap=>{
    reportCache=snap.docs.map(d=>({id:d.id,...d.data()}));
    await renderResidentMarkers();
  },()=>{ reportCache=[]; renderResidentMarkers(); });
}

// ── האזנה לאירוע הפעיל (לסנכרון שעת הערכת מצב במסך קריאה) ──
async function subscribeActiveEvent() {
  if (unsubEvent) unsubEvent();
  if (!activeEventId) return;
  unsubEvent = onSnapshot(getEventDoc(activeEventId), snap => {
    if (snap.exists()) {
      const d = snap.data();
      if (d.assessmentTimeIsManual && d.assessmentTime) {
        assessmentTime = new Date(d.assessmentTime);
        assessmentTimeIsManual = true;
      }
      updateAssessmentDisplay();
    }
  });
}

// ════════════════════════════════════════════════════════
//  JOURNAL HELPERS
// ════════════════════════════════════════════════════════
const showCustomAlert = (msg) => {
  const el=safe('customAlert'); const mel=safe('customAlertMessage');
  if(el&&mel){ 
      mel.textContent=msg; 
      el.classList.remove('hidden'); 
      safe('customAlertCancelBtn')?.classList.remove('hidden');
  }
};

const formatAsDDMMYYYY = (ds) => {
  const d=new Date(ds);
  return `${String(d.getDate()).padStart(2,'0')}/${String(d.getMonth()+1).padStart(2,'0')}/${d.getFullYear()}`;
};
const isValidTimeFormat = (t) => /^([01]?[0-9]|2[0-3]):[0-5][0-9]$/.test(t);

const sortChronologically = arr => [...arr].sort((a,b)=>{
  const da=new Date(a.date), db=new Date(b.date);
  if(da>db) return -1; if(da<db) return 1;
  if(a.time>b.time) return -1; if(a.time<b.time) return 1;
  return 0;
});

const setDefaultDateTime = () => {
  const now=new Date();
  const y=now.getFullYear(), m=String(now.getMonth()+1).padStart(2,'0'), d=String(now.getDate()).padStart(2,'0');
  const h=String(now.getHours()).padStart(2,'0'), mi=String(now.getMinutes()).padStart(2,'0');
  if(safe('newDate')) safe('newDate').value=`${y}-${m}-${d}`;
  if(safe('newTime')) safe('newTime').value=`${h}:${mi}`;
};

// פונקציית סינון - מציגה דיווחים מהיום ואתמול בלבד
function filterToLastTwoDays(reports) {
  const today = new Date();
  const yesterday = new Date();
  yesterday.setDate(yesterday.getDate() - 1);
  
  const formatD = (d) => `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`;
  const validDates = new Set([formatD(today), formatD(yesterday)]);
  
  return reports.filter(r => validDates.has(r.date));
}

// last used reporter/logType — persist across submissions
let lastReporter = '';
let lastLogType  = '';

function resetForm() {
  const ta=safe('generalTextInput'); if(ta){ ta.value=''; ta.style.height='auto'; }
  // Restore last-used reporter and logType
  editingReportId=null;
  const mb=safe('mainActionBtn');   if(mb) mb.textContent='הזן';
  const cb=safe('cancelEditBtn');   if(cb) cb.classList.add('hidden');
  const err=safe('inputErrorMessage'); if(err) err.textContent='';
  safe('dateTimeToggleLabel')?.classList.add('hidden');
  safe('dateTimeInputsWrapper')?.classList.add('hidden');
  if (safe('showDateTimeToggle')) safe('showDateTimeToggle').checked = false;
  setDefaultDateTime();
  // Re-apply last used values (after a tick so dropdowns are ready)
  setTimeout(()=>{
    const rep=safe('filterReporter'); if(rep&&lastReporter) rep.value=lastReporter;
    const lt=safe('filterLogType');   if(lt&&lastLogType)   lt.value=lastLogType;
  }, 0);
}

function fullResetForm() {
  lastReporter=''; lastLogType='';
  resetForm();
  const rep=safe('filterReporter'); if(rep) rep.value='';
  const lt=safe('filterLogType');   if(lt)  lt.value='';
}

function isMobileViewport() {
  return window.innerWidth <= 800;
}

function filterToTodayAndYesterday(data) {
  const now = new Date();
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const yesterday = new Date(today);
  yesterday.setDate(today.getDate() - 1);
  const allowed = new Set([
    today.toISOString().slice(0,10),
    yesterday.toISOString().slice(0,10)
  ]);
  return data.filter(r => allowed.has(r.date));
}

function applyMobileReadOnlyMode() {
  const admin = safe('screen-admin');
  if (!admin) return;
  admin.classList.toggle('mobile-readonly-mode', isMobileViewport());
  if (!isMobileViewport()) mobilePaneMode = null;
  if (!isMobileViewport()) admin.classList.remove('pane-map-full', 'pane-journal-full');
}

function togglePaneMode(which) {
  if (!isMobileViewport()) return;
  const admin = safe('screen-admin');
  if (!admin) return;
  mobilePaneMode = mobilePaneMode === which ? null : which;
  admin.classList.toggle('pane-map-full', mobilePaneMode === 'map');
  admin.classList.toggle('pane-journal-full', mobilePaneMode === 'journal');
  setTimeout(() => map?.invalidateSize(), 120);
}

// ── render journal table ──────────────────────────────
function renderTable(searchTerm='') {
  const tableBody=safe('reportTableBody'); if(!tableBody) return;
  tableBody.innerHTML='';
  const emptyRow=safe('empty-state');
  const loadRow =safe('loading-state');
  if(loadRow) loadRow.classList.add('hidden');

  let data=[...journalReports];

  // סינון ליומיים האחרונים בלבד עבור צופים דרך קישור משותף
  if (isSharedLinkView || isMobileViewport()) {
    data = filterToTodayAndYesterday(data);
  }

  if(searchTerm) {
    const lc=searchTerm.toLowerCase();
    data=data.filter(r=>
      r.description.toLowerCase().includes(lc)||
      r.reporter.toLowerCase().includes(lc)||
      r.logType.toLowerCase().includes(lc)
    );
  }
  if(lastAddedReportId&&!searchTerm) {
    const idx=data.findIndex(r=>r.id===lastAddedReportId);
    if(idx!==-1){ const [top]=data.splice(idx,1); data.unshift(top); }
    lastAddedReportId=null;
  }
  if(data.length===0) {
    if(emptyRow){ emptyRow.classList.remove('hidden'); tableBody.appendChild(emptyRow); } return;
  }
  if(emptyRow) emptyRow.classList.add('hidden');

  const grouped=new Map();
  data.forEach(r=>{ if(!grouped.has(r.date)) grouped.set(r.date,[]); grouped.get(r.date).push(r); });
  const sortedDates=[...grouped.keys()].sort((a,b)=>new Date(b)-new Date(a));
  const today=new Date();
  const todayKey=`${today.getFullYear()}-${String(today.getMonth()+1).padStart(2,'0')}-${String(today.getDate()).padStart(2,'0')}`;

  sortedDates.forEach(dateKey=>{
    const reps=grouped.get(dateKey);
    const isToday=dateKey===todayKey;
    const isCollapsed=searchTerm?false:collapsedGroups.has(dateKey);
    const summary=` (${reps.length} דיווחים)`;

    const hRow=document.createElement('tr');
    hRow.className='date-group-header';
    hRow.dataset.toggleDate = dateKey;
    hRow.innerHTML=`<td colspan="5">
      <span class="toggle-day-icon">${isCollapsed?'◀':'▼'}</span>
      ${formatAsDDMMYYYY(dateKey)}
      <span class="daily-summary ${isCollapsed?'':'hidden'}">${summary}</span>
      ${auth.currentUser?.email==='gavishori@gmail.com'?`<button class="delete-btn delete-day-btn" data-date="${dateKey}" style="margin-right:10px;font-size:12px;padding:3px 8px">מחק יום</button>`:''}
    </td>`;
    tableBody.appendChild(hRow);

    const cRow=document.createElement('tr');
    cRow.className=`date-group-content${isCollapsed?' hidden':''}`;
    cRow.dataset.contentDate=dateKey;
    const cell=document.createElement('td'); cell.colSpan=5; cell.className='p-0';
    const innerT=document.createElement('table'); innerT.className='w-full';
    const innerB=document.createElement('tbody');

    const sorted=[...reps].sort((a,b)=>a.time>b.time?-1:a.time<b.time?1:0);
    const hl=(value,term)=>{
      const safeValue = value == null ? '' : String(value);
      if(!term) return safeValue;
      const escapedTerm = String(term).replace(/[.*+?^${}()|[\]\]/g, '\\$&');
      const regex = new RegExp('(' + escapedTerm + ')', 'gi');
      return safeValue.replace(regex,'<span class="highlight">$&</span>');
    };
    sorted.forEach(report=>{
      const diff=(new Date()-new Date(report.timestamp))/(1000*60*60);
      const canEdit=diff<48;
      const tr=document.createElement('tr');
      tr.innerHTML=`
        <td class="journal-table-td">${hl(report.description,searchTerm)}</td>
        <td class="journal-table-td" style="text-align:center">${report.time || ''}</td>
        <td class="journal-table-td jt-hide-sm" style="text-align:center">${hl(report.reporter,searchTerm)}</td>
        <td class="journal-table-td jt-hide-sm" style="text-align:center">${hl(report.logType,searchTerm)}</td>
        <td class="journal-table-td" style="text-align:center">
          ${canEdit?`<button class="edit-btn" data-id="${report.id}">ערוך</button><button class="delete-btn-sm" data-id="${report.id}">מחק</button>`:`<span style="color:#aaa;font-size:11px">—</span>`}
        </td>`;
      innerB.appendChild(tr);
    });
    innerT.appendChild(innerB); cell.appendChild(innerT); cRow.appendChild(cell); tableBody.appendChild(cRow);

    if(!isToday&&!collapsedGroups.has(dateKey)&&!searchTerm&&!forceAllOpen) {
      collapsedGroups.add(dateKey);
      cRow.classList.add('hidden');
      hRow.querySelector('.toggle-day-icon').textContent='◀';
      const sp=hRow.querySelector('.daily-summary'); if(sp) sp.classList.remove('hidden');
    }
  });

  // toggle handlers - Click specific row
  tableBody.querySelectorAll('.date-group-header').forEach(row=>{
    row.addEventListener('click',e=>{
      if (e.target.closest('.delete-day-btn')) return; // Ignore if clicking delete day button
      const dt=row.dataset.toggleDate;
      const cr=tableBody.querySelector(`tr[data-content-date="${dt}"]`);
      const sp=row.querySelector('.daily-summary');
      const icon=row.querySelector('.toggle-day-icon');
      if(cr){ 
          cr.classList.toggle('hidden'); 
          const col=cr.classList.contains('hidden'); 
          icon.textContent=col?'◀':'▼'; 
          if(col){ forceAllOpen=false; collapsedGroups.add(dt); if(sp) sp.classList.remove('hidden'); }
          else   { collapsedGroups.delete(dt); if(sp) sp.classList.add('hidden'); } 
      }
    });
  });

  tableBody.querySelectorAll('.edit-btn').forEach(btn=>{
    btn.addEventListener('click',()=>startEditReport(btn.dataset.id));
  });

  tableBody.querySelectorAll('.delete-btn-sm').forEach(btn=>{
    btn.addEventListener('click',()=>{
      showCustomAlert('האם למחוק דיווח זה?');
      safe('customAlert').dataset.confirmAction='deleteReport';
      safe('customAlert').dataset.reportIdToDelete=btn.dataset.id;
    });
  });

  tableBody.querySelectorAll('.delete-day-btn').forEach(btn=>{
    btn.addEventListener('click',()=>{
      showCustomAlert(`האם למחוק את כל הדיווחים מ-${formatAsDDMMYYYY(btn.dataset.date)}?`);
      safe('customAlert').dataset.confirmAction='deleteDay';
      safe('customAlert').dataset.dateToDelete=btn.dataset.date;
    });
  });
}

// journal inline cell style
document.addEventListener('DOMContentLoaded',()=>{
  const style=document.createElement('style');
  style.textContent=`.journal-table-td{padding:7px 10px;border-bottom:1px solid #EAE2D9;color:#4A443E;vertical-align:top;word-break:break-word}`;
  document.head.appendChild(style);
});

// ── add / edit report ─────────────────────────────────
async function addJournalReport() {
  const desc=safe('generalTextInput')?.value.trim();
  const rep =safe('filterReporter')?.value;
  const lt  =safe('filterLogType')?.value;
  const err =safe('inputErrorMessage');
  if(!desc){ if(err) err.textContent='נא להזין תיאור דיווח'; return; }
  if(!rep){  if(err) err.textContent='נא לבחור מדווח'; return; }
  if(!lt){   if(err) err.textContent='נא לבחור שיוך'; return; }

  let date=safe('newDate')?.value;
  let time=safe('newTime')?.value;
  if(!date||!time) { const n=new Date(); date=`${n.getFullYear()}-${String(n.getMonth()+1).padStart(2,'0')}-${String(n.getDate()).padStart(2,'0')}`; time=`${String(n.getHours()).padStart(2,'0')}:${String(n.getMinutes()).padStart(2,'0')}`; }
  if(!isValidTimeFormat(time)){ if(err) err.textContent='פורמט שעה שגוי (HH:MM)'; return; }

  if(err) err.textContent='';
  // Save for next submission
  lastReporter = rep;
  lastLogType  = lt;
  try {
    if(editingReportId) {
      const existing=journalReports.find(r=>r.id===editingReportId);
      if(!existing){ showCustomAlert('דיווח לא נמצא'); resetForm(); return; }
      const diff=(new Date()-new Date(existing.timestamp))/(1000*60*60);
      if(diff>=48){ showCustomAlert('לא ניתן לערוך דיווחים בני יותר מ-48 שעות'); resetForm(); return; }
      await setDoc(getReportDoc(editingReportId), {description:desc,date,time,reporter:rep,logType:lt}, {merge:true});
      lastAddedReportId=editingReportId;
      collapsedGroups.delete(date);
    } else {
      const payload={description:desc,date,time,reporter:rep,logType:lt,creatorId:currentUserId,timestamp:new Date().toISOString()};
      const ref=await addDoc(reportsColRef,payload);
      lastAddedReportId=ref.id;
      collapsedGroups.delete(date);
    }
    resetForm();
  } catch(e) {
    if(err) err.textContent='שגיאה בשמירה: '+e.message;
  }
}
async function deleteJournalReport(id) {
  try { 
      await deleteDoc(getReportDoc(id)); 
  } catch(e){ 
      showCustomAlert('שגיאה במחיקה: '+e.message); 
  }
}
async function deleteDayReports(dateKey) {
  const toDelete=journalReports.filter(r=>r.date===dateKey);
  try {
    const batch=writeBatch(db);
    toDelete.forEach(r=>batch.delete(getReportDoc(r.id)));
    await batch.commit();
  } catch(e){ showCustomAlert('שגיאה במחיקת יום: '+e.message); }
}
function startEditReport(id) {
  const r=journalReports.find(x=>x.id===id); if(!r) return;
  const diff=(new Date()-new Date(r.timestamp))/(1000*60*60);
  if(diff>=48){ showCustomAlert('לא ניתן לערוך דיווחים בני יותר מ-48 שעות'); return; }
  editingReportId=id;
  const ta=safe('generalTextInput'); if(ta) ta.value=r.description;
  const rep=safe('filterReporter'); if(rep) rep.value=r.reporter;
  const lt=safe('filterLogType');   if(lt)  lt.value=r.logType;
  const dt=safe('newDate');         if(dt)  dt.value=r.date;
  const tm=safe('newTime');         if(tm)  tm.value=r.time;
  const mb=safe('mainActionBtn');   if(mb)  mb.textContent='עדכן';
  const cb=safe('cancelEditBtn');   if(cb)  cb.classList.remove('hidden');
  
  safe('dateTimeToggleLabel')?.classList.remove('hidden');
  
  ta?.scrollIntoView({behavior:'smooth',block:'center'});
}

// ── reporters (Firestore) ──────────────────────────────
function populateReportersDropdown(names) {
  const sel=safe('filterReporter'); if(!sel) return;
  const cur=sel.value;
  sel.innerHTML='<option value="">מדווח</option>';
  names.sort((a,b)=>a.localeCompare(b,'he')).forEach(n=>{ const o=document.createElement('option'); o.value=n; o.textContent=n; sel.appendChild(o); });
  sel.value=cur;
}
function populateLogTypesDropdowns(arr) {
  const lt=safe('filterLogType'); if(lt){ const cv=lt.value; lt.innerHTML='<option value="">שיוך</option>'; arr.sort((a,b)=>a.name.localeCompare(b.name,'he')).forEach(x=>{ const o=document.createElement('option'); o.value=x.name; o.textContent=x.name; lt.appendChild(o); }); lt.value=cv; }
  const stf=safe('selectTaskTypeForSettings'); if(stf){ const cv=stf.value; stf.innerHTML='<option value="">בחר שיוך</option>'; arr.sort((a,b)=>a.name.localeCompare(b.name,'he')).forEach(x=>{ const o=document.createElement('option'); o.value=x.name; o.textContent=x.name; stf.appendChild(o); }); stf.value=cv; }
}
function renderReportersInModal(arr) {
  const ul=safe('reportersList'); if(!ul) return;
  ul.innerHTML='';
  if(!arr.length){ ul.innerHTML='<li style="padding:10px;color:#8da8c5;text-align:center">אין מדווחים</li>'; return; }
  arr.sort((a,b)=>a.name.localeCompare(b.name,'he')).forEach(r=>{
    const li=document.createElement('li');
    li.innerHTML=`
      <span class="reporter-name-display" data-id="${r.id}">${r.name}</span>
      <input class="reporter-name-edit hidden" value="${r.name}" data-id="${r.id}" />
      <div style="display:flex;gap:6px">
        <button class="icon-btn edit-rep-btn" style="font-size:12px">ערוך</button>
        <button class="icon-btn save-rep-btn hidden" style="font-size:12px">שמור</button>
        <button class="delete-btn del-rep-btn" style="font-size:12px">מחק</button>
        <button class="icon-btn cancel-rep-btn hidden" style="font-size:12px">ביטול</button>
      </div>`;
    ul.appendChild(li);
    const nd=li.querySelector('.reporter-name-display');
    const ni=li.querySelector('.reporter-name-edit');
    li.querySelector('.edit-rep-btn').onclick=()=>{ nd.classList.add('hidden'); ni.classList.remove('hidden'); li.querySelector('.edit-rep-btn').classList.add('hidden'); li.querySelector('.save-rep-btn').classList.remove('hidden'); li.querySelector('.del-rep-btn').classList.add('hidden'); li.querySelector('.cancel-rep-btn').classList.remove('hidden'); ni.focus(); };
    li.querySelector('.cancel-rep-btn').onclick=()=>{ nd.classList.remove('hidden'); ni.classList.add('hidden'); li.querySelector('.edit-rep-btn').classList.remove('hidden'); li.querySelector('.save-rep-btn').classList.add('hidden'); li.querySelector('.del-rep-btn').classList.remove('hidden'); li.querySelector('.cancel-rep-btn').classList.add('hidden'); };
    li.querySelector('.save-rep-btn').onclick=async()=>{ const nn=ni.value.trim(); if(!nn) return; try{ await updateDoc(doc(db,`artifacts/${appId}/public/data/reporters`,r.id),{name:nn}); showCustomAlert(`עודכן ל: "${nn}"`); }catch(e){showCustomAlert('שגיאה: '+e.message);} };
    li.querySelector('.del-rep-btn').onclick=()=>{ showCustomAlert(`למחוק את "${r.name}"?`); safe('customAlert').dataset.confirmAction='deleteReporter'; safe('customAlert').dataset.reporterIdToDelete=r.id; };
  });
}
async function addReporterToFirestore(name) {
  if(!reportersColRef||!auth.currentUser){ showCustomAlert('נדרשת התחברות'); return; }
  if(!name?.trim()){ showCustomAlert('שם ריק'); return; }
  if(currentReporters.some(r=>r.name===name.trim())){ showCustomAlert('מדווח קיים כבר'); return; }
  try { await addDoc(reportersColRef,{name:name.trim()}); if(safe('newReporterName')) safe('newReporterName').value=''; showCustomAlert(`"${name}" נוסף`); } catch(e){ showCustomAlert('שגיאה: '+e.message); }
}
async function deleteReporterFromFirestore(id) {
  try { await deleteDoc(doc(db,`artifacts/${appId}/public/data/reporters`,id)); showCustomAlert('נמחק'); } catch(e){ showCustomAlert('שגיאה: '+e.message); }
}
async function addDefaultReportersIfEmpty() {
  try {
    const snap=await getDocs(reportersColRef);
    if(snap.empty){ const batch=writeBatch(db); ["אורי","שונית","חיליק"].forEach(n=>{ const r=doc(reportersColRef); batch.set(r,{name:n}); }); await batch.commit(); localStorage.setItem('defaultReportersAddedOnce','true'); }
  } catch(e){ console.error(e); }
}
async function addDefaultLogTypesIfEmpty() {
  try {
    const snap=await getDocs(logTypesColRef);
    if(snap.empty){
      const defaults=[
        {name:"שגרה",    tasks:[{id:'r1',text:'בדיקת תקינות מערכות'},{id:'r2',text:'עדכון סטטוס משימות'},{id:'r3',text:'ביצוע סיור תקופתי'},{id:'r4',text:'הכנת ציוד'}]},
        {name:"בטחוני",  tasks:[{id:'s1',text:'בדיקת קשר עם מפקדה'},{id:'s2',text:'אבטחת שטח'},{id:'s3',text:'פריסת כוחות'},{id:'s4',text:'תיאום עם ביטחון'},{id:'s5',text:'הערכת מצב ראשונית'}]},
        {name:"שריפה",   tasks:[{id:'f1',text:'הודעה לכבאות'},{id:'f2',text:'פינוי נפגעים'},{id:'f3',text:'הגדרת קווי אש'},{id:'f4',text:'אבטחת גישה'},{id:'f5',text:'כיבוי ראשוני'}]},
        {name:"נעדר",    tasks:[{id:'m1',text:'פרטים מזהים'},{id:'m2',text:'נסיבות ההיעלמות'},{id:'m3',text:'סריקה ראשונית'},{id:'m4',text:'הודעה למשטרה'},{id:'m5',text:'גיוס כוחות חיפוש'}]},
      ];
      const batch=writeBatch(db);
      defaults.forEach(lt=>{ const r=doc(logTypesColRef); batch.set(r,lt); });
      await batch.commit(); localStorage.setItem('defaultLogTypesAddedOnce','true');
    }
  } catch(e){ console.error(e); }
}
async function addLogType(name) {
  if(!logTypesColRef||!auth.currentUser){ showCustomAlert('נדרשת התחברות'); return; }
  if(!name?.trim()){ showCustomAlert('שם ריק'); return; }
  if(definedLogTypes.some(l=>l.name===name.trim())){ showCustomAlert('שיוך קיים כבר'); return; }
  try { await addDoc(logTypesColRef,{name:name.trim(),tasks:[]}); if(safe('newTaskTypeInput')) safe('newTaskTypeInput').value=''; showCustomAlert(`"${name}" נוסף`); } catch(e){ showCustomAlert('שגיאה: '+e.message); }
}
async function addTaskToLogType(ltName, text) {
  const obj=definedLogTypes.find(l=>l.name===ltName); if(!obj){ showCustomAlert('שיוך לא נמצא'); return; }
  const updated=[...obj.tasks,{id:`task_${Date.now()}`,text:text.trim()}];
  try { await updateDoc(doc(db,`artifacts/${appId}/public/data/log_types`,obj.id),{tasks:updated}); if(safe('newTaskItemInput')) safe('newTaskItemInput').value=''; showCustomAlert('משימה נוספה'); } catch(e){ showCustomAlert('שגיאה: '+e.message); }
}
async function removeTaskFromLogType(ltName, taskId) {
  const obj=definedLogTypes.find(l=>l.name===ltName); if(!obj) return;
  const updated=obj.tasks.filter(t=>t.id!==taskId);
  try {
    await updateDoc(doc(db,`artifacts/${appId}/public/data/log_types`,obj.id),{tasks:updated});
    const prefix=`task-${ltName}-${taskId}`;
    const q2=query(reportsColRef,where('isTaskReport','==',true),where('taskReportId','==',prefix));
    const qs=await getDocs(q2);
    if(!qs.empty){ const batch=writeBatch(db); qs.docs.forEach(d=>batch.delete(getReportDoc(d.id))); await batch.commit(); }
    showCustomAlert('משימה הוסרה');
  } catch(e){ showCustomAlert('שגיאה: '+e.message); }
}

function renderLogtypesList() {
  const box = safe('logtypesListBox'); if (!box) return;
  if (!definedLogTypes.length) {
    box.innerHTML = '<p class="jm-hint" style="padding:10px;text-align:center">אין שיוכים. הוסף למעלה.</p>';
    return;
  }
  box.innerHTML = '';
  const sorted = [...definedLogTypes].sort((a,b) => a.name.localeCompare(b.name,'he'));
  sorted.forEach(lt => {
    const wrap = document.createElement('div');
    wrap.style.cssText = 'margin-bottom:8px';

    // main row
    const row = document.createElement('div');
    row.style.cssText = 'display:flex;align-items:center;gap:8px;padding:10px 12px;background:#15304f;border:1px solid rgba(255,255,255,.08);border-radius:12px';
    row.innerHTML = `
      <span style="flex:1;font-weight:700;color:#fff;font-size:15px">${lt.name}</span>
      <span style="font-size:12px;color:#8da8c5;white-space:nowrap">${(lt.tasks||[]).length} משימות</span>
      <button data-action="toggle-tasks" style="font-size:12px;padding:5px 12px;background:#1a3d63;border:1px solid rgba(255,255,255,.15);color:#cde;border-radius:8px;cursor:pointer">✏️ משימות</button>
      <button data-action="edit-name"    style="font-size:12px;padding:5px 12px;background:#1e4d8c;border:1px solid rgba(40,147,255,.4);color:#7ec8ff;border-radius:8px;cursor:pointer">עריכה</button>
      <button data-action="delete"       style="font-size:12px;padding:5px 12px;background:#5c1c2a;border:1px solid rgba(220,80,80,.3);color:#ff9aaa;border-radius:8px;cursor:pointer">מחק</button>
    `;

    // edit row (hidden)
    const editRow = document.createElement('div');
    editRow.style.cssText = 'display:none;align-items:center;gap:8px;padding:8px 12px;background:#15304f;border:1px solid rgba(40,147,255,.4);border-radius:12px';
    editRow.innerHTML = `
      <input value="${lt.name}" style="flex:1;background:#0d2440;border:1px solid rgba(40,147,255,.5);border-radius:8px;color:#fff;padding:5px 10px;font-size:14px;font-family:inherit" />
      <button data-action="save-name"   style="font-size:12px;padding:5px 12px;background:#1a6b3a;border:1px solid rgba(69,191,100,.4);color:#6fbf7a;border-radius:8px;cursor:pointer">שמור</button>
      <button data-action="cancel-edit" style="font-size:12px;padding:5px 12px;background:#2a3d55;border:1px solid rgba(255,255,255,.1);color:#aaa;border-radius:8px;cursor:pointer">ביטול</button>
    `;

    // tasks panel (hidden)
    const tasksBox = document.createElement('div');
    tasksBox.style.cssText = 'display:none;background:#0d2440;border:1px solid rgba(40,147,255,.2);border-radius:10px;margin-top:4px;overflow:hidden';

    wrap.appendChild(row);
    wrap.appendChild(editRow);
    wrap.appendChild(tasksBox);
    box.appendChild(wrap);

    function refreshTasksBox() {
      const cur = definedLogTypes.find(l => l.id === lt.id) || lt;
      const tasks = cur.tasks || [];
      tasksBox.innerHTML = '';
      if (!tasks.length) {
        tasksBox.innerHTML = '<div style="padding:10px 14px;color:#8da8c5;font-size:14px">אין משימות עדיין</div>';
      } else {
        tasks.forEach(t => {
          const tr = document.createElement('div');
          tr.style.cssText = 'display:flex;align-items:center;gap:8px;padding:8px 12px;border-bottom:1px solid rgba(255,255,255,.05);color:#cde;font-size:14px';
          tr.innerHTML = `<span style="flex:1">${t.text}</span><button style="font-size:11px;padding:3px 8px;background:#5c1c2a;border:1px solid rgba(220,80,80,.3);color:#ff9aaa;border-radius:6px;cursor:pointer">הסר</button>`;
          tr.querySelector('button').addEventListener('click', () => {
            showCustomAlert(`להסיר משימה "${t.text}"?`);
            safe('customAlert').dataset.confirmAction = 'removeTask';
            safe('customAlert').dataset.taskIdToRemove = t.id;
            safe('customAlert').dataset.logTypeToRemove = cur.name;
          });
          tasksBox.appendChild(tr);
        });
      }
      const addRow = document.createElement('div');
      addRow.style.cssText = 'display:flex;gap:8px;padding:8px 10px;border-top:1px solid rgba(255,255,255,.08);background:#0a1e35';
      addRow.innerHTML = `<input placeholder="משימה חדשה..." style="flex:1;background:#15304f;border:1px solid rgba(40,147,255,.3);border-radius:8px;color:#fff;padding:5px 10px;font-size:13px;font-family:inherit" /><button style="font-size:12px;padding:5px 12px;background:#1a6b3a;border:1px solid rgba(69,191,100,.4);color:#6fbf7a;border-radius:8px;cursor:pointer;white-space:nowrap">+ הוסף</button>`;
      addRow.querySelector('button').addEventListener('click', async () => {
        const txt = addRow.querySelector('input').value.trim();
        if (!txt) return;
        await addTaskToLogType(cur.name, txt);
        addRow.querySelector('input').value = '';
        setTimeout(refreshTasksBox, 400);
      });
      tasksBox.appendChild(addRow);
    }

    row.querySelector('[data-action="toggle-tasks"]').addEventListener('click', () => {
      const isHidden = tasksBox.style.display === 'none';
      tasksBox.style.display = isHidden ? 'block' : 'none';
      if (isHidden) refreshTasksBox();
    });

    row.querySelector('[data-action="edit-name"]').addEventListener('click', () => {
      row.style.display = 'none';
      editRow.style.display = 'flex';
      editRow.querySelector('input').focus();
    });

    editRow.querySelector('[data-action="cancel-edit"]').addEventListener('click', () => {
      editRow.style.display = 'none';
      row.style.display = 'flex';
    });

    editRow.querySelector('[data-action="save-name"]').addEventListener('click', async () => {
      const newName = editRow.querySelector('input').value.trim();
      if (!newName) return;
      if (!logTypesColRef || !auth.currentUser) { showCustomAlert('נדרשת התחברות'); return; }
      try {
        await updateDoc(doc(db, `artifacts/${appId}/public/data/log_types`, lt.id), { name: newName });
        editRow.style.display = 'none';
        row.style.display = 'flex';
        showCustomAlert(`השם עודכן ל-"${newName}"`);
      } catch(e) { showCustomAlert('שגיאה: ' + e.message); }
    });

    row.querySelector('[data-action="delete"]').addEventListener('click', () => {
      showCustomAlert(`למחוק שיוך "${lt.name}"?`);
      safe('customAlert').dataset.confirmAction = 'deleteLogType';
      safe('customAlert').dataset.logTypeToRemove = lt.id;
      safe('customAlert').dataset.logTypeNameToRemove = lt.name;
    });
  });
}
async function deleteLogType(id, name) {
  if(!logTypesColRef||!auth.currentUser){ showCustomAlert('נדרשת התחברות'); return; }
  try { await deleteDoc(doc(db,`artifacts/${appId}/public/data/log_types`,id)); showCustomAlert(`"${name}" נמחק`); } catch(e){ showCustomAlert('שגיאה: '+e.message); }
}

async function editTaskInLogType(ltName, taskId, newText) {
  const obj = definedLogTypes.find(l => l.name === ltName);
  if (!obj) return;
  if (!newText.trim()) {
    showCustomAlert('טקסט המשימה לא יכול להיות ריק');
    return;
  }
  const updatedTasks = obj.tasks.map(t =>
    t.id === taskId ? { ...t, text: newText.trim() } : t
  );
  try {
    await updateDoc(doc(db, `artifacts/${appId}/public/data/log_types`, obj.id), { tasks: updatedTasks });
    showCustomAlert('המשימה עודכנה בהצלחה');
  } catch(e) {
    showCustomAlert('שגיאה בעדכון: ' + e.message);
  }
}

function renderCurrentTasksForSettings(ltName) {
  const box = safe('currentTasksForSettings');
  const addRow = safe('jm-add-task-row');
  if(!box) return;

  if(!ltName){
    box.innerHTML='<p class="jm-hint">בחר שיוך כדי לראות משימות.</p>';
    if(addRow) addRow.classList.add('hidden');
    return;
  }

  const obj = definedLogTypes.find(l => l.name === ltName);
  if(!obj){
    box.innerHTML='<p class="jm-hint">שיוך לא נמצא.</p>';
    if(addRow) addRow.classList.add('hidden');
    return;
  }

  if(!obj.tasks || !obj.tasks.length){
    box.innerHTML='<p class="jm-hint">אין משימות. הוסף למטה.</p>';
  } else {
    box.innerHTML = ''; // מחיקת התוכן הקודם
    const ul = document.createElement('ul');
    ul.className = 'jm-list';
    ul.style.maxHeight = 'none'; // נותן לקופסה העוטפת לגלול
    ul.style.border = 'none';
    ul.style.background = 'transparent';

    obj.tasks.forEach(t => {
      const li = document.createElement('li');
      li.style.padding = '8px 4px';
      li.style.borderBottom = '1px solid rgba(255,255,255,.06)';

      // --- מצב צפייה ---
      const viewDiv = document.createElement('div');
      viewDiv.style.cssText = 'display:flex; justify-content:space-between; align-items:center; width:100%; gap:10px;';
      viewDiv.innerHTML = `
        <span style="flex:1; font-size:14px; color:#eef5ff;">${t.text}</span>
        <div style="display:flex; gap:6px; flex-shrink:0;">
          <button class="icon-btn edit-task-btn" style="font-size:12px; padding:4px 10px;" type="button">ערוך</button>
          <button class="delete-btn remove-task-btn" style="font-size:12px; padding:4px 10px;" type="button">הסר</button>
        </div>
      `;

      // --- מצב עריכה ---
      const editDiv = document.createElement('div');
      editDiv.style.cssText = 'display:none; justify-content:space-between; align-items:center; width:100%; gap:8px;';
      editDiv.innerHTML = `
        <input type="text" value="${t.text.replace(/"/g, '&quot;')}" style="flex:1; background:#0d2440; border:1px solid rgba(40,147,255,.5); border-radius:8px; color:#fff; padding:6px 10px; font-size:13px; font-family:inherit;" />
        <div style="display:flex; gap:6px; flex-shrink:0;">
          <button class="save-task-btn" style="font-size:12px; padding:6px 12px; background:#1a6b3a; border:1px solid rgba(69,191,100,.4); color:#6fbf7a; border-radius:8px; cursor:pointer;" type="button">שמור</button>
          <button class="cancel-task-btn" style="font-size:12px; padding:6px 12px; background:#2a3d55; border:1px solid rgba(255,255,255,.1); color:#aaa; border-radius:8px; cursor:pointer;" type="button">ביטול</button>
        </div>
      `;

      li.appendChild(viewDiv);
      li.appendChild(editDiv);
      ul.appendChild(li);

      // --- אירועים לכפתורים ---
      
      // כניסה למצב עריכה
      viewDiv.querySelector('.edit-task-btn').onclick = () => {
        viewDiv.style.display = 'none';
        editDiv.style.display = 'flex';
        editDiv.querySelector('input').focus();
      };
      
      // ביטול עריכה
      editDiv.querySelector('.cancel-task-btn').onclick = () => {
        editDiv.style.display = 'none';
        viewDiv.style.display = 'flex';
        editDiv.querySelector('input').value = t.text; // איפוס הטקסט חזרה למקור
      };
      
      // שמירת עריכה
      editDiv.querySelector('.save-task-btn').onclick = () => {
        const newText = editDiv.querySelector('input').value;
        editTaskInLogType(ltName, t.id, newText);
      };
      
      // הסרת משימה
      viewDiv.querySelector('.remove-task-btn').onclick = () => {
        showCustomAlert(`להסיר את המשימה "${t.text}"?`);
        safe('customAlert').dataset.confirmAction = 'removeTask';
        safe('customAlert').dataset.taskIdToRemove = t.id;
        safe('customAlert').dataset.logTypeToRemove = ltName;
      };
    });
    box.appendChild(ul);
  }
  if(addRow) addRow.classList.remove('hidden');
}

// ── tasks panel ───────────────────────────────────────
function toggleTasksPanel(open) {
  const tp=safe('tasksPanel'); if(!tp) return;
  if(open){ tp.classList.remove('hidden'); setTimeout(()=>tp.classList.add('is-open'),10); }
  else { tp.classList.remove('is-open'); setTimeout(()=>tp.classList.add('hidden'),300); }
}
function renderTasksPanel(logType) {
  const tl=safe('tasksList'); const tld=safe('tasksLogTypeDisplay'); const ach=safe('allTasksCompletedMessage');
  if(!tl||!tld) return;
  tld.textContent=logType; tl.innerHTML='';
  const obj=definedLogTypes.find(l=>l.name===logType);
  const tasks=obj?obj.tasks:[];
  if(!tasks.length){ tl.innerHTML=`<p style="text-align:center;color:#aaa">אין משימות עבור ${logType}</p>`; if(ach) ach.classList.add('hidden'); return; }
  let allDone=true;
  tasks.forEach(task=>{
    const done=completedTasks[logType]&&completedTasks[logType][task.id];
    if(!done) allDone=false;
    const div=document.createElement('div'); div.className=`task-item${done?' highlight-completed':''}`;
    div.innerHTML=`<input type="checkbox" id="t-${task.id}" data-task-id="${task.id}" data-lt="${logType}" ${done?'checked':''}><label for="t-${task.id}" style="flex:1;cursor:pointer">${task.text}</label>`;
    div.querySelector('input').addEventListener('change',e=>handleTaskCheck(task.id,logType,task.text,e.target.checked));
    tl.appendChild(div);
  });
  if(ach) allDone?ach.classList.remove('hidden'):ach.classList.add('hidden');
  updateTasksButtonStates();
}
async function handleTaskCheck(taskId, logType, taskText, checked) {
  if(!completedTasks[logType]) completedTasks[logType]={};
  completedTasks[logType][taskId]=checked;
  try { await setDoc(tasksCompletionDocRef,completedTasks,{merge:true}); } catch(e){ console.error(e); }
  const now=new Date();
  const date=`${now.getFullYear()}-${String(now.getMonth()+1).padStart(2,'0')}-${String(now.getDate()).padStart(2,'0')}`;
  const time=`${String(now.getHours()).padStart(2,'0')}:${String(now.getMinutes()).padStart(2,'0')}`;
  const prefix=`task-${logType}-${taskId}`;
  const todayRep=journalReports.find(r=>r.isTaskReport&&r.taskReportId===prefix&&r.date===date);
  if(checked&&!todayRep) {
    try { await addDoc(reportsColRef,{description:`משימת "${taskText}" עבור "${logType}" הושלמה`,date,time,reporter:safe('filterReporter')?.value||'מערכת',logType,creatorId:currentUserId,timestamp:new Date().toISOString(),isTaskReport:true,taskReportId:prefix}); } catch(e){ console.error(e); }
  } else if(!checked&&todayRep) {
    try { await deleteDoc(getReportDoc(todayRep.id)); } catch(e){ console.error(e); }
  }
  renderTasksPanel(logType);
}
function updateTasksButtonStates() {
  const con=safe('taskButtonsContainer'); if(!con) return;
  con.innerHTML='';
  const today=new Date();
  const tk=`${today.getFullYear()}-${String(today.getMonth()+1).padStart(2,'0')}-${String(today.getDate()).padStart(2,'0')}`;
  const repToday=new Set(journalReports.filter(r=>r.date===tk).map(r=>r.logType));
  const order=["בטחוני","שריפה","נעדר","שגרה"];
  const sorted=[...definedLogTypes].sort((a,b)=>{ const ia=order.indexOf(a.name),ib=order.indexOf(b.name); if(ia===-1&&ib===-1) return a.name.localeCompare(b.name,'he'); if(ia===-1) return 1; if(ib===-1) return -1; return ia-ib; });
  sorted.forEach(lt=>{
    const tasks=lt.tasks||[];
    let allDone=tasks.length>0, someChecked=false, hasIncomplete=false;
    tasks.forEach(t=>{ const done=completedTasks[lt.name]&&completedTasks[lt.name][t.id]; if(done) someChecked=true; else{allDone=false;hasIncomplete=true;} });
    const btn=document.createElement('button');
    btn.className='task-type-button'; btn.dataset.logType=lt.name; btn.textContent=lt.name;
    if(tasks.length>0&&allDone) btn.classList.add('all-tasks-completed');
    else if(tasks.length>0&&someChecked&&hasIncomplete&&repToday.has(lt.name)) btn.classList.add('tasks-incomplete-with-reports');
    btn.addEventListener('click',()=>{
      const open=safe('tasksPanel')?.classList.contains('is-open')&&safe('tasksLogTypeDisplay')?.textContent===lt.name;
      if(open) toggleTasksPanel(false); else { renderTasksPanel(lt.name); toggleTasksPanel(true); }
    });
    con.appendChild(btn);
  });
}

// ── clocks ────────────────────────────────────────────
function updateCurrentTime() {
  const now=new Date();
  const timeStr=`${String(now.getHours()).padStart(2,'0')}:${String(now.getMinutes()).padStart(2,'0')}:${String(now.getSeconds()).padStart(2,'0')}`;
  const el=safe('currentTimeDisplay');
  if(el) el.textContent=timeStr;
  const mob=safe('mobileTimeDisplay');
  if(mob) mob.textContent=timeStr;
  return now;
}
function updateAssessmentDisplay() {
  const el=safe('assessmentTimeDisplay'); if(!el) return;
  const mob=safe('mobileAssessmentDisplay');
  if(!assessmentTimeIsManual){
    el.textContent='טרם נקבע'; el.classList.remove('blinking-red');
    if(mob){ mob.textContent='טרם נקבע'; mob.classList.remove('blinking-red'); }
    return;
  }
  const val=`${String(assessmentTime.getHours()).padStart(2,'0')}:${String(assessmentTime.getMinutes()).padStart(2,'0')}`;
  el.textContent=val;
  if(mob) mob.textContent=val;
  const diff=(assessmentTime-new Date())/(1000*60);
  if(diff>0&&diff<=5){ el.classList.add('blinking-red'); if(mob) mob.classList.add('blinking-red'); }
  else { el.classList.remove('blinking-red'); if(mob) mob.classList.remove('blinking-red'); }
}

// ── export ────────────────────────────────────────────
function exportToCSV() {
  if(!journalReports.length){ showCustomAlert('אין דיווחים לייצוא'); return; }
  const header=["דיווח","תאריך","שעה","שם המדווח","שיוך יומן"].join(',');
  const rows=journalReports.map(r=>[`"${r.description.replace(/"/g,'""')}"`,formatAsDDMMYYYY(r.date),r.time,r.reporter,r.logType].join(','));
  const blob=new Blob(['\uFEFF'+[header,...rows].join('\n')],{type:'text/csv;charset=utf-8'});
  const url=URL.createObjectURL(blob); const a=document.createElement('a'); a.href=url;
  a.download=`יומן_חפק_${new Date().toISOString().slice(0,10)}.csv`;
  document.body.appendChild(a); a.click(); document.body.removeChild(a);
}
function exportToWord() {
  if(!journalReports.length){ showCustomAlert('אין דיווחים לייצוא'); return; }
  const rows=journalReports.map(r=>`<tr><td>${r.description||''}</td><td>${r.date||''}</td><td>${r.time||''}</td><td>${r.reporter||''}</td><td>${r.logType||''}</td></tr>`).join('');
  const html=`<html dir="rtl" lang="he"><head><meta charset="UTF-8"><style>@page{size:A4;margin:1.5cm}body{font-family:Arial;direction:rtl}table{border-collapse:collapse;width:100%}th,td{border:1px solid #999;padding:8px;text-align:right}th{background:#f5f5f5}</style></head><body><h1 style="text-align:center">יומן חפ"ק - לפיד</h1><table><thead><tr><th>דיווח</th><th>תאריך</th><th>שעה</th><th>מדווח</th><th>שיוך</th></tr></thead><tbody>${rows}</tbody></table></body></html>`;
  const blob=new Blob(['\uFEFF',html],{type:'application/msword;charset=utf-8'});
  const url=URL.createObjectURL(blob); const a=document.createElement('a'); a.href=url;
  a.download=`יומן_חפק_${new Date().toISOString().slice(0,10)}.doc`;
  document.body.appendChild(a); a.click(); document.body.removeChild(a);
}
function importFromExcel(file) {
  const reader=new FileReader();
  reader.onload=e=>{
    const data=new Uint8Array(e.target.result);
    const wb=XLSX.read(data,{type:'array'});
    const ws=wb.Sheets[wb.SheetNames[0]];
    const json=XLSX.utils.sheet_to_json(ws,{header:1});
    if(!json.length){ showCustomAlert('קובץ ריק'); return; }
    const hdr=json[0]; const fieldMap={"דיווח":"description","תאריך":"date","שעה":"time","שם המדווח":"reporter","שיוך יומן":"logType"};
    const toAdd=[]; let valid=true;
    for(const row of json.slice(1)) {
      if(!row.length||row.every(c=>c==null||c==='')) continue;
      const rd={}; hdr.forEach((h,i)=>{ const f=fieldMap[h]; if(f) rd[f]=row[i]; });
      if(!rd.description||!rd.date||!rd.time||!rd.reporter||!rd.logType){ showCustomAlert('שורה חסרה נתונים חובה'); valid=false; break; }
      if(!isValidTimeFormat(String(rd.time))){ showCustomAlert(`פורמט שעה שגוי: "${rd.time}"`); valid=false; break; }
      let dateStr=rd.date;
      if(typeof dateStr==='number'){ const ep=new Date('1899-12-30T00:00:00Z'); dateStr=new Date(ep.getTime()+dateStr*86400000).toISOString().split('T')[0]; }
      else { const p=new Date(dateStr); if(isNaN(p)) { showCustomAlert('תאריך לא תקין'); valid=false; break; } dateStr=p.toISOString().split('T')[0]; }
      toAdd.push({description:String(rd.description),date:dateStr,time:String(rd.time),reporter:String(rd.reporter),logType:String(rd.logType),creatorId:currentUserId,timestamp:new Date().toISOString()});
    }
    if(!valid) return;
    if(!toAdd.length){ showCustomAlert('לא נמצאו שורות תקינות'); return; }
    const batch=writeBatch(db);
    toAdd.forEach(r=>{ const ref=doc(reportsColRef); batch.set(ref,r); });
    batch.commit().then(()=>showCustomAlert(`יובאו ${toAdd.length} דיווחים`)).catch(e=>showCustomAlert('שגיאה: '+e.message));
  };
  reader.readAsArrayBuffer(file);
}

// ════════════════════════════════════════════════════════
//  AUTH STATE HANDLER
// ════════════════════════════════════════════════════════
const handleAuthState = async (user) => {
  if(safe('loading-state')) safe('loading-state').classList.add('hidden');

  if(user) {
    currentUserId=user.uid;
    const em=safe('headerUserEmail'); if(em) em.textContent=user.email||'';
    const canUseJournal = hasJournalAccess(user);
    setJournalLockedState(!canUseJournal);

    if(!reportsColRef)         reportsColRef        = collection(db,`${publicDataRoot}/reports`);
    if(!reportersColRef)       reportersColRef      = collection(db,`artifacts/${appId}/public/data/reporters`);
    if(!tasksCompletionDocRef) tasksCompletionDocRef= doc(db,`artifacts/${appId}/users/${currentUserId}/tasks_completion`,'status');
    if(!logTypesColRef)        logTypesColRef       = collection(db,`${publicDataRoot}/log_types`);

    if(!canUseJournal) {
      teardownJournalAccess();
      firebaseAuthReadyResolve();
      return;
    }

    if(!unsubJournalReports) {
      unsubJournalReports=onSnapshot(reportsColRef,snap=>{
        journalReports=sortChronologically(snap.docs.map(d=>({id:d.id,...d.data()})));
        renderTable(); updateTasksButtonStates();
      },err=>{ console.error(err); if(safe('inputErrorMessage')) safe('inputErrorMessage').textContent='שגיאה בטעינה: '+err.message; });
    }
    if(!unsubReporters) {
      unsubReporters=onSnapshot(reportersColRef,async snap=>{
        currentReporters=snap.docs.map(d=>({id:d.id,...d.data()}));
        populateReportersDropdown(currentReporters.map(r=>r.name));
        renderReportersInModal(currentReporters);
        if(snap.size===0&&!localStorage.getItem('defaultReportersAddedOnce')) await addDefaultReportersIfEmpty();
      });
    }
    if(!unsubTasksCompletion) {
      unsubTasksCompletion=onSnapshot(tasksCompletionDocRef,snap=>{ completedTasks=snap.exists()?snap.data():{};
        if(safe('tasksPanel')?.classList.contains('is-open')) renderTasksPanel(safe('tasksLogTypeDisplay')?.textContent||'');
        updateTasksButtonStates();
      });
    }
    if(!unsubLogTypes) {
      unsubLogTypes=onSnapshot(logTypesColRef,async snap=>{
        definedLogTypes=snap.docs.map(d=>({id:d.id,...d.data()}));
        populateLogTypesDropdowns(definedLogTypes);
        updateTasksButtonStates();
        renderLogtypesList();
        renderCurrentTasksForSettings(safe('selectTaskTypeForSettings')?.value || '');
        if(snap.size===0&&!localStorage.getItem('defaultLogTypesAddedOnce')) await addDefaultLogTypesIfEmpty();
        if(safe('tasksPanel')?.classList.contains('is-open')) renderTasksPanel(safe('tasksLogTypeDisplay')?.textContent||'');
      });
    }
  } else {
    currentUserId=null;
    const em=safe('headerUserEmail'); if(em) em.textContent='';
    teardownJournalAccess();
    setJournalLockedState(true);
  }
  firebaseAuthReadyResolve();
};

// ════════════════════════════════════════════════════════
//  RESIDENT REPORT FORM SETUP
// ════════════════════════════════════════════════════════
function setupReportForm() {
  const addressBtn=safe('locAddressBtn'); const gpsBtn=safe('locGpsBtn');
  const manual=safe('manualAddressFields'); const gpsBox=safe('gpsBox');
  function setLoc(mode) {
    locationType=mode;
    addressBtn?.classList.toggle('active',mode==='address');
    gpsBtn?.classList.toggle('active',mode==='gps');
    manual?.classList.toggle('hidden',mode!=='address');
    gpsBox?.classList.toggle('hidden',mode!=='gps');
    if(mode==='gps'&&navigator.geolocation) {
      gpsBox.textContent='מאתר מיקום...';
      navigator.geolocation.getCurrentPosition(async pos=>{ gpsCoords={lat:pos.coords.latitude,lng:pos.coords.longitude}; const a=await reverseGeocode(gpsCoords.lat,gpsCoords.lng); gpsBox.textContent=`${a.city}, ${a.street} ${a.house}`; safe('city').value=a.city; safe('street').value=a.street; safe('house').value=a.house; },()=>{gpsBox.textContent='לא ניתן לאתר מיקום';});
    }
  }
  addressBtn?.addEventListener('click',()=>setLoc('address'));
  gpsBtn?.addEventListener('click',()=>setLoc('gps'));
  setLoc('address');
  const souls=safe('soulsCount');
  safe('plusSouls')?.addEventListener('click',()=>souls.value=Math.min(30,(+souls.value||0)+1));
  safe('minusSouls')?.addEventListener('click',()=>souls.value=Math.max(0,(+souls.value||0)-1));
  $$('.status-btn').forEach(btn=>btn.addEventListener('click',()=>{
    const s=btn.dataset.status;
    if(s==='ok') currentStatus=currentStatus.includes('ok')?[]:['ok'];
    else { currentStatus=currentStatus.filter(x=>x!=='ok'); currentStatus=currentStatus.includes(s)?currentStatus.filter(x=>x!==s):[...currentStatus,s]; }
    $$('.status-btn').forEach(b=>b.classList.toggle('active',currentStatus.includes(b.dataset.status)));
    safe('statusHint').textContent=currentStatus.length>1?'נבחרו מספר מצבים':'';
  }));
  safe('submitBtn')?.addEventListener('click',async()=>{
    const err=safe('formError'); err.classList.add('hidden');
    const city=safe('city').value.trim()||'לפיד';
    const street=safe('street').value.trim(); const house=safe('house').value.trim();
    const souls2=+safe('soulsCount').value||0; const note=safe('freeText').value.trim();
    if(!street){ err.textContent='נא להזין רחוב'; err.classList.remove('hidden'); return; }
    if(!currentStatus.length){ err.textContent='נא לבחור מצב'; err.classList.remove('hidden'); return; }
    try {
      let coords=gpsCoords;
      if(locationType==='address') {
        // Only use exact coordinates from managedHouses — no external geocoding
        coords = lookupHouseCoords(street, house) || null;
      }
      await submitVillageReport({city,street,house,souls:souls2,note,statuses:currentStatus,lat:coords?.lat||null,lng:coords?.lng||null});
      safe('successBox').classList.remove('hidden');
    } catch(e){ err.textContent=e?.message||'שגיאה בשליחה'; err.classList.remove('hidden'); }
  });
}

// ════════════════════════════════════════════════════════
//  JOURNAL MANAGER TABS
// ════════════════════════════════════════════════════════
function setupJournalManagerTabs() {
  $$('.jm-tab').forEach(tab=>tab.addEventListener('click',()=>{
    // מסירים את הסימון מכל הלשוניות ושמים על הנוכחית
    $$('.jm-tab').forEach(t=>t.classList.remove('active'));
    tab.classList.add('active');
    
    // מעדכנים את התוכן של הלשוניות: גם hidden וגם active (לפי ה-CSS שלך)
    const name=tab.dataset.tab;
    $$('.jm-tab-content').forEach(c=>{
      c.classList.remove('active');
      c.classList.add('hidden');
    });
    const target = safe(`jm-tab-${name}`);
    if(target) {
      target.classList.remove('hidden');
      target.classList.add('active');
    }

    if(name==='logtypes') renderLogtypesList();
    if(name==='tasks') { populateLogTypesDropdowns(definedLogTypes); renderCurrentTasksForSettings(safe('selectTaskTypeForSettings')?.value||''); }
  }));
}
function setupJournalManagerListeners() {
  safe('addReporterBtn')?.addEventListener('click',()=>addReporterToFirestore(safe('newReporterName')?.value));
  safe('addNewTaskTypeBtn')?.addEventListener('click',()=>addLogType(safe('newTaskTypeInput')?.value));
  safe('selectTaskTypeForSettings')?.addEventListener('change',e=>renderCurrentTasksForSettings(e.target.value));
  safe('addTaskItemBtn')?.addEventListener('click',()=>{ const lt=safe('selectTaskTypeForSettings')?.value; const txt=safe('newTaskItemInput')?.value.trim(); if(lt&&txt) addTaskToLogType(lt,txt); else showCustomAlert('בחר שיוך והזן משימה'); });
  safe('exportExcelBtn')?.addEventListener('click',exportToCSV);
  safe('exportWordBtn')?.addEventListener('click',exportToWord);
  safe('importExcelInput')?.addEventListener('change',e=>{ const f=e.target.files?.[0]; if(f) importFromExcel(f); e.target.value=''; });
}

// ════════════════════════════════════════════════════════
//  JOURNAL INLINE LISTENERS (in the view-reports panel)
// ════════════════════════════════════════════════════════
function setupJournalInlineListeners() {
  safe('mainActionBtn')?.addEventListener('click',addJournalReport);
  safe('cancelEditBtn')?.addEventListener('click',fullResetForm);
  
  // Toggle all groups
  safe('toggleAllGroupsBtn')?.addEventListener('click',()=>{ 
      const allDates = [...new Set(journalReports.map(r => r.date))];
      if (!allDates.length) return;
      // Check if ANY date is currently expanded (not collapsed)
      const anyOpen = allDates.some(d => !collapsedGroups.has(d));
      if (anyOpen) {
          // Close all
          forceAllOpen = false;
          allDates.forEach(d => collapsedGroups.add(d));
      } else {
          // Open all - set flag to prevent renderTable from auto-collapsing old dates
          forceAllOpen = true;
          collapsedGroups.clear();
      }
      renderTable(safe('searchInput')?.value.trim()||''); 
  });

  safe('searchLogBtn')?.addEventListener('click',(e)=>{ 
      e.stopPropagation();
      isSearchInputVisible=!isSearchInputVisible; 
      const si=safe('searchInput'); 
      if(si){ 
          if(isSearchInputVisible){
              si.classList.remove('hidden');
              si.focus();
          } else {
              si.value='';
              si.classList.add('hidden');
              renderTable();
          } 
      } 
  });
  
  safe('searchInput')?.addEventListener('input',()=>renderTable(safe('searchInput').value.trim()));
  safe('showDateTimeToggle')?.addEventListener('change',e=>{ const wrap=safe('dateTimeInputsWrapper'); if(wrap) wrap.classList.toggle('hidden',!e.target.checked); });
  
  safe('assessmentTimePlusBtn')?.addEventListener('click', async ()=>{ 
      if(!assessmentTimeIsManual){assessmentTime=new Date();} 
      assessmentTime.setMinutes(assessmentTime.getMinutes()+5); 
      assessmentTime.setSeconds(0); 
      assessmentTimeIsManual=true;
      updateAssessmentDisplay(); 
      if (activeEventId) await updateDoc(getEventDoc(activeEventId), { assessmentTime: assessmentTime.getTime(), assessmentTimeIsManual: true });
  });

  safe('assessmentTimeMinusBtn')?.addEventListener('click', async ()=>{ 
      if(!assessmentTimeIsManual){assessmentTime=new Date();} 
      assessmentTime.setMinutes(assessmentTime.getMinutes()-5); 
      assessmentTime.setSeconds(0); 
      assessmentTimeIsManual=true;
      updateAssessmentDisplay(); 
      if (activeEventId) await updateDoc(getEventDoc(activeEventId), { assessmentTime: assessmentTime.getTime(), assessmentTimeIsManual: true });
  });

  safe('closeTasksPanelBtn')?.addEventListener('click',()=>toggleTasksPanel(false));
  // click outside tasks panel inner closes it
  safe('tasksPanel')?.addEventListener('click',e=>{
    if(e.target===safe('tasksPanel')) toggleTasksPanel(false);
  });
  
  // logout
  const logoutHandler = async () => { try{ await signOut(auth); }catch(e){} };
  safe('logoutBtn')?.addEventListener('click', logoutHandler);
  safe('mobileLogoutBtn')?.addEventListener('click', logoutHandler);

  // custom alert cancel btn
  safe('customAlertCancelBtn')?.addEventListener('click',()=>{
      const ca=safe('customAlert'); if(!ca) return;
      ca.classList.add('hidden');
      delete ca.dataset.confirmAction; delete ca.dataset.dateToDelete; delete ca.dataset.reporterIdToDelete; delete ca.dataset.taskIdToRemove; delete ca.dataset.logTypeToRemove; delete ca.dataset.reportIdToDelete;
  });

  // custom alert close + confirm actions
  safe('customAlertCloseBtn')?.addEventListener('click',()=>{
    const ca=safe('customAlert'); if(!ca) return;
    ca.classList.add('hidden');
    safe('customAlertCancelBtn')?.classList.add('hidden');
    const action=ca.dataset.confirmAction;
    if(action==='deleteDay'){ const d=ca.dataset.dateToDelete; if(d) deleteDayReports(d); }
    if(action==='deleteReport'){ const rId=ca.dataset.reportIdToDelete; if(rId) deleteJournalReport(rId); }
    if(action==='deleteReporter'){ const id=ca.dataset.reporterIdToDelete; if(id) deleteReporterFromFirestore(id); }
    if(action==='removeTask'){ const tid=ca.dataset.taskIdToRemove; const lt=ca.dataset.logTypeToRemove; if(tid&&lt) removeTaskFromLogType(lt,tid); }
    if(action==='deleteLogType'){ const ltId=ca.dataset.logTypeToRemove; const ltName=ca.dataset.logTypeNameToRemove; if(ltId&&ltName) deleteLogType(ltId,ltName); }
    delete ca.dataset.confirmAction; delete ca.dataset.dateToDelete; delete ca.dataset.reporterIdToDelete; delete ca.dataset.taskIdToRemove; delete ca.dataset.logTypeToRemove; delete ca.dataset.reportIdToDelete; delete ca.dataset.logTypeNameToRemove;
  });
}

// ════════════════════════════════════════════════════════
//  BOOT ADMIN
// ════════════════════════════════════════════════════════
async function bootJournalReadOnly(eventId) {
  safe('screen-report')?.classList.remove('active');
  safe('screen-admin')?.classList.remove('active');
  const jscreen = safe('screen-journal-readonly');
  if (jscreen) jscreen.classList.add('active');
  if (!reportsColRef) reportsColRef = collection(db, `${publicDataRoot}/reports`);
  const q = query(getReportsCol(), where('eventId', '==', eventId));
  onSnapshot(q, snap => {
    let entries = sortChronologically(snap.docs.map(d => ({id: d.id, ...d.data()})));
    // סינון ליומיים האחרונים בתצוגת קריאה בלבד נפרדת
    entries = filterToLastTwoDays(entries);
    renderJournalReadOnly(entries);
  });
}

function renderJournalReadOnly(entries) {
  const tbody = safe('journalReadOnlyBody');
  if (!tbody) return;
  if (!entries.length) {
    tbody.innerHTML = '<tr><td colspan="4" style="text-align:center;padding:24px;color:#8aabcc">אין רשומות ביומן ליומיים האחרונים</td></tr>';
    return;
  }
  tbody.innerHTML = entries.map(e => `
    <tr class="jro-row">
      <td class="jro-td jro-desc">${e.description || ''}</td>
      <td class="jro-td jro-time">${e.date || ''} ${e.time || ''}</td>
      <td class="jro-td jro-reporter">${e.reporter || ''}</td>
      <td class="jro-td jro-type">${e.logType || ''}</td>
    </tr>`).join('');
}

async function bootAdmin(sharedOnly=false) {
  safe('screen-report')?.classList.remove('active');
  safe('screen-admin')?.classList.add('active');

  if (sharedOnly) {
    isSharedLinkView = true;
  } else {
    setJournalLockedState(!hasJournalAccess(auth?.currentUser));
  }

  initMap();
  setupNavigation();
  setupModals();
  setupControls();
  setupShareUi();
  setupManagement();
  renderInfoView();
  applyMobileReadOnlyMode();
  setupJournalManagerTabs();
  setupJournalManagerListeners();
  setupJournalInlineListeners();
  setDefaultDateTime();
  resetForm();
  assessmentTime.setMinutes(assessmentTime.getMinutes()+30); assessmentTime.setSeconds(0);
  setInterval(updateCurrentTime, 1000);
  setInterval(updateAssessmentDisplay, 1000);
  await getOrCreateActiveEvent();
  await subscribeVillageReports();
  await subscribeActiveEvent(); // מתחיל להאזין לעדכוני שעת הערכת המצב מ-Firestore
  
  // Sync houses to Firestore now that auth is confirmed
  if (!sharedOnly && (managedHouses.length > 0 || managedInfoButtons.length > 0)) syncConfigToFirestore();

  if(sharedOnly) {
    const rail=safe('screen-admin')?.querySelector('.side-rail'); if(rail) rail.style.display='none';
    const lb=safe('lockEventBtn'); if(lb) lb.style.display='none';
    const topBar = document.querySelector('.journal-top-bar'); if(topBar) topBar.style.display='none';
    const logoutDesktop = safe('logoutBtn'); if(logoutDesktop) logoutDesktop.style.display='none';
    const logoutMobile = safe('mobileLogoutBtn'); if(logoutMobile) logoutMobile.style.display='none';
    const plusBtn = safe('assessmentTimePlusBtn'); if(plusBtn) plusBtn.style.display='none';
    const minusBtn = safe('assessmentTimeMinusBtn'); if(minusBtn) minusBtn.style.display='none';
    
    // הסתרת האימייל של המשתמש
    const emailEl = safe('headerUserEmail'); if (emailEl) emailEl.style.display='none';
    
    // הסתרת אזור הזנת הנתונים כולו
    const inputBox = document.querySelector('.journal-input-box'); if (inputBox) inputBox.style.display='none';

    // הבטחת טעינת הנתונים למשתמשים לא מחוברים בקישור שיתוף ציבורי
    if (!unsubJournalReports) {
      if (!reportsColRef) reportsColRef = collection(db, `${publicDataRoot}/reports`);
      unsubJournalReports = onSnapshot(reportsColRef, snap => {
        journalReports = sortChronologically(snap.docs.map(d => ({id: d.id, ...d.data()})));
        renderTable();
      });
    }
  }
  
  setTimeout(()=>map.invalidateSize(),150);
}

// ════════════════════════════════════════════════════════
//  DOMContentLoaded
// ════════════════════════════════════════════════════════

// ── Dynamic house numbers based on managed houses ──
window.updateHouseOptions = function() {
  const streetSel = document.getElementById('street');
  const houseSel  = document.getElementById('house');
  if (!streetSel || !houseSel) return;
  const chosen = streetSel.value;
  const nums = managedHouses
    .filter(h => (h.street || '').trim() === chosen)
    .map(h => String(h.house).trim())
    .filter(Boolean)
    .sort((a,b)=> a.localeCompare(b,'he',{numeric:true}));
  houseSel.innerHTML = '<option value="">מס׳</option>' + nums.map(n => `<option value="${n}">${n}</option>`).join('');
};

document.addEventListener('DOMContentLoaded', async () => {

  setupReportForm();
  syncStreetOptions();

  // Eagerly sync houses to Firestore if we have them locally (admin device)
  // This ensures the Firestore fallback works for other devices/browsers
  if (!MODE && !SHARE_TOKEN && !REPORT_KEY) {
    await loadConfigFromFirestore();
    if (managedHouses.length || managedInfoButtons.length) syncConfigToFirestore();
  }

  // Hide splash after max 6 seconds no matter what
  const splash = document.getElementById('loading-splash');
  const hideSplash = () => { if (splash) splash.style.display = 'none'; };
  const splashTimeout = setTimeout(hideSplash, 6000);

  if(!auth||!db){
    hideSplash();
    clearTimeout(splashTimeout);
    const em=safe('loginErrorMessage'); if(em) em.textContent='שגיאה: Firebase לא אותחל';
    // Still show admin screen so user sees something
    await bootAdmin(false);
    return;
  }

  // Register auth state listener
  onAuthStateChanged(auth, handleAuthState);

  // Try auto sign-in with custom token if available
  if(!auth.currentUser && initialAuthToken) {
    try { await signInWithCustomToken(auth, initialAuthToken); } catch(e) { console.error('Auto sign-in error:', e); }
  }

  // For public modes (report form / shared map), skip auth entirely —
  // anonymous sign-in is disabled; Firestore public paths are accessible without auth.
  const needsPublicSession = Boolean(SHARE_TOKEN || MODE === 'report' || REPORT_KEY);
  if (needsPublicSession && !auth.currentUser) {
    // Initialize Firestore collection refs so public reads/writes work without auth
    if (!reportsColRef) reportsColRef = collection(db, `${publicDataRoot}/reports`);
    // Resolve auth-ready immediately so we don't wait 5 seconds
    firebaseAuthReadyResolve();
  }

  // Login form listener
  safe('loginBtn')?.addEventListener('click', async () => {
    const email=safe('loginEmail')?.value; const pass=safe('loginPassword')?.value;
    const errEl=safe('loginErrorMessage'); if(errEl) errEl.textContent='';
    if(!email||!pass){ if(errEl) errEl.textContent='נא להזין אימייל וסיסמה'; return; }
    try { await signInWithEmailAndPassword(auth,email,pass); }
    catch(e){
      const msg=e.code==='auth/user-not-found'||e.code==='auth/wrong-password'?'אימייל או סיסמה שגויים':e.code==='auth/invalid-email'?'פורמט אימייל שגוי':e.code==='auth/too-many-requests'?'יותר מדי ניסיונות':e.message;
      if(errEl) errEl.textContent='שגיאה: '+msg;
    }
  });

  // Wait for first auth state with a 5 second timeout
  await Promise.race([
    firebaseAuthReady,
    new Promise(r => setTimeout(r, 5000))
  ]);

  hideSplash();
  clearTimeout(splashTimeout);

  // URL-mode routing
  if (SHARE_TOKEN) {
    const shareInfo = await verifyShareToken(SHARE_TOKEN);
    if (!shareInfo?.eventId) { document.body.innerHTML='<div style="padding:40px;text-align:center;color:#eef5ff;direction:rtl;font-family:Heebo,sans-serif;font-size:20px">הקישור לא תקף או פג תוקפו.</div>'; return; }
    activeEventId = shareInfo.eventId;
    if (shareInfo.type === 'journal') {
      if (!reportsColRef) reportsColRef = collection(db, `${publicDataRoot}/reports`);
      await bootJournalReadOnly(activeEventId);
    } else if (shareInfo.type === 'both') {
      await bootAdmin(true);
    } else {
      await bootAdmin(true);
    }
    return;
  }
  if (MODE==='report'||REPORT_KEY) {
    safe('screen-report')?.classList.add('active');
    safe('screen-admin')?.classList.remove('active');

    // Load houses — try all sources in order of reliability:
    // 1. URL parameter (new links generated by admin)
    const housesParam = params.get('houses');
    if (housesParam) {
      try {
        const packed = JSON.parse(decodeURIComponent(escape(atob(housesParam))));
        if (Array.isArray(packed) && packed.length) {
          managedHouses = packed.map(h => ({ street: h.s || '', house: h.n || '' }));
        }
      } catch(e) { console.warn('Could not decode houses from URL:', e); }
    }
    // 2. localStorage (same device/browser as admin)
    if (!managedHouses.length) {
      const local = storage.get('hamal_houses', []);
      if (local.length) managedHouses = local;
    }
    // 3. Firestore fallback (after admin opened app with new code at least once)
    if (!managedHouses.length) {
      try {
        const snap = await getDoc(getConfigDoc());
        if (snap.exists()) {
          const d = snap.data();
          if (Array.isArray(d.houses) && d.houses.length) managedHouses = d.houses;
        }
      } catch(e) { console.warn('Firestore houses fallback failed:', e); }
    }
    syncStreetOptions();
    if (existingReportId) {
      const snap=await getDoc(getReportDoc(existingReportId));
      if(snap.exists()) {
        const d=snap.data();
        safe('city').value=d.city||'לפיד';
        if (d.street) {
          const sel = safe('street');
          if(sel) { sel.value=d.street; window.updateHouseOptions(); }
        }
        if (d.house) { const houseSel=safe('house'); if(houseSel) houseSel.value=d.house; }
        safe('soulsCount').value=d.souls||0; safe('freeText').value=d.note||'';
        currentStatus=Array.isArray(d.statuses)?d.statuses:[];
        $$('.status-btn').forEach(b=>b.classList.toggle('active',currentStatus.includes(b.dataset.status)));
      }
    }
    return;
  }
  // Default: admin boot (login will show if not authenticated)
  await bootAdmin(false);
});
// ════════════════════════════════════════════════════════
//  RESIDENT REPORTS MANAGER HELPERS
// ════════════════════════════════════════════════════════
function updateMapStatusBar() {
  const total    = reportCache.length;
  const ok       = reportCache.filter(r=>(r.statuses||[]).includes('ok')).length;
  const injury   = reportCache.filter(r=>(r.statuses||[]).includes('injury')).length;
  const property = reportCache.filter(r=>(r.statuses||[]).includes('property')).length;
  const noReply  = Math.max(0, managedHouses.length - total);
  const replied  = Math.max(0, total - ok - injury - property);
  const set = (id,v) => { const el=safe(id); if(el) el.textContent=v; };
  set('sbNoReply',  noReply);
  set('sbReplied',  replied);
  set('sbOk',       ok);
  set('sbProperty', property);
  set('sbInjury',   injury);
  // Update summary button text
  const summaryEl = safe('sbSummaryText');
  if(summaryEl) summaryEl.textContent = `${total} השיבו · ${noReply} לא השיבו`;
  const bar = safe('statusBarWrap');
  if (bar) bar.classList.remove('hidden');
}

function updateRrmStats() {
  const total = reportCache.length;
  const ok = reportCache.filter(r=>(r.statuses||[]).includes('ok')).length;
  const injury = reportCache.filter(r=>(r.statuses||[]).includes('injury')).length;
  const property = reportCache.filter(r=>(r.statuses||[]).includes('property')).length;
  const setEl = (id,v) => { const el=safe(id); if(el) el.textContent=v; };
  setEl('rrmStatTotal', total);
  setEl('rrmStatOk', ok);
  setEl('rrmStatInjury', injury);
  setEl('rrmStatProperty', property);
  updateMapStatusBar();
}

function renderRrmSnapshots() {
  const wrap = safe('rrmSnapshotsList'); if(!wrap) return;
  let snapshots = [];
  try { snapshots = JSON.parse(localStorage.getItem('rrmSnapshots')||'[]'); } catch(e){}
  if(!snapshots.length){ wrap.innerHTML='<p class="rrm-hint">לא נשמרו דיווחים עדיין.</p>'; return; }
  wrap.innerHTML = snapshots.map((s,idx)=>`
    <div class="rrm-snapshot-item">
      <div>
        <div class="rrm-snapshot-date">${s.dateLabel}</div>
        <div class="rrm-snapshot-meta">
          <span>${s.total} משיבים</span>
          <span class="ok-pill">${s.ok} תקין</span>
          <span class="inj-pill">${s.injury} פגיעה בנפש</span>
          <span class="prop-pill">${s.property} נזק לרכוש</span>
        </div>
      </div>
      <button class="rrm-snapshot-show-btn" data-idx="${idx}" type="button">הצג על המפה</button>
    </div>
  `).join('');

  wrap.querySelectorAll('.rrm-snapshot-show-btn').forEach(btn=>{
    btn.addEventListener('click',()=>{
      const idx=+btn.dataset.idx;
      let snapshots2=[];
      try { snapshots2=JSON.parse(localStorage.getItem('rrmSnapshots')||'[]'); } catch(e){}
      const snapshot=snapshots2[idx]; if(!snapshot||!snapshot.reports) return;
      // Switch to reports view
      closeModal('#residentReportsManagerPanel');
      $$('.rail-btn').forEach(b=>b.classList.remove('active'));
      $$('.view').forEach(v=>v.classList.remove('active'));
      const railBtn=document.querySelector('.rail-btn[data-view="reports"]');
      if(railBtn) railBtn.classList.add('active');
      const viewEl=safe('view-reports'); if(viewEl) viewEl.classList.add('active');
      // Show snapshot button active
      const showBtn=safe('showSnapshotOnMapBtn');
      if(showBtn){
        showBtn.classList.remove('hidden');
        showBtn.classList.add('active-snapshot');
        showBtn.dataset.snapshotActive='1';
        showBtn.textContent=`📍 מוצג: ${snapshot.dateLabel}`;
      }
      // Temporarily override reportCache rendering
      if(!map) return;
      Object.values(residentMarkers).forEach(m=>map.removeLayer(m));
      residentMarkers={};
      snapshot.reports.forEach(r=>{
        let lat=r.lat, lng=r.lng;
        if(r.street||r.house){ const local=lookupHouseCoords(r.street||'',r.house||''); if(local){lat=local.lat;lng=local.lng;} }
        if(!lat||!lng) return;
        const color=iconColor(dotClass(r.statuses||[]));
        const markerId='snap_'+r.id;
        residentMarkers[markerId]=L.marker([lat,lng],{icon:makeMarkerIcon(color)}).addTo(map);
        residentMarkers[markerId].bindPopup(popupHtml(`${r.city||''}, ${r.street||''} ${r.house||''}`,`${statusLabel(r.statuses||[])} · ${r.souls||0} נפשות`,r.note||''));
      });
      setTimeout(()=>map?.invalidateSize(),80);
    });
  });
}
