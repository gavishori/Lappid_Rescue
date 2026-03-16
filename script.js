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
  _mem: new Map(),
  get (k, fb) { return this._mem.has(k) ? this._mem.get(k) : fb; },
  set (k, v)  { this._mem.set(k, v); }
};

const DEFAULT_EVENT_TYPES = ['ביטחוני','שריפה','נעדר','נפילת טיל'];
const DEFAULT_MANAGED_LAYERS = ['דיווחי תושבים','נקודות דיווח','מצלמות','הידרנטים','מספרי בתים'];
const DEFAULT_ACTIVE_LAYERS = ['דיווחי תושבים'];
const DEFAULT_INFO_BUTTONS = [
  { title: 'פיקוד העורף', url: 'https://www.oref.org.il/' },
  { title: 'מפת יישוב', url: '#' }
];

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

let eventTypes    = [...DEFAULT_EVENT_TYPES];
let managedLayers = [...DEFAULT_MANAGED_LAYERS];
let activeLayers  = new Set(DEFAULT_ACTIVE_LAYERS);
let managedInfoButtons = [...DEFAULT_INFO_BUTTONS];
let managedHouses = [];
let gpxItems      = [];
let rrmSnapshotsCache = [];
let editingHouseIndex = null;

function buildConfigPayload() {
  return {
    eventTypes,
    managedLayers: Array.from(new Set([...managedLayers, 'מספרי בתים'])),
    activeLayers: Array.from(activeLayers),
    infoButtons: managedInfoButtons,
    houses: managedHouses,
    gpxItems,
    updatedAt: serverTimestamp()
  };
}

function persistAll() {
  managedLayers = Array.from(new Set([...managedLayers, 'מספרי בתים']));
  activeLayers = new Set(Array.from(activeLayers).filter(Boolean));
  syncConfigToFirestore();
}

function syncConfigToFirestore() {
  if (!db) return Promise.resolve();
  _configLoaded = false;
  return setDoc(getConfigDoc(), buildConfigPayload(), { merge: true })
    .then(() => { _configLoaded = true; console.log('Config synced to Firestore'); })
    .catch(e => console.error('Failed to sync config to Firestore:', e));
}

function applyConfigData(d = {}) {
  if (Array.isArray(d.eventTypes) && d.eventTypes.length) eventTypes = d.eventTypes;
  else eventTypes = [...DEFAULT_EVENT_TYPES];

  if (Array.isArray(d.managedLayers) && d.managedLayers.length) managedLayers = d.managedLayers;
  else managedLayers = [...DEFAULT_MANAGED_LAYERS];
  managedLayers = Array.from(new Set([...managedLayers, 'מספרי בתים']));

  if (Array.isArray(d.activeLayers) && d.activeLayers.length) activeLayers = new Set(d.activeLayers);
  else activeLayers = new Set(DEFAULT_ACTIVE_LAYERS);

  if (Array.isArray(d.infoButtons)) managedInfoButtons = d.infoButtons;
  else managedInfoButtons = [...DEFAULT_INFO_BUTTONS];

  if (Array.isArray(d.houses)) managedHouses = d.houses;
  else managedHouses = [];

  if (Array.isArray(d.gpxItems)) gpxItems = d.gpxItems;
  else gpxItems = [];
}

async function loadConfigFromFirestore() {
  if (!db) return;
  try {
    const snap = await getDoc(getConfigDoc());
    if (!snap.exists()) {
      applyConfigData({});
      return;
    }
    applyConfigData(snap.data() || {});
  } catch (e) {
    console.warn('Failed to load config from Firestore:', e);
    applyConfigData({});
  }
}

let _configLoaded = false;
async function ensureConfigLoaded() {
  if (_configLoaded) return;
  await loadConfigFromFirestore();
  _configLoaded = true;
}

