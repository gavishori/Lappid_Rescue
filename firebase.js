// Unified Firebase wrapper exposing the exact names script.js expects.
import { initializeApp } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-app.js";
import {
  getAuth,
  onAuthStateChanged,
  signOut,
  signInWithEmailAndPassword,
  createUserWithEmailAndPassword,
  sendPasswordResetEmail,
  setPersistence,
  browserLocalPersistence
} from "https://www.gstatic.com/firebasejs/10.12.2/firebase-auth.js";
import {
  initializeFirestore,
  setLogLevel,
  query,
  where,
  orderBy,
  limit,
  startAfter,
  serverTimestamp,
  deleteDoc,
  doc,
  getDoc,
  setDoc,
  updateDoc,
  onSnapshot,
  collection,
  addDoc,
  getDocs,
  enableNetwork,
  disableNetwork
} from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";

// --- CONFIG ---
const firebaseConfig = {
  apiKey: "AIzaSyArvkyWzgOmPjYYXUIOdilmtfrWt7WxK-0",
  authDomain: "travel-416ff.firebaseapp.com",
  projectId: "travel-416ff",
  storageBucket: "travel-416ff.appspot.com",
  messagingSenderId: "1032412697405",
  appId: "1:1032412697405:web:44c9d7c6c220a3e4a8e3a7"
};

export const app = initializeApp(firebaseConfig);
export const db  = initializeFirestore(app, { ignoreUndefinedProperties: true, experimentalAutoDetectLongPolling: true });
setLogLevel("error");

// --- AUTH ---
export const auth = getAuth(app);
// Persist across tabs & restarts
try { setPersistence(auth, browserLocalPersistence); } catch(e) { console.warn('setPersistence failed', e); }
// Convenience named exports (used in a few places)
export const onAuth = onAuthStateChanged;
export const signOutUser = () => signOut(auth);

// --- FB namespace matching script.js expectations ---
export const FB = {
  // db & auth handles
  db, auth,

  // auth API names as expected by script.js
  onAuthStateChanged,
  signInWithEmailAndPassword,
  createUserWithEmailAndPassword,
  sendPasswordResetEmail,
  signOut,

  // firestore API surface
  doc, getDoc, setDoc, updateDoc,
  collection, addDoc, getDocs,
  onSnapshot, query, where, orderBy, limit, startAfter,
  serverTimestamp,
  deleteDoc
};

// Network toggles (optional resilience)
window.addEventListener("offline", () => disableNetwork(db).catch(()=>{}));
window.addEventListener("online",  () => enableNetwork(db).catch(()=>{}));


// --- Hard sign-out: also wipe local caches so the next login truly switches accounts ---
export async function hardSignOut() {
  try { await signOut(auth); } catch(e) { console.warn('signOut err', e); }
  try {
    // Remove Firebase Auth localStorage shards
    if (typeof localStorage !== 'undefined') {
      for (let i=0; i<localStorage.length; i++) {
        const key = localStorage.key(i);
        if (key && key.startsWith('firebase:authUser:')) { try { localStorage.removeItem(key); } catch(_){} }
        if (key && key.startsWith('firebase:storedPersistence:')) { try { localStorage.removeItem(key); } catch(_){} }
        if (key && key.startsWith('firebase-heartbeat')) { try { localStorage.removeItem(key); } catch(_){} }
      }
    }
  } catch(e) { console.warn('localStorage cleanup err', e); }
  try { indexedDB && indexedDB.deleteDatabase && indexedDB.deleteDatabase('firebaseLocalStorageDb'); } catch(e) {}
  try { indexedDB && indexedDB.deleteDatabase && indexedDB.deleteDatabase('firebase-messaging-database'); } catch(e) {}
  // Optional: give Firestore network a moment to detach
  try { await new Promise(res=>setTimeout(res, 150)); } catch(_) {}
  return true;
}
/* ---- Global attach for legacy scripts that expect a global FB ---- */
try {
  window.FB = FB;
  window.auth = auth;
  window.db = db;
  window.hardSignOut = hardSignOut;
} catch (e) {
  // Ignore if window not available (SSR)
}