const getRrmSnapshotsCol = () => collection(db, `${publicDataRoot}/resident_report_snapshots`);
async function loadRrmSnapshotsFromFirestore() {
  if (!db) return [];
  try {
    const snap = await getDocs(getRrmSnapshotsCol());
    rrmSnapshotsCache = snap.docs
      .map(d => ({ id: d.id, ...d.data() }))
      .sort((a, b) => (b.ts || 0) - (a.ts || 0));
  } catch (e) {
    console.warn('Failed to load resident report snapshots:', e);
    rrmSnapshotsCache = [];
  }
  return rrmSnapshotsCache;
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
let activePaneMode          = null;

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
    renderGpxMarkers();
    setTimeout(() => map?.invalidateSize(), 80);
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
function populateGpxLayerSelect() {
  const sel = safe('gpxLayerType'); if (!sel) return;
  // Remove layers that are not upload targets
  const builtInNonGpx = new Set(['דיווחי תושבים', 'מספרי בתים']);
  const layerOptions = managedLayers.filter(l => !builtInNonGpx.has(l));
  // Fixed streets/excel option
  const STREETS_OPT = 'רחובות (אקסל)';
  const current = sel.value;
  sel.innerHTML = '<option value="">בחר שכבה...</option>'
    + '<optgroup label="── שכבות GPX ──">'
    + layerOptions.map(l => `<option value="${l}">${l}</option>`).join('')
    + '</optgroup>'
    + '<optgroup label="── קובץ נתונים ──">'
    + `<option value="${STREETS_OPT}">${STREETS_OPT}</option>`
    + '</optgroup>';
  const allOpts = [...layerOptions, STREETS_OPT];
  if (allOpts.includes(current)) sel.value = current;
}

function renderGpxList() {
  const wrap=safe('gpxList'); if(!wrap) return;
  const emptyHint = safe('gpxListEmpty');
  const countChip = safe('gpxCountChip');
  if (countChip) countChip.textContent = `${gpxItems.length} קבצים`;
  if (!gpxItems.length) {
    wrap.innerHTML = '';
    if (emptyHint) emptyHint.style.display = '';
    return;
  }
  if (emptyHint) emptyHint.style.display = 'none';
  const fileIcon = item => /\.(xlsx?|csv)$/i.test(item.name) ? '📊' : '📍';
  const pointsLabel = item => item.isStreets ? `${(item.data||[]).length} שורות` : `${(item.points||[]).length} נק׳`;
  wrap.innerHTML = gpxItems.map(item => `
    <div class="simple-item" data-gpx-id="${item.id}">
      <div class="item-main">
        <span class="gpx-item-name">${fileIcon(item)} ${item.type}</span>
        <span class="item-sub">${item.name} · ${pointsLabel(item)}</span>
      </div>
      <div class="item-actions">
        <button class="icon-btn rename-gpx" data-id="${item.id}" type="button" title="שנה שם שכבה">✏️</button>
        <button class="delete-btn remove-gpx" data-id="${item.id}" type="button">הסר</button>
      </div>
    </div>
    <div class="gpx-rename-row hidden" data-rename-id="${item.id}" style="display:none;gap:8px;padding:6px 0 8px;align-items:center">
      <select class="gpx-rename-select" style="flex:1;background:#0d2440;border:1px solid rgba(40,147,255,.5);border-radius:8px;color:#fff;padding:6px 10px;font-size:14px;font-family:inherit"></select>
      <button class="primary-btn gpx-rename-save" data-id="${item.id}" type="button" style="padding:6px 14px;font-size:13px">שמור</button>
      <button class="ghost-btn gpx-rename-cancel" data-id="${item.id}" type="button" style="padding:6px 14px;font-size:13px">ביטול</button>
    </div>
  `).join('');

  // Populate rename selects with managed layers
  const builtInNonGpx = new Set(['דיווחי תושבים', 'מספרי בתים']);
  const layerOptions = managedLayers.filter(l => !builtInNonGpx.has(l));

  $$('#gpxList .gpx-rename-select').forEach(sel => {
    sel.innerHTML = layerOptions.map(l => `<option value="${l}">${l}</option>`).join('');
  });

  $$('#gpxList .rename-gpx').forEach(b => b.onclick = () => {
    const id = b.dataset.id;
    const renameRow = wrap.querySelector(`.gpx-rename-row[data-rename-id="${id}"]`);
    if (!renameRow) return;
    const item = gpxItems.find(x => x.id === id);
    if (item) { const sel = renameRow.querySelector('.gpx-rename-select'); if (sel) sel.value = item.type; }
    renameRow.style.display = 'flex';
  });

  $$('#gpxList .gpx-rename-cancel').forEach(b => b.onclick = () => {
    const renameRow = wrap.querySelector(`.gpx-rename-row[data-rename-id="${b.dataset.id}"]`);
    if (renameRow) renameRow.style.display = 'none';
  });

  $$('#gpxList .gpx-rename-save').forEach(b => b.onclick = () => {
    const id = b.dataset.id;
    const renameRow = wrap.querySelector(`.gpx-rename-row[data-rename-id="${id}"]`);
    const newType = renameRow?.querySelector('.gpx-rename-select')?.value;
    if (!newType) return;
    const idx = gpxItems.findIndex(x => x.id === id);
    if (idx === -1) return;
    gpxItems[idx] = { ...gpxItems[idx], type: newType };
    persistAll();
    renderGpxList();
    populateGpxLayerSelect();
    renderGpxMarkers();
  });

  $$('#gpxList .remove-gpx').forEach(b => b.onclick = () => {
    gpxItems = gpxItems.filter(x => x.id !== b.dataset.id);
    persistAll();
    renderGpxList();
    populateGpxLayerSelect();
    renderGpxMarkers();
  });
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
  safe('openUploadsManagerBtn')?.addEventListener('click',()=>{ openModal('#uploadsPanel'); populateGpxLayerSelect(); renderGpxList(); });
  safe('openHousesManagerBtn')?.addEventListener('click',()=>openModal('#housesPanel'));
  safe('openLayersManagerBtn')?.addEventListener('click',()=>openModal('#layersManagerPanel'));
  safe('openInfoManagerBtn')?.addEventListener('click',()=>openModal('#infoManagerPanel'));
  safe('openEventTypesManagerBtn')?.addEventListener('click',()=>openModal('#eventTypesPanel'));
  safe('openJournalManagerBtn')?.addEventListener('click',()=>openModal('#journalManagerPanel'));
  safe('openResidentReportsManagerBtn')?.addEventListener('click', async ()=>{ openModal('#residentReportsManagerPanel'); updateRrmStats(); await loadRrmSnapshotsFromFirestore(); renderRrmSnapshots(); });
  safe('lockEventBtn')?.addEventListener('click',()=>openModal('#lockPanel'));

  // ── Resident Reports Excel Export ──
  safe('rrmExportExcelBtn')?.addEventListener('click', () => {
    const qs = window._reportQuestionsConfig || DEFAULT_REPORT_QUESTIONS;
    // Collect all custom question labels
    const customLabels = qs.filter(q => !q.builtin && !q.hidden).map(q => q.label);

    // Use live reportCache OR latest snapshot
    let reports = reportCache;
    if (!reports || !reports.length) {
      const latest = rrmSnapshotsCache[0];
      reports = latest?.reports || [];
    }
    if (!reports.length) { showCustomAlert('אין דיווחים לייצוא'); return; }

    const now = new Date();
    const dateStr = `${String(now.getDate()).padStart(2,'0')}/${String(now.getMonth()+1).padStart(2,'0')}/${now.getFullYear()} ${String(now.getHours()).padStart(2,'0')}:${String(now.getMinutes()).padStart(2,'0')}`;

    // Build header
    const headers = ['רחוב', 'מספר', 'יישוב', 'מצב', 'נפשות בבית', 'הערות', 'תאריך ושעת דיווח', ...customLabels];

    const rows = reports.map(r => {
      const statuses = (r.statuses || []).map(s => s === 'ok' ? 'תקין' : s === 'injury' ? 'פגיעה בנפש' : s === 'property' ? 'נזק לרכוש' : s).join(' + ') || 'לא צוין';
      const ts = r.updatedAt?.toDate ? r.updatedAt.toDate() : (r.createdAt?.toDate ? r.createdAt.toDate() : null);
      const tsStr = ts ? `${String(ts.getDate()).padStart(2,'0')}/${String(ts.getMonth()+1).padStart(2,'0')}/${ts.getFullYear()} ${String(ts.getHours()).padStart(2,'0')}:${String(ts.getMinutes()).padStart(2,'0')}` : '';
      const customVals = customLabels.map(lbl => r.customAnswers?.[lbl] ?? '');
      return [r.street || '', r.house || '', r.city || '', statuses, r.souls ?? 0, r.note || '', tsStr, ...customVals];
    });

    // Build CSV with BOM
    const escape = v => `"${String(v ?? '').replace(/"/g, '""')}"`;
    const csv = [headers, ...rows].map(row => row.map(escape).join(',')).join('\n');
    const blob = new Blob(['\uFEFF' + csv], { type: 'text/csv;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `דיווחי_תושבים_${now.getFullYear()}-${String(now.getMonth()+1).padStart(2,'0')}-${String(now.getDate()).padStart(2,'0')}.csv`;
    document.body.appendChild(a); a.click(); document.body.removeChild(a);
    URL.revokeObjectURL(url);
  });

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

  // ── Top mobile refresh button (above hamburger) ──
  safe('mobileTopRefreshBtn')?.addEventListener('click', () => {
    const btn = safe('mobileTopRefreshBtn');
    if(btn) { btn.classList.add('spinning'); setTimeout(()=>btn.classList.remove('spinning'), 700); }
    location.reload();
  });

  safe('toggleMapPaneBtn')?.addEventListener('click', () => togglePaneMode('map'));
  safe('toggleJournalPaneBtn')?.addEventListener('click', () => togglePaneMode('journal'));
  updatePaneToggleButtons();
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
    try {
      await addDoc(getRrmSnapshotsCol(), snapshot);
      await loadRrmSnapshotsFromFirestore();
      renderRrmSnapshots();
      showCustomAlert('הדיווחים נשמרו בהצלחה ✓');
    } catch (e) {
      showCustomAlert('שגיאה בשמירת הדיווחים: ' + e.message);
    }
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

// ── ITM (Israel Transverse Mercator / EPSG:2039) → WGS84 ──────────────────
// X = Easting (~100,000–300,000), Y = Northing (~400,000–900,000)
// Returns {lat, lng} in decimal degrees, or null if not ITM values
function itmToWgs84(x, y) {
  const xn = Number(x), yn = Number(y);
  if (!Number.isFinite(xn) || !Number.isFinite(yn)) return null;
  // ITM range check: X (easting) ~100k-350k, Y (northing) ~350k-900k
  const isITM = xn > 50000 && xn < 1300000 && yn > 50000 && yn < 1300000
             && !(xn >= -180 && xn <= 180 && yn >= -90 && yn <= 90);
  if (!isITM) return { lat: yn, lng: xn }; // already WGS84
  // Helmert / ITM→WGS84 (accurate to ~1m for Israel)
  const a = 6378137.0, f = 1/298.257222101; // GRS80
  const k0 = 1.0000067, E0 = 219529.584, N0 = 2885516.9488;
  const lat0 = 31.7343936111111 * Math.PI / 180;
  const lon0 = 35.2045169444444 * Math.PI / 180;
  const b = a * (1 - f);
  const e2 = 1 - (b*b)/(a*a);
  const ep2 = e2 / (1 - e2);
  const E = xn - E0, N = yn - N0;
  const n = (a - b)/(a + b);
  const n2 = n*n, n3 = n*n2, n4 = n*n3;
  const A0 = 1 - n + (5/4)*n2 - (5/4)*n3 + (81/64)*n4;
  const B0 = (3/2)*(n - n2 + (7/8)*n3 - (7/8)*n4);
  const C0 = (15/16)*(n2 - n3 + (55/64)*n4);
  const D0 = (35/48)*(n3 - n4);
  const M0 = a/(1+n)*(A0*lat0 - B0*Math.sin(2*lat0) + C0*Math.sin(4*lat0) - D0*Math.sin(6*lat0));
  const M = M0 + N/k0;
  const mu = M / (a/(1+n)*A0);
  const e1 = (1 - Math.sqrt(1-e2)) / (1 + Math.sqrt(1-e2));
  const J1 = (3/2)*e1 - (27/32)*e1*e1*e1;
  const J2 = (21/16)*e1*e1 - (55/32)*e1*e1*e1*e1;
  const J3 = (151/96)*e1*e1*e1;
  const J4 = (1097/512)*e1*e1*e1*e1;
  const fp = mu + J1*Math.sin(2*mu) + J2*Math.sin(4*mu) + J3*Math.sin(6*mu) + J4*Math.sin(8*mu);
  const ef2 = e2*Math.pow(Math.cos(fp),2)/(1-e2);
  const C1 = ep2*Math.pow(Math.cos(fp),2);
  const T1 = Math.pow(Math.tan(fp),2);
  const R1 = a*(1-e2)/Math.pow(1-e2*Math.pow(Math.sin(fp),2),1.5);
  const N1 = a/Math.sqrt(1-e2*Math.pow(Math.sin(fp),2));
  const D1 = E/(N1*k0);
  const lat = fp - (N1*Math.tan(fp)/R1)*(D1*D1/2 - (5+3*T1+10*C1-4*C1*C1-9*ep2)*D1*D1*D1*D1/24 + (61+90*T1+298*C1+45*T1*T1-252*ep2-3*C1*C1)*Math.pow(D1,6)/720);
  const lon = lon0 + (D1 - (1+2*T1+C1)*D1*D1*D1/6 + (5-2*C1+(28*T1)-3*C1*C1+8*ep2+24*T1*T1)*Math.pow(D1,5)/120) / Math.cos(fp);
  return { lat: lat * 180/Math.PI, lng: lon * 180/Math.PI };
}

// Extract street name — tries multiple common Hebrew column names
function extractStreetHebrew(row) {
  return extractCell(row, [
    'שם רחוב בעברית','שם רחוב','רחוב','street','street name','street_name','st',
    '__empty_1' // עמודה B בקובץ לפיד WGS84 (ללא כותרת)
  ]);
}
// Extract house number — tries multiple common column names
function extractHouseNumber(row) {
  return extractCell(row, [
    'מספר בית','מספר','מס בית','house','house number','house_number','number',
    '__empty_2' // עמודה C בקובץ לפיד WGS84 (ללא כותרת)
  ]);
}

async function importHousesFromExcel(file) {
  const status = safe('housesImportStatus');
  try {
    const data = await file.arrayBuffer();
    const wb = XLSX.read(data, {type:'array'});
    const sheet = wb.Sheets[wb.SheetNames[0]];
    const rows = XLSX.utils.sheet_to_json(sheet, {defval:''});
    const parsed = rows.map(row => {
      const street = extractStreetHebrew(row);
      const house  = extractHouseNumber(row);
      const rawX   = extractCell(row, ['x','lng','lon','long','longitude','קו אורך','אורך','קו אורך (wgs84)']);
      const rawY   = extractCell(row, ['y','lat','latitude','קו רוחב','רוחב','קו רוחב (wgs84)']);
      const coords = itmToWgs84(rawX, rawY);
      return { street, house, lat: coords?.lat ?? '', lng: coords?.lng ?? '' };
    }).filter(item => String(item.street ?? '').trim() && String(item.house ?? '').trim());

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

  // File input: show selected filename in label
  safe('gpxFileInput')?.addEventListener('change', () => {
    const f = safe('gpxFileInput').files?.[0];
    const disp = safe('uploadFileNameDisplay');
    if (disp) {
      if (f) { disp.textContent = f.name; disp.classList.add('has-file'); }
      else { disp.textContent = 'לא נבחר קובץ'; disp.classList.remove('has-file'); }
    }
  });

  safe('saveGpxBtn')?.addEventListener('click',async()=>{
    const file=safe('gpxFileInput').files?.[0];
    const layerType=safe('gpxLayerType')?.value;
    const errBox=safe('uploadFormError');
    if(errBox) errBox.classList.add('hidden');

    if(!layerType){ if(errBox){errBox.textContent='נא לבחור שכבה / סוג קובץ'; errBox.classList.remove('hidden');} return; }
    if(!file){ if(errBox){errBox.textContent='נא לבחור קובץ'; errBox.classList.remove('hidden');} return; }

    const isExcel = /\.(xlsx?|csv)$/i.test(file.name) || layerType === 'רחובות (אקסל)';

    if(isExcel){
      // Streets/coordinates Excel file → treat as streets lookup table
      try {
        const data = await file.arrayBuffer();
        const wb = XLSX.read(data, {type:'array'});
        const sheet = wb.Sheets[wb.SheetNames[0]];
        const rows = XLSX.utils.sheet_to_json(sheet, {defval:''});
        const streetData = rows.map(row => {
          const street = extractStreetHebrew(row);
          const house  = extractHouseNumber(row);
          const rawX   = extractCell(row, ['x','lng','lon','long','longitude','קו אורך','אורך','קו אורך (wgs84)']);
          const rawY   = extractCell(row, ['y','lat','latitude','קו רוחב','רוחב','קו רוחב (wgs84)']);
          const coords = itmToWgs84(rawX, rawY);
          return { street, house, x: coords?.lng, y: coords?.lat };
        }).filter(r => r.street && String(r.street).trim() && r.house && String(r.house).trim() && r.x && r.y);
        if (!streetData.length) {
          const sampleKeys = rows.length ? Object.keys(rows[0]).join(', ') : 'אין שורות';
          if(errBox){errBox.textContent=`לא נמצאו שורות תקינות. מפתחות בקובץ: ${sampleKeys}`; errBox.classList.remove('hidden');}
          return;
        }
        // Merge into managedHouses for resident-report coordinate matching
        let changed = 0;
        streetData.forEach(r => {
          if(r.house && (r.x || r.y)) {
            if(upsertHouse({street: r.street, house: r.house, lat: r.y, lng: r.x})) changed++;
          }
        });
        gpxItems.unshift({id:crypto.randomUUID(), type:layerType, name:file.name, isStreets:true, data:streetData, points:[]});
        persistAll(); renderGpxList(); renderGpxMarkers();
        syncStreetOptions(); renderHouses();
        safe('gpxFileInput').value='';
        const disp=safe('uploadFileNameDisplay'); if(disp){disp.textContent='לא נבחר קובץ';disp.classList.remove('has-file');}
        if(errBox){errBox.textContent=`✓ יובאו ${streetData.length} שורות מרחובות (${changed} בתים עודכנו)`;errBox.style.cssText='background:rgba(0,200,100,.12);border-color:rgba(0,200,100,.3);color:#5ef5a0';errBox.classList.remove('hidden');setTimeout(()=>errBox.classList.add('hidden'),4000);}
      } catch(e){
        console.error('Excel import error:', e);
        if(errBox){errBox.textContent=`שגיאה בקריאת האקסל: ${e?.message||e}`; errBox.classList.remove('hidden');}
      }
      return;
    }

    // GPX/XML file
    const text=await file.text();
    const xml=new DOMParser().parseFromString(text,'application/xml');
    const points=Array.from(xml.querySelectorAll('wpt')).map((wpt,i)=>({
      lat:Number(wpt.getAttribute('lat')), lng:Number(wpt.getAttribute('lon')),
      name:wpt.querySelector('name')?.textContent||`${layerType} ${i+1}`
    })).filter(p=>Number.isFinite(p.lat)&&Number.isFinite(p.lng));
    if(!points.length){
      if(errBox){errBox.textContent='לא נמצאו נקודות תקינות בקובץ GPX'; errBox.classList.remove('hidden');} return;
    }
    gpxItems.unshift({id:crypto.randomUUID(), type:layerType, name:file.name, points});
    persistAll(); renderGpxList(); renderGpxMarkers();
    safe('gpxFileInput').value='';
    const disp=safe('uploadFileNameDisplay'); if(disp){disp.textContent='לא נבחר קובץ';disp.classList.remove('has-file');}
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
  renderManagedLayers(); renderGpxList(); populateGpxLayerSelect(); renderHouses(); renderInfoAdmin(); renderEventTypes(); syncStreetOptions(); resetHouseForm(); renderLayersModal();
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
  const now = new Date();
  const pad = n => String(n).padStart(2,'0');
  const localDate = d => `${d.getFullYear()}-${pad(d.getMonth()+1)}-${pad(d.getDate())}`;
  const todayStr = localDate(now);
  const yest = new Date(now); yest.setDate(now.getDate() - 1);
  const yesterdayStr = localDate(yest);
  const validDates = new Set([todayStr, yesterdayStr]);
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
  const pad = n => String(n).padStart(2,'0');
  const localDate = d => `${d.getFullYear()}-${pad(d.getMonth()+1)}-${pad(d.getDate())}`;
  const todayStr = localDate(now);
  const yest = new Date(now); yest.setDate(now.getDate() - 1);
  const yesterdayStr = localDate(yest);
  const allowed = new Set([todayStr, yesterdayStr]);
  return data.filter(r => allowed.has(r.date));
}

function applyMobileReadOnlyMode() {
  const admin = safe('screen-admin');
  if (!admin) return;
  // readonly mode only for shared/public views — not for logged-in admin
  const isAdmin = hasJournalAccess(auth?.currentUser) && !isSharedLinkView;
  if (isMobileViewport()) {
    if (isAdmin) {
      admin.classList.remove('mobile-readonly-mode');
    } else {
      admin.classList.add('mobile-readonly-mode');
    }
  } else {
    admin.classList.remove('mobile-readonly-mode');
    activePaneMode = null;
    admin.classList.remove('pane-map-full', 'pane-journal-full');
  }
}

function togglePaneMode(which) {
  const admin = safe('screen-admin');
  if (!admin) return;
  activePaneMode = activePaneMode === which ? null : which;
  admin.classList.toggle('pane-map-full', activePaneMode === 'map');
  admin.classList.toggle('pane-journal-full', activePaneMode === 'journal');
  updatePaneToggleButtons();
  setTimeout(() => map?.invalidateSize(), 120);
}

function updatePaneToggleButtons() {
  const mapBtn = safe('toggleMapPaneBtn');
  const journalBtn = safe('toggleJournalPaneBtn');
  const isMapFull = activePaneMode === 'map';
  const isJournalFull = activePaneMode === 'journal';

  if (mapBtn) {
    mapBtn.textContent = isMapFull ? '⤡' : '⤢';
    mapBtn.setAttribute('aria-label', isMapFull ? 'החזר לפיצול רגיל' : 'הגדל את המפה');
    mapBtn.title = isMapFull ? 'החזר לפיצול רגיל' : 'הגדל את המפה';
  }
  if (journalBtn) {
    journalBtn.textContent = isJournalFull ? '⤡' : '⤢';
    journalBtn.setAttribute('aria-label', isJournalFull ? 'החזר לפיצול רגיל' : 'הגדל את היומן');
    journalBtn.title = isJournalFull ? 'החזר לפיצול רגיל' : 'הגדל את היומן';
  }
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
  if (isSharedLinkView) {
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
      const escapedTerm = String(term).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
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
        <td class="journal-table-td jt-hide-mobile-journal" style="text-align:center">
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
  // Desktop: fill main form
  const ta=safe('generalTextInput'); if(ta) ta.value=r.description;
  const rep=safe('filterReporter'); if(rep) rep.value=r.reporter;
  const lt=safe('filterLogType');   if(lt)  lt.value=r.logType;
  const dt=safe('newDate');         if(dt)  dt.value=r.date;
  const tm=safe('newTime');         if(tm)  tm.value=r.time;
  const mb=safe('mainActionBtn');   if(mb)  mb.textContent='עדכן';
  const cb=safe('cancelEditBtn');   if(cb)  cb.classList.remove('hidden');
  safe('dateTimeToggleLabel')?.classList.remove('hidden');
  // Mobile: open drawer
  if (isMobileViewport()) {
    openMobileJournalDrawer();
  } else {
    ta?.scrollIntoView({behavior:'smooth',block:'center'});
  }
}

// ── reporters (Firestore) ──────────────────────────────
function populateReportersDropdown(names) {
  const sel=safe('filterReporter'); if(!sel) return;
  const cur=sel.value;
  sel.innerHTML='<option value="">מדווח</option>';
  names.sort((a,b)=>a.localeCompare(b,'he')).forEach(n=>{ const o=document.createElement('option'); o.value=n; o.textContent=n; sel.appendChild(o); });
  sel.value=cur;
  // sync mobile drawer
  const mjdRep = safe('mjdReporter');
  if (mjdRep) { const mc=mjdRep.value; mjdRep.innerHTML=sel.innerHTML; if(mc) mjdRep.value=mc; }
}
function populateLogTypesDropdowns(arr) {
  const lt=safe('filterLogType'); if(lt){ const cv=lt.value; lt.innerHTML='<option value="">שיוך</option>'; arr.sort((a,b)=>a.name.localeCompare(b.name,'he')).forEach(x=>{ const o=document.createElement('option'); o.value=x.name; o.textContent=x.name; lt.appendChild(o); }); lt.value=cv;
    // sync mobile drawer
    const mjdLt = safe('mjdLogType'); if(mjdLt){ const mc=mjdLt.value; mjdLt.innerHTML=lt.innerHTML; if(mc) mjdLt.value=mc; }
  }
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
    if(snap.empty){ const batch=writeBatch(db); ["אורי","שונית","חיליק"].forEach(n=>{ const r=doc(reportersColRef); batch.set(r,{name:n}); }); await batch.commit(); }
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
      await batch.commit();
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
  con.style.display = 'flex';
  const today=new Date();
  const tk=`${today.getFullYear()}-${String(today.getMonth()+1).padStart(2,'0')}-${String(today.getDate()).padStart(2,'0')}`;
  const repToday=new Set(journalReports.filter(r=>r.date===tk).map(r=>r.logType));
  const order=["בטחוני","שריפה","נעדר","שגרה"];
  const sorted=[...definedLogTypes].sort((a,b)=>{ const ia=order.indexOf(a.name),ib=order.indexOf(b.name); if(ia===-1&&ib===-1) return a.name.localeCompare(b.name,'he'); if(ia===-1) return 1; if(ib===-1) return -1; return ia-ib; });
  if (!sorted.length) {
    con.style.display = 'none';
    return;
  }

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
  const now=new Date();
  const diff=(assessmentTime-now)/(1000*60);
  // Auto-reset to "טרם נקבע" when current time reaches or passes the set assessment time
  if(diff<=0){
    assessmentTimeIsManual=false;
    el.textContent='טרם נקבע'; el.classList.remove('blinking-red');
    if(mob){ mob.textContent='טרם נקבע'; mob.classList.remove('blinking-red'); }
    if(activeEventId && db){
      updateDoc(getEventDoc(activeEventId),{assessmentTimeIsManual:false,assessmentTime:null}).catch(()=>{});
    }
    return;
  }
  if(diff<=5){ el.classList.add('blinking-red'); if(mob) mob.classList.add('blinking-red'); }
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
      const fab = safe('mobileAdminFab'); if(fab) fab.style.display='none';
      firebaseAuthReadyResolve();
      return;
    }

    // show FAB for admin on mobile
    const fab = safe('mobileAdminFab');
    if(fab && !isSharedLinkView) fab.style.display = '';

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
        if(snap.size===0) await addDefaultReportersIfEmpty();
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
        if(snap.size===0) await addDefaultLogTypesIfEmpty();
        if(safe('tasksPanel')?.classList.contains('is-open')) renderTasksPanel(safe('tasksLogTypeDisplay')?.textContent||'');
      });
    }
  } else {
    currentUserId=null;
    const em=safe('headerUserEmail'); if(em) em.textContent='';
    teardownJournalAccess();
    setJournalLockedState(true);
    // hide FAB when logged out
    const fab = safe('mobileAdminFab'); if(fab) fab.style.display='none';
  }
  // refresh mobile layout based on new auth state
  applyMobileReadOnlyMode();
  firebaseAuthReadyResolve();
};

// ════════════════════════════════════════════════════════
//  RESIDENT REPORT FORM SETUP
// ════════════════════════════════════════════════════════
function applyReportQuestionsToForm() {
  const qs = Array.isArray(window._reportQuestionsConfig) && window._reportQuestionsConfig.length
    ? window._reportQuestionsConfig
    : (Array.isArray(reportQuestions) && reportQuestions.length ? reportQuestions : DEFAULT_REPORT_QUESTIONS);

  // Builtin sections
  const statusSection = document.querySelector('.rc-section-status')?.closest('.rc-row2') || document.querySelector('.rc-row2');
  const soulsSection = document.querySelector('.rc-section-souls');
  const statusSectionInner = document.querySelector('.rc-section-status');
  const noteSection = safe('freeText')?.closest('.rc-section');

  const qStatus  = qs.find(q => q.id === 'builtin_status');
  const qSouls   = qs.find(q => q.id === 'builtin_souls');
  const qNote    = qs.find(q => q.id === 'builtin_note');

  // Show/hide status block
  if (statusSectionInner) {
    statusSectionInner.style.display = (qStatus && qStatus.hidden) ? 'none' : '';
    const lbl = statusSectionInner.querySelector('.rc-label');
    if (lbl && qStatus) lbl.textContent = qStatus.label;
  }
  // Show/hide souls block
  if (soulsSection) {
    soulsSection.style.display = (qSouls && qSouls.hidden) ? 'none' : '';
    const lbl = soulsSection.querySelector('.rc-label');
    if (lbl && qSouls) lbl.textContent = qSouls.label;
  }
  // If both hidden, hide the entire row
  if (statusSection) {
    const bothHidden = (qStatus?.hidden) && (qSouls?.hidden);
    statusSection.style.display = bothHidden ? 'none' : '';
  }
  // Show/hide note
  if (noteSection) {
    noteSection.style.display = (qNote && qNote.hidden) ? 'none' : '';
    const lbl = noteSection.querySelector('.rc-label');
    if (lbl && qNote) lbl.textContent = qNote.label;
  }

  // Render custom questions
  const customContainer = safe('customQuestionsContainer');
  if (!customContainer) return;
  customContainer.innerHTML = '';

  const customQs = qs.filter(q => !q.builtin && !q.hidden);
  customQs.forEach(q => {
    const section = document.createElement('div');
    section.className = 'rc-section';
    section.dataset.qid = q.id;

    let inputHtml = '';
    if (q.type === 'text') {
      inputHtml = `<textarea class="rc-textarea cq-input" data-qid="${q.id}" rows="2" placeholder="${q.label}${q.required?' (חובה)':''}"></textarea>`;
    } else if (q.type === 'number') {
      inputHtml = `<input type="number" class="rc-textarea cq-input" data-qid="${q.id}" placeholder="0" style="max-width:120px" />`;
    } else if (q.type === 'yesno') {
      inputHtml = `<div style="display:flex;gap:10px">
        <button type="button" class="rc-pill cq-yesno cq-input" data-qid="${q.id}" data-val="כן">כן</button>
        <button type="button" class="rc-pill cq-yesno cq-input" data-qid="${q.id}" data-val="לא">לא</button>
      </div>`;
    } else if (q.type === 'select' && q.options) {
      inputHtml = `<select class="rc-select cq-input" data-qid="${q.id}" style="width:100%;max-width:300px">
        <option value="">בחר...</option>
        ${q.options.map(o => `<option value="${o}">${o}</option>`).join('')}
      </select>`;
    }

    section.innerHTML = `<span class="rc-label">${q.label}${q.required ? ' *' : ''}</span>${inputHtml}`;
    customContainer.appendChild(section);
  });

  // Yes/No toggle
  customContainer.querySelectorAll('.cq-yesno').forEach(btn => {
    btn.addEventListener('click', () => {
      const qid = btn.dataset.qid;
      customContainer.querySelectorAll(`.cq-yesno[data-qid="${qid}"]`).forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
    });
  });
}

function collectCustomAnswers() {
  const answers = {};
  const qs = window._reportQuestionsConfig || [];
  qs.filter(q => !q.builtin && !q.hidden).forEach(q => {
    if (q.type === 'yesno') {
      const active = document.querySelector(`.cq-yesno.active[data-qid="${q.id}"]`);
      answers[q.label] = active ? active.dataset.val : '';
    } else {
      const el = document.querySelector(`.cq-input[data-qid="${q.id}"]`);
      answers[q.label] = el ? (el.value || '') : '';
    }
  });
  return answers;
}

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

  // Apply question config to form
  applyReportQuestionsToForm();

  safe('submitBtn')?.addEventListener('click',async()=>{
    const err=safe('formError'); err.classList.add('hidden');
    const city=safe('city').value.trim()||'לפיד';
    const street=safe('street').value.trim(); const house=safe('house').value.trim();
    const souls2=+safe('soulsCount').value||0; const note=safe('freeText').value.trim();
    const qs = window._reportQuestionsConfig || DEFAULT_REPORT_QUESTIONS;
    const qStatus = qs.find(q => q.id === 'builtin_status');
    const statusRequired = qStatus ? (qStatus.required !== false && !qStatus.hidden) : true;
    if(!street){ err.textContent='נא להזין רחוב'; err.classList.remove('hidden'); return; }
    if(statusRequired && !currentStatus.length){ err.textContent='נא לבחור מצב'; err.classList.remove('hidden'); return; }
    // Validate required custom questions
    const customQs = qs.filter(q => !q.builtin && !q.hidden && q.required);
    for (const q of customQs) {
      const el = document.querySelector(`.cq-input[data-qid="${q.id}"]`);
      const yesnoActive = document.querySelector(`.cq-yesno.active[data-qid="${q.id}"]`);
      const val = q.type === 'yesno' ? (yesnoActive ? yesnoActive.dataset.val : '') : (el ? el.value.trim() : '');
      if (!val) { err.textContent = `נא למלא: ${q.label}`; err.classList.remove('hidden'); return; }
    }
    try {
      let coords=gpsCoords;
      if(locationType==='address') {
        coords = lookupHouseCoords(street, house) || null;
      }
      const customAnswers = collectCustomAnswers();
      const statuses = currentStatus.length ? currentStatus : (qStatus?.hidden ? [] : currentStatus);
      await submitVillageReport({city,street,house,souls:souls2,note,statuses,lat:coords?.lat||null,lng:coords?.lng||null,customAnswers});
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
      if(!assessmentTimeIsManual){
        // First press: round up to the next 5-minute mark from now
        const now = new Date();
        const mins = now.getMinutes();
        const nextMark = Math.ceil((mins + 1) / 5) * 5;
        assessmentTime = new Date(now);
        assessmentTime.setMinutes(nextMark);
        assessmentTime.setSeconds(0);
      } else {
        assessmentTime.setMinutes(assessmentTime.getMinutes()+5); 
        assessmentTime.setSeconds(0); 
      }
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
//  MOBILE ADMIN JOURNAL DRAWER (כפתור + צף)
// ════════════════════════════════════════════════════════
function openMobileJournalDrawer() {
  const drawer = safe('mobileJournalDrawer'); if (!drawer) return;
  drawer.classList.remove('hidden');
  // sync dropdowns from main dropdowns
  syncMobileDrawerDropdowns();
  // sync title & button state
  const fab = safe('mobileAdminFab');
  if (editingReportId) {
    if (safe('mjdTitle')) safe('mjdTitle').textContent = 'עריכת דיווח';
    if (safe('mjdSubmitBtn')) safe('mjdSubmitBtn').textContent = 'עדכן';
    if (safe('mjdCancelBtn')) safe('mjdCancelBtn').classList.remove('hidden');
    if (fab) fab.classList.add('is-editing');
    // fill drawer fields from editing state
    const r = journalReports.find(x => x.id === editingReportId);
    if (r) {
      if (safe('mjdText'))     safe('mjdText').value = r.description || '';
      if (safe('mjdReporter')) safe('mjdReporter').value = r.reporter || '';
      if (safe('mjdLogType'))  safe('mjdLogType').value = r.logType || '';
      if (safe('mjdDate'))     safe('mjdDate').value = r.date || '';
      if (safe('mjdTime'))     safe('mjdTime').value = r.time || '';
    }
  } else {
    if (safe('mjdTitle')) safe('mjdTitle').textContent = 'הזנת דיווח ליומן';
    if (safe('mjdSubmitBtn')) safe('mjdSubmitBtn').textContent = 'הזן דיווח';
    if (safe('mjdCancelBtn')) safe('mjdCancelBtn').classList.add('hidden');
    if (fab) fab.classList.remove('is-editing');
    // set default date/time
    const now = new Date();
    const d = `${now.getFullYear()}-${String(now.getMonth()+1).padStart(2,'0')}-${String(now.getDate()).padStart(2,'0')}`;
    const t = `${String(now.getHours()).padStart(2,'0')}:${String(now.getMinutes()).padStart(2,'0')}`;
    if (safe('mjdDate')) safe('mjdDate').value = d;
    if (safe('mjdTime')) safe('mjdTime').value = t;
    if (safe('mjdText')) safe('mjdText').value = '';
    if (safe('mjdError')) safe('mjdError').textContent = '';
    // restore last used reporter/logType
    setTimeout(() => {
      if (safe('mjdReporter') && lastReporter) safe('mjdReporter').value = lastReporter;
      if (safe('mjdLogType')  && lastLogType)  safe('mjdLogType').value  = lastLogType;
    }, 0);
  }
  setTimeout(() => safe('mjdText')?.focus(), 120);
}

function closeMobileJournalDrawer() {
  const drawer = safe('mobileJournalDrawer');
  if (drawer) drawer.classList.add('hidden');
  const fab = safe('mobileAdminFab');
  if (fab) fab.classList.remove('is-editing');
}

function syncMobileDrawerDropdowns() {
  // Sync reporter options
  const mjdRep = safe('mjdReporter');
  const mainRep = safe('filterReporter');
  if (mjdRep && mainRep) {
    const cur = mjdRep.value;
    mjdRep.innerHTML = mainRep.innerHTML;
    if (cur) mjdRep.value = cur;
  }
  // Sync logType options
  const mjdLt = safe('mjdLogType');
  const mainLt = safe('filterLogType');
  if (mjdLt && mainLt) {
    const cur = mjdLt.value;
    mjdLt.innerHTML = mainLt.innerHTML;
    if (cur) mjdLt.value = cur;
  }
}

async function submitMobileDrawer() {
  const desc = safe('mjdText')?.value.trim();
  const rep  = safe('mjdReporter')?.value;
  const lt   = safe('mjdLogType')?.value;
  const err  = safe('mjdError');
  if (!desc) { if (err) err.textContent = 'נא להזין תיאור דיווח'; return; }
  if (!rep)  { if (err) err.textContent = 'נא לבחור מדווח'; return; }
  if (!lt)   { if (err) err.textContent = 'נא לבחור שיוך'; return; }

  let date = safe('mjdDate')?.value;
  let time = safe('mjdTime')?.value;
  if (!date || !time) {
    const n = new Date();
    date = `${n.getFullYear()}-${String(n.getMonth()+1).padStart(2,'0')}-${String(n.getDate()).padStart(2,'0')}`;
    time = `${String(n.getHours()).padStart(2,'0')}:${String(n.getMinutes()).padStart(2,'0')}`;
  }
  if (!isValidTimeFormat(time)) { if (err) err.textContent = 'פורמט שעה שגוי (HH:MM)'; return; }
  if (err) err.textContent = '';
  lastReporter = rep;
  lastLogType  = lt;

  const btn = safe('mjdSubmitBtn');
  if (btn) { btn.disabled = true; btn.textContent = 'שומר...'; }

  try {
    if (editingReportId) {
      const existing = journalReports.find(r => r.id === editingReportId);
      if (!existing) { showCustomAlert('דיווח לא נמצא'); closeMobileJournalDrawer(); return; }
      const diff = (new Date() - new Date(existing.timestamp)) / (1000*60*60);
      if (diff >= 48) { showCustomAlert('לא ניתן לערוך דיווחים בני יותר מ-48 שעות'); closeMobileJournalDrawer(); return; }
      await setDoc(getReportDoc(editingReportId), {description:desc,date,time,reporter:rep,logType:lt}, {merge:true});
      lastAddedReportId = editingReportId;
      collapsedGroups.delete(date);
      editingReportId = null;
    } else {
      const payload = {description:desc, date, time, reporter:rep, logType:lt, creatorId:currentUserId, timestamp:new Date().toISOString()};
      const ref = await addDoc(reportsColRef, payload);
      lastAddedReportId = ref.id;
      collapsedGroups.delete(date);
    }
    closeMobileJournalDrawer();
  } catch(e) {
    if (err) err.textContent = 'שגיאה בשמירה: ' + e.message;
  } finally {
    if (btn) { btn.disabled = false; btn.textContent = editingReportId ? 'עדכן' : 'הזן דיווח'; }
  }
}

function setupMobileAdminDrawer() {
  // FAB button — open drawer
  safe('mobileAdminFab')?.addEventListener('click', () => openMobileJournalDrawer());

  // Close drawer
  safe('mjdCloseBtn')?.addEventListener('click', () => {
    closeMobileJournalDrawer();
    if (editingReportId) { editingReportId = null; }
  });
  safe('mjdBackdrop')?.addEventListener('click', () => {
    closeMobileJournalDrawer();
    if (editingReportId) { editingReportId = null; }
  });

  // Cancel edit
  safe('mjdCancelBtn')?.addEventListener('click', () => {
    editingReportId = null;
    closeMobileJournalDrawer();
  });

  // Submit
  safe('mjdSubmitBtn')?.addEventListener('click', submitMobileDrawer);

  // DateTime toggle
  safe('mjdShowDateTime')?.addEventListener('change', e => {
    safe('mjdDateTimeRow')?.classList.toggle('hidden', !e.target.checked);
  });
}

// ════════════════════════════════════════════════════════
//  REPORT QUESTIONS MANAGER
// ════════════════════════════════════════════════════════
// Default built-in questions (always shown, cannot be deleted, but label is editable)
const DEFAULT_REPORT_QUESTIONS = [
  { id: 'builtin_status',  label: 'מצב',           type: 'status',  builtin: true,  required: true,  hidden: false },
  { id: 'builtin_souls',   label: 'נפשות בבית',     type: 'counter', builtin: true,  required: false, hidden: false },
  { id: 'builtin_note',    label: 'פרטים נוספים',   type: 'text',    builtin: true,  required: false, hidden: false },
];

let reportQuestions = [];  // loaded from Firestore config
let _rqLoaded = false;

function getReportQuestionsFromConfig() {
  return Array.isArray(window._reportQuestionsConfig) ? window._reportQuestionsConfig : DEFAULT_REPORT_QUESTIONS;
}

async function loadReportQuestions() {
  if (!db) return;
  try {
    const snap = await getDoc(getConfigDoc());
    const data = snap.exists() ? snap.data() : {};
    if (Array.isArray(data.reportQuestions) && data.reportQuestions.length) {
      reportQuestions = data.reportQuestions;
    } else {
      reportQuestions = [...DEFAULT_REPORT_QUESTIONS];
    }
    window._reportQuestionsConfig = reportQuestions;
    _rqLoaded = true;
  } catch(e) {
    reportQuestions = [...DEFAULT_REPORT_QUESTIONS];
    window._reportQuestionsConfig = reportQuestions;
  }
}

async function saveReportQuestions() {
  window._reportQuestionsConfig = reportQuestions;
  if (!db) return;
  await setDoc(getConfigDoc(), { reportQuestions }, { merge: true }).catch(e => console.error('Failed to save report questions:', e));
}

function renderRqmList() {
  const wrap = safe('rqm-questions-list'); if (!wrap) return;
  if (!reportQuestions.length) { wrap.innerHTML = '<div style="color:#8da8c5;text-align:center;padding:12px">אין שאלות. הוסף למטה.</div>'; return; }

  wrap.innerHTML = reportQuestions.map((q, idx) => {
    const typeLabel = { status: 'מצב (מובנה)', counter: 'מונה (מובנה)', text: 'טקסט חופשי', select: 'בחירה', yesno: 'כן/לא', number: 'מספר' }[q.type] || q.type;
    const optStr = q.options ? ` · ${q.options.join(', ')}` : '';
    const isHidden = q.hidden === true;
    return `<div class="rqm-item" data-idx="${idx}" style="display:flex;align-items:center;gap:8px;padding:10px 12px;background:${isHidden?'#0d1e30':'#15304f'};border:1px solid ${isHidden?'rgba(255,255,255,.04)':'rgba(255,255,255,.08)'};border-radius:12px;opacity:${isHidden?'0.55':'1'}">
      <div style="flex:1">
        <div style="display:flex;align-items:center;gap:8px">
          <span style="font-weight:700;color:#eef5ff;font-size:14px;${isHidden?'text-decoration:line-through;color:#8da8c5':''}">${q.label}</span>
          ${q.required && !isHidden ? '<span style="color:#f4c246;font-size:11px">(חובה)</span>' : ''}
          ${q.builtin ? '<span style="color:#7ec8ff;font-size:11px;background:rgba(40,147,255,.15);padding:2px 6px;border-radius:6px">מובנה</span>' : ''}
          ${isHidden ? '<span style="color:#8da8c5;font-size:11px;background:rgba(255,255,255,.07);padding:2px 6px;border-radius:6px">מוסתר</span>' : ''}
        </div>
        <div style="color:#8da8c5;font-size:12px;margin-top:2px">${typeLabel}${optStr}</div>
      </div>
      <div style="display:flex;gap:6px;flex-shrink:0">
        ${!q.builtin && idx > 0 && !isHidden ? `<button class="icon-btn rqm-up" data-idx="${idx}" type="button" title="הזז למעלה">↑</button>` : ''}
        ${!q.builtin && idx < reportQuestions.length - 1 && !isHidden ? `<button class="icon-btn rqm-down" data-idx="${idx}" type="button" title="הזז למטה">↓</button>` : ''}
        <button class="icon-btn rqm-toggle-hidden" data-idx="${idx}" type="button" style="font-size:12px;padding:4px 8px;background:${isHidden?'rgba(40,147,255,.2)':'rgba(255,255,255,.06)'};border:1px solid ${isHidden?'rgba(40,147,255,.5)':'rgba(255,255,255,.1)'};color:${isHidden?'#7ec8ff':'#8da8c5'}" title="${isHidden?'הצג בטופס':'הסתר מהטופס'}">${isHidden ? '👁 הצג' : '🙈 הסתר'}</button>
        <button class="icon-btn rqm-edit" data-idx="${idx}" type="button" style="font-size:12px;padding:4px 8px">ערוך</button>
        ${!q.builtin ? `<button class="delete-btn rqm-del" data-idx="${idx}" type="button" style="font-size:12px;padding:4px 8px">מחק</button>` : ''}
      </div>
    </div>
    <div class="rqm-edit-row" data-edit-idx="${idx}" style="display:none;padding:10px 12px;background:#0d2440;border:1px solid rgba(40,147,255,.4);border-radius:12px;flex-direction:column;gap:8px">
      <div style="display:flex;gap:8px;flex-wrap:wrap">
        <input class="rqm-edit-label" value="${q.label}" style="flex:1;min-width:140px;background:#15304f;border:1px solid rgba(40,147,255,.5);border-radius:8px;color:#fff;padding:6px 10px;font-size:14px;font-family:inherit" />
        ${!q.builtin ? `<select class="rqm-edit-type" style="background:#15304f;border:1px solid rgba(40,147,255,.4);border-radius:8px;color:#fff;padding:6px 8px;font-size:13px;font-family:inherit">
          <option value="text" ${q.type==='text'?'selected':''}>טקסט חופשי</option>
          <option value="select" ${q.type==='select'?'selected':''}>בחירה מרשימה</option>
          <option value="yesno" ${q.type==='yesno'?'selected':''}>כן / לא</option>
          <option value="number" ${q.type==='number'?'selected':''}>מספר</option>
        </select>` : ''}
        <label style="display:flex;align-items:center;gap:5px;color:#8da8c5;font-size:13px;cursor:pointer">
          <input type="checkbox" class="rqm-edit-required" ${q.required ? 'checked' : ''} ${q.builtin && q.type === 'status' ? 'disabled' : ''} /> חובה
        </label>
      </div>
      ${!q.builtin ? `<input class="rqm-edit-options" value="${(q.options||[]).join(', ')}" placeholder="אפשרויות מופרדות בפסיק (רק לסוג 'בחירה')" style="background:#15304f;border:1px solid rgba(40,147,255,.3);border-radius:8px;color:#fff;padding:6px 10px;font-size:13px;font-family:inherit;width:100%;box-sizing:border-box" />` : ''}
      <div style="display:flex;gap:8px">
        <button class="primary-btn rqm-edit-save" data-idx="${idx}" type="button" style="padding:6px 16px;font-size:13px">שמור</button>
        <button class="ghost-btn rqm-edit-cancel" data-idx="${idx}" type="button" style="padding:6px 14px;font-size:13px">ביטול</button>
      </div>
    </div>`;
  }).join('');

  // Bind events
  wrap.querySelectorAll('.rqm-toggle-hidden').forEach(b => b.onclick = async () => {
    const i = +b.dataset.idx;
    reportQuestions[i].hidden = !reportQuestions[i].hidden;
    // if making status required+hidden, un-require it
    if (reportQuestions[i].hidden && reportQuestions[i].id === 'builtin_status') {
      reportQuestions[i].required = false;
    }
    await saveReportQuestions(); renderRqmList(); applyReportQuestionsToForm();
  });
  wrap.querySelectorAll('.rqm-up').forEach(b => b.onclick = async () => {
    const i = +b.dataset.idx;
    [reportQuestions[i-1], reportQuestions[i]] = [reportQuestions[i], reportQuestions[i-1]];
    await saveReportQuestions(); renderRqmList(); applyReportQuestionsToForm();
  });
  wrap.querySelectorAll('.rqm-down').forEach(b => b.onclick = async () => {
    const i = +b.dataset.idx;
    [reportQuestions[i], reportQuestions[i+1]] = [reportQuestions[i+1], reportQuestions[i]];
    await saveReportQuestions(); renderRqmList(); applyReportQuestionsToForm();
  });
  wrap.querySelectorAll('.rqm-del').forEach(b => b.onclick = async () => {
    reportQuestions.splice(+b.dataset.idx, 1);
    await saveReportQuestions(); renderRqmList(); applyReportQuestionsToForm();
  });
  wrap.querySelectorAll('.rqm-edit').forEach(b => b.onclick = () => {
    const idx = +b.dataset.idx;
    wrap.querySelectorAll('.rqm-edit-row').forEach(r => r.style.display = 'none');
    const editRow = wrap.querySelector(`.rqm-edit-row[data-edit-idx="${idx}"]`);
    if (editRow) editRow.style.display = 'flex';
  });
  wrap.querySelectorAll('.rqm-edit-cancel').forEach(b => b.onclick = () => {
    wrap.querySelectorAll('.rqm-edit-row').forEach(r => r.style.display = 'none');
  });
  wrap.querySelectorAll('.rqm-edit-save').forEach(b => b.onclick = async () => {
    const idx = +b.dataset.idx;
    const editRow = wrap.querySelector(`.rqm-edit-row[data-edit-idx="${idx}"]`);
    if (!editRow) return;
    const newLabel = editRow.querySelector('.rqm-edit-label')?.value.trim();
    if (!newLabel) return;
    const q = reportQuestions[idx];
    q.label = newLabel;
    const typeEl = editRow.querySelector('.rqm-edit-type');
    if (typeEl) q.type = typeEl.value;
    const reqEl = editRow.querySelector('.rqm-edit-required');
    if (reqEl) q.required = reqEl.checked;
    const optEl = editRow.querySelector('.rqm-edit-options');
    if (optEl && q.type === 'select') {
      q.options = optEl.value.split(',').map(s => s.trim()).filter(Boolean);
    } else if (q.type !== 'select') {
      delete q.options;
    }
    await saveReportQuestions();
    renderRqmList();
    applyReportQuestionsToForm();
  });
}

function setupReportQuestionsManager() {
  // Load questions and bind open button
  loadReportQuestions().then(() => renderRqmList());

  safe('openReportQuestionsManagerBtn')?.addEventListener('click', async () => {
    await loadReportQuestions();
    renderRqmList();
    openModal('#reportQuestionsManagerPanel');
  });

  // Close panel
  safe('reportQuestionsManagerPanel')?.addEventListener('click', e => {
    if (e.target === safe('reportQuestionsManagerPanel')) closeModal('#reportQuestionsManagerPanel');
  });
  safe('reportQuestionsManagerPanel')?.querySelector('[data-close="#reportQuestionsManagerPanel"]')
    ?.addEventListener('click', () => closeModal('#reportQuestionsManagerPanel'));

  // Type change: show/hide options field
  safe('rqmNewType')?.addEventListener('change', () => {
    const t = safe('rqmNewType').value;
    const row = safe('rqmOptionsRow');
    if (row) row.style.display = t === 'select' ? 'block' : 'none';
  });

  safe('rqmSaveBtn')?.addEventListener('click', async () => {
    const errEl = safe('rqmError');
    if (errEl) errEl.textContent = '';
    window._reportQuestionsConfig = [...reportQuestions];
    await saveReportQuestions();
    renderRqmList();
    applyReportQuestionsToForm();
    showCustomAlert('השאלות נשמרו');
  });

  // Add question
  safe('rqmAddQuestionBtn')?.addEventListener('click', async () => {
    const label = safe('rqmNewLabel')?.value.trim();
    const type  = safe('rqmNewType')?.value || 'text';
    const required = safe('rqmNewRequired')?.checked || false;
    const errEl = safe('rqmError');
    if (!label) { if (errEl) errEl.textContent = 'נא להזין תווית לשאלה'; return; }
    if (errEl) errEl.textContent = '';
    const newQ = { id: `q_${Date.now()}`, label, type, required };
    if (type === 'select') {
      const opts = safe('rqmOptionsInput')?.value.split(',').map(s => s.trim()).filter(Boolean);
      if (!opts || !opts.length) { if (errEl) errEl.textContent = 'נא להזין אפשרויות לבחירה'; return; }
      newQ.options = opts;
    }
    reportQuestions.push(newQ);
    window._reportQuestionsConfig = [...reportQuestions];
    await saveReportQuestions();
    renderRqmList();
    applyReportQuestionsToForm();
    applyReportQuestionsToForm();
    if (safe('rqmNewLabel')) safe('rqmNewLabel').value = '';
    if (safe('rqmOptionsInput')) safe('rqmOptionsInput').value = '';
    if (safe('rqmNewRequired')) safe('rqmNewRequired').checked = false;
    const optRow = safe('rqmOptionsRow'); if (optRow) optRow.style.display = 'none';
    const typeEl = safe('rqmNewType'); if (typeEl) typeEl.value = 'text';
  });
}

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
  setupMobileAdminDrawer();
  setupReportQuestionsManager();
  setDefaultDateTime();
  resetForm();
  // assessmentTime remains "טרם נקבע" (assessmentTimeIsManual=false) until + is pressed
  setInterval(updateCurrentTime, 1000);
  setInterval(updateAssessmentDisplay, 1000);
  await getOrCreateActiveEvent();
  await subscribeVillageReports();
  await subscribeActiveEvent();

  // הצג/הסתר FAB בהתאם לסטטוס התחברות
  const fab = safe('mobileAdminFab');
  if (fab) fab.style.display = (!sharedOnly && hasJournalAccess(auth?.currentUser)) ? '' : 'none';

  if(sharedOnly) {
    const rail=safe('screen-admin')?.querySelector('.side-rail'); if(rail) rail.style.display='none';
    const lb=safe('lockEventBtn'); if(lb) lb.style.display='none';
    const topBar = document.querySelector('.journal-top-bar'); if(topBar) topBar.style.display='none';
    const logoutDesktop = safe('logoutBtn'); if(logoutDesktop) logoutDesktop.style.display='none';
    const logoutMobile = safe('mobileLogoutBtn'); if(logoutMobile) logoutMobile.style.display='none';
    const plusBtn = safe('assessmentTimePlusBtn'); if(plusBtn) plusBtn.style.display='none';
    const minusBtn = safe('assessmentTimeMinusBtn'); if(minusBtn) minusBtn.style.display='none';
    const emailEl = safe('headerUserEmail'); if (emailEl) emailEl.style.display='none';
    const inputBox = document.querySelector('.journal-input-box'); if (inputBox) inputBox.style.display='none';
    if (fab) fab.style.display = 'none';

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

  const splash = document.getElementById('loading-splash');
  let splashHidden = false;
  const hideSplash = () => {
    if (splashHidden || !splash) return;
    splashHidden = true;
    splash.style.display = 'none';
    document.body.classList.add('app-ready');
  };
  const splashTimeout = setTimeout(hideSplash, 2500);
  window.addEventListener('load', hideSplash, { once: true });

  try {
    if(!auth||!db){
      const em=safe('loginErrorMessage'); if(em) em.textContent='שגיאה: Firebase לא אותחל';
      await bootAdmin(false);
      return;
    }

    onAuthStateChanged(auth, handleAuthState);

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

    if (!SHARE_TOKEN && MODE !== 'report' && !REPORT_KEY) {
      await ensureConfigLoaded();
      await bootAdmin(false);
      hideSplash();
    }

    if(!auth.currentUser && initialAuthToken) {
      try { await signInWithCustomToken(auth, initialAuthToken); } catch(e) { console.error('Auto sign-in error:', e); }
    }

    const needsPublicSession = Boolean(SHARE_TOKEN || MODE === 'report' || REPORT_KEY);
    if (needsPublicSession && !auth.currentUser) {
      if (!reportsColRef) reportsColRef = collection(db, `${publicDataRoot}/reports`);
      firebaseAuthReadyResolve();
    }

    await Promise.race([
      firebaseAuthReady,
      new Promise(r => setTimeout(r, 1200))
    ]);

    hideSplash();

    if (SHARE_TOKEN) {
      await ensureConfigLoaded();
      const shareInfo = await verifyShareToken(SHARE_TOKEN);
      if (!shareInfo?.eventId) { document.body.innerHTML='<div style="padding:40px;text-align:center;color:#eef5ff;direction:rtl;font-family:Heebo,sans-serif;font-size:20px">הקישור לא תקף או פג תוקפו.</div>'; return; }
      activeEventId = shareInfo.eventId;
      if (shareInfo.type === 'journal') {
        if (!reportsColRef) reportsColRef = collection(db, `${publicDataRoot}/reports`);
        await bootJournalReadOnly(activeEventId);
      } else {
        await bootAdmin(true);
      }
      return;
    }

    if (MODE==='report'||REPORT_KEY) {
      await ensureConfigLoaded();
      safe('screen-report')?.classList.add('active');
      safe('screen-admin')?.classList.remove('active');

      const housesParam = params.get('houses');
      if (housesParam) {
        try {
          const packed = JSON.parse(decodeURIComponent(escape(atob(housesParam))));
          if (Array.isArray(packed) && packed.length) {
            managedHouses = packed.map(h => ({ street: h.s || '', house: h.n || '' }));
          }
        } catch(e) { console.warn('Could not decode houses from URL:', e); }
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
  } catch (e) {
    console.error('App boot error:', e);
    const em=safe('loginErrorMessage'); if(em) em.textContent='שגיאה באתחול המערכת';
    try { await bootAdmin(false); } catch(_) {}
  } finally {
    clearTimeout(splashTimeout);
    hideSplash();
  }
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

  // Update journal top-bar resident status
  set('rsbTotal',    total);
  set('rsbOk',       ok);
  set('rsbInjury',   injury);
  set('rsbProperty', property);
  set('rsbNoReply',  noReply);
  const rsb = safe('residentStatusBar');
  if (rsb) rsb.classList.remove('hidden');
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

function exportSnapshotToExcel(snapshot) {
  const qs = window._reportQuestionsConfig || DEFAULT_REPORT_QUESTIONS;
  const reports = snapshot.reports || [];
  if (!reports.length) { showCustomAlert('אין דיווחים בסנפשוט זה'); return; }

  // Collect all unique custom-answer keys from this snapshot's reports
  const customKeysSet = new Set();
  reports.forEach(r => { if (r.customAnswers) Object.keys(r.customAnswers).forEach(k => customKeysSet.add(k)); });
  // Order: prefer question order from config, then anything extra
  const configLabels = qs.filter(q => !q.builtin).map(q => q.label);
  const customKeys = [...configLabels.filter(l => customKeysSet.has(l)), ...[...customKeysSet].filter(l => !configLabels.includes(l))];

  const headers = ['רחוב', 'מספר', 'יישוב', 'מצב', 'נפשות בבית', 'הערות', 'תאריך ושעת דיווח', ...customKeys];
  const rows = reports.map(r => {
    const statuses = (r.statuses || []).map(s => s === 'ok' ? 'תקין' : s === 'injury' ? 'פגיעה בנפש' : s === 'property' ? 'נזק לרכוש' : s).join(' + ') || 'לא צוין';
    const ts = r.updatedAt?.toDate ? r.updatedAt.toDate() : (r.createdAt?.toDate ? r.createdAt.toDate() : null);
    const tsStr = ts ? `${String(ts.getDate()).padStart(2,'0')}/${String(ts.getMonth()+1).padStart(2,'0')}/${ts.getFullYear()} ${String(ts.getHours()).padStart(2,'0')}:${String(ts.getMinutes()).padStart(2,'0')}` : '';
    const customVals = customKeys.map(k => r.customAnswers?.[k] ?? '');
    return [r.street || '', r.house || '', r.city || '', statuses, r.souls ?? 0, r.note || '', tsStr, ...customVals];
  });

  const escape = v => `"${String(v ?? '').replace(/"/g, '""')}"`;
  const csv = [headers, ...rows].map(row => row.map(escape).join(',')).join('\n');
  const blob = new Blob(['\uFEFF' + csv], { type: 'text/csv;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  const safeLabel = (snapshot.dateLabel || 'snapshot').replace(/[/:]/g, '-');
  a.download = `דיווחי_תושבים_${safeLabel}.csv`;
  document.body.appendChild(a); a.click(); document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

function renderRrmSnapshots() {
  const wrap = safe('rrmSnapshotsList'); if(!wrap) return;
  const snapshots = Array.isArray(rrmSnapshotsCache) ? rrmSnapshotsCache : [];
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
      <div style="display:flex;gap:6px;flex-shrink:0">
        <button class="rrm-snapshot-show-btn" data-idx="${idx}" type="button">הצג על המפה</button>
        <button class="rrm-snapshot-export-btn" data-idx="${idx}" type="button" style="background:rgba(40,180,80,.15);border:1px solid rgba(40,180,80,.4);color:#6fbf7a;border-radius:8px;padding:5px 10px;font-size:12px;cursor:pointer;font-family:inherit">📊 אקסל</button>
      </div>
    </div>
  `).join('');

  wrap.querySelectorAll('.rrm-snapshot-export-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      const idx = +btn.dataset.idx;
      const snapshot = snapshots[idx];
      if (!snapshot || !snapshot.reports) { showCustomAlert('אין נתונים לייצוא'); return; }
      exportSnapshotToExcel(snapshot);
    });
  });

  wrap.querySelectorAll('.rrm-snapshot-show-btn').forEach(btn=>{
    btn.addEventListener('click',()=>{
      const idx=+btn.dataset.idx;
      const snapshot=snapshots[idx]; if(!snapshot||!snapshot.reports) return;
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
        // Build popup with original question answers from snapshot
        let extraHtml = r.note ? `<div style='color:#8da8c5;margin-top:4px'>${r.note}</div>` : '';
        if (r.customAnswers && typeof r.customAnswers === 'object') {
          const answerLines = Object.entries(r.customAnswers)
            .filter(([,v]) => v !== '' && v != null)
            .map(([label, val]) => `<div style='color:#b0d4f7;font-size:12px;margin-top:2px'><span style='color:#8da8c5'>${label}:</span> ${val}</div>`)
            .join('');
          if (answerLines) extraHtml += `<div style='margin-top:6px;border-top:1px solid rgba(255,255,255,.1);padding-top:6px'>${answerLines}</div>`;
        }
        residentMarkers[markerId].bindPopup(`<div style="direction:rtl;font-family:Heebo,sans-serif"><strong>${r.city||''}, ${r.street||''} ${r.house||''}</strong><div>${statusLabel(r.statuses||[])} · ${r.souls||0} נפשות</div>${extraHtml}</div>`);
      });
      setTimeout(()=>map?.invalidateSize(),80);
    });
  });
}