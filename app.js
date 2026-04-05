// --- Helper: strip links (for Word export) ---
function stripLinks(text){
  try{
    if(text==null) return '';
    let s = String(text);
    s = s.replace(/<a\b[^>]*>([\s\S]*?)<\/a>/gi, '$1'); // remove anchors keep text
    s = s.replace(/\bhttps?:\/\/\S+/gi, ''); // remove raw urls
    s = s.replace(/\bwww\.[^\s)]+/gi, '');    // remove www.*
    s = s.replace(/[ \t]{2,}/g, ' ').replace(/\n{3,}/g, '\n\n').trim();
    return s;
  }catch(e){ return (text||''); }
}

var importGPXFromFile, importGPXAsTrek;
// === Auth Button Toggle (Login <-> Logout) ===
function legacyWireAuthPrimaryButton(){
  const btn = document.getElementById('btnLogin'); // header primary button
  if(!btn) return;
  if(btn.dataset.authWired==='1') return;
  btn.dataset.authWired='1';
  const doLogout = async (e)=>{
    try{ e?.preventDefault?.(); e?.stopPropagation?.(); }catch(_){ }

    try{
      if(typeof hardSignOut==='function'){ await hardSignOut(); }
      else if(typeof FB!=='undefined' && typeof FB.signOut==='function'){ await FB.signOut(FB.auth); }
      else if(typeof signOutUser==='function'){ await signOutUser(); }
      else if(typeof FB?.auth?.signOut==='function'){ await FB.auth.signOut(); }
    }catch(err){ console.error('primary logout failed', err); }
    try { window.state = globalThis.state = { trips: [], current: null, currentTripId: null, user: null, maps: {}, filters: {}, shared: {}, rates: {}, categories: {} }; } catch(_) {}
    try { sessionStorage.clear(); } catch(_) {}
    try { localStorage.removeItem('activeTripId'); } catch(_) {}
    // Force a hard reload with a cache-busting query so Firestore listeners fully reset
    try { location.replace(location.pathname + '?logout=' + Date.now()); } catch(_) { location.reload(); }
};
  // Swap handlers on auth changes
  window.__authPrimarySwap = (loggedIn)=>{
    const old = document.getElementById('btnLogin');
    if(!old) return;
    const clone = old.cloneNode(true);
    old.parentNode.replaceChild(clone, old);
    const target = document.getElementById('btnLogin');
    if(!target) return;
    if(loggedIn){
      target.textContent = 'ניתוק';
      target.classList.add('danger');
      target.addEventListener('click', doLogout, {passive:false});
    } else {
      target.textContent = 'התחברות';
      target.classList.remove('danger');
    }
  };
}
function isCompactMobileHeader(){
  return window.matchMedia('(max-width: 820px)').matches;
}

function isMobileViewport(){
  return /Android|iPhone|iPad|iPod/i.test(navigator.userAgent || '') || window.innerWidth <= 820;
}

function syncViewportModeClasses(){
  try{
    const isMobile = isMobileViewport();
    document.body.classList.toggle('mobile-ui', !!isMobile);
    document.body.classList.toggle('desktop-ui', !isMobile);
    document.body.classList.toggle('mobile-shell-v2', !!isMobile);
  }catch(_){ }
}

function normalizeMobileOverviewHeader(){
  try{
    const tabs = document.getElementById('tabs');
    const headerBar = document.getElementById('overviewHeaderBar');
    const overviewHidden = !document.getElementById('view-overview') || document.getElementById('view-overview').hidden;

    if(!isMobileViewport()){
      if(tabs) tabs.classList.remove('mobile-tabs-compact');
      if(headerBar) headerBar.hidden = overviewHidden;
      return;
    }

    if(tabs) tabs.classList.add('mobile-tabs-compact');
    if(headerBar) headerBar.hidden = true;
  }catch(err){
    console.error('normalizeMobileOverviewHeader failed', err);
  }
}

function purgeOverviewNavSelect(){
  try{
    const wrap = document.querySelector('.tab-select-wrap[data-tab="overview"]')
      || document.getElementById('overviewTabSelect')?.closest('.tab-select-wrap');
    const select = document.getElementById('overviewTabSelect');
    if(wrap){
      try{ wrap.remove(); }catch(_){
        wrap.style.display = 'none';
        wrap.setAttribute('aria-hidden', 'true');
      }
    }
    if(select && !wrap){
      try{ select.remove(); }catch(_){
        select.style.display = 'none';
        select.setAttribute('aria-hidden', 'true');
      }
    }
  }catch(_){}
}

function ensureOverviewNavSelectRemoved(){
  try{
    purgeOverviewNavSelect();
    if(window.__overviewNavSelectObserverBound) return;
    const root = document.body || document.documentElement;
    if(!root || typeof MutationObserver === 'undefined') return;
    const obs = new MutationObserver(()=> purgeOverviewNavSelect());
    obs.observe(root, { childList:true, subtree:true });
    window.__overviewNavSelectObserverBound = '1';
  }catch(_){}
}

function ensureBudgetSummaryDialog(){
  let dlg = document.getElementById('budgetSummaryDialog');
  if(dlg) return dlg;
  dlg = document.createElement('dialog');
  dlg.id = 'budgetSummaryDialog';
  dlg.className = 'modal budget-summary-dialog';
  dlg.innerHTML = `
    <header><strong>תקציב נסיעה</strong></header>
    <div class="body" id="budgetSummaryDialogBody"></div>
    <div class="footer">
      <button type="button" class="btn" id="budgetSummaryDialogClose">סגור</button>
    </div>
  `;
  document.body.appendChild(dlg);
  dlg.querySelector('#budgetSummaryDialogClose')?.addEventListener('click', ()=> dlg.close());
  dlg.addEventListener('click', (ev)=>{ if(ev.target === dlg) dlg.close(); });
  return dlg;
}

function openBudgetSummaryDialog(payload){
  const dlg = ensureBudgetSummaryDialog();
  const body = dlg.querySelector('#budgetSummaryDialogBody');
  if(!body) return;
  body.innerHTML = `
    <div class="budget-dialog-currencies">
      <button type="button" class="btn budget-currency-option ${payload.cur === 'ILS' ? 'active' : ''}" data-budget-currency="ILS">₪</button>
      <button type="button" class="btn budget-currency-option ${payload.cur === 'USD' ? 'active' : ''}" data-budget-currency="USD">$</button>
      <button type="button" class="btn budget-currency-option ${payload.cur === 'EUR' ? 'active' : ''}" data-budget-currency="EUR">€</button>
    </div>
    <div class="budget-dialog-grid">
      <div class="budget-dialog-card">
        <span class="budget-dialog-label">תקציב</span>
        <strong class="budget-dialog-value">${payload.budget}</strong>
      </div>
      <div class="budget-dialog-card">
        <span class="budget-dialog-label">שולם</span>
        <strong class="budget-dialog-value">${payload.paid}</strong>
      </div>
      <div class="budget-dialog-card">
        <span class="budget-dialog-label">יתרה</span>
        <strong class="budget-dialog-value ${payload.isNeg ? 'neg' : ''}">${payload.balance}</strong>
      </div>
      <div class="budget-dialog-card">
        <span class="budget-dialog-label">ניצול</span>
        <strong class="budget-dialog-value">${payload.pct}%</strong>
      </div>
    </div>
  `;
  body.querySelectorAll('[data-budget-currency]').forEach(btn=>{
    btn.addEventListener('click', ()=>{
      const nextCur = btn.getAttribute('data-budget-currency');
      if(!nextCur || !state.current) return;
      setActiveCurrency(nextCur);
      try{
        const ref = FB.doc(db,'trips', state.current.id || state.currentTripId);
        FB.updateDoc(ref, { baseCurrency: nextCur }).catch(()=>{});
        state.current.baseCurrency = nextCur;
      }catch(_){}
      renderExpenseSummary(state.current);
      openCurrentBudgetSummary();
    });
  });
  if(!dlg.open) dlg.showModal();
}

function buildExpenseAmountMarkup(amount, currency){
  return `
    <div class="amt-main mobile-expense-amount" style="display:flex; align-items:center; justify-content:flex-end; gap:6px;">
      <span class="val">${bidiWrap(amount)}</span>
      <span class="code">${bidiWrap(currency || '')}</span>
    </div>
  `;
}

function buildBudgetSummaryPayload(t, forcedCur){
  if(!t) return null;
  const cur = forcedCur || getActiveCurrencyFromTrip(t);
  const budgetObj = t.budget || {};
  function getBudget(localCur){
    const direct = Number(budgetObj[localCur] || 0);
    if(direct) return direct;
    const tryUSD = budgetObj.USD ? convertAmount(budgetObj.USD,'USD',localCur,state.rates) : 0;
    const tryEUR = budgetObj.EUR ? convertAmount(budgetObj.EUR,'EUR',localCur,state.rates) : 0;
    const tryILS = budgetObj.ILS ? convertAmount(budgetObj.ILS,'ILS',localCur,state.rates) : 0;
    return Number(tryUSD || tryEUR || tryILS || 0);
  }
  const budgetRaw = getBudget(cur);
  let paid = 0;
  const ex = t.expenses || {};
  for(const id in ex){
    const e = ex[id] || {};
    const amt = Number(e.amount || 0);
    const from = e.currency || cur;
    const localRates = e.rates || state.rates || {};
    paid += convertAmount(amt, from, cur, localRates);
  }
  const balance = budgetRaw - paid;
  const isNeg = balance < 0;
  let pct = 0;
  if (budgetRaw > 0) pct = Math.max(0, Math.round((paid / budgetRaw) * 100));
  else if (budgetRaw === 0 && paid > 0) pct = 100;
  return {
    cur,
    pct,
    isNeg,
    band: paid > budgetRaw ? 'danger' : (pct >= 80 ? 'warn' : 'ok'),
    budget: `${formatInt(Math.round(budgetRaw))} ${cur}`,
    paid: `${formatInt(Math.round(paid))} ${cur}`,
    balance: `${formatIntSigned(Math.round(balance))} ${cur}`
  };
}

function openCurrentBudgetSummary(){
  if(!state.current) return;
  const payload = buildBudgetSummaryPayload(state.current);
  if(!payload) return;
  openBudgetSummaryDialog(payload);
}

function syncThemeToggleButton(){
  const btn = document.getElementById('btnTheme');
  if(!btn) return;
  const isLight = document.body.dataset.theme === 'light';
  const icon = isLight ? '☀' : '☾';
  const nextLabel = isLight ? 'מעבר למצב כהה' : 'מעבר למצב בהיר';
  btn.innerHTML = `<span aria-hidden="true">${icon}</span>`;
  btn.setAttribute('aria-label', nextLabel);
  btn.title = nextLabel;
  btn.classList.add('icon-only');
}

async function performPrimaryLogout(e){
  try{ e?.preventDefault?.(); e?.stopPropagation?.(); }catch(_){ }
  try{
    if(typeof hardSignOut==='function'){ await hardSignOut(); }
    else if(typeof FB!=='undefined' && typeof FB.signOut==='function'){ await FB.signOut(FB.auth); }
    else if(typeof signOutUser==='function'){ await signOutUser(); }
    else if(typeof FB?.auth?.signOut==='function'){ await FB.auth.signOut(); }
  }catch(err){ console.error('primary logout failed', err); }
  try { window.state = globalThis.state = { trips: [], current: null, currentTripId: null, user: null, maps: {}, filters: {}, shared: {}, rates: {}, categories: {} }; } catch(_) {}
  try { sessionStorage.clear(); } catch(_) {}
  try { localStorage.removeItem('activeTripId'); } catch(_) {}
  try { location.replace(location.pathname + '?logout=' + Date.now()); } catch(_) { location.reload(); }
}

function openAccountMenu(){
  const dlg = document.getElementById('accountMenuDialog');
  if(!dlg || typeof dlg.showModal !== 'function') return;
  if(!dlg.open) dlg.showModal();
}

function closeAccountMenu(){
  const dlg = document.getElementById('accountMenuDialog');
  if(dlg?.open) dlg.close();
}

function setBodyTheme(nextTheme){
  document.body.dataset.theme = (nextTheme === 'light' ? 'light' : 'dark');
  const btn = document.getElementById('btnTheme');
  if(!btn) return;
  const isLight = document.body.dataset.theme === 'light';
  btn.innerHTML = `<span aria-hidden="true">${isLight ? '&#9728;' : '&#9790;'}</span>`;
  const nextLabel = isLight ? 'מעבר למצב כהה' : 'מעבר למצב בהיר';
  btn.setAttribute('aria-label', nextLabel);
  btn.title = nextLabel;
  btn.classList.add('icon-only');
}

function bindTap(btn, handler, key){
  if(!btn || btn.dataset[key]==='1') return;
  btn.dataset[key] = '1';
  let lastTouchTs = 0;
  const run = (ev)=>{
    try{ ev?.preventDefault?.(); ev?.stopPropagation?.(); }catch(_){ }
    handler(ev);
  };
  btn.addEventListener('touchend', (ev)=>{
    lastTouchTs = Date.now();
    run(ev);
  }, { passive:false });
  btn.addEventListener('click', (ev)=>{
    if(Date.now() - lastTouchTs < 500) return;
    run(ev);
  }, { passive:false });
}

function wireReliableMobileButton(btn, handler, key='mobileReliableTap'){
  if(!btn || btn.dataset[key] === '1') return;
  btn.dataset[key] = '1';
  let lastTouchTs = 0;
  const run = async (ev)=>{
    try{ ev?.preventDefault?.(); ev?.stopPropagation?.(); ev?.stopImmediatePropagation?.(); }catch(_){ }
    if(ev?.type === 'click' && Date.now() - lastTouchTs < 500) return false;
    if(ev?.type === 'touchend' || ev?.type === 'pointerup') lastTouchTs = Date.now();
    await handler(ev);
    return false;
  };
  btn.onclick = run;
  btn.ontouchend = run;
  btn.onpointerup = run;
  btn.style.pointerEvents = 'auto';
  btn.style.touchAction = 'manipulation';
  btn.style.webkitTapHighlightColor = 'transparent';
}

function wireReliableMobileActions(){
  if(!isMobileViewport()) return;
  wireReliableMobileButton(document.getElementById('accountMenuCancel'), ()=> closeAccountMenu(), 'accountMenuCancelReliable');
  wireReliableMobileButton(document.getElementById('accountMenuLogout'), async (ev)=>{
    closeAccountMenu();
    await performPrimaryLogout(ev);
  }, 'accountMenuLogoutReliable');
  wireReliableMobileButton(document.getElementById('tripTodayCancel'), ()=>{
    const dlg = document.getElementById('tripTodayModal');
    try{ dlg?.close(); }catch(_){ }
  }, 'tripTodayCancelReliable');
  wireReliableMobileButton(document.getElementById('tripCancel'), ()=>{
    try{ document.getElementById('tripModal')?.close(); }catch(_){ }
  }, 'tripCancelReliable');
  wireReliableMobileButton(document.getElementById('expCancel'), ()=>{
    try{ document.getElementById('expenseModal')?.close(); }catch(_){ }
  }, 'expCancelReliable');
  wireReliableMobileButton(document.getElementById('jrCancel'), ()=>{
    try{ document.getElementById('journalModal')?.close(); }catch(_){ }
  }, 'jrCancelReliable');
  wireReliableMobileButton(document.getElementById('selectMapCancel'), ()=>{
    try{ document.getElementById('mapSelectModal')?.close(); }catch(_){ }
  }, 'mapCancelReliable');
  wireReliableMobileButton(document.getElementById('unsavedCancel'), ()=>{
    try{ document.getElementById('unsavedChangesModal')?.close(); }catch(_){ }
  }, 'unsavedCancelReliable');
  wireReliableMobileButton(document.getElementById('tripTodayAddExpense'), async ()=>{
    const dlg = document.getElementById('tripTodayModal');
    const promptTripId = dlg?.dataset.tripId || '';
    try{ dlg?.close(); }catch(_){ }
    if(promptTripId && state.currentTripId !== promptTripId){
      try{ await openTrip(promptTripId); }catch(_){ }
    }
    try{ switchToTab('expenses'); }catch(_){ }
    try{ openExpenseModal(); }catch(_){ }
  }, 'tripTodayExpenseReliable');
  wireReliableMobileButton(document.getElementById('btnAddExpense'), ()=>{
    try{ openExpenseModal(); }catch(_){ }
  }, 'btnAddExpenseReliable');
  wireReliableMobileButton(document.getElementById('btnQuickAddExpense'), ()=>{
    try{ openExpenseModal(); }catch(_){ }
  }, 'btnQuickAddExpenseReliable');
}

function applyAuthShellState(user){
  const loginScreen = document.getElementById('loginScreen');
  const appContainer = document.querySelector('.container');
  const appEl = document.querySelector('.app');
  const authModal = document.getElementById('authModal');
  const mobileOverlay = document.getElementById('mobileAuthOverlay');
  const emailSpan = document.getElementById('currentUserEmail');
  const isLoggedIn = !!user;

  document.body.dataset.authstate = isLoggedIn ? 'in' : 'out';
  if(appEl) appEl.style.display = 'grid';

  if(emailSpan){
    emailSpan.textContent = isLoggedIn ? (user.email || '') : '';
    emailSpan.style.display = 'none';
  }

  if(typeof window.__authPrimarySwap === 'function'){
    try{ window.__authPrimarySwap(isLoggedIn, user?.email || ''); }catch(_){ }
  }

  try{
    const tripSearch = document.getElementById('searchTrips');
    const currentEmail = String(user?.email || '').trim().toLowerCase();
    const currentValue = String(tripSearch?.value || '').trim().toLowerCase();
    if(tripSearch && currentEmail && currentValue === currentEmail){
      tripSearch.value = '';
    }
  }catch(_){}

  if(isLoggedIn){
    if(loginScreen) loginScreen.style.display = 'none';
    if(appContainer) appContainer.style.display = 'grid';
    try{ if(authModal?.open) authModal.close(); }catch(_){ }
    if(mobileOverlay) mobileOverlay.style.display = 'none';
    document.body.style.overflow = 'auto';
  }else{
    if(loginScreen) loginScreen.style.display = 'grid';
    if(appContainer) appContainer.style.display = 'none';
    try{ if(authModal?.open) authModal.close(); }catch(_){ }
    if(mobileOverlay) mobileOverlay.style.display = 'none';
    document.body.style.overflow = '';
  }
}

window.__applyAuthShellState = applyAuthShellState;
function openAuthEntryPoint(){
  const mobileOverlay = document.getElementById('mobileAuthOverlay');
  const authModal = document.getElementById('authModal');
  const lsEmail = document.getElementById('lsEmail');
  const mEmail = document.getElementById('mEmail');
  const authEmail = document.getElementById('authEmail');
  const isMobile = isMobileViewport();

  try{
    if(isMobile && mobileOverlay){
      mobileOverlay.style.display = 'flex';
      mobileOverlay.setAttribute('aria-hidden', 'false');
      document.body.style.overflow = 'hidden';
      setTimeout(()=>{ try{ (mEmail || lsEmail || authEmail)?.focus(); }catch(_){ } }, 30);
      return;
    }
    if(authModal?.showModal){
      authModal.showModal();
      setTimeout(()=>{ try{ (authEmail || lsEmail || mEmail)?.focus(); }catch(_){ } }, 30);
      return;
    }
  }catch(err){
    console.error('openAuthEntryPoint failed', err);
  }

  try{ (lsEmail || mEmail || authEmail)?.focus(); }catch(_){ }
}
window.__openAuthEntryPoint = openAuthEntryPoint;
try{
  if(document.body && !document.body.dataset.authstate){
    document.body.dataset.authstate = 'out';
  }
}catch(_){ }

function refreshHeaderAuthUi(forcedUser){
  try{
    if(typeof window.__authPrimarySwap !== 'function') return;
    const user = forcedUser === undefined
      ? ((typeof FB !== 'undefined' && FB?.auth?.currentUser) ? FB.auth.currentUser : null)
      : forcedUser;
    window.__authPrimarySwap(!!user, user?.email || '');
  }catch(err){
    console.warn('header auth sync failed', err);
  }
}

function syncThemeToggleButtonLegacy(){
  const btn = document.getElementById('btnTheme');
  if(!btn) return;
  const isLight = document.body.dataset.theme === 'light';
  const nextLabel = isLight ? 'מעבר למצב כהה' : 'מעבר למצב בהיר';
  btn.innerHTML = `<span aria-hidden="true">${isLight ? '&#9728;' : '&#9790;'}</span>`;
  btn.setAttribute('aria-label', nextLabel);
  btn.title = nextLabel;
  btn.classList.add('icon-only');
}

function wireHeaderControls(){
  const btn = document.getElementById('btnLogin');
  const themeBtn = document.getElementById('btnTheme');
  const dlg = document.getElementById('accountMenuDialog');
  if(!btn) return;
  if(btn.dataset.authWired==='1') return;
  btn.dataset.authWired='1';

  if(themeBtn && themeBtn.dataset.themeWired!=='1'){
    themeBtn.dataset.themeWired='1';
  }

  document.getElementById('accountMenuLogout')?.addEventListener('click', async (e)=>{
    closeAccountMenu();
    await performPrimaryLogout(e);
  });
  document.getElementById('accountMenuCancel')?.addEventListener('click', ()=> closeAccountMenu());
  dlg?.addEventListener('click', (e)=>{
    if(e.target === dlg) closeAccountMenu();
  });

  window.__authPrimarySwap = (loggedIn, email='')=>{
    const old = document.getElementById('btnLogin');
    if(!old) return;
    const clone = old.cloneNode(true);
    old.parentNode.replaceChild(clone, old);
    const target = document.getElementById('btnLogin');
    const compact = isCompactMobileHeader();
    const emailEl = document.getElementById('accountMenuEmail');
    if(!target) return;
    if(emailEl) emailEl.textContent = email || '';
    target.classList.remove('danger', 'icon-only', 'is-authenticated');
    if(loggedIn){
      target.classList.add('is-authenticated', 'icon-only');
      target.innerHTML = '<span aria-hidden="true">⇦</span>';
      target.setAttribute('aria-label', 'חשבון מחובר');
      target.title = 'חשבון מחובר';
      target.addEventListener('click', (ev)=>{
        ev.preventDefault();
        openAccountMenu();
      }, {passive:false});
    } else {
      target.textContent = 'התחברות';
      target.setAttribute('aria-label', 'התחברות');
      target.title = 'התחברות';
      bindTap(target, ()=> openAuthEntryPoint(), 'authOpenTapWired');
    }
  };

  if(themeBtn){
    bindTap(themeBtn, ()=>{
      const nextTheme = document.body.dataset.theme === 'light' ? 'dark' : 'light';
      setBodyTheme(nextTheme);
    }, 'themeTapWired');
  }

  window.__authPrimarySwap = (loggedIn, email='')=>{
    const old = document.getElementById('btnLogin');
    if(!old) return;
    const clone = old.cloneNode(true);
    old.parentNode.replaceChild(clone, old);
    const target = document.getElementById('btnLogin');
    const emailEl = document.getElementById('accountMenuEmail');
    if(!target) return;
    if(emailEl) emailEl.textContent = email || '';
    target.classList.remove('danger', 'icon-only', 'is-authenticated');
    if(loggedIn){
      target.classList.add('is-authenticated', 'icon-only');
      target.innerHTML = '<span aria-hidden="true">&#10140;</span>';
      target.setAttribute('aria-label', 'חשבון מחובר');
      target.title = 'חשבון מחובר';
      bindTap(target, ()=> openAccountMenu(), 'authTapWired');
    } else {
      target.textContent = 'התחברות';
      target.setAttribute('aria-label', 'התחברות');
      target.title = 'התחברות';
      bindTap(target, ()=> openAuthEntryPoint(), 'authOpenTapWired');
    }
  };

  setBodyTheme(document.body.dataset.theme);
  window.addEventListener('resize', syncThemeToggleButton);
  window.addEventListener('pageshow', ()=> refreshHeaderAuthUi());
  document.addEventListener('visibilitychange', ()=>{
    if(!document.hidden) refreshHeaderAuthUi();
  });
  window.__refreshHeaderAuthUi = refreshHeaderAuthUi;
  refreshHeaderAuthUi();
}
document.addEventListener('DOMContentLoaded', wireHeaderControls);
document.addEventListener('DOMContentLoaded', wireReliableMobileActions);
document.addEventListener('DOMContentLoaded', syncViewportModeClasses);
document.addEventListener('DOMContentLoaded', normalizeMobileOverviewHeader);
window.addEventListener('resize', syncViewportModeClasses);
window.addEventListener('resize', normalizeMobileOverviewHeader);
window.addEventListener('pageshow', syncViewportModeClasses);
window.addEventListener('pageshow', normalizeMobileOverviewHeader);

function finalMobileThemeSync(){
  if(!isCompactMobileHeader()) return;
  const btn = document.getElementById('btnTheme');
  if(!btn) return;
  const isLight = document.body.dataset.theme === 'light';
  btn.innerHTML = `<span aria-hidden="true">${isLight ? '&#9728;' : '&#9790;'}</span>`;
  btn.classList.add('icon-only');
  btn.setAttribute('aria-label', isLight ? 'מעבר למצב כהה' : 'מעבר למצב בהיר');
  btn.title = isLight ? 'מעבר למצב כהה' : 'מעבר למצב בהיר';
}

function finalMobileAuthSwap(loggedIn, email=''){
  if(!isCompactMobileHeader()) return;
  const old = document.getElementById('btnLogin');
  if(!old) return;
  const clone = old.cloneNode(true);
  old.parentNode.replaceChild(clone, old);
  const btn = document.getElementById('btnLogin');
  const emailEl = document.getElementById('accountMenuEmail');
  if(!btn) return;
  if(emailEl) emailEl.textContent = email || '';
  btn.classList.remove('danger', 'icon-only', 'is-authenticated');
  if(loggedIn){
    btn.classList.add('icon-only', 'is-authenticated');
    btn.innerHTML = '<span aria-hidden="true">&#10140;</span>';
    btn.setAttribute('aria-label', 'חשבון מחובר');
    btn.title = 'חשבון מחובר';
    bindTap(btn, ()=> openAccountMenu(), 'finalAuthTapWired');
  }else{
    btn.textContent = 'התחברות';
    btn.setAttribute('aria-label', 'התחברות');
    btn.title = 'התחברות';
    bindTap(btn, ()=> openAuthEntryPoint(), 'finalAuthOpenTapWired');
  }
}

document.addEventListener('DOMContentLoaded', ()=>{
  if(!isCompactMobileHeader()) return;
  const themeBtn = document.getElementById('btnTheme');
  if(themeBtn){
    bindTap(themeBtn, ()=>{
      document.body.dataset.theme = document.body.dataset.theme === 'light' ? 'dark' : 'light';
      finalMobileThemeSync();
    }, 'finalThemeTapWired');
    finalMobileThemeSync();
  }

  window.__authPrimarySwap = finalMobileAuthSwap;
  const currentUser = (typeof FB !== 'undefined' && FB?.auth?.currentUser) ? FB.auth.currentUser : null;
  finalMobileAuthSwap(!!currentUser, currentUser?.email || '');
});

// --- ensure "מחק נבחרים" button exists in Journal tab even if HTML not updated ---
(function(){
  document.addEventListener('DOMContentLoaded', ()=>{
    const view = document.getElementById('view-journal');
    if(!view) return;
    const actions = view.querySelector('.list-actions');
    if(!actions) return;
    let btn = document.getElementById('btnDeleteSelectedJournal');
    let cancelBtn = document.getElementById('btnCancelSelectionJournal');
    if(!btn){
      btn = document.createElement('button');
      btn.id = 'btnDeleteSelectedJournal';
      btn.className = 'btn danger';
      btn.textContent = 'מחק נבחרים';
      actions.insertBefore(btn, actions.querySelector('#btnSortJournal')?.nextSibling || null);
      if(!cancelBtn){
        cancelBtn = document.createElement('button');
        cancelBtn.id = 'btnCancelSelectionJournal';
        cancelBtn.className = 'btn';
        cancelBtn.textContent = 'בטל בחירה';
        cancelBtn.style.display = 'none';
        actions.insertBefore(cancelBtn, btn.nextSibling);
      }
    }
    syncJournalSelectionUi();
  });
})();

function syncJournalSelectionUi(){
  const btn = document.getElementById('btnDeleteSelectedJournal');
  const cancelBtn = document.getElementById('btnCancelSelectionJournal');
  const selectionOn = !!state.journalSelectionMode;
  const count = state.journalSelectedIds ? state.journalSelectedIds.size : 0;

  if(btn) btn.textContent = selectionOn ? `מחק (${count})` : 'מחק נבחרים';
  if(cancelBtn) cancelBtn.style.display = selectionOn ? 'inline-flex' : 'none';
}

/* ---------- Final mobile-only shell overrides ---------- */
(function(){
  function mobileApplyThemeButton(){
    if(!isCompactMobileHeader()) return;
    const btn = document.getElementById('btnTheme');
    if(!btn) return;
    const isLight = document.body.dataset.theme === 'light';
    btn.classList.add('icon-only');
    btn.innerHTML = `<span aria-hidden="true">${isLight ? '&#9728;' : '&#9790;'}</span>`;
    btn.setAttribute('aria-label', isLight ? 'מעבר למצב כהה' : 'מעבר למצב בהיר');
    btn.title = isLight ? 'מעבר למצב כהה' : 'מעבר למצב בהיר';
  }

  function mobileApplyAuthButton(loggedIn, email=''){
    if(!isCompactMobileHeader()) return;
    const current = document.getElementById('btnLogin');
    if(!current) return;
    const replacement = current.cloneNode(true);
    current.parentNode.replaceChild(replacement, current);
    const btn = document.getElementById('btnLogin');
    const emailEl = document.getElementById('accountMenuEmail');
    if(!btn) return;
    if(emailEl) emailEl.textContent = email || '';
    btn.classList.remove('danger', 'icon-only', 'is-authenticated');
    if(loggedIn){
      btn.classList.add('icon-only', 'is-authenticated');
      btn.innerHTML = '<span aria-hidden="true">&#10140;</span>';
      btn.setAttribute('aria-label', 'חשבון מחובר');
      btn.title = 'חשבון מחובר';
      btn.classList.add('is-authenticated');
      bindTap(btn, ()=> openAccountMenu(), 'mobileFinalAuthTap');
    }else{
      btn.textContent = 'התחברות';
      btn.setAttribute('aria-label', 'התחברות');
      btn.title = 'התחברות';
      bindTap(btn, ()=> openAuthEntryPoint(), 'mobileFinalAuthOpenTap');
    }
  }

  function getCurrentAuthUser(){
    return (typeof FB !== 'undefined' && FB?.auth?.currentUser) ? FB.auth.currentUser : null;
  }

  function ensureMobileSectionMenuDialog(){
    if(!isCompactMobileHeader()) return null;
    let dlg = document.getElementById('mobileSectionMenuDialog');
    if(dlg) return dlg;
    dlg = document.createElement('dialog');
    dlg.id = 'mobileSectionMenuDialog';
    dlg.className = 'modal mobile-section-dialog';
    dlg.innerHTML = `
      <header><strong id="mobileSectionMenuTitle">פעולות</strong></header>
      <div class="body"><div id="mobileSectionMenuBody" class="mobile-section-menu-body"></div></div>
      <div class="footer"><button id="mobileSectionMenuClose" class="btn" type="button">סגור</button></div>`;
    document.body.appendChild(dlg);
    dlg.querySelector('#mobileSectionMenuClose')?.addEventListener('click', ()=> dlg.close());
    dlg.addEventListener('click', (ev)=>{ if(ev.target === dlg) dlg.close(); });
    return dlg;
  }

  function triggerButton(id){
    document.getElementById(id)?.click();
  }

  function applyOverviewSelection(value){
    const v = (value || '').trim();
    if(!v) return;

    try{
      const currentTab = document.querySelector('#tabs [data-tab].active')?.dataset?.tab;
      if(currentTab === 'meta' && state?.isDirty && typeof showUnsavedChangesAlert === 'function'){
        showUnsavedChangesAlert(v);
        return;
      }
    }catch(_){}

    if (v === 'journal' || v === 'expenses' || v === 'mix') {
      try {
        const overviewEl = document.querySelector('#tabs [data-tab="overview"]');
        if (overviewEl) { setActiveTab(overviewEl); showView('overview'); }
      } catch (_) {}

      try {
        const nextMode = (v === 'mix') ? 'all' : v;
        state.overviewMode = nextMode;
        localStorage.setItem('overviewMode', nextMode);
        if (state.current) renderAllTimeline(state.current, state.allSort);
      } catch (_) {}
      return;
    }

    if (v === 'breakdown') {
      setTimeout(() => {
        if (typeof window.__openBreakdownDialog === 'function') {
          window.__openBreakdownDialog();
          return;
        }
        try {
          const dlg = document.getElementById('breakdownDialog');
          if (dlg) {
            if (typeof renderCategoryBreakdownNode === 'function')
              renderCategoryBreakdownNode('categoryBreakdownDialog');
            if (!dlg.open) {
              if (dlg.showModal) dlg.showModal(); else dlg.setAttribute('open', '');
            }
          }
        } catch (_) {}
      }, 0);
      return;
    }

    if (v === 'meta' || v === 'map' || v === 'share') {
      try {
        const overviewWrap = document.querySelector('#tabs [data-tab="overview"]');
        if (overviewWrap) setActiveTab(overviewWrap);
      } catch (_e) {}

      showView(v);
      if (v === 'map') setTimeout(initBigMap, 50);
      return;
    }

    const tabEl = document.querySelector(`#tabs [data-tab="${v}"]`);
    if (tabEl) tabEl.click();
  }

  function setOverviewSelectValue(value){
    applyOverviewSelection(value);
  }

  function getMobileVisibleSection(){
    if(!document.getElementById('view-overview')?.hidden) return 'overview';
    if(!document.getElementById('view-expenses')?.hidden) return 'expenses';
    if(!document.getElementById('view-journal')?.hidden) return 'journal';
    if(!document.getElementById('view-meta')?.hidden) return 'meta';
    return 'home';
  }

  function buildMobileAction(label, action, variant=''){
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = `btn mobile-sheet-action ${variant}`.trim();
    btn.textContent = label;
    btn.addEventListener('click', ()=>{
      action();
      document.getElementById('mobileSectionMenuDialog')?.close();
    });
    return btn;
  }

  function openMobileSectionMenu(section){
    if(!isCompactMobileHeader()) return;
    const currentSection = section || getMobileVisibleSection();
    const dlg = ensureMobileSectionMenuDialog();
    if(!dlg) return;
    const title = dlg.querySelector('#mobileSectionMenuTitle');
    const body = dlg.querySelector('#mobileSectionMenuBody');
    if(!title || !body) return;
    body.innerHTML = '';
    const add = (label, action, variant='') => body.appendChild(buildMobileAction(label, action, variant));

    if(currentSection === 'overview'){
      title.textContent = 'תצוגה ופעולות';
      add('נתוני נסיעה', ()=> setOverviewSelectValue('meta'));
      add('הצג יומן + הוצאות', ()=> setOverviewSelectValue('mix'));
      add('הצג יומן', ()=> setOverviewSelectValue('journal'));
      add('הצג הוצאות', ()=> setOverviewSelectValue('expenses'));
      add('מפה', ()=> setOverviewSelectValue('map'));
      add('תקציב', ()=> openCurrentBudgetSummary());
    } else if(currentSection === 'expenses'){
      title.textContent = 'פעולות הוצאות';
      add('+ הוסף הוצאה', ()=> triggerButton('btnAddExpense'), 'primary');
      add('מיין', ()=> triggerButton('btnSortExpenses'));
      add('סנן', ()=> triggerButton('btnFilterExpenses'));
      add('צמצם / פרוס הכל', ()=> triggerButton('btnToggleExpenseDetails'));
      add('סיכום פילוח', ()=> triggerButton('openBreakdownBtn'));
    } else if(currentSection === 'journal'){
      title.textContent = 'פעולות יומן';
      add('+ הוסף רישום', ()=> triggerButton('btnAddJournal'), 'primary');
      add('מיין', ()=> triggerButton('btnSortJournal'));
      add('צמצם / פרוס הכל', ()=> triggerButton('btnToggleJournalDetails'));
    } else {
      title.textContent = 'פעולות נסיעות';
      add('נסיעה חדשה', ()=> triggerButton('btnNewTrip'), 'primary');
      add('מיין לפי תאריך', ()=> triggerButton('btnSortTrips'));
      add('כל הנסיעות', ()=> triggerButton('btnAllTrips'));
    }

    if(!dlg.open) dlg.showModal();
  }

  function ensureSectionButton(hostSelector, buttonId, label, section){
    const host = document.querySelector(hostSelector);
    if(!host || document.getElementById(buttonId)) return;
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.id = buttonId;
    btn.className = 'btn mobile-section-menu-btn';
    btn.setAttribute('aria-label', label);
    btn.dataset.mobileSection = section || '';
    btn.innerHTML = section === 'overview'
      ? '<span class="mobile-btn-label">עוד</span>'
      : '<span aria-hidden="true">&#9776;</span>';
    btn.addEventListener('click', ()=> openMobileSectionMenu(section));
    host.prepend(btn);
  }

  function scrubLegacyMobileOverviewNodes(){
    if(!isCompactMobileHeader()) return;
    const host = document.getElementById('view-overview');
    if(!host) return;
    Array.from(host.children).forEach((child)=>{
      if(!child || child.id === 'mobileOverviewActionRail') return;
      if(child.matches?.('select, input') || child.classList?.contains('tab-select-wrap')){
        try{ child.remove(); }catch(_){ child.style.display = 'none'; }
      }
    });
  }

  function ensureOverviewActionRail(){
    const host = document.getElementById('view-overview');
    if(!host) return;
    let rail = document.getElementById('mobileOverviewActionRail');
    if(!rail){
      rail = document.createElement('section');
      rail.id = 'mobileOverviewActionRail';
      rail.className = 'mobile-overview-action-rail';
      rail.innerHTML = `
        <div class="mobile-overview-action-rail__search"></div>
        <div class="mobile-overview-action-rail__buttons">
          <button type="button" id="mobileOverviewSortBtn" class="btn mobile-overview-chip" aria-label="מיון">מיון</button>
          <button type="button" id="mobileOverviewToggleBtn" class="btn mobile-overview-chip" aria-label="צמצם או פרוס">פריסה</button>
          <button type="button" id="mobileOverviewExpenseBtn" class="btn mobile-overview-chip accent" aria-label="הוסף הוצאה">הוצאה</button>
          <button type="button" id="mobileOverviewJournalBtn" class="btn mobile-overview-chip accent-alt" aria-label="הוסף יומן">יומן</button>
        </div>
      `;
      host.prepend(rail);
      rail.querySelector('#mobileOverviewSortBtn')?.addEventListener('click', ()=> triggerButton('btnAllSort'));
      rail.querySelector('#mobileOverviewToggleBtn')?.addEventListener('click', ()=> triggerButton('btnAllToggle'));
      rail.querySelector('#mobileOverviewExpenseBtn')?.addEventListener('click', ()=> triggerButton('btnQuickAddExpense'));
      rail.querySelector('#mobileOverviewJournalBtn')?.addEventListener('click', ()=> triggerButton('btnQuickAddJournal'));
    }
    const menuBtn = document.getElementById('mobileOverviewMenuBtn');
    const searchInput = document.getElementById('searchAll');
    const searchSlot = rail.querySelector('.mobile-overview-action-rail__search');
    const buttonsRow = rail.querySelector('.mobile-overview-action-rail__buttons');
    if(menuBtn && buttonsRow && menuBtn.parentElement !== buttonsRow){
      menuBtn.classList.add('mobile-overview-chip', 'mobile-overview-menu');
      menuBtn.innerHTML = '<span class="mobile-btn-label">עוד</span>';
      buttonsRow.prepend(menuBtn);
    }
    if(searchInput){
      searchInput.hidden = false;
      searchInput.placeholder = 'חיפוש ביומן ובהוצאות';
      searchInput.classList.add('mobile-overview-search');
      if(searchSlot && searchInput.parentElement !== searchSlot) searchSlot.appendChild(searchInput);
    }
    scrubLegacyMobileOverviewNodes();
  }

  function syncMobileViewportVars(){
    if(!isCompactMobileHeader()) return;
    const vv = window.visualViewport;
    const height = vv?.height || window.innerHeight || 0;
    const offsetTop = vv?.offsetTop || 0;
    document.documentElement.style.setProperty('--vvh', `${height}px`);
    document.documentElement.style.setProperty('--vv-top', `${offsetTop}px`);
    document.body.classList.toggle('mobile-keyboard-open', !!vv && vv.height < window.innerHeight - 120);
  }

  function scrollFieldIntoView(target){
    if(!target || !isCompactMobileHeader()) return;
    const modalBody = target.closest('.modal .body');
    const scroller = modalBody || document.scrollingElement || document.documentElement;
    setTimeout(()=>{
      try{
        target.scrollIntoView({ behavior:'smooth', block:'center', inline:'nearest' });
      }catch(_){
        try{ target.scrollIntoView(); }catch(__){}
      }
      if(modalBody){
        try{
          const bodyRect = modalBody.getBoundingClientRect();
          const targetRect = target.getBoundingClientRect();
          const delta = targetRect.top - bodyRect.top - Math.max(16, (bodyRect.height - targetRect.height) / 2);
          modalBody.scrollTop += delta;
        }catch(_){}
      }else if(scroller){
        try{ scroller.scrollTop = Math.max(0, scroller.scrollTop - 24); }catch(_){}
      }
    }, 120);
  }

  function wireMobileFieldComfort(){
    if(!isCompactMobileHeader()) return;
    const selectors = [
      '#lsEmail','#lsPass','#searchTrips','#searchAll',
      '#tripDest','#tripStart','#tripEnd',
      '#metaDestination','#metaStart','#metaEnd','#metaPeople',
      '#expTitle','#expAmount','#expDate','#expTime','#expLocationName',
      '#jrTitle','#jrDate','#jrTime','#jrPlaceName',
      '#authEmail','#authPass','#suEmail','#suPass','#rsEmail',
      '#mEmail','#mPass'
    ];
    selectors.forEach((sel)=>{
      const el = document.querySelector(sel);
      if(!el || el.dataset.mobileComfortWired === '1') return;
      el.dataset.mobileComfortWired = '1';
      el.addEventListener('focus', ()=> scrollFieldIntoView(el), { passive:true });
      el.addEventListener('click', ()=> scrollFieldIntoView(el), { passive:true });
    });
    ['#expText','#jrText'].forEach((sel)=>{
      const el = document.querySelector(sel);
      if(!el || el.dataset.mobileComfortWired === '1') return;
      el.dataset.mobileComfortWired = '1';
      el.addEventListener('focus', ()=> scrollFieldIntoView(el), { passive:true });
      el.addEventListener('click', ()=> scrollFieldIntoView(el), { passive:true });
    });
  }

  function applyMobileLayout(){
    if(!isCompactMobileHeader()) return;
    document.body.classList.add('mobile-shell-v2');
    const newTripBtn = document.getElementById('btnNewTrip');
    if(newTripBtn){
      newTripBtn.textContent = 'נסיעה חדשה';
      newTripBtn.setAttribute('aria-label', 'נסיעה חדשה');
      newTripBtn.title = 'נסיעה חדשה';
    }

    if(typeof state === 'object'){
      state.viewMode = 'list';
      state.lastNonMapView = 'list';
    }

    const gridBtn = document.getElementById('btnViewGrid');
    const listBtn = document.getElementById('btnViewList');
    const mapBtn = document.getElementById('btnViewMap');
    if(gridBtn){
      gridBtn.disabled = true;
      gridBtn.setAttribute('aria-hidden', 'true');
      gridBtn.tabIndex = -1;
      gridBtn.style.display = 'none';
    }
    if(listBtn){
      listBtn.textContent = 'רשימה';
      listBtn.classList.add('active');
    }
    if(mapBtn){
      mapBtn.disabled = false;
      mapBtn.removeAttribute('aria-hidden');
      mapBtn.tabIndex = 0;
      mapBtn.textContent = 'מפה';
    }
    const sortTripsBtn = document.getElementById('btnSortTrips');
    if(sortTripsBtn) sortTripsBtn.textContent = 'מיון';
    const tripSearch = document.getElementById('searchTrips');
    if(tripSearch) tripSearch.placeholder = 'חיפוש נסיעות';

    ensureMobileSectionMenuDialog();
    ensureSectionButton('#view-overview', 'mobileOverviewMenuBtn', 'פעולות תצוגה', 'overview');
    ensureOverviewActionRail();
    ensureSectionButton('#view-expenses .list-actions', 'mobileExpensesMenuBtn', 'פעולות הוצאות', 'expenses');
    ensureSectionButton('#view-journal .list-actions', 'mobileJournalMenuBtn', 'פעולות יומן', 'journal');
    syncMobileViewportVars();
    wireMobileFieldComfort();
  }

  function wire(){
    if(!isCompactMobileHeader()) return;
    const themeBtn = document.getElementById('btnTheme');
    if(themeBtn && themeBtn.dataset.mobileFinalTheme !== '1'){
      themeBtn.dataset.mobileFinalTheme = '1';
      bindTap(themeBtn, ()=>{
        setBodyTheme(document.body.dataset.theme === 'light' ? 'dark' : 'light');
        mobileApplyThemeButton();
      }, 'mobileFinalThemeTap');
    }

    window.__authPrimarySwap = mobileApplyAuthButton;
    mobileApplyThemeButton();
    const currentUser = getCurrentAuthUser();
    mobileApplyAuthButton(!!currentUser, currentUser?.email || '');
    applyMobileLayout();
    syncMobileViewportVars();
    wireMobileFieldComfort();

    if(window.visualViewport && !window.visualViewport.__mobileViewportWired){
      window.visualViewport.__mobileViewportWired = true;
      window.visualViewport.addEventListener('resize', syncMobileViewportVars);
      window.visualViewport.addEventListener('scroll', syncMobileViewportVars);
    }

    window.addEventListener('pageshow', ()=>{
      if(!isCompactMobileHeader()) return;
      const currentUser = getCurrentAuthUser();
      mobileApplyThemeButton();
      mobileApplyAuthButton(!!currentUser, currentUser?.email || '');
      applyMobileLayout();
    });
    window.addEventListener('resize', ()=>{
      if(!isCompactMobileHeader()) return;
      syncMobileViewportVars();
      applyMobileLayout();
    });
    window.addEventListener('focus', ()=>{
      if(!isCompactMobileHeader()) return;
      const currentUser = getCurrentAuthUser();
      mobileApplyAuthButton(!!currentUser, currentUser?.email || '');
    });
  }

  if(document.readyState === 'loading'){
    document.addEventListener('DOMContentLoaded', wire);
  }else{
    wire();
  }
})();
// --- end ensure button ---

async function loadJournalOnly(){
  const tid = state.currentTripId;
  if(!tid) return;
  const ref = FB.doc(db, 'trips', tid);
  const snap = await FB.getDoc(ref);
  if(!snap.exists()) return;
  const t = snap.data() || {};
  if(!state.current) state.current = { id: tid };
  state.current.journal = t.journal || {};
  const $jrD = document.getElementById('jrDate');
  const $jrT = document.getElementById('jrTime');
  let _jr_dateIso;
  if ($jrD && $jrT && $jrD.value && $jrT.value) {
    _jr_dateIso = new Date(`${$jrD.value}T${$jrT.value}:00`).toISOString();
  } else {
    const currentJournalId = document.getElementById('journalModal')?.dataset?.id;
    const curJ = (currentJournalId && t.journal && t.journal[currentJournalId]) || {};
    _jr_dateIso = curJ.dateIso || curJ.createdAt || new Date().toISOString();
  }
  const __jr_dt = new Date(_jr_dateIso);
  const __pad2 = n=>String(n).padStart(2,'0');
  const __jr_dateStr = `${__pad2(__jr_dt.getDate())}/${__pad2(__jr_dt.getMonth()+1)}/${__pad2(__jr_dt.getFullYear())}`;
  const __jr_timeStr = `${__pad2(__jr_dt.getHours())}:${__pad2(__jr_dt.getMinutes())}`;

  renderJournal(state.current, state.journalSort);
}

import { auth, db, FB, hardSignOut } from './firebase.js';
try { window.hardSignOut = hardSignOut; } catch(_) {}

// Safe Leaflet map init (prevents double-init)
window.safeInitMap = function(containerId, opts){
  const id = typeof containerId==='string' ? containerId : (containerId?.id || 'map');
  const el = typeof containerId==='string' ? document.getElementById(containerId) : containerId;
  if(!el) return null;
  if (el._leaflet_id && el._leaflet_id !== undefined) {
    try { el._leaflet_map && el._leaflet_map.remove(); } catch(_){ }
    try { el.replaceWith(el.cloneNode(true)); } catch(_){ }
  }
  const node = document.getElementById(id) || el;
  const map = L.map(node, opts || {});
  node._leaflet_map = map;
  return map;
};

function bidiWrap(value, className='bidi-fix'){
  const safe = esc(value == null ? '' : String(value));
  return `<span class="${className}">${safe}</span>`;
}


// === Textarea auto-resize + safe Enter handling ===
(function(){
  function autoResize(el){
    if(!el) return;
    el.style.height = 'auto';
    const h = Math.min(el.scrollHeight, 420);
    el.style.height = h + 'px';
  }
  function bindAutoResize(el){
    if(!el || el.dataset._autoResizeBound) return;
    el.dataset._autoResizeBound = '1';
    autoResize(el);
    el.addEventListener('input', ()=>autoResize(el));
  }
  // bind on DOM ready and whenever modals open
  document.addEventListener('DOMContentLoaded', ()=>{
    bindAutoResize(document.getElementById('expDesc'));
    // bindAutoResize skipped for contenteditable jrText
  });

 // Enter behavior inside modals (desktop + mobile):
document.addEventListener('keydown', (e)=>{
  const anyOpen = (m)=>{ const d=document.getElementById(m); return d && d.open; };
  if(!(anyOpen('expenseModal') || anyOpen('journalModal'))) return;

  const tag = (document.activeElement && document.activeElement.tagName) || '';
  const isTextarea = tag.toLowerCase() === 'textarea' ||
                     document.activeElement?.isContentEditable;

  // Ctrl/Cmd + Enter → שמירה
  if ((e.ctrlKey || e.metaKey) && e.key === 'Enter') {
    if (anyOpen('expenseModal')) document.getElementById('expSave')?.click();
    if (anyOpen('journalModal')) document.getElementById('jrSave')?.click();
    e.preventDefault();
    return;
  }

  // Enter רגיל → ירידת שורה רק ב־textarea או contenteditable
  if (e.key === 'Enter' && isTextarea) {
    // לא נוגעים — הדפדפן כבר מוריד שורה
    return;
  }

  // מניעת שליחה/שמירה בטעות בכל מקום אחר
  if (e.key === 'Enter' && !isTextarea) {
    e.preventDefault();
  }
});

// תיקון למובייל – מאזין ל־input למקרה שה־keydown לא נורה
document.addEventListener('input', (e) => {
  const tag = (e.target && e.target.tagName) || '';
  if (tag.toLowerCase() === 'textarea') {
    e.target.style.height = 'auto';
    e.target.style.height = Math.min(e.target.scrollHeight, 420) + 'px';
  }
});

  // Expose to modal openers to (re)bind
  window._bindTextareasForModals = function(){
    bindAutoResize(document.getElementById('expDesc'));
    // bindAutoResize skipped for contenteditable jrText
  };
})();
// === End textarea helpers ===
// === ensureExpenseCurrencyOption: global-safe ===
(function () {
  const root = (typeof window !== 'undefined') ? window : globalThis;
  function ensureExpenseCurrencyOption(localCode) {
    try {
      const lc = localCode ||
        (root.state && (root.state.localCurrency || (root.state.current && root.state.current.localCurrency))) ||
        'USD';
      if (!lc) return;
      const selects = Array.from(document.querySelectorAll(
        'select[id*="curr"], select[name*="curr"], select[id*="Currency"], select[name*="Currency"]'
      ));
      selects.forEach(sel => {
        const exists = Array.from(sel.options).some(o => {
          const t = (o.textContent || o.innerText || '').trim().toUpperCase();
          return o.value === lc || t === lc || t.includes(lc.toUpperCase());
        });
        if (!exists) sel.add(new Option(lc, lc, false, false));
      });
    } catch (e) { /*log removed*/ }
  }
  root.ensureExpenseCurrencyOption = ensureExpenseCurrencyOption;
})();

// ---- Lazy loader for heavy export libs with multi-CDN fallback ----
async function loadExternalScript(urls) {
  for (const url of urls) {
    try {
      await new Promise((res, rej) => {
        const s = document.createElement('script');
        s.src = url;
        s.async = true;
        s.onload = () => res();
        s.onerror = () => { s.remove(); rej(new Error('failed')); };
        document.head.appendChild(s);
      });
      return true;
    } catch (e) { /* try next */ }
  }
  return false;
}
async function ensureJsPDF() {
  if (typeof window.jspdf !== 'undefined' || typeof window.jsPDF !== 'undefined') return true;
  const ok = await loadExternalScript([
    "https://unpkg.com/jspdf@2.5.1/dist/jspdf.umd.min.js",
    "https://cdn.jsdelivr.net/npm/jspdf@2.5.1/dist/jspdf.umd.min.js"
  ]);
  if (!ok) return false;
  const ok2 = await loadExternalScript([
    "https://unpkg.com/jspdf-autotable@3.8.2/dist/jspdf.plugin.autotable.min.js",
    "https://cdn.jsdelivr.net/npm/jspdf-autotable@3.8.2/dist/jspdf.plugin.autotable.min.js"
  ]);
  return ok2;
}
async function ensureXLSX() {
  if (typeof window.XLSX !== 'undefined') return true;
  return await loadExternalScript([
    "https://unpkg.com/xlsx@0.18.5/dist/xlsx.full.min.js",
    "https://cdn.jsdelivr.net/npm/xlsx@0.18.5/dist/xlsx.full.min.js"
  ]);
}
async function ensureDOCX() {
  if (typeof window.docx !== 'undefined') return true;
  return await loadExternalScript([
    "https://unpkg.com/docx@8.5.0/build/index.umd.js",
    "https://cdn.jsdelivr.net/npm/docx@8.5.0/build/index.umd.js"
  ]);
}
function toast(msg){ const t=document.getElementById('toast'); if(!t) { alert(msg); return; } t.textContent=msg; t.className='toast show'; setTimeout(()=>t.classList.remove('show'), 2200); }

// === Currency conversion helpers ===

function rateMatrix(r){
  const USDEUR = Number((r && r.USDEUR) ?? (state?.rates?.USDEUR) ?? 0.92);
  const USDILS = Number((r && r.USDILS) ?? (state?.rates?.USDILS) ?? 3.7);
  const USDLocal = Number((r && r.USDLocal) ?? (state?.rates?.USDLocal) ?? 1);
  const LC = state.current?.localCurrency;
  const lcSpread = (LC && !['USD', 'EUR', 'ILS'].includes(LC)) ? { [LC]: USDLocal } : {};
  const M = {
    USD: { USD:1, EUR:USDEUR, ILS:USDILS, ...lcSpread },
    EUR: { USD:1/USDEUR, EUR:1, ILS:USDILS/USDEUR, ...(lcSpread[LC] ? { [LC]: USDLocal/USDEUR } : {}) },
    ILS: { USD:1/USDILS, EUR:USDEUR/USDILS, ILS:1, ...(lcSpread[LC] ? { [LC]: USDLocal/USDILS } : {}) }
  };
  // If the local currency is already USD/EUR/ILS, do not overwrite the base matrices.
  if (LC && !['USD', 'EUR', 'ILS'].includes(LC)) {
    M[LC] = { 
      USD: USDLocal ? 1/USDLocal : 1,
      EUR: USDLocal && USDEUR ? USDEUR/USDLocal : 1,
      ILS: USDLocal && USDILS ? USDILS/USDLocal : 1,
      [LC]: 1
    };
  }
  return M;
}

function convertAmount(amount, from, to, rates){
  const M = rateMatrix(rates);
  const a = Number(amount)||0;
  if(!M[from] || !M[from][to]) return a; // graceful fallback
  return a * M[from][to];
}
// === Fetch live USD rates once and lock ===
async function fetchRatesOnce(){
  try{
    const localCur = state.current?.localCurrency;
    // סינון כפילויות ומניעת שליחת USD כערך יעד כדי למנוע שגיאה 400
    const to = [...new Set(['ILS', 'EUR', localCur].filter(c => c && c !== 'USD'))];
    const r = await fetch(`https://api.frankfurter.app/latest?from=USD&to=${to.join(',')}`);
    const d = await r.json();
    
    const USDILS = Number(d?.rates?.ILS);
    const USDEUR = Number(d?.rates?.EUR);
    const USDLocal = (localCur) ? Number(d?.rates?.[localCur]) : null;
    
    if(USDILS && USDEUR){
      const rates = { USDILS, USDEUR, lockedAt: new Date().toISOString() };
      if(USDLocal) rates.USDLocal = USDLocal;
      return rates;
    }
  }catch(e){ console.error("Rates fetch failed:", e); }
  return { USDILS: 3.7, USDEUR: 0.92, lockedAt: new Date().toISOString() };
}
var state = globalThis.state || (globalThis.state = {});
try { window.state = state; } catch(_) {}
// === End helpers ===


function stripHtmlToText(v){
  try{
    const s = String(v || '')
      .replace(/<br\s*\/?>/gi, ' ')
      .replace(/<\/p>/gi, ' ')
      .replace(/<[^>]+>/g, ' ')
      .replace(/\s+/g, ' ')
      .trim();
    return s;
  }catch(_){ return ''; }
}
function deriveExpenseTitle(e){
  const title = String(e?.title || '').trim();
  if (title) return title;
  const desc = stripHtmlToText(e?.descHtml || e?.desc || '');
  if (desc) return desc.slice(0, 80);
  return '';
}
function deriveJournalTitle(j){
  const title = String(j?.title || '').trim();
  if (title) return title;
  const place = String(j?.placeName || '').trim();
  if (place) return place;
  const text = stripHtmlToText(j?.html || j?.text || '');
  if (text) return text.slice(0, 80);
  return '';
}

function invalidateMap(m){
  try{ if(m && m.invalidateSize){ m.invalidateSize(); } }catch(e){}
}
try { window.invalidateMap = invalidateMap; } catch(_) {}

// === Map popup helpers ===
function switchToTab(tab){
  try{
    const btn = document.querySelector(`#tabs [data-tab="${tab}"]`);
    if(!btn) return;
    // emulate click
    const currentTab = document.querySelector('#tabs [data-tab].active');
    if(currentTab && currentTab.dataset.tab === 'meta' && state.isDirty){
      // if blocked by unsaved modal, just fallback to click which will trigger modal logic
      btn.click();
      return;
    }
    if (btn.dataset.tab !== 'all') { // If switching to a single view, hide others
      document.querySelectorAll('#tabs [data-tab]').forEach(b=>b.classList.remove('active'));
      btn.classList.add('active');
      document.querySelectorAll('.tabview').forEach(v=> v.hidden = true);
      const v = document.querySelector('#view-'+tab);
      if(v) v.hidden = false;
    }
    if(tab==='map') setTimeout(initBigMap,50);
    try{
      const hb = document.getElementById('overviewHeaderBar');
      if(hb) hb.hidden = isMobileViewport() ? true : (tab !== 'overview');
    }catch(e){}
/* patched switchToTab */
try{
  const views = document.querySelectorAll('.tabview');
  views.forEach(v=>{ v.removeAttribute('data-active'); v.hidden = true; });
  const cur = document.getElementById('view-'+tab);
  if(!cur){ /*log removed*/ }
  else { cur.setAttribute('data-active','1'); cur.hidden = false; }
}catch(e){ console.error(e); }
/* end patched switchToTab */

    try{
      document.querySelectorAll('.tabview').forEach(v=>v.removeAttribute('data-active'));
      const v = document.querySelector('#view-'+tab);
      if(v){ v.setAttribute('data-active','1'); }
    }catch(e){}

    // toggle no-scroll when entering/leaving share tab
    try{
      const rootEls=[document.documentElement, document.body];
      if(tab==='share'){ rootEls.forEach(el=>el.classList.add('share-open')); }
      else { rootEls.forEach(el=>el.classList.remove('share-open')); }
    }catch(_e){}

    if(tab==='overview') { setTimeout(()=> { try{ initBigMap(); }catch(_){} initMiniMap(state.current||{}); invalidateMap(state.maps?.mini); }, 80);}
  }catch(e){}
}

function focusItemInTab(type, id){
  const tab = (type==='expense') ? 'expenses' : 'journal';
  switchToTab(tab);
  // allow render to complete
  setTimeout(()=>{
    if(type==='expense'){
      const el = document.querySelector(`.exp-item[data-id="${id}"]`);
      if(el){
        el.scrollIntoView({behavior:'smooth', block:'center'});
        el.classList.add('flash-green');
        setTimeout(()=> el.classList.remove('flash-green'), 5000);
      }
      return;
    }
    // Journal: highlight the whole record block (header + notes row)
    const head = document.querySelector(`#tblJournal .exp-item[data-id="${id}"]`);
    const notes = head ? head.nextElementSibling : null;
    const list = [head, notes].filter(Boolean);
    if(list.length){
      (head || list[0]).scrollIntoView({behavior:'smooth', block:'center'});
      list.forEach(n => n.classList.add('flash-green'));
      setTimeout(()=> list.forEach(n => n.classList.remove('flash-green')), 5000);
    }
  }, 150);
}

function focusItemOnMap(type, id){
  switchToTab('map');
  setTimeout(()=>{
    try{ initBigMap(); }catch(_){}
    const map = state?.maps?.big;
    if(!map || !id) return;
    let targetLayer = null;
    map.eachLayer(layer=>{
      if(targetLayer) return;
      if(layer && layer.__itemType === type && String(layer.__itemId) === String(id)){
        targetLayer = layer;
      }
    });
    if(!targetLayer) return;
    try{
      if(typeof targetLayer.getBounds === 'function'){
        const bounds = targetLayer.getBounds();
        if(bounds?.isValid?.()) map.fitBounds(bounds.pad(0.2));
      }else if(typeof targetLayer.getLatLng === 'function'){
        map.flyTo(targetLayer.getLatLng(), Math.max(map.getZoom?.() || 12, 15), { duration: 0.45 });
      }
      if(typeof targetLayer.openPopup === 'function'){
        setTimeout(()=>{ try{ targetLayer.openPopup(); }catch(_){} }, 180);
      }
    }catch(_){}
  }, 180);
}

function attachMapPopup(marker, type, id, dataObj){
  try{
    const isExp = (type==='expense');
    const date = fmtDateTime(dataObj.dateIso || dataObj.createdAt || dataObj.ts || dataObj.date);
    
    // בחר את השדה הנכון (locationName להוצאה, placeName ליומן)
    const placeRaw = isExp ? (dataObj.locationName || '') : (dataObj.placeName || '');
    
    // הסרת כפילויות בשם המקום
    const placeParts = (placeRaw || '').split(',').map(s => s.trim()).filter(Boolean);
    const uniqueParts = [...new Set(placeParts)];
    const place = esc(uniqueParts.join(', '));

    // הגדרת שורות סכום וקטגוריה (רק להוצאות)
    const amountLine = isExp ? `<div><strong>סכום:</strong> ${esc(dataObj.amount||'')} ${esc(dataObj.currency||'')}</div>` : '';
    const catLine = isExp ? `<div><strong>קטגוריה:</strong> ${esc(dataObj.category||'')}</div>` : '';
    
    // הכנת שורת תיאור (בין אם זה יומן או הוצאה)
    const rawDesc = isExp ? (dataObj.desc || '') : (dataObj.text || '');
    const descLine = rawDesc ? `<div style="margin-top:4px; word-break: break-word;"><strong>תיאור:</strong> <span class="muted">${linkifyText(rawDesc)}</span></div>` : '';

    const html = `
      <div class="map-popup" style="direction: rtl; text-align: right;">
        <div><strong>${isExp?'הוצאה':'יומן'}</strong></div>
        <div><strong>תאריך:</strong> ${esc(date||'')}</div>
        ${amountLine}
        ${catLine}
        <div><strong>מקום:</strong> ${place}</div>
        ${descLine}
        <div class="popup-actions" style="display:flex;gap:.5rem;margin-top:.5rem; justify-content: flex-end;">
          <button class="btn small" data-act="show" data-type="${isExp?'expense':'journal'}" data-id="${id}">הצג</button>
          ${state.shared.readOnly ? '' : `<button class="btn small" data-act="edit" data-type="${isExp?'expense':'journal'}" data-id="${id}">ערוך</button>`}
          ${state.shared.readOnly ? '' : `<button class="btn small danger" data-act="delete" data-type="${isExp?'expense':'journal'}" data-id="${id}">מחק</button>`}
        </div>
      </div>`;

    marker.bindPopup(html);
    marker.on('popupopen', (ev)=>{
      const root = ev.popup.getElement();
      if(!root) return;
      const showBtn = root.querySelector('button[data-act="show"]');
      if(showBtn){
        showBtn.addEventListener('click', (e)=>{
          e.preventDefault();
          focusItemInTab(showBtn.dataset.type, showBtn.dataset.id);
        });
      }
      const editBtn = root.querySelector('button[data-act="edit"]');
      if (editBtn) {
        editBtn.addEventListener('click', (e) => {
          e.preventDefault();

          const tid = state.currentTripId;
          if (!tid) {
            /*log removed*/
            try { toast('שגיאה: אין נסיעה פעילה לעריכה'); } catch (_) {}
            return;
          }

          if (!state._lastTripObj) {
            /*log removed*/
            try { toast('שגיאה: הנתונים של הנסיעה לא נטענו'); } catch (_) {}
            return;
          }

          const isExpense = (editBtn.dataset.type === 'expense');
          const srcCollection = isExpense ? state._lastTripObj.expenses : state._lastTripObj.journal;

          if (!srcCollection || typeof srcCollection !== 'object') {
            /*log removed*/
            try { toast('לא נמצא פריט לעריכה'); } catch (_) {}
            return;
          }

          const obj = srcCollection[id];

          if (!obj) {
            /*log removed*/
            try { toast('לא נמצא פריט לעריכה (אולי נמחק או עודכן)'); } catch (_) {}
            return;
          }

          /*log removed*/

          if (isExpense) {
            openExpenseModal({ ...obj, id });
          } else {
            openJournalModal({ ...obj, id });
          }
        });
      }
      const deleteBtn = root.querySelector('button[data-act="delete"]');
      if(deleteBtn){
        deleteBtn.addEventListener('click', (e)=>{
          e.preventDefault();
          marker.closePopup?.();
          routeDelete({
            type: deleteBtn.dataset.type,
            id,
            message: deleteBtn.dataset.type === 'expense'
              ? 'האם אתה בטוח שברצונך למחוק הוצאה זו?'
              : 'האם אתה בטוח שברצונך למחוק רישום זה?'
          });
        });
      }
    });
  }catch(e){ console.error('Error in attachMapPopup', e); }
}
// === Filter modal helpers ===
function seedExpenseCategoriesSelect(sel){
  try{
    if(!sel) return;
    sel.innerHTML = '<option value="">הכול</option>';
    const cats = (state.categories?.expenses) || ['טיסה','לינה','תקשורת','רכב','ביטוח בריאות','מזון - מסעדות / סופר','קניות','אטרקציות','תחבורה','אחר'];
    cats.forEach(c=>{
      const opt = document.createElement('option');
      opt.value = c; opt.textContent = c;
      sel.appendChild(opt);
    });
  }catch(e){}
}
function openFilterModal(){
  const d = document.getElementById('filterModal');
  if(!d) return;
  seedExpenseCategoriesSelect(document.getElementById('filterCat'));
  document.getElementById('filterCat').value = state.filters?.expenseCat || '';
  d.showModal();
}
function applyExpenseFilter(){
  const val = (document.getElementById('filterCat')?.value)||'';
  state.filters = state.filters || {};
  state.filters.expenseCat = val;
  document.getElementById('filterModal')?.close();
  if(state._lastTripObj) renderExpenses(state._lastTripObj);
}
function clearExpenseFilter(){
  if(state.filters) state.filters.expenseCat = '';
  document.getElementById('filterModal')?.close();
  if(state._lastTripObj) renderExpenses(state._lastTripObj);
}
document.addEventListener('DOMContentLoaded', ()=>{
  document.getElementById('btnFilterExpenses')?.addEventListener('click', openFilterModal);
  document.getElementById('filterApply')?.addEventListener('click', applyExpenseFilter);
  document.getElementById('filterClear')?.addEventListener('click', clearExpenseFilter);
});
// === End Filter modal helpers ===

// --- wiring for Expense Filter buttons (idempotent) ---
function wireExpenseFilterButtons(){
  const b = document.querySelector('#btnFilterExpenses');
  if (b && !b.dataset.wiredFilter) {
    b.dataset.wiredFilter = '1';
    b.addEventListener('click', openFilterModal);
  }
  const a = document.querySelector('#filterApply');
  if (a && !a.dataset.wiredFilter) {
    a.dataset.wiredFilter = '1';
    a.addEventListener('click', applyExpenseFilter);
  }
  const c = document.querySelector('#filterClear');
  if (c && !c.dataset.wiredFilter) {
    c.dataset.wiredFilter = '1';
    c.addEventListener('click', clearExpenseFilter);
  }
}
document.addEventListener('DOMContentLoaded', wireExpenseFilterButtons);


// Initialize small (overview) map with journal + expense markers
function initMiniMap(t){
  try{
    // Create map once
    if(!state.maps.mini){
      state.maps.mini = L.map('miniMap', { zoomControl: false });
      L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', { attribution: '© OpenStreetMap' })
        .addTo(state.maps.mini);
    }
    // Clear previous layers
    if(state.maps.layers?.miniGroup){
      state.maps.mini.removeLayer(state.maps.layers.miniGroup);
    }
    const group = L.layerGroup().addTo(state.maps.mini);
    state.maps.layers = state.maps.layers || {};
    state.maps.layers.miniGroup = group;

    const pts = [];
    // Expenses markers
    Object.entries(t.expenses||{}).forEach(([id,e])=>{
      if(typeof e.lat==='number' && typeof e.lng==='number'){
        pts.push([e.lat, e.lng]);
        L.circleMarker([e.lat,e.lng], { radius:4, color:'#1a73e8' }).addTo(group);
      }
    });
   // Journal markers (and paths)
    Object.entries(t.journal||{}).forEach(([id,j])=>{
      if (j.path && Array.isArray(j.path) && j.path.length > 1) {
          // --- התיקון: המרה של מבנה הנקודות עבור Leaflet ---
          const leafletPath = j.path.map(p => [p.lat, p.lng]);
          L.polyline(leafletPath, { color: '#007bff', weight: 3 }).addTo(group);
          pts.push(...leafletPath); // הוסף את כל הנקודות לחישוב ה-bounds
          // --- סוף התיקון ---
          
          // הוסף מרקר בנקודת ההתחלה עם פופאפ
          if (typeof j.lat === 'number' && typeof j.lng === 'number') {
              ((m=>{attachMapPopup(m,'journal', id, j); m.addTo(group);}))(L.circleMarker([j.lat,j.lng], { radius:4, color:'#34a853' }))
          }
      } else if (typeof j.lat==='number' && typeof j.lng==='number') {
        // התנהגות רגילה עבור נקודות יומן בודדות
        pts.push([j.lat, j.lng]);
        ((m=>{attachMapPopup(m,'journal', id, j); m.addTo(group);}))(L.circleMarker([j.lat,j.lng], { radius:4, color:'#34a853' }))
      }
    });

    if(pts.length){
      const b = L.latLngBounds(pts);
      state.maps.mini.fitBounds(b.pad(0.2));
    }else{
      state.maps.mini.setView([32.0853,34.7818], 6);
    }
    invalidateMap(state.maps.mini);
  }catch(e){ console.error('initMiniMap error', e); }
}

// Initialize big map (map tab) and reuse same data set when switching
function initBigMap() {
  const emailSpan = document.getElementById('currentUserEmail');

  try{
    if(!state.maps.big){
      state.maps.big = L.map('bigMap');
      L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', { attribution: '© OpenStreetMap' }).addTo(state.maps.big);
    }
    const ref = state.currentTripId;
    if(!ref){ invalidateMap(state.maps.big); return; }

    state.maps.layers = state.maps.layers || {};
    if(state.maps.layers.expenses){ state.maps.big.removeLayer(state.maps.layers.expenses); }
    if(state.maps.layers.journal){  state.maps.big.removeLayer(state.maps.layers.journal); }

    const expensesLG = L.layerGroup();
    const journalLG  = L.layerGroup();
    state.maps.layers.expenses = expensesLG;
    state.maps.layers.journal  = journalLG;

    const pts = [];
    if(state._lastTripObj){
      const expEntries = _sortByCreated(Object.entries(state._lastTripObj.expenses||{}));
      let expIndex = 1;
      expEntries.forEach(([id,e])=>{
        if(typeof e.lat==='number' && typeof e.lng==='number'){
          pts.push([e.lat,e.lng]);
          ((m=>{attachMapPopup(m,'expense', id, e); m.addTo(expensesLG);})(_numberedMarker(e.lat, e.lng, expIndex++, 'expense')));
        }
      });

const jourEntries = _sortByCreated(Object.entries(state._lastTripObj.journal||{}));

      let jourIndex = 1;
      jourEntries.forEach(([id,j])=>{
        if (j.path && Array.isArray(j.path) && j.path.length > 1) {
            // --- התיקון: המרה של מבנה הנקודות עבור Leaflet ---
            const leafletPath = j.path.map(p => [p.lat, p.lng]);
            L.polyline(leafletPath, { color: '#007bff', weight: 3 }).addTo(journalLG);
            pts.push(...leafletPath);
            // --- סוף התיקון ---

            // הוסף מרקר ממוספר בנקודת ההתחלה עם פופאפ
            if (typeof j.lat === 'number' && typeof j.lng === 'number') {
                 ((m=>{attachMapPopup(m,'journal', id, j); m.addTo(journalLG);})(_numberedMarker(j.lat, j.lng, jourIndex++, 'journal')));
            }
        } else if (typeof j.lat==='number' && typeof j.lng==='number') {
          // התנהגות רגילה עבור נקודות בודדות
          pts.push([j.lat,j.lng]);
          ((m=>{attachMapPopup(m,'journal', id, j); m.addTo(journalLG);})(_numberedMarker(j.lat, j.lng, jourIndex++, 'journal')));
        }
      });

      if(pts.length){
        const b = L.latLngBounds(pts);
        state.maps.big.fitBounds(b.pad(0.2));
      } else {
      if(emailSpan){ emailSpan.textContent=''; emailSpan.style.display='none'; }
      if(btnLogin) btnLogin.style.display='inline-block';
      const ub=document.getElementById('userBadge'); if(ub) ub.style.display='none';
        state.maps.big.setView([32.0853,34.7818], 6);
      }
    }

    state.maps.big.addLayer(expensesLG);
    state.maps.big.addLayer(journalLG);
    document.getElementById('btnToggleSpent')?.classList.add('active');
    document.getElementById('btnToggleVisited')?.classList.add('active');
    // --- Map toolbar: toggle visibility of layers + button state ---
    const btnSpent   = document.getElementById('btnToggleSpent');
    const btnVisited = document.getElementById('btnToggleVisited');

    function applyMapToolbarVisibility(){
      if(btnSpent && btnSpent.classList.contains('active')){
        if(!state.maps.big.hasLayer(expensesLG)) state.maps.big.addLayer(expensesLG);
      } else {
        if(state.maps.big.hasLayer(expensesLG)) state.maps.big.removeLayer(expensesLG);
      }
      if(btnVisited && btnVisited.classList.contains('active')){
        if(!state.maps.big.hasLayer(journalLG)) state.maps.big.addLayer(journalLG);
      } else {
        if(state.maps.big.hasLayer(journalLG)) state.maps.big.removeLayer(journalLG);
      }
      invalidateMap(state.maps.big);
    }
    btnSpent?.addEventListener('click', ()=>{ btnSpent.classList.toggle('active'); applyMapToolbarVisibility(); });
    btnVisited?.addEventListener('click', ()=>{ btnVisited.classList.toggle('active'); applyMapToolbarVisibility(); });
    // ensure initial visibility matches default state
    applyMapToolbarVisibility();
    

    invalidateMap(state.maps.big);
  }catch(e){ console.error('initBigMap error', e); }
}







// Create a numbered marker icon
function _numberedMarker(lat, lng, n, kind){
  const cls = (kind==='expense') ? 'red' : 'green';
  const html = `<div class="num-pin ${cls}">${n}</div>`;
  const icon = L.divIcon({ className:'', html, iconSize:[28,28], iconAnchor:[14,28] });
  return L.marker([lat,lng], { icon: icon });
}
// Sort items by created timestamp if possible (fallback to key)
function _sortByCreated(entries){
  return entries.sort((a,b)=>{
    const av = (a[1] && (a[1].createdAt || a[1].ts || a[1].time || a[1].date)) || 0;
    const bv = (b[1] && (b[1].createdAt || b[1].ts || b[1].time || b[1].date)) || 0;
    if(av && bv){
      const an = Number(new Date(av)); const bn = Number(new Date(bv));
      if(!isNaN(an) && !isNaN(bn)) return an - bn;
    }
    // fallback: by key
    return String(a[0]).localeCompare(String(b[0]));
  });
}


// Day.js setup

function esc(s){
  if (s === null || s === undefined) return '';
  return String(s)
    .replace(/&/g,'&')
    .replace(/</g,'<')
    .replace(/>/g,'>')
    .replace(/"/g,'"')
    .replace(/'/g,'\'');
}


// Safe Day.js plugin setup (guards against missing plugins due to blocked CDN)
try {
  if (typeof dayjs!=='undefined') {
    if (window.dayjs_plugin_advancedFormat) { try { dayjs.extend(window.dayjs_plugin_advancedFormat); } catch(e){} }
    if (window.dayjs_plugin_utc) { try { dayjs.extend(window.dayjs_plugin_utc); } catch(e){} }
    if (window.dayjs_plugin_timezone) { try { dayjs.extend(window.dayjs_plugin_timezone); } catch(e){} }
  }
} catch(e) { /* ignore */ }
// App State (preserve existing global state instead of replacing it)
state = Object.assign(state, {
  user: state.user ?? null,
  trips: state.trips ?? [],
  current: state.current ?? null,
  currentTripId: state.currentTripId ?? null,
  viewMode: state.viewMode ?? 'grid',
  lastNonMapView: state.lastNonMapView ?? 'grid',
  rates: state.rates ?? { USDEUR: 0.92, USDILS: 3.7 },
  maps: state.maps ?? { mini: null, big: null, home: null, layers: { expenses: null, journal: null }, select: null, selectMarker: null, currentModal: null },
  shared: state.shared ?? { enabled: false, token: null, readOnly: false },
  filters: state.filters ?? {},
  homeMapSelection: state.homeMapSelection ?? null,
  categories: state.categories ?? {},
  isDirty: state.isDirty ?? false,
  allSort: state.allSort ?? 'desc'
});
try { globalThis.state = state; window.state = state; } catch(_) {}

const $ = sel => document.querySelector(sel);
const $$ = sel => Array.from(document.querySelectorAll(sel));

// --- Numeric helpers for budget display (thousands separator, integers only) ---

// === Place display helpers (compact link) ===
function _isUrl(s){ return typeof s==='string' && /^https?:\/\//i.test(s.trim()); }
function _dec(s){ try{return decodeURIComponent(s);}catch(_){return s||'';} }
function _extractNameFromUrl(u){
  try{
    const url=new URL(u);
    const q=url.searchParams.get('q')||url.searchParams.get('query');
    if(q){ return _dec(q).replaceAll('+',' ').replace(/[\-_]+/g,' ').trim(); }
    // try /place/<name>/ or last segment
    const segs=_dec(url.pathname).split('/').filter(Boolean);
    const idx=segs.lastIndexOf('place');
    if(idx>=0 && segs[idx+1]) return segs[idx+1].replace(/[\-_]+/g,' ').trim();
    return (segs.pop()||'').replace(/[\-_]+/g,' ').trim();
  }catch(_){ return String(u||''); }
}
function _displayNameCityCountry(raw){
  if(!raw) return '';
  let t=String(raw).trim();
  if(_isUrl(t)) t=_extractNameFromUrl(t);
  t=_dec(t).replace(/[\-_]+/g,' ');
  const parts=t.split(/\s*,\s*|\s*-\s*|\s*\|\s*/).map(s=>s.trim()).filter(Boolean);
  return parts.slice(0,3).join(', ');
}
function placeLinkHtml(e){
  const raw = e && e.locationName;
  if(!raw) return '';
  const name=_displayNameCityCountry(raw);
  let href=null;
  if(e && typeof e.lat==='number' && typeof e.lng==='number' && isFinite(e.lat) && isFinite(e.lng)){
    // FIX: Added missing backtick after the 0
    href=`https://maps.google.com/?q=${e.lat},${e.lng}`;
  }else if(_isUrl(raw)){ href=raw.trim(); }
  if(href){ return `<a href="${encodeURI(href)}" target="_blank" rel="noopener">${esc(name||raw)}</a>`; }
  return esc(name||raw);
}
// === End helpers ===
function formatInt(n){
  n = Math.floor(Number(n)||0);
  return n.toString().replace(/\B(?=(\d{3})+(?!\d))/g, ",");
}
function formatIntSigned(n){
  const num = Math.floor(Number(n)||0);
  const sign = num < 0 ? "-" : "";
  const abs = Math.abs(num);
  return sign + abs.toString().replace(/\B(?=(\d{3})+(?!\d))/g, ",");
}
function parseIntSafe(s){
  const n = String(s||'').replace(/[^\d-]/g,''); // allow minus sign
  return Math.floor(Number(n||0)||0);
}

const showToast = (msg) => { const t = $('#toast'); t.textContent = msg; t.classList.add('show'); setTimeout(()=>t.classList.remove('show'), 2600); };
function syncHomeMapMode(){
  const container = document.querySelector('.container');
  if(!container) return;
  container.classList.toggle('home-map-mode', container.classList.contains('home-mode') && state.viewMode === 'map');
}

// Mode management: 'home' (pick a trip) vs 'trip' (focus one)
function enterHomeMode(){
  const container = document.querySelector('.container');
  container.classList.add('home-mode');
  container.classList.remove('trip-mode');
  syncHomeMapMode();
  $('#tabs').style.display = 'none';
  $('#btnAllTrips').style.display = 'none';
  state.currentTripId = null;
  updateHeaderDestination();
  showView('welcome');
}
function enterTripMode(){
  const container = document.querySelector('.container');
  container.classList.add('trip-mode');
  container.classList.remove('home-mode');
  syncHomeMapMode();
  if(!isMobileViewport()) $('#tabs').style.display = 'flex';
  $('#btnAllTrips').style.display = 'inline-block';
  updateHeaderDestination();
}


function updateHeaderDestination(){
  try{
    const el = document.getElementById('headerDest');
    if(!el) return;
    const inTripMode = !!document.querySelector('.container.trip-mode');
    if(!inTripMode){
      el.textContent = '';
      el.style.display = 'none';
      return;
    }
    const name = (state && state.current && state.current.destination) ? String(state.current.destination).trim() : '';
    if(name){
      el.textContent = name;
      el.style.display = 'inline-block';
    }else{
      el.textContent = '';
      el.style.display = 'none';
    }
  }catch(_){}
}

$('#btnAllTrips').addEventListener('click', enterHomeMode);

syncThemeToggleButton();

// Tabs logic (supports non-button tab widgets like the Overview dropdown)
function getActiveTabEl(){
  return document.querySelector('#tabs [data-tab].active');
}
function setActiveTab(nextEl){
  document.querySelectorAll('#tabs [data-tab]').forEach(b=>b.classList.remove('active'));
  nextEl.classList.add('active');
}

document.querySelectorAll('#tabs [data-tab]').forEach(el => el.addEventListener('click', (e) => {
  const currentTab = getActiveTabEl();
  const nextTab = el.dataset.tab;
  
    if(!nextTab){ return; }
  if (currentTab && currentTab.dataset.tab === 'meta' && state.isDirty) {
    e.preventDefault();
    showUnsavedChangesAlert(nextTab);
    return;
  }

  if (el.classList.contains('active')) return;
  setActiveTab(el);
  showView(nextTab);
  if(nextTab==='map') setTimeout(initBigMap, 50);
  if(nextTab==='overview') { setTimeout(()=> { try{ initBigMap(); }catch(_){} initMiniMap(state.current||{}); invalidateMap(state.maps?.mini); }, 80);}
}));

ensureOverviewNavSelectRemoved();
// (old Auth UI block removed – using unified handler below)

// Handle share link mode (read-only)
const url = new URL(location.href);
const token = url.searchParams.get('share');
const tripId = url.searchParams.get('tripId');
if (token && tripId) {
  state.shared.readOnly = true;
  state.currentTripId = tripId;
  $('#sidebar').style.display = 'none';
  $('#btnLogin').style.display = 'none';
  $('#btnLogout').style.display = 'none';
  if(!isMobileViewport()) $('#tabs').style.display = 'flex';
  // Switch to trip-mode so content is visible
  const container = document.querySelector('.container');
  container.classList.remove('home-mode'); container.classList.add('trip-mode');
  // Only journal + map
  $$('#tabs [data-tab]').forEach(b=>{ if(!['journal','map'].includes(b.dataset.tab)) b.style.display='none'; });
  showView('journal');
  await loadSharedTrip(tripId, token);
}


// Date formatting helper used by trip cards
function fmtDate(d){
  if(!d) return '';
  try{ return dayjs(d).format('DD/MM/YYYY'); }
  catch(e){ return String(d||''); }
}
// Add the missing fmtDateTime function
function fmtDateTime(d){
  if(!d) return '';
  try{ return dayjs(d).format('DD/MM/YYYY HH:mm'); }
  catch(e){ return String(d||''); }
}

// Robust sort key for expenses (handles legacy fields)
function expenseSortKey(e){ const candidates = [e.dateIso, e.createdAt, e.date, e.time, e.ts, e.timestamp];
  for (const v of candidates){
    if(!v) continue;
    const d = new Date(v);
    if(!isNaN(d)) return d.getTime();
    const n = Number(v);
    if(!isNaN(n)) return n;
  }
  return 0; // fallback
}
function num(n){
  if (typeof n !== 'number') return '';
  return n.toLocaleString('he-IL', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}
function xErr(e){
  const msg = e?.message || String(e);
  if (msg.includes('auth/invalid-email')) return 'מייל לא תקין';
  if (msg.includes('auth/weak-password')) return 'סיסמה חלשה (6 תווים ומעלה)';
  if (msg.includes('auth/email-already-in-use')) return 'מייל כבר קיים במערכת';
  if (msg.includes('auth/wrong-password') || msg.includes('auth/invalid-credential')) return 'שם משתמש או סיסמה שגויים';
  if (msg.includes('auth/user-not-found')) return 'משתמש לא נמצא';
  return 'שגיאה: ' + msg;
}
function numOrNull(s){
  const n = Number(s);
  return isNaN(n) ? null : n;
}
const __baseXErr = xErr;
xErr = function(e){
  const msg = e?.message || String(e);
  if (msg.includes('auth/too-many-requests')) return 'יותר מדי ניסיונות. נסה שוב בעוד כמה דקות';
  if (msg.includes('auth/network-request-failed') || msg.includes('ERR_CONNECTION_CLOSED')) return 'לא ניתן להגיע לשרתי Firebase. בדוק חיבור, VPN, חומת אש, אנטי-וירוס או תוסף דפדפן שחוסם בקשות ל-googleapis.com';
  if (msg.includes('auth/user-disabled')) return 'המשתמש הזה הושבת';
  if (msg.includes('auth/operation-not-allowed')) return 'שיטת ההתחברות הזו לא פעילה ב-Firebase';
  if (msg.includes('auth/unauthorized-domain')) return 'הדומיין הזה לא מורשה ב-Firebase Auth';
  return __baseXErr(e);
};
function ensureMobileAuthDebug(){
  let root = document.getElementById('mobileAuthDebug');
  if(root) return root;
  root = document.createElement('div');
  root.id = 'mobileAuthDebug';
  root.innerHTML = `
    <div id="mobileAuthDebugCard" role="dialog" aria-modal="true" aria-labelledby="mobileAuthDebugTitle">
      <h3 id="mobileAuthDebugTitle">שגיאת התחברות במובייל</h3>
      <p id="mobileAuthDebugMessage"></p>
      <pre id="mobileAuthDebugRaw"></pre>
      <div id="mobileAuthDebugActions">
        <button id="mobileAuthDebugClose" class="btn primary" type="button">סגור</button>
      </div>
    </div>
  `;
  document.body.appendChild(root);
  root.querySelector('#mobileAuthDebugClose')?.addEventListener('click', ()=> root.classList.remove('show'));
  root.addEventListener('click', (ev)=>{
    if(ev.target === root) root.classList.remove('show');
  });
  return root;
}
function showMobileAuthDebug(error){
  const isMobileViewport = typeof window.__isMobileViewport === 'function'
    ? window.__isMobileViewport()
    : (window.innerWidth <= 820);
  if(!isMobileViewport) return;
  const root = ensureMobileAuthDebug();
  const pretty = xErr(error);
  const raw = (error?.code ? `${error.code}\n` : '') + (error?.message || String(error || 'Unknown auth error'));
  const msgEl = root.querySelector('#mobileAuthDebugMessage');
  const rawEl = root.querySelector('#mobileAuthDebugRaw');
  if(msgEl) msgEl.textContent = pretty;
  if(rawEl) rawEl.textContent = raw;
  root.classList.add('show');
}
function getActiveCurrencyFromTrip(t){
  return localStorage.getItem(`flymily_currency_${t.id}`) || 'ILS'; // Changed default to ILS to match the image
}
function setActiveCurrency(cur){
  localStorage.setItem(`flymily_currency_${state.current.id}`, cur);
}
// UPDATED `cycleCurrency` to ensure only USD, EUR, ILS are used
function cycleCurrency(cur){
  const opts = ['USD', 'EUR', 'ILS'];
  const idx = opts.indexOf(cur);
  return opts[(idx + 1) % opts.length];
}
// Firestore: subscribe to user's trips (no orderBy to avoid index; sort client-side)
let __subTripsTimer=null;
let __tripListBackfillTimer=null;
let __subscribeTripsStartedAt = 0;
let __tripSummaryFallbackStarted = false;

function tripSummaryRef(id){
  return FB.doc(db, 'tripSummaries', id);
}

function tripSummaryCacheKey(uid){
  return `flymily_trip_summaries_${uid || 'anon'}`;
}

function tripSummaryHydratedKey(uid){
  return `flymily_trip_summaries_hydrated_${uid || 'anon'}`;
}

function hasHydratedTripSummaries(uid){
  try{
    return localStorage.getItem(tripSummaryHydratedKey(uid)) === '1';
  }catch(_){
    return false;
  }
}

function markTripSummariesHydrated(uid){
  try{
    if(!uid) return;
    localStorage.setItem(tripSummaryHydratedKey(uid), '1');
  }catch(_){}
}

function saveTripSummariesCache(uid, trips){
  try{
    if(!uid) return;
    const payload = {
      savedAt: new Date().toISOString(),
      trips: (trips || []).map(t => buildTripSummary(t))
    };
    localStorage.setItem(tripSummaryCacheKey(uid), JSON.stringify(payload));
  }catch(_){}
}

function loadTripSummariesCache(uid){
  try{
    if(!uid) return [];
    const raw = localStorage.getItem(tripSummaryCacheKey(uid));
    if(!raw) return [];
    const parsed = JSON.parse(raw);
    if(!Array.isArray(parsed?.trips)) return [];
    return parsed.trips.map(t => buildTripSummary(t));
  }catch(_){
    return [];
  }
}

function tripCacheKey(uid, tripId){
  return `flymily_trip_cache_${uid || 'anon'}_${tripId || 'none'}`;
}

function saveTripCache(uid, trip){
  try{
    if(!uid || !trip?.id) return;
    const payload = {
      savedAt: new Date().toISOString(),
      trip: normalizeTripShape(trip)
    };
    localStorage.setItem(tripCacheKey(uid, trip.id), JSON.stringify(payload));
  }catch(_){}
}

function loadTripCache(uid, tripId){
  try{
    if(!uid || !tripId) return null;
    const raw = localStorage.getItem(tripCacheKey(uid, tripId));
    if(!raw) return null;
    const parsed = JSON.parse(raw);
    if(!parsed?.trip) return null;
    return normalizeTripShape(parsed.trip);
  }catch(_){
    return null;
  }
}

function buildTripSummary(trip){
  const normalized = normalizeTripShape(trip || {});
  return {
    id: normalized.id || trip?.id || null,
    ownerUid: normalized.ownerUid || trip?.ownerUid || state?.user?.uid || null,
    destination: normalized.destination || '',
    start: normalized.start || '',
    end: normalized.end || '',
    localCurrency: normalized.localCurrency || null,
    people: Array.isArray(normalized.people) ? normalized.people : [],
    types: Array.isArray(normalized.types) ? normalized.types : [],
    createdAt: normalized.createdAt || trip?.createdAt || new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    expenses: {},
    journal: {}
  };
}

async function upsertTripSummary(trip){
  try{
    const summary = buildTripSummary(trip);
    if(!summary.id || !summary.ownerUid) return;
    await FB.setDoc(tripSummaryRef(summary.id), summary, { merge:true });
  }catch(_){}
}

async function deleteTripSummary(id){
  try{
    if(!id) return;
    await FB.deleteDoc(tripSummaryRef(id));
  }catch(_){}
}

function normalizeTripSummaryDoc(doc){
  const raw = doc?.data ? { id: doc.id, ...doc.data() } : doc;
  return buildTripSummary(raw);
}

function scheduleTripListBackfill(trips){
  if(__tripListBackfillTimer){
    clearTimeout(__tripListBackfillTimer);
    __tripListBackfillTimer = null;
  }
  const targets = (trips || []).filter(trip=>{
    if(!trip?.id) return false;
    const missingCurrency = !trip.localCurrency;
    const missingBudget = !trip.budget || typeof trip.budget !== 'object';
    const missingRates = !trip.rates || !Number(trip.rates?.USDILS) || !Number(trip.rates?.USDEUR);
    return missingCurrency || missingBudget || missingRates;
  }).slice(0, 2);
  if(!targets.length) return;
  __tripListBackfillTimer = setTimeout(()=>{
    targets.forEach(trip => { try{ backfillTripVersionFields(trip); }catch(_){} });
  }, 1200);
}

function applyTripsSnapshotPerf(snapAt, snapSize){
  try{
    window.__lastTripsSnapshotPerf = {
      docs: snapSize,
      subscribeToSnapshotMs: Math.round(snapAt - __subscribeTripsStartedAt)
    };
    console.info('[perf] tripsSnapshot', window.__lastTripsSnapshotPerf);
  }catch(_){}
}

function subscribeTripsFull(reason='fallback'){
  try { state._unsubTripsFallback && state._unsubTripsFallback(); } catch(_) {}
  const q = FB.query(FB.collection(db, 'trips'), FB.where('ownerUid', '==', state.user.uid));
  state._unsubTripsFallback = FB.onSnapshot(q, (snap)=>{
    const snapAt = (typeof performance !== 'undefined' && performance.now ? performance.now() : Date.now());
    state.trips = snap.docs
      .map(d=> normalizeTripShape({ id:d.id, ...d.data() }))
      .sort((a,b)=> (b.start||'').localeCompare(a.start||''));
    renderTripList();
    setTimeout(()=>{ try{ maybeShowTodayPromptFromTrips(state.trips); }catch(_){ } }, 0);
    saveTripSummariesCache(state.user?.uid, state.trips);
    applyTripsSnapshotPerf(snapAt, snap.size);
    scheduleTripListBackfill(state.trips);
    state.trips.forEach(trip => { try{ upsertTripSummary(trip); }catch(_){} });
    markTripSummariesHydrated(state.user?.uid);
  }, (err)=>{
    try{ state._unsubTripsFallback && state._unsubTripsFallback(); }catch(_){}
    if(String(err).includes('Missing or insufficient permissions')){
      __subTripsTimer = setTimeout(()=>{ try{ subscribeTrips(); }catch(_){} }, 800);
      return;
    }
    console.warn('subscribeTripsFull failed', reason, err);
    showToast('אין הרשאה לקרוא נתונים (בדוק התחברות/חוקי Firestore)');
  });
}

function subscribeTrips(){
  if(__subTripsTimer){ clearTimeout(__subTripsTimer); __subTripsTimer=null; }
  if (!state.user || !state.user.uid) {
    return;
  }
  __tripSummaryFallbackStarted = false;
  __subscribeTripsStartedAt = (typeof performance !== 'undefined' && performance.now ? performance.now() : Date.now());
  const cachedTrips = loadTripSummariesCache(state.user.uid)
    .sort((a,b)=> (b.start||'').localeCompare(a.start||''));
  if(cachedTrips.length){
    state.trips = cachedTrips;
    renderTripList();
    setTimeout(()=>{ try{ maybeShowTodayPromptFromTrips(state.trips); }catch(_){ } }, 0);
  }
  try { state._unsubTrips && state._unsubTrips(); } catch(_) {}
  try { state._unsubTripsFallback && state._unsubTripsFallback(); } catch(_) {}
  const q = FB.query(FB.collection(db, 'tripSummaries'), FB.where('ownerUid', '==', state.user.uid));
  state._unsubTrips = FB.onSnapshot(q, (snap)=>{
    const snapAt = (typeof performance !== 'undefined' && performance.now ? performance.now() : Date.now());
    if(snap.size === 0){
      state.trips = [];
      renderTripList();
      applyTripsSnapshotPerf(snapAt, snap.size);
      if(!__tripSummaryFallbackStarted){
        __tripSummaryFallbackStarted = true;
        subscribeTripsFull('empty-tripSummaries');
      }
      return;
    }
    try { state._unsubTripsFallback && state._unsubTripsFallback(); } catch(_) {}
    state.trips = snap.docs
      .map(d=> normalizeTripSummaryDoc(d))
      .sort((a,b)=> (b.start||'').localeCompare(a.start||''));
    renderTripList();
    setTimeout(()=>{ try{ maybeShowTodayPromptFromTrips(state.trips); }catch(_){ } }, 0);
    saveTripSummariesCache(state.user?.uid, state.trips);
    applyTripsSnapshotPerf(snapAt, snap.size);
    if(!hasHydratedTripSummaries(state.user?.uid) && !__tripSummaryFallbackStarted){
      __tripSummaryFallbackStarted = true;
      subscribeTripsFull('hydrate-tripSummaries');
    }
  }, (err)=>{
    try{ state._unsubTrips && state._unsubTrips(); }catch(_){}
    console.warn('tripSummaries subscription failed, falling back to trips', err);
    if(!__tripSummaryFallbackStarted){
      __tripSummaryFallbackStarted = true;
      subscribeTripsFull('tripSummaries-error');
    }
  });
}
async function renderTripList(){
  const perfNow = ()=> (typeof performance !== 'undefined' && performance.now ? performance.now() : Date.now());
  const renderStart = perfNow();
  const list = $('#tripList');
  if(!list) return;
  syncHomeMapMode();
  const searchInput = $('#searchTrips');
  const rawSearch = searchInput?.value?.trim() || '';
  const userEmail = String(state.user?.email || '').trim().toLowerCase();
  const search = rawSearch.toLowerCase() === userEmail ? '' : rawSearch;
  if(searchInput && rawSearch && !search){
    searchInput.value = '';
  }
  let items = [...state.trips];
  let s = null;
  if(search){
    s = search.toLowerCase();
    items = items.map(t=> ({...t, __match: matchInfo(t, s)}))
                 .filter(t=> t.__match.hit)
                 .sort((a,b)=> b.__match.score - a.__match.score);
  }
  state._tripListRenderToken = (state._tripListRenderToken || 0) + 1;
  const renderToken = state._tripListRenderToken;
  list.className = state.viewMode === 'map' ? 'map-view' : (state.viewMode==='grid' ? 'grid' : 'list');
  if(state.viewMode !== 'map' && items.length === 0){
    const msg = search
      ? 'לא נמצאו נסיעות שמתאימות לחיפוש.'
      : 'התחברת בהצלחה. עדיין אין נסיעות בחשבון הזה.';
    list.innerHTML = `
      <div class="trip-list-empty" role="status" aria-live="polite">
        <strong>${msg}</strong>
        <span>אפשר ללחוץ על "נסיעה חדשה +" כדי ליצור נסיעה ראשונה.</span>
      </div>`;
    ['btnViewGrid','btnViewList','btnViewMap'].forEach(id => document.getElementById(id)?.classList.remove('active'));
    document.getElementById(`btnView${state.viewMode==='grid' ? 'Grid' : state.viewMode==='list' ? 'List' : 'Map'}`)?.classList.add('active');
    try{
      window.__lastRenderTripListPerf = {
        items: items.length,
        mode: state.viewMode,
        ms: Math.round(perfNow() - renderStart)
      };
      console.info('[perf] renderTripList', window.__lastRenderTripListPerf);
    }catch(_){}
    return;
  }
  if(state.viewMode === 'map'){
    await renderTripMapView(items, renderToken);
  } else {
    list.innerHTML = items.map(t=> state.viewMode==='grid' ? cardHTML(t, s) : rowHTML(t, s)).join('');
    if(renderToken !== state._tripListRenderToken) return;
    list.querySelectorAll('[data-trip]').forEach(el=>{
      el.addEventListener('click', ()=> openTrip(el.dataset.trip));
    });
    list.querySelectorAll('.menu-btn').forEach(btn => {
      btn.addEventListener('click', (e) => {
        e.stopPropagation();
        _rowActionTrip = state.trips.find(t => t.id === btn.dataset.id);
        $('#rowMenuModal').showModal();
      });
    });
  }
  ['btnViewGrid','btnViewList','btnViewMap'].forEach(id => document.getElementById(id)?.classList.remove('active'));
  document.getElementById(`btnView${state.viewMode==='grid' ? 'Grid' : state.viewMode==='list' ? 'List' : 'Map'}`)?.classList.add('active');
  try{
    window.__lastRenderTripListPerf = {
      items: items.length,
      mode: state.viewMode,
      ms: Math.round(perfNow() - renderStart)
    };
    console.info('[perf] renderTripList', window.__lastRenderTripListPerf);
  }catch(_){}
}
function cardHTML(t, s){
  const period = `${fmtDate(t.start)} – ${fmtDate(t.end)}`;
  const where = t.__match?.where || [];
  return `<div class="trip-card" data-trip="${t.id}">
    <div>
        <strong>${esc(t.destination||'ללא יעד')}</strong>
    </div>
    <div class="muted">${period}</div>
    <div class="trip-footer-grid">
      <div class="pill types-pill" data-trip="${t.id}" data-keyword="${esc((t.types||'').toString())}">${esc((t.types||'').toString())}</div>
      <button class="menu-btn" data-id="${t.id}" aria-label="פעולות">
        <svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="lucide lucide-more-vertical"><circle cx="12" cy="12" r="1"/><circle cx="12" cy="5" r="1"/><circle cx="12" cy="19" r="1"/></svg>
      </button>
    </div>
    ${s ? `<div class="muted" style="margin-top:6px;width:100%">התאמות: ${where.map(w=>`<span class="pill hl-pill" data-trip="${t.id}" data-term="${s}" data-type="${w.type}" data-item="${w.itemId}">${w.label}</span>`).join(' ')}</div>` : ''}
  </div>`;
}
function rowHTML(t, s){
  const period = `${fmtDate(t.start)} – ${fmtDate(t.end)}`;
  const where = t.__match?.where || [];
  return `<div class="trip-row" data-trip="${t.id}">
    <div class="row-main-content">
      <strong>${esc(t.destination||'ללא יעד')}</strong>
      <span class="muted">${period}</span>
      <div class="pill types-pill" data-trip="${t.id}" data-keyword="${esc((t.types||'').toString())}">${esc((t.types||'').toString())}</div>
    </div>
    <button class="menu-btn" data-id="${t.id}" aria-label="פעולות">
      <svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="lucide lucide-more-vertical"><circle cx="12" cy="12" r="1"/><circle cx="12" cy="5" r="1"/><circle cx="12" cy="19" r="1"/></svg>
    </button>
    ${s ? `<div class="muted" style="grid-column:1/-1;margin-top:4px">התאמות: ${where.map(w=>`<span class="pill hl-pill" data-trip="${t.id}" data-term="${s}" data-type="${w.type}" data-item="${w.itemId}">${w.label}</span>`).join(' ')}</div>` : ''}
  </div>`;
}

function showView(view){
  try {
    // alias old/new names
    if(view==='overview' && !document.querySelector('#view-overview') && document.querySelector('#view-welcome')){
      view = 'welcome';
    }
    // deactivate all
    document.querySelectorAll('.tabview').forEach(v=>{
      if(!v) return;
      v.removeAttribute('data-active');
      v.setAttribute('hidden','');
    });
    // activate target
    const el = document.querySelector('#view-' + view);
    if (el) {
      el.setAttribute('data-active','1');
      el.removeAttribute('hidden');
    } else {
    }

    // Show the Overview toolbar (header bar) only when the Overview tab is active.
    // The toolbar itself lives next to the "ייבוא / ייצוא / שיתוף" tab button,
    // but we do not want it visible in other tabs.
    try {
      const hb = document.getElementById('overviewHeaderBar');
      if (hb) hb.hidden = isMobileViewport() ? true : (view !== 'overview');
    } catch(_e){}
  } catch(e){ /*log removed*/ }
}

// Open a trip -> Overview tab
async function openTrip(id){
  state.currentTripId = id;
  enterTripMode();
  $$('#tabs [data-tab]').forEach(b=>b.classList.remove('active'));
  const first = $('#tabs [data-tab="overview"]');
  if(first){
    first.classList.add('active');
  }
  showView('overview');
  state.overviewMode = 'all';
  try { localStorage.setItem('overviewMode', 'all'); } catch (_) {}
  try { syncOverviewTabLabel(); } catch (_) {}
  try{
    const cachedTrip = loadTripCache(state.user?.uid, id);
    if(cachedTrip){
      state.current = { ...cachedTrip, id };
      state._lastTripObj = state.current;
      updateHeaderDestination();
      renderAllTimeline(state.current, state.allSort || 'desc');
      renderExpenseSummary(state.current);
    }
  }catch(_){}
  await loadTrip();
}

// Function to map destination/country to currency (supports Hebrew + English + common variants)
const localCurrencyMap = {
  // Europe
  "בולגריה":"BGN","Bulgaria":"BGN","bulgaria":"BGN",
  "רומניה":"RON","Romania":"RON","romania":"RON",
  "גיאורגיה":"GEL","גאורגיה":"GEL","Georgia":"GEL","georgia":"GEL",
  "פולין":"PLN","Poland":"PLN","poland":"PLN",
  "צ'כיה":"CZK","צכיה":"CZK","Czech":"CZK","Czechia":"CZK","czech":"CZK","czechia":"CZK",
  "הונגריה":"HUF","Hungary":"HUF","hungary":"HUF",
  "שוויץ":"CHF","שווייץ":"CHF","Switzerland":"CHF","switzerland":"CHF",
  "בריטניה":"GBP","אנגליה":"GBP","UK":"GBP","United Kingdom":"GBP","Britain":"GBP","England":"GBP","uk":"GBP",
  "צרפת":"EUR","France":"EUR","france":"EUR",
  "גרמניה":"EUR","Germany":"EUR","germany":"EUR",
  "איטליה":"EUR","Italy":"EUR","italy":"EUR",
  "ספרד":"EUR","Spain":"EUR","spain":"EUR",
  "יוון":"EUR","Greece":"EUR","greece":"EUR",
  "קרואטיה":"EUR","Croatia":"EUR","croatia":"EUR",
  "שוודיה":"SEK","Sweden":"SEK","sweden":"SEK",
  "נורווגיה":"NOK","Norway":"NOK","norway":"NOK",
  "דנמרק":"DKK","Denmark":"DKK","denmark":"DKK",
  "סרביה":"RSD","Serbia":"RSD","serbia":"RSD",
  "ישראל":"ILS","Israel":"ILS","israel":"ILS",

  // Asia / Middle East
  "תאילנד":"THB","Thailand":"THB","thailand":"THB",
  "טורקיה":"TRY","Turkey":"TRY","turkey":"TRY",
  "יפן":"JPY","Japan":"JPY","japan":"JPY",
  "סין":"CNY","China":"CNY","china":"CNY",
  "סינגפור":"SGD","Singapore":"SGD","singapore":"SGD",
  "איחוד האמירויות":"AED","דובאי":"AED","UAE":"AED","United Arab Emirates":"AED","Dubai":"AED","uae":"AED","dubai":"AED",

  // Americas / Oceania
  "קנדה":"CAD","Canada":"CAD","canada":"CAD",
  "מקסיקו":"MXN","Mexico":"MXN","mexico":"MXN",
  "אוסטרליה":"AUD","Australia":"AUD","australia":"AUD"
};

Object.assign(localCurrencyMap, {
  'ארה"ב': 'USD',
  'ארצות הברית': 'USD',
  'ארצות-הברית': 'USD',
  'USA': 'USD',
  'U.S.A': 'USD',
  'US': 'USD',
  'United States': 'USD',
  'United States of America': 'USD',
  'America': 'USD',
  'usa': 'USD',
  'u.s.a': 'USD',
  'us': 'USD',
  'united states': 'USD',
  'united states of america': 'USD',
  'america': 'USD'
});

// Try to infer local currency from free-text destination (match by inclusion, not exact equality)
function getLocalCurrency(destination){
  if(!destination) return null;
  const raw = String(destination);
  const parts = raw.split(",").map(x=>x.trim()).filter(Boolean);
  const haystack = (parts.join(" | ") + " | " + raw).toLowerCase();

  // Prefer longer keys first (e.g., "united kingdom" before "uk")
  const keys = Object.keys(localCurrencyMap).sort((a,b)=> b.length - a.length);
  for(const k of keys){
    if(haystack.includes(String(k).toLowerCase())){
      return localCurrencyMap[k];
    }
  }
  return null;
}

function normalizeRatesShape(rates){
  const src = (rates && typeof rates === 'object') ? rates : {};
  const out = {
    USDILS: Number(src.USDILS ?? state?.rates?.USDILS ?? 3.7) || 3.7,
    USDEUR: Number(src.USDEUR ?? state?.rates?.USDEUR ?? 0.92) || 0.92
  };
  const usdLocal = Number(src.USDLocal);
  if (isFinite(usdLocal) && usdLocal > 0) out.USDLocal = usdLocal;
  if (src.lockedAt) out.lockedAt = src.lockedAt;
  return out;
}

function normalizeTripShape(trip){
  const t = { ...(trip || {}) };
  const inferredLocalCurrency = t.localCurrency || getLocalCurrency(t.destination) || null;
  const normalizedRates = normalizeRatesShape(t.rates);
  const rawBudget = (t.budget && typeof t.budget === 'object') ? t.budget : {};
  const normalizedBudget = {
    USD: Number(rawBudget.USD || 0) || 0,
    EUR: Number(rawBudget.EUR || 0) || 0,
    ILS: Number(rawBudget.ILS || 0) || 0
  };

  const rawExpenses = t.expenses || {};
  const normalizedExpenses = Array.isArray(rawExpenses)
    ? rawExpenses.map((e)=>({
        ...e,
        category: (e?.category || 'אחר').toString(),
        currency: (e?.currency || inferredLocalCurrency || 'USD').toString().toUpperCase(),
        rates: normalizeRatesShape(e?.rates || normalizedRates)
      }))
    : Object.fromEntries(
        Object.entries(rawExpenses).map(([id, e])=>[id, {
          ...e,
          category: (e?.category || 'אחר').toString(),
          currency: (e?.currency || inferredLocalCurrency || 'USD').toString().toUpperCase(),
          rates: normalizeRatesShape(e?.rates || normalizedRates)
        }])
      );

  return {
    ...t,
    localCurrency: inferredLocalCurrency,
    rates: normalizedRates,
    budget: normalizedBudget,
    expenses: normalizedExpenses
  };
}

async function backfillTripVersionFields(trip){
  try{
    if(!trip?.id) return;
    const normalized = normalizeTripShape(trip);
    const patch = {};
    if (!trip.localCurrency && normalized.localCurrency) patch.localCurrency = normalized.localCurrency;
    if (!trip.budget || typeof trip.budget !== 'object') patch.budget = normalized.budget;
    if (!trip.rates || !Number(trip.rates?.USDILS) || !Number(trip.rates?.USDEUR)) patch.rates = normalized.rates;
    if (!Object.keys(patch).length) return;
    const ref = FB.doc(db, 'trips', trip.id);
    await FB.updateDoc(ref, patch);
  }catch(_){}
}

// Best-effort destination city (avoid showing a country name as a "title")
const currencyDefaultCityMap = {
  THB: 'בנגקוק',
  BGN: 'סופיה',
  GEL: 'טביליסי',
  RON: 'בוקרשט',
  TRY: 'אנקרה',
  PLN: 'ורשה',
  CZK: 'פראג',
  HUF: 'בודפשט',
  CHF: 'ברן',
  GBP: 'לונדון',
  SEK: 'שטוקהולם',
  NOK: 'אוסלו',
  DKK: 'קופנהגן',
  JPY: 'טוקיו',
  CNY: 'בייג׳ינג',
  SGD: 'סינגפור',
  AED: 'דובאי',
  CAD: 'אוטווה',
  MXN: 'מקסיקו סיטי',
  AUD: 'קנברה'
};

function guessDestinationCity(t){
  try{
    const raw = (t && t.destination) ? String(t.destination).trim() : '';
    if(raw){
      // If user typed something like "Bansko, Bulgaria" or "Bansko - Bulgaria" -> take first segment
      const parts = raw.split(/\s*,\s*|\s*-\s*|\s*\|\s*/).map(s=>s.trim()).filter(Boolean);
      if(parts.length >= 2) return parts[0];
    }
    const cur = (t && (t.localCurrency || getLocalCurrency(t.destination))) || null;
    if(cur && currencyDefaultCityMap[cur]) return currencyDefaultCityMap[cur];
  }catch(_){ }
  return '';
}


// Enrich legacy expenses: fill missing title/locationName from coords or first line of description (best-effort)
async function enrichLegacyExpenses(trip){
  try{
    if(!trip || !trip.id) return;
    const expObj = trip.expenses || {};
    const ids = Object.keys(expObj);
    if(!ids.length) return;
    let changed = false;
    let touched = 0;
    for(const id of ids){
      const e = expObj[id] || {};
      const title = (e.title||'').toString().trim();
      const loc   = (e.locationName||'').toString().trim();
      const hasCoords = (e.lat!=null && e.lng!=null && isFinite(Number(e.lat)) && isFinite(Number(e.lng)));
      // Prefer: coords -> locationName, so titles become place/city (e.g., "Casa Karina")
      if(!loc && hasCoords){
        try{
          const name = await reverseGeocodeCached(Number(e.lat), Number(e.lng));
          if(name){
            expObj[id].locationName = String(name).trim();
            changed = true;
          }
        }catch(_){}
      }
      // Retro: if title empty -> first line of description
      const title2 = (expObj[id].title||'').toString().trim();
      if(!title2){
        const fromLoc = (expObj[id].locationName||'').toString().trim();
        const fromLocHead = fromLoc ? fromLoc.split(',')[0].trim() : '';
        const fromDesc = firstNonEmptyLine(expObj[id].desc || '');
        const final = fromLocHead || fromDesc || '';
        if(final){
          expObj[id].title = final;
          expObj[id].titleAuto = expObj[id].titleAuto || (fromLocHead ? 'location' : 'desc');
          changed = true;
        }
      }
      if(changed) touched++;
      if(touched >= 8) break; // avoid too many reverse-geocode calls per load
    }
    if(changed){
      const ref = FB.doc(db,'trips', trip.id);
      await FB.updateDoc(ref, { expenses: expObj });
    }
  }catch(_){}
}
async function loadTrip(){
  const perfNow = ()=> (typeof performance !== 'undefined' && performance.now ? performance.now() : Date.now());
  const loadPerf = { start: perfNow() };
  const ref = FB.doc(db, 'trips', state.currentTripId);
  const snap = await FB.getDoc(ref);
  loadPerf.afterFetch = perfNow();
  if(!snap.exists()) return;
  const rawTrip = { id: snap.id, ...snap.data() };
  const t = normalizeTripShape(rawTrip); state._lastTripObj = t;
  state.current = t;
  try{ saveTripCache(state.user?.uid, t); }catch(_){}
  try { globalThis.state = state; window.state = state; } catch(_) {}
  updateHeaderDestination();
  const inferredLocalCurrency = t.localCurrency || getLocalCurrency(t.destination) || null;
  state.current.localCurrency = inferredLocalCurrency;

  let effectiveRates = (t.rates && typeof t.rates === 'object') ? { ...t.rates } : null;
  const missingBaseRates = !effectiveRates || !Number(effectiveRates.USDILS) || !Number(effectiveRates.USDEUR);
  if (effectiveRates) state.rates = effectiveRates;
  ensureExpenseCurrencyOption();

  // Overview meta (optional – only if element exists)
  (function(){
    const metaEl = document.getElementById('metaSummary');
    if(!metaEl) return;
    metaEl.innerHTML = `
    <div><strong>${esc(t.destination||'')}</strong></div>
    <div class="muted">${fmtDate(t.start)} – ${fmtDate(t.end)}</div>
    <div>משתתפים: ${esc((t.people||[]).join(', '))}</div>
    <div>סוגים: ${esc((t.types||[]).join(', '))}</div>
    ${(() => {
      const b = t.budget || {};
      const pairs = Object.entries(b).filter(([k,v]) => Number(v) > 0);
      if (!pairs.length) return '';
      const line = pairs.map(([k,v]) => `${k} ${formatInt(v)}`).join(' · ');
      return `<div>תקציב: ${line}</div>`;
    })()}
  `;
  })();
  // Populate meta form
  $('#metaDestination').value = t.destination||'';
  $('#metaStart').value = t.start||'';
  $('#metaEnd').value = t.end||'';
  $('#metaPeople').value = (t.people||[]).join(', ');
  (function(){ const typesArr = Array.isArray(t.types)?t.types:[]; $$('.metaType').forEach(btn=>{ btn.classList.toggle('active', typesArr.includes(btn.dataset.value)); btn.onclick = ()=> btn.classList.toggle('active'); }); })();
  const budget = t.budget||{ USD:0, EUR:0, ILS:0 };
  $('#bUSD').value = formatInt(budget.USD||0); $('#bEUR').value = formatInt(budget.EUR||0); $('#bILS').value = formatInt(budget.ILS||0); ['bUSD','bEUR','bILS'].forEach(id=> $('#'+id).disabled = !!t.budgetLocked); const be=$('#btnBudgetEdit'); if(be){ be.textContent = t.budgetLocked ? 'ביטול נעילה' : 'קבע תקציב'; be.classList.toggle('locked', !!t.budgetLocked);}
  if(t.rates && !missingBaseRates){ state.rates = t.rates; }
  const _r1=$('#rateUSDEUR'); const _r2=$('#rateUSDILS'); if(_r1) _r1.value = state.rates.USDEUR; if(_r2) _r2.value = state.rates.USDILS;

  const activeViewEl = document.querySelector('.tabview[data-active="1"]:not([hidden])') || document.querySelector('.tabview:not([hidden])');
  const activeViewId = activeViewEl?.id || 'view-overview';
  const renderOverviewNow = ()=>{
    if (typeof renderAllTimeline === 'function') {
      try { renderAllTimeline(t, state.allSort || 'desc'); } catch(_) {}
    }
  };
  const renderExpensesNow = ()=> renderExpenses(t);
  const renderJournalNow = ()=> renderJournal(t);
  const renderMiniMapNow = ()=>{
    const miniEl = document.getElementById('miniMap');
    if (miniEl && typeof initMiniMap === 'function') {
      initMiniMap(t);
      setTimeout(()=> invalidateMap(state.maps?.mini), 80);
    }
  };

  if(activeViewId === 'view-expenses') renderExpensesNow();
  else setTimeout(()=>{ if(state.currentTripId === t.id) renderExpensesNow(); }, 120);

  if(activeViewId === 'view-journal') renderJournalNow();
  else setTimeout(()=>{ if(state.currentTripId === t.id) renderJournalNow(); }, 180);

  if(activeViewId === 'view-overview') renderOverviewNow();
  else setTimeout(()=>{ if(state.currentTripId === t.id) renderOverviewNow(); }, 40);

  if(activeViewId === 'view-meta') renderMiniMapNow();
  else setTimeout(()=>{ if(state.currentTripId === t.id) renderMiniMapNow(); }, 260);
  renderExpenseSummary(t);
  loadPerf.afterInitialRender = perfNow();

  // If trip dates overlap "today" on open → show quick actions popup
  try{ maybeShowTripTodayPrompt(t, { source:'trip' }); }catch(_){ }
  
  // Reset dirty state on successful load
  state.isDirty = false;

  setTimeout(async ()=>{
    if(state.currentTripId !== t.id) return;
    let backgroundRates = effectiveRates;

    if (missingBaseRates) {
      try{
        const fetchedRates = await fetchRatesOnce();
        if(fetchedRates) backgroundRates = { ...(backgroundRates || {}), ...fetchedRates };
        if(state.currentTripId !== t.id) return;
        if(backgroundRates){
          state.rates = backgroundRates;
          if(state.current) state.current.rates = backgroundRates;
          const _r1=$('#rateUSDEUR'); const _r2=$('#rateUSDILS');
          if(_r1) _r1.value = state.rates.USDEUR;
          if(_r2) _r2.value = state.rates.USDILS;
          renderExpenseSummary(state.current || t);
        }
      }catch(_){}
    }

    try{ await enrichLegacyExpenses(t); }catch(_){ }

    try{
      const patch = {};
      if (!rawTrip.localCurrency && inferredLocalCurrency) patch.localCurrency = inferredLocalCurrency;
      if (!rawTrip.budget || typeof rawTrip.budget !== 'object') patch.budget = t.budget;
      if (backgroundRates && missingBaseRates) patch.rates = backgroundRates;
      if (Object.keys(patch).length) await FB.updateDoc(ref, patch);
    }catch(_){}

    try{ await upsertTripSummary(t); }catch(_){}
  }, 0);

  try{
    loadPerf.end = perfNow();
    window.__lastLoadTripPerf = {
      tripId: t.id,
      fetchMs: Math.round(loadPerf.afterFetch - loadPerf.start),
      initialRenderMs: Math.round(loadPerf.afterInitialRender - loadPerf.afterFetch),
      totalMs: Math.round(loadPerf.end - loadPerf.start),
      activeViewId
    };
    console.info('[perf] loadTrip', window.__lastLoadTripPerf);
  }catch(_){}
}

// === Trip "today" prompt (Add Journal / Add Expense / Cancel) ===
function _parseISODateOnly(ymd){
  try{
    if(!ymd) return null;
    const s = String(ymd).trim();
    if(!/^\d{4}-\d{2}-\d{2}$/.test(s)) return null;
    const [y,m,d] = s.split('-').map(n=>parseInt(n,10));
    if(!y||!m||!d) return null;
    return new Date(y, m-1, d, 0, 0, 0, 0);
  }catch(_){ return null; }
}
function _todayKey(){
  const now = new Date();
  const pad = n=>String(n).padStart(2,'0');
  return `${now.getFullYear()}-${pad(now.getMonth()+1)}-${pad(now.getDate())}`;
}
function _isTodayWithinTripDates(startYMD, endYMD){
  const s = _parseISODateOnly(startYMD);
  const e = _parseISODateOnly(endYMD);
  if(!s || !e) return false;
  const t = _parseISODateOnly(_todayKey());
  if(!t) return false;
  const a = s.getTime();
  const b = e.getTime();
  const x = t.getTime();
  const lo = Math.min(a,b);
  const hi = Math.max(a,b);
  return x >= lo && x <= hi;
}

function maybeShowTripTodayPrompt(trip, opts){
  try{
    const source = opts?.source || 'trip';
    if(!trip || !trip.id) return;
    // Avoid prompts on shared read-only views
    if(state?.shared?.readOnly) return;
    const start = trip.start;
    const end   = trip.end;
    if(!_isTodayWithinTripDates(start, end)) return;

    const homeKey = (source === 'home') ? `tripTodayPrompt_${trip.id}_${_todayKey()}_home` : '';
    if(homeKey && sessionStorage.getItem(homeKey) === '1') return;

    const dlg = document.getElementById('tripTodayModal');
    if(!dlg || typeof dlg.showModal !== 'function') return;
    dlg.dataset.tripId = trip.id;
    dlg.dataset.source = source;
    const ctx = document.getElementById('tripTodayContext');
    if(ctx){
      const destination = String(trip.destination || 'נסיעה ללא שם').trim();
      const period = `${fmtDate(trip.start)} – ${fmtDate(trip.end)}`;
      ctx.textContent = `נסיעה פעילה: ${destination} (${period})`;
    }
    // If another modal is open, don't steal focus
    try{
      const anyOpen = document.querySelector('dialog[open]');
      if(anyOpen && anyOpen !== dlg) return;
    }catch(_){ }
    dlg.showModal();
    if(homeKey) sessionStorage.setItem(homeKey, '1');
  }catch(_){ }
}

function maybeShowTodayPromptFromTrips(trips){
  try{
    const activeTrips = (trips || []).filter(trip => trip?.id && _isTodayWithinTripDates(trip.start, trip.end));
    if(!activeTrips.length) return;
    const preferred = (state?.currentTripId && activeTrips.find(trip => trip.id === state.currentTripId))
      || [...activeTrips].sort((a,b)=> (b.start || '').localeCompare(a.start || ''))[0];
    maybeShowTripTodayPrompt(preferred, { source:'home' });
  }catch(_){ }
}

async function runTripTodayPromptAction(kind){
  const dlg = document.getElementById('tripTodayModal');
  if(!dlg) return false;
  const promptTripId = dlg.dataset.tripId || '';
  const ensurePromptTripOpen = async ()=>{
    if(!promptTripId) return;
    if(state.currentTripId === promptTripId) return;
    await openTrip(promptTripId);
  };
  try{
    if(kind === 'cancel'){
      try{ dlg.close(); }catch(_){ }
      return false;
    }
    try{ dlg.close(); }catch(_){ }
    try{ await ensurePromptTripOpen(); }catch(_){ }
    if(kind === 'journal'){
      try{ switchToTab('journal'); }catch(_){ }
      try{ openJournalModal(); }catch(_){ }
    }
    if(kind === 'expense'){
      try{ switchToTab('expenses'); }catch(_){ }
      try{ openExpenseModal(); }catch(_){ }
    }
  }catch(_){ }
  return false;
}

window.__tripTodayPromptAction = function(kind){
  runTripTodayPromptAction(kind);
  return false;
};

document.addEventListener('DOMContentLoaded', ()=>{
  const dlg = document.getElementById('tripTodayModal');
  if(!dlg) return;
  const bJ = document.getElementById('tripTodayAddJournal');
  const bE = document.getElementById('tripTodayAddExpense');
  const bC = document.getElementById('tripTodayCancel');
  const wirePromptButton = (btn, key, handler)=>{
    if(!btn || btn.dataset[key] === '1') return;
    btn.dataset[key] = '1';
    let lastTouchTs = 0;
    const run = async (ev)=>{
      try{ ev?.preventDefault?.(); ev?.stopPropagation?.(); }catch(_){ }
      if(ev?.type === 'click' && Date.now() - lastTouchTs < 500) return;
      if(ev?.type === 'touchend') lastTouchTs = Date.now();
      await handler();
      return false;
    };
    btn.onclick = run;
    btn.ontouchend = run;
    btn.style.pointerEvents = 'auto';
    btn.style.touchAction = 'manipulation';
  };
  dlg.addEventListener('click', (ev)=>{
    if(ev.target === dlg){
      try{ dlg.close(); }catch(_){ }
    }
  });

  if(bJ && !bJ.dataset.wired){
    bJ.dataset.wired='1';
    wirePromptButton(bJ, 'tripTodayJournalTap', async ()=> runTripTodayPromptAction('journal'));
  }
  if(bE && !bE.dataset.wired){
    bE.dataset.wired='1';
    wirePromptButton(bE, 'tripTodayExpenseTap', async ()=> runTripTodayPromptAction('expense'));
  }
  if(bC && !bC.dataset.wired){
    bC.dataset.wired='1';
    wirePromptButton(bC, 'tripTodayCancelTap', async ()=> runTripTodayPromptAction('cancel'));
  }
});
// === End Trip "today" prompt ===


function renderExpenses(t, order){
  order = (order || state.expenseSort || 'desc');
  const dir = (order === 'asc') ? 1 : -1;
  const body = $('#tblExpenses'); if (body) body.innerHTML = '';
  let arr = Object.entries(t.expenses||{}).map(([id,e])=>({id, ...e}))
    .sort((a,b)=> dir * (expenseSortKey(a) - expenseSortKey(b)));
  
  arr.forEach(e=>{
    const d = dayjs(e.dateIso || e.createdAt);
    const dateStr = d.isValid() ? d.format('DD/MM/YYYY') : '';
    const amount = Number(e.amount||0).toLocaleString('he-IL', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
    const curr   = e.currency||'';
    let rateToILS = null;
    try {
      const M = rateMatrix(e.rates || state.rates || {});
      rateToILS = (M && curr && M[curr] && M[curr].ILS) ? M[curr].ILS : null;
    } catch(_){}
    const convertedAmountILS = rateToILS ? (Number(e.amount||0) * rateToILS) : null;

    const displayTitle = deriveExpenseTitle(e);
    const cat = esc(e.category||'');
    const desc = (e.descHtml && /(<a|link-icon)/i.test(e.descHtml)) ? e.descHtml : linkifyToIcons(e.descHtml || e.desc || '');
    
    const tr1 = document.createElement('tr');
    tr1.className = 'exp-item';
    tr1.dataset.id = e.id;
    tr1.dataset.kind = 'expense';
    tr1.dataset.mobileLayout = 'expense-two-line';
    tr1.innerHTML = `
      <td class="cell header date">${bidiWrap(dateStr)}</td>
      <td class="cell header time"></td>
      <td class="cell header title">${esc(displayTitle)}</td>
      <td class="cell header category">${cat}</td>
      <td class="cell header amount">${buildExpenseAmountMarkup(amount, curr)}</td>
      <td class="cell header currency"></td>
      <td class="cell header menu-cell"><button class="menu-btn">...</button></td>
    `;
    const tr4 = document.createElement('tr');
    tr4.className = 'exp-item exp-details';
    tr4.innerHTML = `<td class="cell notes" colspan="7">${desc}</td>`;
    body.appendChild(tr1); body.appendChild(tr4);

    tr1.querySelector('.menu-btn').onclick = () => { 
        _rowActionExpense = e; 
        document.getElementById('rowMenuModal').showModal(); 
    };
  });
}
function renderJournal(t, order){
  const body = document.querySelector('#tblJournal');
  if (!body) return;
  body.innerHTML = '';
  state.journalSelectedIds = state.journalSelectedIds || new Set();
  const selectionOn = !!state.journalSelectionMode;
  let arr = Object.entries(t?.journal || {}).map(([id,j])=>({id, ...j}))
    .sort((a,b)=> ((state.journalSort||'desc') === 'asc' ? 1 : -1) * (expenseSortKey(a) - expenseSortKey(b)));

  arr.forEach(j=>{
    const d = dayjs(j.dateIso || j.createdAt);
    const dateStr = d.isValid() ? d.format('DD/MM/YYYY') : '';
    const timeStr = d.isValid() ? d.format('HH:mm') : '';
    const text = (j.html && /(<a|link-icon)/i.test(j.html)) ? j.html : linkifyToIcons(j.html || j.text || '');

    const tr1 = document.createElement('tr');
    tr1.className = 'exp-item';
    tr1.dataset.kind = 'journal'; // מחזיר את הצבע הירוק
    const checkedAttr = selectionOn && state.journalSelectedIds.has(j.id) ? 'checked' : '';
    const selectCell = selectionOn ? `<td class="cell select-cell"><input type="checkbox" class="jr-select" data-id="${esc(j.id)}" ${checkedAttr}></td>` : "";
    const hasMapPoint = Number.isFinite(+j.lat) && Number.isFinite(+j.lng);
    const mapActionCell = hasMapPoint
      ? `<td class="cell header menu-cell"><button class="btn small journal-map-btn" type="button" data-map-item="journal" data-id="${esc(j.id)}">מפה</button></td>`
      : "";
    
    const displayTitle = deriveJournalTitle(j);
    tr1.innerHTML = `
      ${selectCell}
      <td class="cell header date">${bidiWrap(dateStr)}</td>
      <td class="cell header time"></td>
      <td class="cell header location" colspan="${hasMapPoint ? 3 : 4}">${esc(displayTitle)}</td>
      ${mapActionCell}
      <td class="cell header menu-cell"><button class="menu-btn">...</button></td>
    `;
    const tr2 = document.createElement('tr');
    tr2.className = 'exp-item exp-details';
    tr2.innerHTML = `<td class="cell notes" colspan="${selectionOn ? 8 : 7}">${text}</td>`;
    body.appendChild(tr1); body.appendChild(tr2);

    tr1.querySelector('.menu-btn').onclick = () => { 
        _rowActionJournal = j; 
        document.getElementById('rowMenuModal').showModal(); 
    };
    tr1.querySelector('.journal-map-btn')?.addEventListener('click', (ev)=>{
      ev.preventDefault();
      focusItemOnMap('journal', j.id);
    });
  });
  syncJournalSelectionUi();
}
function appendExpenseRowToTimeline(body, e){
  const d = dayjs(e.dateIso || e.createdAt);
  const amount = Number(e.amount||0).toLocaleString('he-IL', { minimumFractionDigits: 2 });
  const displayTitle = deriveExpenseTitle(e);
  const desc = (e.descHtml && /(<a|link-icon|<br|<div|<p|<span)/i.test(e.descHtml))
    ? e.descHtml
    : linkifyToIcons(e.descHtml || e.desc || '');
  const tr1 = document.createElement('tr');
  tr1.className = 'exp-item';
  tr1.dataset.kind = 'expense';
  tr1.dataset.mobileLayout = 'expense-two-line';
  tr1.innerHTML = `
    <td class="cell header date">${bidiWrap(d.format('DD/MM/YYYY'))}</td>
    <td class="cell header time"></td>
    <td class="cell header title">${esc(displayTitle)}</td>
    <td class="cell header category">${esc(e.category||'')}</td>
    <td class="cell header amount">${buildExpenseAmountMarkup(amount, e.currency || '')}</td>
    <td class="cell header menu-cell"><button class="menu-btn">...</button></td>
  `;
  const tr2 = document.createElement('tr');
  tr2.className = 'exp-item exp-details';
  tr2.innerHTML = `<td class="cell notes" colspan="6">${desc}</td>`;
  body.appendChild(tr1); body.appendChild(tr2);
  tr1.querySelector('.menu-btn').onclick = () => {
    _rowActionExpense = e;
    document.getElementById('rowMenuModal').showModal();
  };
}
function appendJournalRowToTimeline(body, j){
  const d = dayjs(j.dateIso || j.createdAt);
  const displayTitle = deriveJournalTitle(j);
  const text = (j.html && /(<a|link-icon|<br|<div|<p|<span)/i.test(j.html))
    ? j.html
    : linkifyToIcons(j.html || j.text || '');
  const selectionOn = getOverviewMode() === 'journal' && !!state.journalSelectionMode;
  const checkedAttr = selectionOn && state.journalSelectedIds && state.journalSelectedIds.has(j.id) ? 'checked' : '';
  const hasMapPoint = Number.isFinite(+j.lat) && Number.isFinite(+j.lng);
  const tr1 = document.createElement('tr');
  tr1.className = 'exp-item';
  tr1.dataset.kind = 'journal';
  tr1.innerHTML = `
    ${selectionOn ? `<td class="cell select-cell"><input type="checkbox" class="jr-select" data-id="${esc(j.id)}" ${checkedAttr}></td>` : ''}
    <td class="cell header date">${bidiWrap(d.format('DD/MM/YYYY'))}</td>
    <td class="cell header time"></td>
    <td class="cell header location" colspan="${hasMapPoint ? 2 : 3}">${esc(displayTitle)}</td>
    ${hasMapPoint ? `<td class="cell header menu-cell"><button class="btn small journal-map-btn" type="button" data-map-item="journal" data-id="${esc(j.id)}">מפה</button></td>` : ''}
    <td class="cell header menu-cell"><button class="menu-btn">...</button></td>
  `;
  const tr2 = document.createElement('tr');
  tr2.className = 'exp-item exp-details';
  tr2.innerHTML = `<td class="cell notes" colspan="${selectionOn ? 7 : 6}">${text}</td>`;
  body.appendChild(tr1); body.appendChild(tr2);
  tr1.querySelector('.menu-btn').onclick = () => { 
    _rowActionJournal = j; 
    document.getElementById('rowMenuModal').showModal(); 
  };
  tr1.querySelector('.journal-map-btn')?.addEventListener('click', (ev)=>{
    ev.preventDefault();
    focusItemOnMap('journal', j.id);
  });
}
function getOverviewMode(){
  const allowed = new Set(['all', 'expenses', 'journal']);
  const fromState = state?.overviewMode;
  if (allowed.has(fromState)) return fromState;
  try {
    const stored = localStorage.getItem('overviewMode');
    if (allowed.has(stored)) return stored;
  } catch (_) {}
  return 'all';
}

function renderAllTimeline(t, order){
  const body = document.getElementById('tblAllTimeline');
  if (!body) return;
  state.journalSelectedIds = state.journalSelectedIds || new Set();

  const dir = (order || state.allSort || 'desc') === 'asc' ? 1 : -1;
  const mode = getOverviewMode();

  const expenses = Object.entries(t?.expenses || {}).map(([id, e]) => ({
    id,
    kind: 'expense',
    sortKey: expenseSortKey(e),
    payload: { id, ...e }
  }));
  const journal = Object.entries(t?.journal || {}).map(([id, j]) => ({
    id,
    kind: 'journal',
    sortKey: expenseSortKey(j),
    payload: { id, ...j }
  }));

  let items = [];
  if (mode === 'expenses') items = expenses;
  else if (mode === 'journal') items = journal;
  else items = expenses.concat(journal);

  items.sort((a, b) => dir * ((a.sortKey || 0) - (b.sortKey || 0)));

  const frag = document.createDocumentFragment();
  for (const item of items) {
    if (item.kind === 'expense') appendExpenseRowToTimeline(frag, item.payload);
    else appendJournalRowToTimeline(frag, item.payload);
  }

  body.replaceChildren(frag);
  syncOverviewJournalBulkUi();

  if (typeof window.__overviewApplyAfterRender === 'function') {
    try { window.__overviewApplyAfterRender(); } catch (_) {}
  }
}

function syncOverviewTabLabel(){
  syncOverviewJournalBulkUi();
}

function syncOverviewJournalBulkUi(){
  const mode = getOverviewMode();
  const deleteBtn = document.getElementById('btnOverviewDeleteSelectedJournal');
  const cancelBtn = document.getElementById('btnOverviewCancelSelectionJournal');
  const isJournalOverview = mode === 'journal';
  const selectionOn = isJournalOverview && !!state.journalSelectionMode;
  const count = state.journalSelectedIds ? state.journalSelectedIds.size : 0;

  if(deleteBtn){
    deleteBtn.hidden = !isJournalOverview;
    deleteBtn.style.display = isJournalOverview ? '' : 'none';
    deleteBtn.textContent = selectionOn ? `מחק (${count})` : 'מחק נבחרים';
  }
  if(cancelBtn){
    cancelBtn.hidden = !selectionOn;
    cancelBtn.style.display = selectionOn ? '' : 'none';
  }
}

function wireOverviewSort(){
  const btn = document.getElementById('btnAllSort');
  if (!btn || btn.dataset.bound === '1') return;
  btn.dataset.bound = '1';
  btn.addEventListener('click', ()=>{
    state.allSort = state.allSort === 'asc' ? 'desc' : 'asc';
    try { localStorage.setItem('allSort', state.allSort); } catch (_) {}
    if (state.current) renderAllTimeline(state.current, state.allSort);
  });
}

document.addEventListener('DOMContentLoaded', ()=>{
  if (!state.overviewMode) state.overviewMode = 'all';
  try {
    const savedSort = localStorage.getItem('allSort');
    if (savedSort === 'asc' || savedSort === 'desc') state.allSort = savedSort;
  } catch (_) {}
  syncOverviewTabLabel();
  wireOverviewSort();
});
// הפעלת הכפתור לפתיחת חלון "נסיעה חדשה"
$('#btnNewTrip').addEventListener('click', () => {
  const modal = $('#tripModal');
  if (modal) {
    // איפוס שדות לפני פתיחה
    $('#tripDest').value = '';
    $('#tripStart').value = '';
    $('#tripEnd').value = '';
    modal.showModal();
  }
});

// השורה הקיימת (להשוואה):
$('#tripCancel').addEventListener('click', ()=> $('#tripModal').close());
$('#tripSave').addEventListener('click', async ()=>{
  // הוספנו בלוק try...catch כדי למנוע קריסה שקטה
  try {
    const dest = $('#tripDest').value.trim(); 
    const start = $('#tripStart').value; 
    const end = $('#tripEnd').value;

    if(!dest||!start||!end) {
      showToast('אנא מלא יעד ותאריכים');
      return; // עצירה אם חסרים נתונים
    }

    // בדיקה קריטית: ודא שפרטי המשתמש נטענו
    if (!state.user || !state.user.uid) {
      console.error("Save failed: state.user.uid is missing.", state.user);
      showToast('שגיאה: המשתמש לא מחובר כראוי. נסה לרענן.');
      return;
    }

    const id = (typeof crypto !== 'undefined' && crypto.randomUUID) 
      ? crypto.randomUUID() 
      : ('id-' + Date.now() + '-' + Math.floor(Math.random() * 1e6));

    // Determine local currency from destination (best-effort) and lock matching rates
    const localCur = getLocalCurrency(dest);
    const _prevCurrent = state.current;
    try{ state.current = { ...(state.current||{}), localCurrency: localCur }; }catch(_){}
    const live = await fetchRatesOnce();
    try{ state.current = _prevCurrent; }catch(_){}

    const lockedRates = { USDILS: live.USDILS, USDEUR: live.USDEUR, lockedAt: live.lockedAt };
    if (localCur && live.USDLocal) lockedRates.USDLocal = live.USDLocal;

    await FB.setDoc(FB.doc(db, 'trips', id), {
      ownerUid: state.user.uid, // עכשיו בטוח לגשת ל-uid
      destination: dest,
      start,
      end,
      localCurrency: localCur || null,
      createdAt: new Date().toISOString(),
      expenses:{},
      journal:{},
      budget:{USD:0,EUR:0,ILS:0},
      rates: lockedRates,
      share:{enabled:false}
    });
    try{
      await upsertTripSummary({
        id,
        ownerUid: state.user.uid,
        destination: dest,
        start,
        end,
        localCurrency: localCur || null,
        createdAt: new Date().toISOString(),
        people: [],
        types: []
      });
    }catch(_){}

    $('#tripModal').close(); 
    showToast('נוצרה נסיעה');

  } catch (err) {
    // הצג הודעת שגיאה במקום לקרוס בשקט
    console.error("Error saving trip:", err);
    showToast('שגיאה בשמירת הנסיעה: ' + err.message);
  }
});

// Sidebar actions
$('#searchTrips').addEventListener('input', renderTripList);
let sortAsc = false; $('#btnSortTrips').addEventListener('click', ()=>{
  sortAsc = !sortAsc; state.trips.sort((a,b)=> sortAsc ? (a.start||'').localeCompare(b.start||'') : (b.start||'').localeCompare(a.start||'')); renderTripList();
});
$('#btnViewGrid').addEventListener('click', ()=>{ state.lastNonMapView='grid'; state.viewMode='grid'; renderTripList(); });
$('#btnViewList').addEventListener('click', ()=>{ state.lastNonMapView='list'; state.viewMode='list'; renderTripList(); });
$('#btnViewMap').addEventListener('click', ()=>{ if(state.viewMode !== 'map') state.lastNonMapView = state.viewMode === 'list' ? 'list' : 'grid'; state.viewMode='map'; renderTripList(); });

// Meta save, verify, budgets
$('#btnVerifyOnMap').click(() => {
  // ...
});

// Budget edit + currency sync
function syncBudget(from){
  let usd = parseIntSafe($('#bUSD').value);
  let eur = parseIntSafe($('#bEUR').value);
  let ils = parseIntSafe($('#bILS').value);
  if(from==='USD'){ eur = Math.round(usd*state.rates.USDEUR); ils = Math.round(usd*state.rates.USDILS); }
  if(from==='EUR'){ const u = Math.round(eur/state.rates.USDEUR); usd = u; ils = Math.round(u*state.rates.USDILS); }
  if(from==='ILS'){ const u = Math.round(ils/state.rates.USDILS); usd = u; eur = Math.round(u*state.rates.USDEUR); }
  $('#bUSD').value = formatInt(usd); $('#bEUR').value = formatInt(eur); $('#bILS').value = formatInt(ils);
  state.isDirty = true; // Mark as dirty on any change
}
['bUSD','bEUR','bILS'].forEach(id=> $('#'+id).addEventListener('input', ()=> syncBudget(id.replace('b','')) ));
if($('#rateUSDEUR')) $('#rateUSDEUR').addEventListener('input', e=> state.rates.USDEUR = Number(e.target.value||0.92));
if($('#rateUSDILS')) $('#rateUSDILS').addEventListener('input', e=> state.rates.USDILS = Number(e.target.value||3.7));
$('#btnBudgetEdit').addEventListener('click', async ()=>{
  const btn = $('#btnBudgetEdit');
  const locking = !btn.classList.contains('locked');
  const ref = FB.doc(db, 'trips', state.currentTripId);
  const budget = { USD: parseIntSafe($('#bUSD').value), EUR: parseIntSafe($('#bEUR').value), ILS: parseIntSafe($('#bILS').value) };
  const live = await fetchRatesOnce();
  const lockedRates = { USDILS: live.USDILS, USDEUR: live.USDEUR, lockedAt: live.lockedAt };
  if (live.USDLocal) lockedRates.USDLocal = live.USDLocal;
  await FB.updateDoc(ref, { budget, rates: lockedRates, budgetLocked: locking });
  ['bUSD','bEUR','bILS'].forEach(id=> $('#'+id).disabled = locking);
  btn.classList.toggle('locked', locking);
  btn.textContent = locking ? 'ביטול נעילה' : 'קבע תקציב';
  showToast(locking ? 'התקציב נקבע' : 'התקציב פתוח לעריכה');
  state.isDirty = false; // Reset dirty state on save
});
// Expenses CRUD
$('#btnAddExpense').addEventListener('click', ()=> openExpenseModal());
$('#expCancel').addEventListener('click', ()=> $('#expenseModal').close());
$('#expSave').addEventListener('click', saveExpense);

const EXPENSE_BASE_CURRENCIES = ['USD', 'EUR', 'ILS'];
const EXPENSE_CURRENCY_SYMBOLS = {
  USD:'$',
  EUR:'€',
  ILS:'₪',
  THB:'฿',
  GBP:'£',
  JPY:'¥'
};
function getExpenseCurrencyOrder(){
  const localCur = (state.current?.localCurrency || getLocalCurrency(state.current?.destination) || 'USD').toString().toUpperCase();
  return [...new Set([localCur, ...EXPENSE_BASE_CURRENCIES].filter(Boolean))];
}
function getExpenseDefaultCurrency(){
  return getExpenseCurrencyOrder()[0] || 'USD';
}
function syncExpenseCurrencyButton(cur){
  const normalized = String(cur || getExpenseDefaultCurrency()).toUpperCase();
  const order = getExpenseCurrencyOrder();
  const finalCur = order.includes(normalized) ? normalized : getExpenseDefaultCurrency();
  const input = $('#expCurr');
  const btn = $('#expCurrBtn');
  if(input) input.value = finalCur;
  if(btn){
    btn.textContent = EXPENSE_CURRENCY_SYMBOLS[finalCur] || finalCur;
    btn.dataset.currency = finalCur;
    btn.setAttribute('aria-label', `מטבע ${finalCur}`);
    btn.title = `מטבע ${finalCur}`;
  }
  return finalCur;
}
function cycleExpenseCurrency(){
  const order = getExpenseCurrencyOrder();
  const current = ($('#expCurr')?.value || getExpenseDefaultCurrency()).toString().toUpperCase();
  const currentIndex = order.indexOf(current);
  const nextCur = order[(currentIndex + 1 + order.length) % order.length];
  return syncExpenseCurrencyButton(nextCur);
}
$('#expCurrBtn')?.addEventListener('click', cycleExpenseCurrency);

function openExpenseModal(e){try{ window._rebindTextColorDots(); }catch(_){}

  /*__OPEN_EXP_PREFILL__*/
  try{
    const base = e || null;
    const $d = document.getElementById('expDate');
    const $t = document.getElementById('expTime');
    if($d && $t){
      const src = base?.dateIso || base?.createdAt || new Date().toISOString();
      const d = new Date(src);
      const pad = n=>String(n).padStart(2,'0');
      $d.value = `${d.getFullYear()}-${pad(d.getMonth()+1)}-${pad(d.getDate())}`;
      $t.value = `${pad(d.getHours())}:${pad(d.getMinutes())}`;
    }
  }catch(_){}

  if(window._bindTextareasForModals) window._bindTextareasForModals();

  seedExpenseCategories();

   $('#expenseModal').dataset.id = e?.id||'';
  try{ const tEl=document.getElementById("expTitle"); if(tEl) tEl.value = e?.title || ""; }catch(_){ }
  $('#expText').innerHTML = (e?.descHtml || (e?.desc ? linkifyText(e.desc,'קישור') : '')) || '';
  enableLinkRemoval(document.getElementById('expText')); $('#expCat').value = e?.category||''; $('#expAmount').value = e?.amount||'';
  const __defCur = (e && e.currency) ? e.currency : getExpenseDefaultCurrency();
  syncExpenseCurrencyButton(__defCur);
	  $('#expLat').value = e?.lat||''; $('#expLng').value = e?.lng||'';
	document.getElementById('expLocationName').value = e?.locationName || '';
  if (typeof updateLocLabelState === 'function') updateLocLabelState('exp'); // <--- תיקון: עדכון תצוגת התווית
$('#expLocationName').value = e?.locationName || '';
  updateLocLabelState('exp'); // <--- שורה חדשה שנוספה
	  try{ updateExpLocationPreview(); }catch(_){ }
  $('#expDelete').style.display = e? 'inline-block':'none';
  // Prefill expDate/expTime (enrich)
  try {
    const base = (typeof e!=='undefined' && e) || (typeof j!=='undefined' && j) || null;
    const pad = n=>String(n).padStart(2,'0');
    let dStr=null, tStr=null;
    if (base && base.date && base.time) {
      dStr = base.date.split('/').reverse().join('-'); // dd/mm/yyyy -> yyyy-mm-dd
      tStr = base.time;
    } else if (base && (base.createdAt||base.dateIso)) {
      const d = new Date(base.createdAt||base.dateIso);
      dStr = `${d.getFullYear()}-${pad(d.getMonth()+1)}-${pad(d.getDate())}`;
      tStr = `${pad(d.getHours())}:${pad(d.getMinutes())}`;
    } else {
      const d = new Date();
      dStr = `${d.getFullYear()}-${pad(d.getMonth()+1)}-${pad(d.getDate())}`;
      tStr = `${pad(d.getHours())}:${pad(d.getMinutes())}`;
    }
    const $d=$('#expDate'), $t=$('#expTime');
    if($d) $d.value=dStr; if($t) $t.value=tStr;
  } catch(_){}

  document.dispatchEvent(new Event('openExpenseModal')); $('#expenseModal').showModal();
}

async function saveExpense(){
  // בדיקה כפויה של מיקום לפני שמירה
  if ($('#expLocationName').value.trim() && !$('#expLat').value) {
      if(typeof showToast === 'function') // showToast בוטל: לא מחפשים מיקום אוטומטית יותר;
      await autoFetchCoords('exp');
  }

  const ref  = FB.doc(db,'trips', state.currentTripId);
  const snap = await FB.getDoc(ref);
  const t    = snap.exists() ? (snap.data()||{}) : {};

  const live = await fetchRatesOnce();
  const currentExpense = t.expenses?.[$('#expenseModal').dataset.id] || {};
  const expenseRates = currentExpense.rates || { USDILS: live.USDILS, USDEUR: live.USDEUR, lockedAt: live.lockedAt };
  if(live.USDLocal) expenseRates.USDLocal = live.USDLocal;

  const $expD = document.getElementById('expDate');
  const $expT = document.getElementById('expTime');
  let _exp_dateIso;
  if ($expD && $expT && $expD.value && $expT.value) {
    _exp_dateIso = new Date(`${$expD.value}T${$expT.value}:00`).toISOString();
  } else {
    const curE = (t.expenses && t.expenses[$('#expenseModal')?.dataset?.id || '']) || {};
    _exp_dateIso = curE.dateIso || curE.createdAt || new Date().toISOString();
  }
  const __exp_dt = new Date(_exp_dateIso);
  const __pad = n=>String(n).padStart(2,'0');
  const __exp_dateStr = `${__pad(__exp_dt.getDate())}/${__pad(__exp_dt.getMonth()+1)}/${__exp_dt.getFullYear()}`;
  const __exp_timeStr = `${__pad(__exp_dt.getHours())}:${__pad(__exp_dt.getMinutes())}`;
  
  const id = $('#expenseModal').dataset.id || (crypto.randomUUID ? crypto.randomUUID() : String(Date.now()));
  t.expenses = t.expenses || {};

  // Ensure we have a meaningful locationName/title when possible
  let _locName = (document.getElementById('expLocationName')?.value || '').trim();
  const _latVal = numOrNull($('#expLat').value);
  const _lngVal = numOrNull($('#expLng').value);
  if(!_locName && _latVal != null && _lngVal != null){
    try{
      const name = await reverseGeocode(_latVal, _lngVal);
      if(name){
        _locName = String(name).trim();
        const el = document.getElementById('expLocationName');
        if(el) el.value = _locName;
      }
    }catch(_){ }
  }

  const _titleInput = (document.getElementById('expTitle')?.value || '').trim();
  const _nameFromLoc = _cleanPlaceLabel(_locName ? _locName.split(',')[0].trim() : '');
  const _destCity = (()=>{ const d=(t.destination||'').toString().trim(); return d.includes(',') ? d.split(',')[0].trim() : ''; })();
  const _fromDesc = firstNonEmptyLine((document.getElementById('expText')?.textContent||'').trim());
  const _finalTitle = _titleInput || _nameFromLoc || _fromDesc || _destCity || '';

  t.expenses[id] = {
    title: _finalTitle,
    desc: (document.getElementById('expText')?.textContent||'').trim(),
    descHtml: sanitizeExpenseNoLinks(document.getElementById('expText')?.innerHTML||'').trim(),
    category: $('#expCat').value.trim(),
    amount: Number($('#expAmount').value||0),
    currency: $('#expCurr').value,
    locationName: _locName,
    lat: _latVal,
    lng: _lngVal,
    createdAt: (t.expenses[id] && t.expenses[id].createdAt) ? t.expenses[id].createdAt : new Date().toISOString(),
    dateIso: _exp_dateIso,
    date: __exp_dateStr,
    time: __exp_timeStr,
    rates: expenseRates
  };

  await FB.updateDoc(ref, { expenses: t.expenses, rates: t.rates });
  $('#expenseModal').close();
  showToast('ההוצאה נשמרה');
  await loadTrip();
}

 
$('#lsSignUp').addEventListener('click', async ()=>{
  try{
    await FB.createUserWithEmailAndPassword(auth, $('#lsEmail').value.trim(), $('#lsPass').value);
    $('#lsError').textContent = '';
  }catch(e){ $('#lsError').textContent = xErr(e); showMobileAuthDebug(e); }
});
$('#lsReset').addEventListener('click', async ()=>{

// Safe HTML escape

  try{ await FB.sendPasswordResetEmail(auth, $('#lsEmail').value.trim()); showToast('נשלח מייל לאיפוס'); }catch(e){ $('#lsError').textContent = xErr(e); showMobileAuthDebug(e); }
});
// ---- Mobile-safe auth wiring ----
(function(){
  const $ = (sel)=>document.querySelector(sel);
  const isMobileViewport = ()=> /Android|iPhone|iPad|iPod/i.test(navigator.userAgent || '') || window.innerWidth <= 820;

  async function doLogin(emailSel, passSel, errSel){
    const email = $(emailSel)?.value?.trim();
    const pass  = $(passSel)?.value;
    const errEl = $(errSel);
    if(errEl) errEl.textContent = '';
    if(!email || !pass){
      if(errEl) errEl.textContent = 'נא מלא אימייל וסיסמה';
      return;
    }
    try{
      await FB.signInWithEmailAndPassword(auth, email, pass);
      if(errEl) errEl.textContent = '';
      const authModal = document.getElementById('authModal');
      if(authModal?.open) authModal.close();
    }catch(e){
      if(errEl) errEl.textContent = xErr(e);
      showMobileAuthDebug(e);
      console.error('mobile-safe login failed', e);
      try{
        if(isMobileViewport()) alert(xErr(e));
      }catch(_){}
    }
  }

  function bindTap(el, fn){
    if(!el || el.dataset.mobileTapBound === '1') return;
    el.dataset.mobileTapBound = '1';
    let touchHandled = false;
    el.addEventListener('touchend', (ev)=>{
      touchHandled = true;
      ev.preventDefault();
      ev.stopPropagation();
      fn();
      setTimeout(()=>{ touchHandled = false; }, 350);
    }, { passive:false });
    el.addEventListener('click', (ev)=>{
      if(touchHandled){
        ev.preventDefault();
        ev.stopPropagation();
        return;
      }
      fn();
    });
  }

  bindTap($('#loginBtn'), ()=>doLogin('#lsEmail', '#lsPass', '#lsError'));
  bindTap($('#authSignIn'), ()=>doLogin('#authEmail', '#authPass', '#authError'));

  ['#lsEmail', '#lsPass'].forEach((sel)=>{
    const el = $(sel);
    if(!el || el.dataset.mobileEnterBound === '1') return;
    el.dataset.mobileEnterBound = '1';
    el.addEventListener('keydown', (ev)=>{
      if(ev.key === 'Enter'){
        ev.preventDefault();
        doLogin('#lsEmail', '#lsPass', '#lsError');
      }
    });
  });

  window.__isMobileViewport = isMobileViewport;
})();


function mark(text, s){
  if(!s) return esc(text||''); const t = String(text); const i = t.toLowerCase().indexOf(s); if(i<0) return esc(t);
  return esc(t.slice(0,i)) + '<mark>' + esc(t.slice(i,i+s.length)) + '</mark>' + esc(t.slice(i+s.length));
}
function snippet(text, s, len=60){
  if(!text) return ''; const t = String(text); const idx = t.toLowerCase().indexOf(s);
  if(idx<0) return esc(t.slice(0,len));
  const start = Math.max(0, idx - Math.floor(len/3)); const end = Math.min(t.length, idx + s.length + Math.floor(len/3));
  const seg = t.slice(start, end); const pre = start>0 ? '…' : ''; const post = end<t.length ? '…' : '';
  return pre + mark(seg, s) + post;
}
function matchInfo(t, s){
  let score = 0, where = [];
  const dst = (t.destination||''); if(dst.toLowerCase().includes(s)){ score+=5; where.push({label:`<span class="match-source">יעד:</span> ${snippet(dst,s)}`, type:'meta', itemId:null}); }
  const types = (Array.isArray(t.types)? t.types.join(', '): (t.types||'')); if(types.toLowerCase().includes(s)){ score+=2; where.push({label:`<span class="match-source">סוגים:</span> ${snippet(types,s)}`, type:'meta', itemId:null}); }
  const people = (Array.isArray(t.people)? t.people.join(', '): (t.people||'')); if(people.toLowerCase().includes(s)){ score+=1; where.push({label:`<span class="match-source">משתתפים:</span> ${snippet(people,s)}`, type:'meta', itemId:null}); }
  const ex = Object.entries(t.expenses||{}); let exHits = 0; ex.forEach(([id, e])=>{ if((e.desc||'').toLowerCase().includes(s) || (e.category||'').toLowerCase().includes(s)){ exHits++; where.push({label:`<span class="match-source">הוצאות:</span> ${snippet(e.desc||e.category||'', s)}`, type:'expense', itemId:id});} });
  if(exHits) score += Math.min(3, exHits);
  const jr = Object.entries(t.journal||{}); let jrHits = 0; jr.forEach(([id, j])=>{ if((j.text||'').toLowerCase().includes(s) || (j.placeName||'').toLowerCase().includes(s)){ jrHits++; where.push({label:`<span class="match-source">יומן:</span> ${snippet(j.text||j.placeName||'', s)}`, type:'journal', itemId:id});} });
  if(jrHits) score += Math.min(3, jrHits);
  return { hit: score>0, score, where };
}
// Add the new function to highlight and scroll to the element
function highlightAndScroll(element, s){
  if(!element) return;
  const text = element.innerHTML;
  element.innerHTML = text.replace(new RegExp(`(${s})`, 'gi'), '<mark>$1</mark>');
  element.scrollIntoView({ behavior: 'smooth', block: 'center' });
}

function searchAndNavigate(tripId, query, type, itemId){
  openTrip(tripId).then(()=>{
    if(type === 'expense'){
      // "הוצאות" ו"יומן" הוסרו מהטאבים; הכל מופיע ב"הצג הכל"
      document.querySelector('#tabs [data-tab="overview"]')?.click();
      setTimeout(()=>{
        const cont = document.querySelector(`#view-overview`) || document.querySelector(`#tblAllTimeline`);
        if(cont) highlightAllInContainer(cont, query);
      }, 300);
    } else if(type === 'journal'){
      document.querySelector('#tabs [data-tab="overview"]')?.click();
      setTimeout(()=>{
        const cont = document.querySelector(`#view-overview`) || document.querySelector(`#tblAllTimeline`);
        if(cont) highlightAllInContainer(cont, query);
      }, 300);
    } else if (type === 'meta') {
      document.querySelector('#tabs [data-tab="meta"]')?.click();
      setTimeout(()=>{
        const cont = document.querySelector('#view-meta') || document.querySelector('#view-meta .dest-col');
        if(cont) highlightAllInContainer(cont, query);
      }, 300);
    }
  });
}

// Global modal state for row actions
let _rowActionExpense = null;
let _rowActionJournal = null;
let _rowActionTrip = null; // New global state for trip actions
(() => {
  const modal = document.getElementById('rowMenuModal');
  if (!modal) return;
  const btnEdit = document.getElementById('rowMenuEdit');
  const btnDel = document.getElementById('rowMenuDelete');
  const btnCancel = document.getElementById('rowMenuCancel');

  if (btnEdit) btnEdit.addEventListener('click', ()=>{
    if (_rowActionExpense) { openExpenseModal(_rowActionExpense); }
    else if (_rowActionJournal) { openJournalModal(_rowActionJournal); }
    else if (_rowActionTrip) { openTrip(_rowActionTrip.id); } // Open trip on edit
    modal.close(); _rowActionExpense = _rowActionJournal = _rowActionTrip = null;
  });

  if (btnDel) btnDel.addEventListener('click', ()=>{
    if (_rowActionExpense) {
      routeDelete({type:'expense', id:_rowActionExpense.id, message:'האם אתה בטוח שברצונך למחוק הוצאה זו?'});
    }
    else if (_rowActionJournal) {
      routeDelete({type:'journal', id:_rowActionJournal.id, message:'האם אתה בטוח שברצונך למחוק רישום זה?'});
    }
    else if (_rowActionTrip) {
      routeDelete({type:'trip', id:_rowActionTrip.id, message:'האם אתה בטוח שברצונך למחוק טיול זה? פעולה זו אינה הפיכה.'});
    }
    modal.close(); _rowActionExpense = _rowActionJournal = _rowActionTrip = null;
  });

  if (btnCancel) btnCancel.addEventListener('click', ()=>{
    modal.close(); _rowActionExpense = _rowActionJournal = _rowActionTrip = null;
  });
})();


/* ---------- Global Delete Router (DRY) ---------- */
function routeDelete(opts){
  try {
    const type = opts?.type;
    const id   = opts?.id;
    const msg  = opts?.message || 'לאשר מחיקה?';
    if (!type || !id) return;
    showConfirm(msg, ()=>{
      if (type === 'expense') return deleteExpense(id);
      if (type === 'journal') return deleteJournal(id);
      if (type === 'trip')    return deleteTrip(id);
    });
  } catch(e){ /*log removed*/ }
}

/* Delegation: any element with [data-delete="expense|journal|trip"] and [data-id] */
document.addEventListener('click', (ev)=>{
  const el = ev.target && ev.target.closest?.('[data-delete]');
  if (!el) return;
  const type = el.dataset.delete;
  const id   = el.dataset.id || el.closest('[data-id]')?.dataset.id;
  const message = el.dataset.msg || null;
  if (type && id) {
    ev.preventDefault();
    ev.stopPropagation();
    routeDelete({type, id, message});
  }
});

/* ---------- Confirm Modal (generic) ---------- */
function showConfirm(msg, onYes){
  const m = document.getElementById('confirmDeleteModal');
  if(!m){ if(onYes) onYes(); return; }
  const body = m.querySelector('.body p') || m.querySelector('.body');
  if(body) body.textContent = msg || 'לאשר?';
  m.showModal();
  m._yesHandler = ()=>{
    try{ onYes && onYes(); } finally { m.close(); }
  };
}
(function bindConfirmButtons(){
  const m = document.getElementById('confirmDeleteModal');
  if(!m) return;
  const yes = document.getElementById('confirmDeleteYes');
  const no  = document.getElementById('confirmDeleteNo');
  if(yes) yes.onclick = ()=>{ m._yesHandler ? m._yesHandler() : m.close(); };
  if(no)  no.onclick  = ()=> m.close();
})();


// === Bind delete buttons inside the Expense & Journal modals ===
(function bindInlineDeleteButtons(){
  // Expense modal delete
  const expDelBtn = document.getElementById('expDelete');
  if (expDelBtn && !expDelBtn._bound) {
    expDelBtn._bound = true;
    expDelBtn.addEventListener('click', () => {
      const expId = document.getElementById('expenseModal')?.dataset?.id;
      if (!expId) return;
      showConfirm('לאשר מחיקה?', async () => {
        try {
          await deleteExpense(expId);
        } finally {
          document.getElementById('expenseModal')?.close();
          document.getElementById('confirmDeleteModal')?.close();
        }
      });
    });
  }
  // Journal modal delete
  const jrDelBtn = document.getElementById('jrDelete');
  if (jrDelBtn && !jrDelBtn._bound) {
    jrDelBtn._bound = true;
    jrDelBtn.addEventListener('click', () => {
      const jrId = document.getElementById('journalModal')?.dataset?.id;
      if (!jrId) return;
      showConfirm('לאשר מחיקה?', async () => {
        try {
          await deleteJournal(jrId);
        } finally {
          document.getElementById('journalModal')?.close();
          document.getElementById('confirmDeleteModal')?.close();
        }
      });
    });
  }
})(); 

// New delete trip function
async function deleteTrip(id) {
  if (!id) return;
  const ref = FB.doc(db, 'trips', id);
  await FB.deleteDoc(ref);
  await deleteTripSummary(id);
  showToast('הטיול נמחק בהצלחה');
  enterHomeMode();
}

function handleGlobalDeleteClicks(e){
  const el = e.target.closest && e.target.closest('[data-confirm="delete-expense"]');
  if(!el) return;
  e.preventDefault();
  const expId = document.getElementById('expenseModal')?.dataset?.id;
  if(!expId) return;
  showConfirm('לאשר מחיקה?', async ()=>{
    try{
      // Use the existing, correct delete function
      await deleteExpense(expId);
    }catch(err){ alert(typeof xErr==='function' ? xErr(err) : (err?.message||err)); }
    finally{
      // The deleteExpense function already reloads the trip, just close the modals.
      document.getElementById('expenseModal')?.close();
      document.getElementById('confirmDeleteModal')?.close();
    }
  });
}
document.addEventListener('click', handleGlobalDeleteClicks);

// Added a separate delete function for expenses
async function deleteExpense(id){
  const tid = state.currentTripId;
  if(!tid || !id) return;
  const ref = FB.doc(db,'trips', tid);
  const snap = await FB.getDoc(ref);
  const t = snap.data() || {};
  if(t.expenses && t.expenses[id]){
    delete t.expenses[id];
    await FB.updateDoc(ref, { expenses: t.expenses });
    showToast('הוצאה נמחקה');
    await loadTrip();
  }
}

// Added a new delete function for journal entries

// ---- Local-refresh bulk delete: instant UI, background sync ----
async function deleteJournalBulkLocal(ids){
  if(!Array.isArray(ids) || ids.length===0) return;
  const tid = state.currentTripId;
  if(!tid) return;
  // 1) Update local state
  if(!state.current) state.current = { id: tid, journal:{} };
  let removed = 0;
  for(const id of ids){
    if(state.current.journal && state.current.journal[id]){
      delete state.current.journal[id];
      removed++;
    }
  }
  // 2) Instant re-render (no network)
  renderJournal(state.current, state.journalSort);
  try{ renderAllTimeline(state.current, state.allSort); }catch(_){}
  try{
    if(state.gpx?.enabled){
      __refreshGpxFromCurrent();
      __renderGpxPanel();
    }
  }catch(_){}
  showToast(`נמחקו ${removed} רישומים`);
  // 3) Background sync (best-effort)
  try{
    const ref = FB.doc(db,'trips', tid);
    await FB.updateDoc(ref, { journal: state.current.journal });
  }catch(e){
  }
}
async function deleteJournal(id){
  const tid = state.currentTripId;
  if(!tid || !id) return;

  // Update local state immediately so the row disappears now
  try{
    if(state.current && state.current.journal && state.current.journal[id]){
      delete state.current.journal[id];
      renderJournal(state.current, state.journalSort);
      try{ renderAllTimeline(state.current, state.allSort); }catch(_){}
      try{
        if(state.gpx?.enabled){
          __refreshGpxFromCurrent();
          __renderGpxPanel();
        }
      }catch(_){}
    }
  }catch(_){}

  // Persist: overwrite the journal map (Firestore ignores undefined field updates)
  const ref = FB.doc(db,'trips', tid);
  const snap = await FB.getDoc(ref);
  const t = snap.data() || {};
  if(t.journal && t.journal[id]){
    delete t.journal[id];
    await FB.updateDoc(ref, { journal: t.journal });
    showToast('רישום יומן נמחק');
    await loadTrip();
    try{
      if(state.gpx?.enabled){
        __refreshGpxFromCurrent();
        __renderGpxPanel();
      }
    }catch(_){}
  }
}


function handleGlobalCurrencyClick(e){
  const btn = e.target.closest && e.target.closest('#barCurrency');
  if(!btn) return;
  const t = state.current;
  if(!t) return;
  let cur = getActiveCurrencyFromTrip(t);
  cur = cycleCurrency(cur);
  setActiveCurrency(cur);
  try{
    const ref = FB.doc(db,'trips', t.id || state.currentTripId);
    FB.updateDoc(ref, { baseCurrency: cur }).catch(()=>{});
    t.baseCurrency = cur;
  }catch(_){}
  try{ renderExpenseSummary(t); }catch(_){}
}
document.addEventListener('click', handleGlobalCurrencyClick);


function handleBarSort(e){
  const btn = e.target.closest && e.target.closest('#barSort');
  if(!btn) return;
  e.preventDefault();
  // Toggle state sort order
  toggleExpenseSort();
}
document.addEventListener('click', handleBarSort);


const EXPENSE_CATEGORIES = ['טיסה','לינה','תקשורת','רכב','ביטוח בריאות','מזון - מסעדות / סופר','קניות','אטרקציות','אחר'];
function seedExpenseCategories(){
  const sel = document.getElementById('expCat');
  if(!sel) return;
  if(sel.options && sel.options.length>0) return;
  EXPENSE_CATEGORIES.forEach(lbl=>{
    const opt = document.createElement('option'); opt.value = lbl; opt.textContent = lbl; sel.appendChild(opt);
  });
}


// === UI: add small rate note under amount cells (vs ILS) ===
function getRateToILS(cur, rates){
  const M = rateMatrix(rates || state.rates);
  return (M[cur] && M[cur].ILS) ? M[cur].ILS : 1;
}
function applyRateNotes(){
  const tbls = ['#tblExpenses', '#tblRecentExpenses'];
  tbls.forEach(sel=>{
    const body = document.querySelector(sel);
    if(!body) return;
    Array.from(body.querySelectorAll('tr')).forEach(tr=>{
      const tds = tr.querySelectorAll('td');
      if(tds.length < 5) return;
      const amountTd = tds[3]; // menu, desc, category, amount, currency, date
      const currencyTd = tds[4];
      const cur = (currencyTd?.textContent || '').trim();
      let amount = Number(amountTd.firstChild && amountTd.firstChild.nodeValue || 0); if(!amount) { amount = parseFloat((amountTd.textContent||'').replace(/[^0-9.]/g,''))||0; } // Get the number from the cell
      if(!cur) return;
      if(amountTd.querySelector('.rate-note')) return;
      const rateToILS = getRateToILS(cur, state.rates);
      const convertedAmountILS = amount * rateToILS;
      // Removed the creation and appending of the rate-note div
      // const note = document.createElement('div');
      // note.className = 'rate-note';
      // note.textContent = `₪${convertedAmountILS.toFixed(2)}`; // Display the converted amount in ILS
      // amountTd.appendChild(note);
    });
  });
}
// Observe changes and apply automatically
(function(){
  const target = document.body;
  if(!target) return;
  const obs = new MutationObserver(()=> applyRateNotes());
  obs.observe(target, { childList:true, subtree:true });
  // also run once on load
  window.addEventListener('DOMContentLoaded', applyRateNotes);
  setTimeout(applyRateNotes, 300);
})();
// === End UI rate note ===


// New Map Selection Functionality

// Common function to get current location
function getCurrentLocation(callback) {
  if (navigator.geolocation) {
    navigator.geolocation.getCurrentPosition(
      (position) => {
        callback(position.coords.latitude, position.coords.longitude);
      },
      (error) => {
        showToast('שגיאה בקבלת מיקום: ' + error.message);
      }
    );
  } else {
    showToast('הדפדפן אינו תומך ב-Geolocation.');
  }
}

// === Persist last known location (for faster entry) ===
const __LAST_LOC_KEY = 'flymily_last_location_v1';
function saveLastLocation(lat, lng, name){
  try{
    const payload = { lat:Number(lat), lng:Number(lng), name:String(name||''), ts: Date.now() };
    localStorage.setItem(__LAST_LOC_KEY, JSON.stringify(payload));
  }catch(_){ }
}
function loadLastLocation(){
  try{
    const raw = localStorage.getItem(__LAST_LOC_KEY);
    if(!raw) return null;
    const d = JSON.parse(raw);
    if(!d || typeof d.lat!=='number' || typeof d.lng!=='number') return null;
    return d;
  }catch(_){ return null; }
}
function updateExpLocationPreview(){
  try{
    const prev = document.getElementById('expLocationPreview');
    if(!prev) return;
    const name = (document.getElementById('expLocationName')?.value || '').trim();
    prev.textContent = name ? name : 'מיקום נשמר אוטומטית';
  }catch(_){ }
}
async function setExpenseLocation(lat, lng, name, opts){
  try{
    if(lat!=null) document.getElementById('expLat').value = String(lat);
    if(lng!=null) document.getElementById('expLng').value = String(lng);
    if(typeof name === 'string') document.getElementById('expLocationName').value = name;
    updateExpLocationPreview();
    if(!opts || opts.persist !== false){ saveLastLocation(lat, lng, name); }
  }catch(_){ }
}

function updateJrLocationPreview(){
  try{
    const prev = document.getElementById('jrLocationPreview');
    if(!prev) return;
    const name = (document.getElementById('jrPlaceName')?.value || '').trim();
    prev.textContent = name ? name : 'מיקום נשמר אוטומטית';
  }catch(_){ }
}
async function setJournalLocation(lat, lng, name, opts){
  try{
    if(lat!=null) document.getElementById('jrLat').value = String(lat);
    if(lng!=null) document.getElementById('jrLng').value = String(lng);
    if(typeof name === 'string') document.getElementById('jrPlaceName').value = name;
    updateJrLocationPreview();
    if(!opts || opts.persist !== false){ saveLastLocation(lat, lng, name); }
  }catch(_){ }
}

function openFxDetailsModal(payload){
  try{
    const dlg = document.getElementById('fxDetailsModal');
    if(!dlg || !dlg.showModal) return;
    const { curr, amountNum, rateToILS, ilsNum } = payload || {};
    const fmtAmt = (n, min=2, max=2) => Number(n||0).toLocaleString('he-IL', { minimumFractionDigits:min, maximumFractionDigits:max });
    const localTxt = `${curr} ${fmtAmt(amountNum)}`;
    const rateTxt = (rateToILS!=null) ? `1 ${curr} = ₪ ${fmtAmt(rateToILS,4,4)}` : 'לא זמין';
    const ilsTxt  = (ilsNum!=null) ? `₪ ${fmtAmt(ilsNum)}` : 'לא זמין';
    const $l=document.getElementById('fxLocal'); if($l) $l.textContent = localTxt;
    const $r=document.getElementById('fxRate');  if($r) $r.textContent = rateTxt;
    const $i=document.getElementById('fxILS');   if($i) $i.textContent = ilsTxt;
    dlg.showModal();
  }catch(_){ }
}

// Common function for searching a location name
async function searchLocationByName(name, callback, isHebrew) {
  const lang = isHebrew ? 'he' : 'en';
  try {
    const res = await fetch(`https://nominatim.openstreetmap.org/search?q=${name}&format=json&accept-language=${lang}&limit=1`);
    const data = await res.json();
    if (data.length > 0) {
      callback(Number(data[0].lat), Number(data[0].lon), data[0].display_name);
    } else {
      if(emailSpan){ emailSpan.textContent=''; emailSpan.style.display='none'; }
      if(btnLogin) btnLogin.style.display='inline-block';
      const ub=document.getElementById('userBadge'); if(ub) ub.style.display='none';
      showToast('לא נמצא מיקום עבור השם הזה.');
    }
  } catch (e) {
    showToast('שגיאה בחיפוש מיקום: ' + e.message);
  }
}

// === Reverse Geocode (Coords -> Name) ===
function _cleanPlaceLabel(v){
  try{
    let s = String(v || '').trim();
    if(!s) return '';
    s = s
      .replace(/^תיקון\s+/, '')
      .replace(/^near\s+/i, '')
      .replace(/^ליד\s+/, '')
      .replace(/\s*,\s*ישראל$/,'')
      .replace(/\s*,\s*israel$/i,'')
      .trim();
    return s;
  }catch(_){ return ''; }
}
function _pickFirstPlaceLabel(candidates){
  const bad = new Set(['yes','building','house','residential','retail','commercial','hotel']);
  for(const raw of candidates || []){
    const s = _cleanPlaceLabel(raw);
    if(!s) continue;
    if(bad.has(s.toLowerCase())) continue;
    return s;
  }
  return '';
}
function _placeFromReversePayload(data, preferHebrew){
  try{
    const addr = data?.address || {};
    const nd = data?.namedetails || {};
    const countryCode = String(addr.country_code || '').toLowerCase();
    const isIsrael = countryCode === 'il';

    const poi = _pickFirstPlaceLabel([
      preferHebrew ? nd['name:he'] : nd['name:en'],
      nd.name,
      preferHebrew ? nd.official_name : nd.official_name,
      preferHebrew ? nd.brand : nd.brand,
      data?.name,
      addr.attraction,
      addr.tourism,
      addr.amenity,
      addr.shop,
      addr.leisure,
      addr.building,
      addr.hotel,
      addr.aeroway,
      addr.railway
    ]);

    const cityish = _pickFirstPlaceLabel([
      addr.city,
      addr.town,
      addr.village,
      addr.municipality,
      addr.suburb,
      addr.city_district,
      addr.borough,
      addr.hamlet,
      addr.county,
      addr.state
    ]);

    if (poi) return poi;
    if (cityish) return cityish;
    if (isIsrael) return _cleanPlaceLabel(addr.country || 'ישראל');
    return _cleanPlaceLabel(addr.country || data?.display_name || '');
  }catch(_){ return ''; }
}
async function reverseGeocode(lat, lng) {
  const fallback = `${Number(lat).toFixed(5)}, ${Number(lng).toFixed(5)}`;
  try {
    const mkUrl = (lang) => `https://nominatim.openstreetmap.org/reverse?format=jsonv2&addressdetails=1&namedetails=1&extratags=1&zoom=18&lat=${encodeURIComponent(lat)}&lon=${encodeURIComponent(lng)}&accept-language=${encodeURIComponent(lang)}`;

    const resEn = await fetch(mkUrl('en'));
    const dataEn = await resEn.json();
    const isIsrael = String(dataEn?.address?.country_code || '').toLowerCase() === 'il';

    if (isIsrael) {
      try {
        const resHe = await fetch(mkUrl('he'));
        const dataHe = await resHe.json();
        return _placeFromReversePayload(dataHe, true) || _placeFromReversePayload(dataEn, false) || fallback;
      } catch (_) {
        return _placeFromReversePayload(dataEn, false) || fallback;
      }
    }

    return _placeFromReversePayload(dataEn, false) || fallback;
  } catch (e) {
    return fallback;
  }
}


// === Helpers: title derivation & cached reverse geocode ===
const __revGeoCache = new Map(); // key: "lat,lng" (rounded)
function _revKey(lat,lng){
  const r = (n)=> (Math.round(Number(n)*10000)/10000).toFixed(4);
  return `${r(lat)},${r(lng)}`;
}
async function reverseGeocodeCached(lat, lng){
  const key = _revKey(lat,lng);
  if(__revGeoCache.has(key)) return __revGeoCache.get(key);
  const prom = (async()=> await reverseGeocode(lat,lng))();
  __revGeoCache.set(key, prom);
  return prom;
}
const __countryReverseCache = new Map();
const __placeSearchCache = new Map();
const __countryCenterCache = new Map();
const countryCapitalMap = {
  'israel': { label:'ישראל', capital:'Jerusalem, Israel', lat:31.7683, lng:35.2137 },
  'france': { label:'צרפת', capital:'Paris, France', lat:48.8566, lng:2.3522 },
  'switzerland': { label:'שווייץ', capital:'Bern, Switzerland', lat:46.9480, lng:7.4474 },
  'italy': { label:'איטליה', capital:'Rome, Italy', lat:41.9028, lng:12.4964 },
  'germany': { label:'גרמניה', capital:'Berlin, Germany', lat:52.5200, lng:13.4050 },
  'spain': { label:'ספרד', capital:'Madrid, Spain', lat:40.4168, lng:-3.7038 },
  'greece': { label:'יוון', capital:'Athens, Greece', lat:37.9838, lng:23.7275 },
  'austria': { label:'אוסטריה', capital:'Vienna, Austria', lat:48.2082, lng:16.3738 },
  'czechia': { label:'צ׳כיה', capital:'Prague, Czechia', lat:50.0755, lng:14.4378 },
  'hungary': { label:'הונגריה', capital:'Budapest, Hungary', lat:47.4979, lng:19.0402 },
  'poland': { label:'פולין', capital:'Warsaw, Poland', lat:52.2297, lng:21.0122 },
  'romania': { label:'רומניה', capital:'Bucharest, Romania', lat:44.4268, lng:26.1025 },
  'bulgaria': { label:'בולגריה', capital:'Sofia, Bulgaria', lat:42.6977, lng:23.3219 },
  'croatia': { label:'קרואטיה', capital:'Zagreb, Croatia', lat:45.8150, lng:15.9819 },
  'serbia': { label:'סרביה', capital:'Belgrade, Serbia', lat:44.7866, lng:20.4489 },
  'denmark': { label:'דנמרק', capital:'Copenhagen, Denmark', lat:55.6761, lng:12.5683 },
  'sweden': { label:'שוודיה', capital:'Stockholm, Sweden', lat:59.3293, lng:18.0686 },
  'norway': { label:'נורווגיה', capital:'Oslo, Norway', lat:59.9139, lng:10.7522 },
  'united kingdom': { label:'בריטניה', capital:'London, United Kingdom', lat:51.5072, lng:-0.1276 },
  'thailand': { label:'תאילנד', capital:'Bangkok, Thailand', lat:13.7563, lng:100.5018 },
  'turkey': { label:'טורקיה', capital:'Ankara, Turkey', lat:39.9334, lng:32.8597 },
  'japan': { label:'יפן', capital:'Tokyo, Japan', lat:35.6762, lng:139.6503 },
  'china': { label:'סין', capital:'Beijing, China', lat:39.9042, lng:116.4074 },
  'hong kong': { label:'הונג קונג', capital:'Hong Kong', lat:22.3193, lng:114.1694 },
  'vietnam': { label:'ויאטנם', capital:'Hanoi, Vietnam', lat:21.0278, lng:105.8342 },
  'singapore': { label:'סינגפור', capital:'Singapore', lat:1.3521, lng:103.8198 },
  'united arab emirates': { label:'איחוד האמירויות', capital:'Abu Dhabi, United Arab Emirates', lat:24.4539, lng:54.3773 },
  'canada': { label:'קנדה', capital:'Ottawa, Canada', lat:45.4215, lng:-75.6972 },
  'mexico': { label:'מקסיקו', capital:'Mexico City, Mexico', lat:19.4326, lng:-99.1332 },
  'australia': { label:'אוסטרליה', capital:'Canberra, Australia', lat:-35.2809, lng:149.1300 },
  'georgia': { label:'גאורגיה', capital:'Tbilisi, Georgia', lat:41.7151, lng:44.8271 },
  'cyprus': { label:'קפריסין', capital:'Nicosia, Cyprus', lat:35.1856, lng:33.3823 },
  'usa': { label:'ארצות הברית', capital:'Washington, DC, United States', lat:38.9072, lng:-77.0369 },
  'united states': { label:'ארצות הברית', capital:'Washington, DC, United States', lat:38.9072, lng:-77.0369 }
};
const countryAliasMap = {
  'ישראל':'israel','israel':'israel',
  'צרפת':'france','france':'france',
  'שוויץ':'switzerland','שווייץ':'switzerland','switzerland':'switzerland',
  'איטליה':'italy','italy':'italy',
  'גרמניה':'germany','germany':'germany',
  'ספרד':'spain','spain':'spain',
  'יוון':'greece','greece':'greece',
  'אוסטריה':'austria','austria':'austria',
  'צכיה':'czechia','צ׳כיה':'czechia','צכ׳יה':'czechia','czechia':'czechia','czech':'czechia',
  'הונגריה':'hungary','hungary':'hungary',
  'פולין':'poland','poland':'poland',
  'רומניה':'romania','romania':'romania',
  'בולגריה':'bulgaria','bulgaria':'bulgaria',
  'קרואטיה':'croatia','croatia':'croatia',
  'סרביה':'serbia','serbia':'serbia',
  'דנמרק':'denmark','denmark':'denmark',
  'שוודיה':'sweden','שבדיה':'sweden','sweden':'sweden',
  'נורווגיה':'norway','נורבגיה':'norway','norway':'norway',
  'בריטניה':'united kingdom','אנגליה':'united kingdom','uk':'united kingdom','united kingdom':'united kingdom','britain':'united kingdom','england':'united kingdom',
  'תאילנד':'thailand','thailand':'thailand',
  'טורקיה':'turkey','turkey':'turkey',
  'יפן':'japan','japan':'japan',
  'סין':'china','china':'china',
  'הונג קונג':'hong kong','hong kong':'hong kong',
  'ויאטנם':'vietnam','וייטנאם':'vietnam','vietnam':'vietnam',
  'סינגפור':'singapore','singapore':'singapore',
  'איחוד האמירויות':'united arab emirates','איחוד האמירויות הערביות':'united arab emirates','uae':'united arab emirates','united arab emirates':'united arab emirates',
  'קנדה':'canada','canada':'canada',
  'מקסיקו':'mexico','mexico':'mexico',
  'אוסטרליה':'australia','australia':'australia',
  'גאורגיה':'georgia','גיאורגיה':'georgia','georgia':'georgia',
  'קפריסין':'cyprus','cyprus':'cyprus','cypriot':'cyprus',
  'ארהב':'usa','ארה״ב':'usa','ארה"ב':'usa','ארצות הברית':'usa','usa':'usa','us':'usa','united states':'usa','united states of america':'usa','america':'usa'
};
const placeAliasMap = {
  'לרנקה':'cyprus','larnaca':'cyprus','larnaka':'cyprus','larnaca':'cyprus',
  'ניקוסיה':'cyprus','nicosia':'cyprus',
  'פאפוס':'cyprus','paphos':'cyprus',
  'איה נאפה':'cyprus','איה נאפה, קפריסין':'cyprus','ayia napa':'cyprus','agia napa':'cyprus',
  'פרוטראס':'cyprus','protaras':'cyprus',
  'לימסול':'cyprus','limassol':'cyprus',
  'קפריסין הצפונית':'cyprus','צפון קפריסין':'cyprus'
};
countryCapitalMap['andorra'] = { label:'אנדורה', capital:'Andorra la Vella, Andorra', lat:42.5063, lng:1.5218 };
countryCapitalMap['montenegro'] = { label:'מונטנגרו', capital:'Podgorica, Montenegro', lat:42.4304, lng:19.2594 };
countryAliasMap['אנדורה'] = 'andorra';
countryAliasMap['andorra'] = 'andorra';
countryAliasMap['andorra la vella'] = 'andorra';
countryAliasMap['מונטנגרו'] = 'montenegro';
countryAliasMap['montenegro'] = 'montenegro';
countryAliasMap['podgorica'] = 'montenegro';
placeAliasMap['אנדורה'] = 'andorra';
placeAliasMap['andorra'] = 'andorra';
placeAliasMap['andorra la vella'] = 'andorra';
placeAliasMap['מונטנגרו'] = 'montenegro';
placeAliasMap['montenegro'] = 'montenegro';
placeAliasMap['podgorica'] = 'montenegro';
const usStateMap = {
  'new york': { label:'ארה"ב - ניו יורק', center:{ lat:42.9538, lng:-75.5268 } },
  'florida': { label:'ארה"ב - פלורידה', center:{ lat:27.6648, lng:-81.5158 } },
  'california': { label:'ארה"ב - קליפורניה', center:{ lat:36.7783, lng:-119.4179 } },
  'nevada': { label:'ארה"ב - נבדה', center:{ lat:38.8026, lng:-116.4194 } },
  'new jersey': { label:'ארה"ב - ניו ג׳רזי', center:{ lat:40.0583, lng:-74.4057 } },
  'massachusetts': { label:'ארה"ב - מסצ׳וסטס', center:{ lat:42.4072, lng:-71.3824 } },
  'pennsylvania': { label:'ארה"ב - פנסילבניה', center:{ lat:41.2033, lng:-77.1945 } },
  'virginia': { label:'ארה"ב - וירג׳יניה', center:{ lat:37.4316, lng:-78.6569 } },
  'washington': { label:'ארה"ב - וושינגטון', center:{ lat:47.7511, lng:-120.7401 } },
  'district of columbia': { label:'ארה"ב - וושינגטון די.סי.', center:{ lat:38.9072, lng:-77.0369 } }
};
const usStateAliasMap = {
  'new york':'new york','ny':'new york','ניו יורק':'new york',
  'florida':'florida','fl':'florida','פלורידה':'florida',
  'california':'california','ca':'california','קליפורניה':'california',
  'nevada':'nevada','nv':'nevada','נבדה':'nevada','las vegas':'nevada','לאס וגאס':'nevada',
  'new jersey':'new jersey','nj':'new jersey','ניו ג׳רזי':'new jersey','ניו גרזי':'new jersey','newark':'new jersey',
  'massachusetts':'massachusetts','ma':'massachusetts','מסצ׳וסטס':'massachusetts','boston':'massachusetts','בוסטון':'massachusetts',
  'pennsylvania':'pennsylvania','pa':'pennsylvania','פנסילבניה':'pennsylvania','פילדלפיה':'pennsylvania','philadelphia':'pennsylvania',
  'virginia':'virginia','va':'virginia','וירג׳יניה':'virginia',
  'washington':'washington','wa':'washington','washington state':'washington','מדינת וושינגטון':'washington','וושינגטון':'washington','seattle':'washington','סיאטל':'washington',
  'district of columbia':'district of columbia','dc':'district of columbia','washington dc':'district of columbia','washington d c':'district of columbia','washington, dc':'district of columbia','וושינגטון די סי':'district of columbia','וושינגטון די.סי.':'district of columbia','וושינגטון די סי':'district of columbia'
};
function _cleanCountryLabel(v){
  return String(v || '')
    .replace(/^near\s+/i, '')
    .replace(/^ליד\s+/, '')
    .trim();
}
function normalizeCountryKey(value){
  const raw = _cleanCountryLabel(value).toLowerCase()
    .replace(/[׳״"'`]/g,'')
    .replace(/\s+/g,' ')
    .trim();
  return countryAliasMap[raw] || raw;
}
function normalizePlaceKey(value){
  return _cleanCountryLabel(value).toLowerCase()
    .replace(/[׳״"'`]/g,'')
    .replace(/\s+/g,' ')
    .trim();
}
function getCountryMeta(value){
  const key = normalizeCountryKey(value);
  const meta = countryCapitalMap[key];
  if(meta) return { key, ...meta };
  const clean = _cleanCountryLabel(value);
  return { key, label: clean, capital: clean };
}
function getUsStateKeyFromText(raw){
  const text = normalizePlaceKey(raw);
  if(!text) return '';
  const entries = Object.entries(usStateAliasMap).sort((a,b)=> b[0].length - a[0].length);
  for(const [alias, key] of entries){
    if(text === alias || text.includes(alias)) return key;
  }
  return '';
}
function splitDestinationCountries(raw){
  return String(raw || '')
    .split(/\s*[,;]\s*/)
    .map(s=>_cleanCountryLabel(s))
    .filter(Boolean);
}
function isUsaCountryToken(value){
  return normalizeCountryKey(value) === 'usa';
}
function _splitPlaceParts(raw){
  return String(raw || '')
    .split(/\s*,\s*|\s*-\s*|\s*\|\s*/)
    .map(s=>s.trim())
    .filter(Boolean)
    .filter(p=>!/^\d+[A-Za-z-]*$/.test(p));
}
function extractCountryFromPlace(raw){
  const parts = _splitPlaceParts(raw);
  return _cleanCountryLabel(parts[parts.length - 1] || '');
}
function extractCountriesFromDestination(raw){
  const text = String(raw || '').trim();
  if(!text) return [];
  const parts = splitDestinationCountries(text);
  const found = new Map();
  const aliasEntries = Object.entries(countryAliasMap).sort((a,b)=> b[0].length - a[0].length);
  parts.forEach(part=>{
    const normalizedPart = normalizePlaceKey(part);
    for(const [alias, key] of aliasEntries){
      if(normalizedPart === alias || normalizedPart.includes(alias)){
        const meta = countryCapitalMap[key] || { label: part, capital: part };
        found.set(key, { key, country: meta.label, capital: meta.capital });
      }
    }
    const placeCountryKey = placeAliasMap[normalizedPart];
    if(placeCountryKey){
      const meta = countryCapitalMap[placeCountryKey] || { label: part, capital: part };
      found.set(placeCountryKey, { key: placeCountryKey, country: meta.label, capital: meta.capital });
    }
  });
  if(found.size) return Array.from(found.values());
  const fallback = extractCountryFromPlace(text);
  if(!fallback) return [];
  const meta = getCountryMeta(fallback);
  return [{ key: meta.key, country: meta.label, capital: meta.capital }];
}
function buildUsStateGroup(trip){
  const parts = splitDestinationCountries(trip?.destination || '');
  if(parts.length < 2) return null;
  if(!isUsaCountryToken(parts[0])) return null;
  const stateKey = getUsStateKeyFromText(parts.slice(1).join(', '));
  if(!stateKey) return null;
  const stateMeta = usStateMap[stateKey];
  if(!stateMeta) return null;
  return {
    key: `usa:${stateKey}`,
    country: stateMeta.label,
    capital: stateMeta.label,
    center: { ...stateMeta.center }
  };
}
function getTripCoordinateCandidates(trip){
  const out = [];
  const push = (lat, lng)=>{
    const a = Number(lat), b = Number(lng);
    if(Number.isFinite(a) && Number.isFinite(b)) out.push({ lat:a, lng:b });
  };
  Object.values(trip?.expenses || {}).forEach(e=> push(e?.lat, e?.lng));
  Object.values(trip?.journal || {}).forEach(j=>{
    if(Array.isArray(j?.path)){
      j.path.forEach(p=> push(p?.lat, p?.lng));
    }
    push(j?.lat, j?.lng);
  });
  return out;
}
function getTripRepresentativeCoords(trip){
  const pts = getTripCoordinateCandidates(trip);
  if(!pts.length) return null;
  const sum = pts.reduce((acc, pt)=>{
    acc.lat += pt.lat;
    acc.lng += pt.lng;
    return acc;
  }, { lat:0, lng:0 });
  return { lat: sum.lat / pts.length, lng: sum.lng / pts.length };
}
async function reverseGeocodeCountryCached(lat, lng){
  const key = _revKey(lat, lng);
  if(__countryReverseCache.has(key)) return __countryReverseCache.get(key);
  const prom = (async()=>{
    try{
      const url = `https://nominatim.openstreetmap.org/reverse?format=jsonv2&zoom=5&addressdetails=1&lat=${encodeURIComponent(lat)}&lon=${encodeURIComponent(lng)}&accept-language=en`;
      const res = await fetch(url, {
        headers: { 'Accept': 'application/json' }
      });
      if(!res.ok) return '';
      const data = await res.json();
      return String(data?.address?.country || '').trim();
    }catch(_){
      return '';
    }
  })();
  __countryReverseCache.set(key, prom);
  return prom;
}
async function searchPlaceDetailsCached(name){
  const key = String(name || '').trim().toLowerCase();
  if(!key) return null;
  if(__placeSearchCache.has(key)) return __placeSearchCache.get(key);
  const prom = (async()=>{
    try{
      const url = `https://nominatim.openstreetmap.org/search?format=jsonv2&addressdetails=1&limit=1&q=${encodeURIComponent(name)}&accept-language=en`;
      const res = await fetch(url, {
        headers: { 'Accept': 'application/json' }
      });
      if(!res.ok) return null;
      const data = await res.json();
      const first = Array.isArray(data) ? data[0] : null;
      if(!first) return null;
      return {
        country: String(first?.address?.country || '').trim(),
        lat: Number(first?.lat),
        lng: Number(first?.lon),
        displayName: String(first?.display_name || '').trim()
      };
    }catch(_){
      return null;
    }
  })();
  __placeSearchCache.set(key, prom);
  return prom;
}
async function geocodeCountryCenterCached(country){
  const meta = getCountryMeta(country);
  const key = meta.key.toLowerCase();
  if(!key) return null;
  if(__countryCenterCache.has(key)) return __countryCenterCache.get(key);
  const prom = (async()=>{
    if(Number.isFinite(meta.lat) && Number.isFinite(meta.lng)){
      return { lat:Number(meta.lat), lng:Number(meta.lng) };
    }
    return null;
  })();
  __countryCenterCache.set(key, prom);
  return prom;
}
function makeCountryMarkerIcon(count){
  return L.divIcon({
    className: 'country-marker-wrap',
    html: `<div class="country-marker">${esc(count)}</div>`,
    iconSize: [40, 40],
    iconAnchor: [20, 20],
    popupAnchor: [0, -18]
  });
}
function getTripMapDedupKey(trip){
  const id = String(trip?.id || '').trim();
  const destination = String(trip?.destination || '').trim().toLowerCase();
  const start = String(trip?.start || '').trim();
  const end = String(trip?.end || '').trim();
  if(destination || start || end){
    return `trip:${destination}|${start}|${end}`;
  }
  return `trip-id:${id}`;
}
function getTripCountryBaseKey(trip){
  const raw = String(trip?.destination || '').trim().toLowerCase();
  if(!raw) return '';
  return raw
    .split(/\s*-\s*/)[0]
    .replace(/\s+/g, ' ')
    .trim();
}
function dedupeCountryTrips(trips){
  const picked = new Map();
  for(const trip of (trips || [])){
    const baseKey = getTripCountryBaseKey(trip) || getTripMapDedupKey(trip);
    const current = picked.get(baseKey);
    if(!current){
      picked.set(baseKey, trip);
      continue;
    }
    const currentStart = String(current?.start || '');
    const nextStart = String(trip?.start || '');
    if(nextStart && (!currentStart || nextStart < currentStart)){
      picked.set(baseKey, trip);
    }
  }
  return Array.from(picked.values())
    .sort((a,b)=> String(b?.start || '').localeCompare(String(a?.start || '')));
}
async function buildTripCountryGroups(trips){
  const groups = new Map();
  for(const trip of trips || []){
    const tripDedupKey = getTripMapDedupKey(trip);
    const usStateGroup = buildUsStateGroup(trip);
    if(usStateGroup){
      if(!groups.has(usStateGroup.key)){
        groups.set(usStateGroup.key, { ...usStateGroup, trips: [] });
      }
      const usaGroup = groups.get(usStateGroup.key);
      if(!usaGroup.trips.some(existing => getTripMapDedupKey(existing) === tripDedupKey)){
        usaGroup.trips.push(trip);
      }
      continue;
    }
    let countries = extractCountriesFromDestination(trip?.destination || '');
    const representativeCoords = getTripRepresentativeCoords(trip);
    if(!countries.length && representativeCoords){
      const detected = await reverseGeocodeCountryCached(representativeCoords.lat, representativeCoords.lng);
      if(detected){
        const meta = getCountryMeta(detected);
        countries = [{ key: meta.key, country: meta.label, capital: meta.capital }];
      }
    }
    if(!countries.length && trip?.destination){
      const details = await searchPlaceDetailsCached(trip.destination);
      if(details?.country){
        const meta = getCountryMeta(details.country);
        countries = [{ key: meta.key, country: meta.label, capital: meta.capital }];
      }
    }
    for(const countryEntry of countries){
      const center = await geocodeCountryCenterCached(countryEntry.country);
      if(!center) continue;
      const key = countryEntry.key;
      if(!groups.has(key)){
        groups.set(key, { key, country: countryEntry.country, center, trips: [] });
      }
      const group = groups.get(key);
      if(!group.trips.some(existing => getTripMapDedupKey(existing) === tripDedupKey)){
        group.trips.push(trip);
      }
    }
  }
  return Array.from(groups.values())
    .map(group=>{
      const uniqueTrips = dedupeCountryTrips(group.trips);
      return {
        ...group,
        trips: uniqueTrips,
        count: uniqueTrips.length
      };
    })
    .sort((a,b)=> b.count - a.count || a.country.localeCompare(b.country, 'he'));
}
function bindCountryListActions(root){
  if(!root) return;
  root.querySelectorAll('[data-trip-country-open]').forEach(btn=>{
    btn.addEventListener('click', ()=>{
      openTrip(btn.dataset.tripCountryOpen);
    });
  });
}
async function renderTripMapView(trips, renderToken){
  const list = document.getElementById('tripList');
  if(!list) return;
  list.innerHTML = `
    <div class="trip-map-screen">
      <div class="trip-map-topbar">
        <button id="btnExitTripMap" class="btn">חזרה לתצוגה רגילה</button>
        <div class="trip-map-title">מפת המדינות שלי</div>
      </div>
      <div class="trip-list-map-shell">
        <div id="tripListMap" class="trip-list-map" aria-label="מפת מדינות"></div>
        <div id="countryTripsModal" class="country-trips-modal" hidden>
          <div class="country-trips-backdrop" data-country-modal-close></div>
          <div class="country-trips-dialog" role="dialog" aria-modal="true" aria-labelledby="countryTripsTitle">
            <button type="button" class="country-trips-close" aria-label="סגור" data-country-modal-close>×</button>
            <div id="countryTripsTitle" class="country-trips-title"></div>
            <div id="countryTripsList" class="country-trips-list"></div>
          </div>
        </div>
      </div>
    </div>
  `;
  document.getElementById('btnExitTripMap')?.addEventListener('click', ()=>{
    state.viewMode = state.lastNonMapView === 'list' ? 'list' : 'grid';
    renderTripList();
  });
  const countryTripsModal = document.getElementById('countryTripsModal');
  const countryTripsTitle = document.getElementById('countryTripsTitle');
  const countryTripsList = document.getElementById('countryTripsList');
  const closeCountryTripsModal = ()=>{
    if(countryTripsModal) countryTripsModal.hidden = true;
  };
  countryTripsModal?.querySelectorAll('[data-country-modal-close]').forEach(el=>{
    el.addEventListener('click', closeCountryTripsModal);
  });
  if(state._countryTripsModalEscHandler){
    window.removeEventListener('keydown', state._countryTripsModalEscHandler);
  }
  state._countryTripsModalEscHandler = (ev)=>{
    if(ev.key === 'Escape' && !countryTripsModal?.hidden) closeCountryTripsModal();
  };
  window.addEventListener('keydown', state._countryTripsModalEscHandler);
  function openCountryTripsModal(group){
    if(!countryTripsModal || !countryTripsTitle || !countryTripsList || !group) return;
    countryTripsTitle.textContent = `${group.country} · ${group.count} נסיעות`;
    countryTripsList.innerHTML = group.trips.map(trip=>`
      <button class="btn country-trips-item" data-trip-country-open="${esc(trip.id)}">
        <strong>${esc(trip.destination || 'ללא יעד')}</strong>
        <span>${esc(`${fmtDate(trip.start)} - ${fmtDate(trip.end)}`)}</span>
        <span>${esc((Array.isArray(trip.people) && trip.people.length) ? trip.people.join(', ') : 'ללא משתתפים')}</span>
      </button>
    `).join('');
    bindCountryListActions(countryTripsList);
    countryTripsList.querySelectorAll('[data-trip-country-open]').forEach(btn=>{
      btn.addEventListener('click', closeCountryTripsModal);
    });
    countryTripsModal.hidden = false;
  }
  const groups = await buildTripCountryGroups(trips);
  if(renderToken !== state._tripListRenderToken) return;
  if(!state.maps.home){
    state.maps.home = safeInitMap('tripListMap', { zoomControl: true });
    L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', { attribution: '© OpenStreetMap' }).addTo(state.maps.home);
  } else {
    const existing = document.getElementById('tripListMap');
    if(existing && !existing._leaflet_map){
      state.maps.home = safeInitMap('tripListMap', { zoomControl: true });
      L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', { attribution: '© OpenStreetMap' }).addTo(state.maps.home);
    }
  }
  const map = state.maps.home;
  if(!map) return;
  if(state.maps.layers?.homeCountries){
    try{ map.removeLayer(state.maps.layers.homeCountries); }catch(_){}
  }
  state.maps.layers = state.maps.layers || {};
  const layer = L.layerGroup().addTo(map);
  state.maps.layers.homeCountries = layer;
  const bounds = [];
  groups.forEach(group=>{
    const marker = L.marker([group.center.lat, group.center.lng], { icon: makeCountryMarkerIcon(group.count) }).addTo(layer);
    bounds.push([group.center.lat, group.center.lng]);
    marker.on('click', ()=> openCountryTripsModal(group));
  });
  if(bounds.length){
    map.fitBounds(L.latLngBounds(bounds).pad(0.25));
  } else {
    map.setView([20, 10], 2);
  }
  setTimeout(()=> invalidateMap(map), 80);
}
function firstNonEmptyLine(txt){
  try{
    const s = String(txt||'').replace(/\r/g,'').trim();
    if(!s) return '';
    const parts = s.split('\n').map(x=>x.trim()).filter(Boolean);
    return parts[0] || '';
  }catch(_){ return ''; }
}

function _numFromTitleMaybe(s){
  try{
    if(s==null) return null;
    const t = String(s).trim();
    if(!t) return null;
    // remove currency codes/symbols and normalize commas
    const cleaned = t
      .replace(/[A-Z]{2,5}/g,' ')
      .replace(/[₪$€£¥₩₽₹₺₫₴₦₲₱₡₭₸₼₾₿]/g,' ')
      .replace(/,/g,'')
      .replace(/\s+/g,'')
      .trim();
    if(!cleaned) return null;
    // must contain a digit
    if(!/[0-9]/.test(cleaned)) return null;
    // allow leading +/-
    if(!/^[+-]?\d+(\.\d+)?$/.test(cleaned)) return null;
    const n = Number(cleaned);
    return Number.isFinite(n) ? n : null;
  }catch(_){ return null; }
}
function isProbablyAmountTitle(title, exp){
  const n = _numFromTitleMaybe(title);
  if(n==null) return false;
  const a = Number(exp?.amount||0);
  if(!Number.isFinite(a)) return false;
  // treat as bad if it essentially equals the amount (including 0), or title is tiny/zero-like
  const eps = 1e-6;
  if(Math.abs(n - a) <= eps) return true;
  if(a===0 && Math.abs(n) <= eps) return true;
  return false;
}
function deriveTitleCandidateIgnoringStoredTitle(exp, trip){
  const loc = (exp?.locationName||'').toString().trim();
  if(loc) return loc.split(',')[0].trim();
  const d1 = firstNonEmptyLine(exp?.desc || '');
  if(d1) return d1;
  try{
    const raw = (exp?.descHtml || '').toString();
    if(raw){
      const asText = raw
        .replace(/<br\s*\/?>/gi, '\n')
        .replace(/<\/p>/gi, '\n')
        .replace(/<[^>]+>/g, ' ')
        .replace(/&nbsp;/gi, ' ')
        .replace(/&amp;/gi, '&')
        .replace(/&lt;/gi, '<')
        .replace(/&gt;/gi, '>')
        .replace(/\s+/g, ' ')
        .trim();
      const d2 = firstNonEmptyLine(asText);
      if(d2) return d2;
    }
  }catch(_){}
  const dest = (trip?.destination||'').toString().trim();
  if(dest.includes(',')) return dest.split(',')[0].trim();
  return '';
}


function migrateBadExpenseTitles(trip){
  // guard: run once per loaded trip to avoid repeated writes
  if(!state || !state.currentTripId) return;
  if(state._migratedBadTitlesTripId === state.currentTripId) return;

  const expenses = trip?.expenses || {};
  let changed = false;

  for(const [id, exp] of Object.entries(expenses)){
    const curTitle = (exp?.title||'').toString().trim();
    if(curTitle && isProbablyAmountTitle(curTitle, exp)){
      const newTitle = deriveTitleCandidateIgnoringStoredTitle(exp, trip).toString().trim();
      if(newTitle && newTitle !== curTitle){
        expenses[id] = {...exp, title: newTitle};
        changed = true;
      } else if(!newTitle) {
        // blank it so UI falls back cleanly
        expenses[id] = {...exp, title: ''};
        changed = true;
      }
    }
  }

  state._migratedBadTitlesTripId = state.currentTripId;

  if(changed){
    try{
      const ref = FB.doc(db,'trips', state.currentTripId);
      FB.updateDoc(ref, { expenses });
    }catch(_){}
  }
}

function deriveTitleCandidate(exp, trip){
  const t0 = (exp?.title||'').toString().trim();
  if(t0 && !isProbablyAmountTitle(t0, exp)) return t0;
  const loc = (exp?.locationName||'').toString().trim();
  if(loc) return _cleanPlaceLabel(loc.split(',')[0].trim());
  const d1 = firstNonEmptyLine(exp?.desc || '');
  if(d1) return d1;
  // Do NOT fall back to country-only destination (e.g., "Thailand")
  const dest = (trip?.destination||'').toString().trim();
  if(dest.includes(',')) return dest.split(',')[0].trim();
  return '';
}
function buildMapHref(exp){
  try{
    const lat = (exp?.lat!=null) ? Number(exp.lat) : null;
    const lng = (exp?.lng!=null) ? Number(exp.lng) : null;
    if(Number.isFinite(lat) && Number.isFinite(lng)){
      const z = 16;
      return `https://www.openstreetmap.org/?mlat=${encodeURIComponent(lat)}&mlon=${encodeURIComponent(lng)}#map=${z}/${encodeURIComponent(lat)}/${encodeURIComponent(lng)}`;
    }
    const q = (exp?.locationName||'').toString().trim();
    if(q){
      return `https://www.openstreetmap.org/search?query=${encodeURIComponent(q)}`;
    }
    return '';
  }catch(_){ return ''; }
}

// Map modal functionality for both expenses and journal
function openMapSelectModal(lat, lng) {
  const modal = $('#mapSelectModal');
  modal.showModal();
  state.maps.select = L.map('selectMap').setView([lat || 32.0853, lng || 34.7818], 12);
  L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', { attribution: '© OpenStreetMap' }).addTo(state.maps.select);
  state.maps.select.invalidateSize();

  if (lat && lng) {
    state.maps.selectMarker = L.marker([lat, lng]).addTo(state.maps.select);
  } else {
    state.maps.selectMarker = L.marker(state.maps.select.getCenter()).addTo(state.maps.select);
  }

  state.maps.select.on('click', (e) => {
    if (state.maps.selectMarker) {
      state.maps.selectMarker.setLatLng(e.latlng);
    } else {
      if(emailSpan){ emailSpan.textContent=''; emailSpan.style.display='none'; }
      if(btnLogin) btnLogin.style.display='inline-block';
      const ub=document.getElementById('userBadge'); if(ub) ub.style.display='none';
      state.maps.selectMarker = L.marker(e.latlng).addTo(state.maps.select);
    }
  });
}

// Save location from map modal
$('#selectMapSave').addEventListener('click', async () => {
  if (state.maps.selectMarker) {
    const { lat, lng } = state.maps.selectMarker.getLatLng();
    if (state.maps.currentModal === 'expense') {
	      const name = await reverseGeocode(lat, lng);
	      await setExpenseLocation(lat, lng, name, {persist:true});
	      try{ const inEdit = document.getElementById('expLocationNameEdit'); if(inEdit) inEdit.value = (document.getElementById('expLocationName')?.value||''); }catch(_){ }
    // --- קוד חדש (לאחר התיקון) ---
    } else if (state.maps.currentModal === 'journal') {
      try{
        const displayName = await reverseGeocode(lat, lng);
        await setJournalLocation(lat, lng, displayName, {persist:true});
        try{ const inEdit = document.getElementById('jrLocationNameEdit'); if(inEdit) inEdit.value = (document.getElementById('jrPlaceName')?.value||''); }catch(_){ }
      }catch(e){
        // Fallback: keep coords even if reverse-geocode failed
        try{ await setJournalLocation(lat, lng, (document.getElementById('jrPlaceName')?.value||''), {persist:true}); }catch(_){ }
      }
    }
  }
  $('#mapSelectModal').close();
  state.maps.select.remove();
  state.maps.select = null;
});

// Cancel map selection
$('#selectMapCancel').addEventListener('click', () => {
  $('#mapSelectModal').close();
  state.maps.select.remove();
  state.maps.select = null;
});

// Expense modal location actions (wired once)
(function(){
  const btnCur = document.getElementById('btnUseCurrentExp');
  const btnMap = document.getElementById('btnSelectExpLocation');
  const btnEdit = document.getElementById('btnEditExpLocation');
  const dlgLoc = document.getElementById('expLocationModal');
  const inEdit = document.getElementById('expLocationNameEdit');
  const btnOk  = document.getElementById('expLocOk');
  const btnCancel = document.getElementById('expLocCancel');

  if(btnCur && !btnCur.dataset.wired){
    btnCur.dataset.wired='1';
    btnCur.addEventListener('click', async () => {
      getCurrentLocation(async (lat, lng) => {
        const name = await reverseGeocode(lat, lng);
        await setExpenseLocation(lat, lng, name, {persist:true});
        showToast('המיקום הנוכחי נשמר.');
      });
    });
  }
  if(btnMap && !btnMap.dataset.wired){
    btnMap.dataset.wired='1';
    btnMap.addEventListener('click', () => {
      state.maps.currentModal = 'expense';
      openMapSelectModal(numOrNull($('#expLat').value), numOrNull($('#expLng').value));
    });
  }

  // Main expense modal: open compact location editor
  if(btnEdit && dlgLoc && !btnEdit.dataset.wired){
    btnEdit.dataset.wired='1';
    btnEdit.addEventListener('click', ()=>{
      if(inEdit){ inEdit.value = (document.getElementById('expLocationName')?.value||''); }
      if(dlgLoc.showModal) dlgLoc.showModal();
    });
  }
  if(btnOk && dlgLoc && !btnOk.dataset.wired){
    btnOk.dataset.wired='1';
    btnOk.addEventListener('click', ()=>{
      try{
        const v = (inEdit?.value||'').trim();
        document.getElementById('expLocationName').value = v;
        // if user typed manually, keep lat/lng as-is (or clear if empty)
        if(!v){ /* allow empty */ }
        updateExpLocationPreview();
        dlgLoc.close();
      }catch(_){ try{ dlgLoc.close(); }catch(__){} }
    });
  }
  if(btnCancel && dlgLoc && !btnCancel.dataset.wired){
    btnCancel.dataset.wired='1';
    btnCancel.addEventListener('click', ()=>{ try{ dlgLoc.close(); }catch(_){ } });
  }
})();

// Keep preview in sync
try{ updateExpLocationPreview(); }catch(_){ }


// Journal modal location actions
$('#btnAddJournal').addEventListener('click', ()=> openJournalModal());
$('#jrCancel').addEventListener('click', ()=> $('#journalModal').close());
$('#jrSave').addEventListener('click', saveJournal);

function openJournalModal(j) {try{ window._rebindTextColorDots(); }catch(_){}

  try{ document.querySelector('#journalModal .input.rtf').style.paddingBottom='72px'; }catch(_){}
  $('#journalModal').dataset.id = j?.id || '';
  document.getElementById('jrText').innerHTML = (j?.html || j?.text || '').trim();
  enableLinkRemoval(document.getElementById('jrText'));
  $('#jrTitle').value = j?.title || '';
  $('#jrLat').value = j?.lat || '';
  $('#jrLng').value = j?.lng || '';
	$('#jrPlaceName').value = j?.placeName || '';
	try{ updateJrLocationPreview(); }catch(_){ }
	  // Auto-save current location for NEW journal entries (prefill quickly, then refresh in background)
	  try{
	    const isNew = !j;
	    if(isNew){
	      const cached = loadLastLocation();
	      if(cached && !$('#jrLat').value && !$('#jrLng').value){
	        $('#jrLat').value = cached.lat;
	        $('#jrLng').value = cached.lng;
	        if(!$('#jrPlaceName').value && cached.name) $('#jrPlaceName').value = cached.name;
	        try{ updateJrLocationPreview(); }catch(_){ }
	      }
	      getCurrentLocation((lat, lng)=>{
	        try{ setJournalLocation(lat, lng, (document.getElementById('jrPlaceName')?.value||''), {persist:false}); }catch(_){ }
	        // Persist for next entry
	        reverseGeocode(lat, lng).then(name=>{ try{ setJournalLocation(lat, lng, name, {persist:true}); }catch(_){} });
	      });
	    }
	  }catch(_){ }
  $('#jrDelete').style.display = j ? 'inline-block' : 'none';
  // Prefill jrDate/jrTime (enrich)
  try {
    const base = (typeof e!=='undefined' && e) || (typeof j!=='undefined' && j) || null;
    const pad = n=>String(n).padStart(2,'0');
    let dStr=null, tStr=null;
    if (base && base.date && base.time) {
      dStr = base.date.split('/').reverse().join('-'); // dd/mm/yyyy -> yyyy-mm-dd
      tStr = base.time;
    } else if (base && (base.createdAt||base.dateIso)) {
      const d = new Date(base.createdAt||base.dateIso);
      dStr = `${d.getFullYear()}-${pad(d.getMonth()+1)}-${pad(d.getDate())}`;
      tStr = `${pad(d.getHours())}:${pad(d.getMinutes())}`;
    } else {
      const d = new Date();
      dStr = `${d.getFullYear()}-${pad(d.getMonth()+1)}-${pad(d.getDate())}`;
      tStr = `${pad(d.getHours())}:${pad(d.getMinutes())}`;
    }
    const $d=$('#jrDate'), $t=$('#jrTime');
    if($d) $d.value=dStr; if($t) $t.value=tStr;
  } catch(_){}

  $('#journalModal').showModal();
}

async function saveJournal() {
  const ref = FB.doc(db, 'trips', state.currentTripId);
  const snap = await FB.getDoc(ref);
// ---------------------------------------
  const t = snap.exists() ? (snap.data() || {}) : {};

  const existingId = $('#journalModal').dataset.id || '';
  const isInitialCreate = !existingId;
  const id = existingId || (crypto.randomUUID ? crypto.randomUUID() : String(Date.now()));
  t.journal = t.journal || {};

  const prev = t.journal[id] || {};

  const getCurrentLocationOnce = ()=> new Promise((resolve, reject)=>{
    try{
      if(!navigator.geolocation){
        reject(new Error('Geolocation unsupported'));
        return;
      }
      navigator.geolocation.getCurrentPosition(
        (position)=> resolve({
          lat: position.coords.latitude,
          lng: position.coords.longitude
        }),
        (error)=> reject(error),
        { enableHighAccuracy:true, timeout:8000, maximumAge:60000 }
      );
    }catch(err){ reject(err); }
  });

  if(
    isInitialCreate &&
    !($('#jrPlaceName')?.value || '').trim() &&
    !numOrNull($('#jrLat').value) &&
    !numOrNull($('#jrLng').value)
  ){
    try{
      const currentLoc = await getCurrentLocationOnce();
      let displayName = '';
      try{ displayName = await reverseGeocode(currentLoc.lat, currentLoc.lng); }catch(_){ }
      await setJournalLocation(currentLoc.lat, currentLoc.lng, displayName, {persist:true});
    }catch(_){ }
  }

  t.journal[id] = {
    text: (document.getElementById('jrText').innerText || '').trim(),
    html: (document.getElementById('jrText').innerHTML || '').trim(),
    title: ($('#jrTitle').value.trim()),
    placeName: ($('#jrPlaceName')?.value || '').trim(),
    lat: numOrNull($('#jrLat').value),
    lng: numOrNull($('#jrLng').value),
    createdAt: prev.createdAt || new Date().toISOString()
  };

  const $jrD = $('#jrDate');
  const $jrT = $('#jrTime');
  let _jr_dateIso;
  if ($jrD && $jrT && $jrD.value && $jrT.value) {
    _jr_dateIso = new Date(`${$jrD.value}T${$jrT.value}:00`).toISOString();
  } else {
    _jr_dateIso = prev.dateIso || prev.createdAt || new Date().toISOString();
  }
  const __dt = new Date(_jr_dateIso);
  const pad2 = n => String(n).padStart(2, '0');

  t.journal[id].dateIso = _jr_dateIso;
  t.journal[id].date    = `${pad2(__dt.getDate())}/${pad2(__dt.getMonth()+1)}/${__dt.getFullYear()}`;
  t.journal[id].time    = `${pad2(__dt.getHours())}:${pad2(__dt.getMinutes())}`;

  await FB.updateDoc(ref, { [`journal.${id}`]: t.journal[id] });
  $('#journalModal').close();
  showToast('רישום יומן נשמר');
  await loadTrip();
}

// Journal modal location actions (compact UI + editor dialog)
(function(){
  const btnCur = document.getElementById('btnUseCurrentJr');
  const btnMap = document.getElementById('btnSelectJrLocation');
  const btnEdit = document.getElementById('btnEditJrLocation');
  const dlgLoc = document.getElementById('jrLocationModal');
  const inEdit = document.getElementById('jrLocationNameEdit');
  const btnOk  = document.getElementById('jrLocOk');
  const btnCancel = document.getElementById('jrLocCancel');

  if(btnCur && !btnCur.dataset.wired){
    btnCur.dataset.wired='1';
    btnCur.addEventListener('click', async () => {
      getCurrentLocation(async (lat, lng) => {
        const name = await reverseGeocode(lat, lng);
        await setJournalLocation(lat, lng, name, {persist:true});
        showToast('המיקום הנוכחי נשמר.');
      });
    });
  }
  if(btnMap && !btnMap.dataset.wired){
    btnMap.dataset.wired='1';
    btnMap.addEventListener('click', () => {
      state.maps.currentModal = 'journal';
      openMapSelectModal(numOrNull($('#jrLat').value), numOrNull($('#jrLng').value));
    });
  }

  if(btnEdit && dlgLoc && !btnEdit.dataset.wired){
    btnEdit.dataset.wired='1';
    btnEdit.addEventListener('click', ()=>{
      if(inEdit){ inEdit.value = (document.getElementById('jrPlaceName')?.value||''); }
      try{ updateJrLocationPreview(); }catch(_){ }
      if(dlgLoc.showModal) dlgLoc.showModal();
    });
  }
  if(btnOk && dlgLoc && !btnOk.dataset.wired){
    btnOk.dataset.wired='1';
    btnOk.addEventListener('click', ()=>{
      try{
        const v = (inEdit?.value||'').trim();
        document.getElementById('jrPlaceName').value = v;
        updateJrLocationPreview();
        // Persist name for faster next entry (even without coordinates)
        try{ saveLastLocation(numOrNull($('#jrLat').value), numOrNull($('#jrLng').value), v); }catch(_){ }
        dlgLoc.close();
      }catch(_){ try{ dlgLoc.close(); }catch(__){} }
    });
  }
  if(btnCancel && dlgLoc && !btnCancel.dataset.wired){
    btnCancel.dataset.wired='1';
    btnCancel.addEventListener('click', ()=>{ try{ dlgLoc.close(); }catch(_){ } });
  }
})();

try{ updateJrLocationPreview(); }catch(_){ }

// Expense modal location actions
// These were already defined, just re-ordering for clarity
// (Guard) Expense location listeners are wired earlier.
try{
  const _c = document.getElementById('btnUseCurrentExp');
  const _m = document.getElementById('btnSelectExpLocation');
  if(_c && !_c.dataset.wired){ _c.dataset.wired='1'; }
  if(_m && !_m.dataset.wired){ _m.dataset.wired='1'; }
}catch(_){ }


// New logic to set dirty state on input change in meta tab
const metaInputs = [
  '#metaDestination', '#metaStart', '#metaEnd', '#metaPeople', '#bUSD', '#bEUR', '#bILS'
];
metaInputs.forEach(sel => {
  const el = $(sel);
  if (el) {
    el.addEventListener('input', () => {
      state.isDirty = true;
    });
  }
});
$$('.metaType').forEach(btn => {
    btn.addEventListener('click', () => {
        state.isDirty = true;
    });
});
// Function to show the alert
function showUnsavedChangesAlert(nextTab) {
    const modal = $('#unsavedChangesModal');
    if (modal) {
        modal.showModal();
        modal.dataset.nextTab = nextTab;
    }
}
// Unsaved changes modal buttons
$('#unsavedSave').addEventListener('click', async () => {
    $('#unsavedChangesModal').close();
    await saveMetaChanges();
    const nextTab = $('#unsavedChangesModal').dataset.nextTab;
    if (nextTab) {
        const nextBtn = $(`#tabs [data-tab="${nextTab}"]`);
        if (nextBtn) {
            nextBtn.click();
        }
    }
});
$('#unsavedDiscard').addEventListener('click', async () => {
    $('#unsavedChangesModal').close();
    state.isDirty = false; // Discard changes
    await loadTrip(); // Reload trip data to revert changes
    const nextTab = $('#unsavedChangesModal').dataset.nextTab;
    if (nextTab) {
        const nextBtn = $(`#tabs [data-tab="${nextTab}"]`);
        if (nextBtn) {
            nextBtn.click();
        }
    }
});
$('#unsavedCancel').addEventListener('click', () => {
    $('#unsavedChangesModal').close();
});
async function saveMetaChanges() {
    try{
        if(!state.currentTripId){
            showToast('לא נבחרה נסיעה לשמירה');
            return;
        }
        const ref = FB.doc(db, 'trips', state.currentTripId);
        const people = $('#metaPeople').value.split(',').map(s => s.trim()).filter(Boolean);
        const types = $$('.metaType.active').map(b => b.dataset.value);
        const destination = $('#metaDestination').value.trim();
        const localCur = getLocalCurrency(destination);
        
        const budget = {
            USD: parseIntSafe($('#bUSD').value),
            EUR: parseIntSafe($('#bEUR').value),
            ILS: parseIntSafe($('#bILS').value)
        };

        const live = await fetchRatesOnce();
        const lockedRates = {
            USDILS: Number(live?.USDILS) || Number(state.rates?.USDILS) || 3.7,
            USDEUR: Number(live?.USDEUR) || Number(state.rates?.USDEUR) || 0.92,
            lockedAt: live?.lockedAt || new Date().toISOString()
        };
        if (live?.USDLocal) lockedRates.USDLocal = live.USDLocal;

        await FB.updateDoc(ref, {
            destination,
            start: $('#metaStart').value,
            end: $('#metaEnd').value,
            people,
            types,
            localCurrency: localCur,
            budget,
            rates: lockedRates
        });
        try{
            await upsertTripSummary({
                id: state.currentTripId,
                ownerUid: state.user?.uid || state.current?.ownerUid,
                destination,
                start: $('#metaStart').value,
                end: $('#metaEnd').value,
                localCurrency: localCur,
                people,
                types,
                createdAt: state.current?.createdAt
            });
        }catch(_){}
        state.isDirty = false;
        await loadTrip();
        try{ switchToTab('overview'); }catch(_){}
        showToast('נשמר');
    }catch(err){
        console.error('saveMetaChanges failed', err);
        showToast('שמירת נתוני הנסיעה נכשלה');
    }
}
// Override default save button to use the new function
$('#btnSaveMeta').addEventListener('click', saveMetaChanges);

function toggleExpenseSort(){
  state.expenseSort = (state.expenseSort === 'asc') ? 'desc' : 'asc';
  if (state.current) {
    renderExpenses(state.current, state.expenseSort);
    // Recompute summary to keep numbers consistent (and to keep the bar wired)
    try{ renderExpenseSummary(state.current); }catch(_){}
  }
}

// -- Sort buttons wiring --
(() => {
  const btnExp = document.querySelector('#btnSortExpenses');
  if (btnExp && !btnExp.dataset.wired) {
    btnExp.dataset.wired = '1';
    btnExp.addEventListener('click', () => {
      toggleExpenseSort();
    });
  }
  const btnJour = document.querySelector('#btnSortJournal');
  if (btnJour && !btnJour.dataset.wired) {
    btnJour.dataset.wired = '1';
    btnJour.addEventListener('click', () => {
      state.journalSort = (state.journalSort === 'asc') ? 'desc' : 'asc';
      if (state.current) renderJournal(state.current, state.journalSort);
    });
  }
})();



// Delegated click handler as a safety net (in case the direct wiring is skipped)
document.addEventListener('click', (ev) => {
  const el = ev.target;
  if (!el) return;
  if (el.id === 'btnSortExpenses') {
    try { toggleExpenseSort(); } catch(e) { console.error('toggleExpenseSort failed', e); }
  }
});

// === SHARE / IMPORT / EXPORT (Last Tab) ===

// helper to get safe current trip or fallback
function currentTrip(){ return state?.current || {}; }
function asArray(o){ return Array.isArray(o)? o : (o? Object.values(o): []); }

// Build a minimal HTML block for export (RTL + Hebrew-safe)
// Load html2canvas for Hebrew-safe PDF (render as image)
async function ensureHtml2Canvas(){
  if (typeof window.html2canvas !== 'undefined') return true;
  return await loadExternalScript([
    "https://unpkg.com/html2canvas@1.4.1/dist/html2canvas.min.js",
    "https://cdn.jsdelivr.net/npm/html2canvas@1.4.1/dist/html2canvas.min.js"
  ]);
}

// Format helpers for meta
function kvRowsFromMeta(trip){
  const rows = [];
  rows.push({ שדה:'יעד', ערך: esc(trip.destination||'') });
  rows.push({ שדה:'תאריכים', ערך: `${fmtDate(trip.start)} – ${fmtDate(trip.end)}` });
  if (trip.people && trip.people.length) rows.push({ שדה:'משתתפים', ערך: esc(trip.people.join(', ')) });
  if (trip.types && trip.types.length) rows.push({ שדה:'סוג טיול', ערך: esc(trip.types.join(', ')) });
  // Budget (flatten one level)
  if (trip.budget && typeof trip.budget === 'object'){
    const pairs = [];
    if (Number(trip.budget.USD) > 0) pairs.push(`USD: ${formatInt(trip.budget.USD)}`);
    if (Number(trip.budget.EUR) > 0) pairs.push(`EUR: ${formatInt(trip.budget.EUR)}`);
    if (Number(trip.budget.ILS) > 0) pairs.push(`ILS: ${formatInt(trip.budget.ILS)}`);
    if (pairs.length) rows.push({ שדה:'תקציב', ערך: pairs.join(' | ') });
  }
  // Rates
  if (trip.rates && typeof trip.rates === 'object'){
    const parts = [];
    if (trip.rates.USDILS) parts.push(`USDILS: ${trip.rates.USDILS}`);
    if (trip.rates.USDEUR) parts.push(`USDEUR: ${trip.rates.USDEUR}`);
    if (trip.rates.USDLocal) parts.push(`USDLocal: ${trip.rates.USDLocal}`);
    if (parts.length) rows.push({ שדה:'שערי מטבע', ערך: parts.join(' | ') + (trip.rates.lockedAt ? ` | lockedAt: ${dayjs(trip.rates.lockedAt).toISOString()}` : '') });
  }
  return rows;
}

// override PDF to always include all sections
async function exportPDF(){
  const t = currentTrip();
  if(!t.id){ toast('פתח נסיעה'); return; }
  const ok1 = await ensureJsPDF();
  const ok2 = await ensureHtml2Canvas();
  if(!ok1 || !ok2){ toast('בעיה בטעינת ספריות PDF'); return; }

  const { jsPDF } = window.jspdf || window;
  const doc = new jsPDF({orientation:'p', unit:'pt', format:'a4'});
  const container = buildExportContainer(t);
  document.body.appendChild(container);

  const blocks = Array.from(container.children);
  let first = true;
  for (const block of blocks){
    const canvas = await html2canvas(block, { scale: 2, useCORS: true, backgroundColor: '#ffffff' });
    const imgData = canvas.toDataURL('image/png');
    const pageW = doc.internal.pageSize.getWidth();
    const pageH = doc.internal.pageSize.getHeight();
    const ratio = Math.min(pageW / canvas.width, pageH / canvas.height);
    const w = canvas.width * ratio;
    const h = canvas.height * ratio;
    if (!first) doc.addPage();
    first = false;
    doc.addImage(imgData, 'PNG', (pageW - w)/2, 24, w, h, undefined, 'FAST');
  }
  container.remove();
  const file = `FLYMILY_${(t.destination||'trip').replace(/\s+/g,'_')}.pdf`;
  doc.save(file);
}

// override Excel
async function exportExcel(){
  const t = currentTrip();
  if(!t.id){ toast('פתח נסיעה'); return; }
  const ok = await ensureXLSX(); if(!ok){ toast('בעיה בייצוא Excel'); return; }
  const wb = XLSX.utils.book_new();

  const meta = kvRowsFromMeta(t);
  const s0 = XLSX.utils.json_to_sheet(meta);
  XLSX.utils.book_append_sheet(wb, s0, 'נתוני נסיעה');

  const jr = Object.values(t.journal || {}).sort((a,b)=> (a.createdAt||'').localeCompare(b.createdAt||'')).map(j=>({ תאריך: fmtDateTime(j.dateIso || j.createdAt), כותרת:(j.title||''), תיאור:j.text||'' }));
  const s1 = XLSX.utils.json_to_sheet(jr);
  XLSX.utils.book_append_sheet(wb, s1, 'יומן יומי');

  const ex = Object.values(t.expenses || {}).sort((a,b)=> (a.createdAt||'').localeCompare(b.createdAt||'')).map(e=>({ תיאור:e.desc||'', קטגוריה:e.category||'', סכום:e.amount||'', מטבע:e.currency||'', תאריך:fmtDateTime(e.dateIso || e.createdAt)}));
  const s2 = XLSX.utils.json_to_sheet(ex);
  XLSX.utils.book_append_sheet(wb, s2, 'הוצאות');

  const fn = `FLYMILY_${(t.destination||'trip').replace(/\s+/g,'_')}.xlsx`;
  XLSX.writeFile(wb, fn);
}

// override Word
async function exportWord(){
  const t = currentTrip();
  if(!t.id){ toast('פתח נסיעה'); return; }
  const ok = await ensureDOCX(); if(!ok){ toast('בעיה בייצוא Word'); return; }
  const { Document, Packer, Paragraph, HeadingLevel, Table, TableRow, TableCell, WidthType, AlignmentType } = docx;

  const metaRows = kvRowsFromMeta(t).map(r =>
    new TableRow({ children:[
      new TableCell({ children:[new Paragraph(r['שדה'])]}),
      new TableCell({ children:[new Paragraph(String(r['ערך']))]}),
    ]})
  );
  const metaTable = new Table({
    width: { size: 100, type: WidthType.PERCENTAGE },
    rows: [ new TableRow({ children:[
      new TableCell({ children:[new Paragraph({text:'שדה', alignment: AlignmentType.CENTER})]}),
      new TableCell({ children:[new Paragraph({text:'ערך', alignment: AlignmentType.CENTER})]}),
    ]}), ...metaRows ]
  });

  const journalRows = Object.values(t.journal || {}).sort((a,b)=> (a.createdAt||'').localeCompare(b.createdAt||'')).map(j =>
    new TableRow({
      children:[
        new TableCell({ children:[new Paragraph(fmtDateTime(j.dateIso || j.createdAt)||'')]}),
        new TableCell({ children:[new Paragraph(j.placeName||'')]}),
        new TableCell({ children:[new Paragraph(stripLinks(j.text||''))]}),
      ]
    })
  );
  const jrTable = new Table({
    width: { size: 100, type: WidthType.PERCENTAGE },
    rows: [ new TableRow({ children:[
      new TableCell({ children:[new Paragraph({text:'תאריך', alignment: AlignmentType.CENTER})]}),
      new TableCell({ children:[new Paragraph({text:'כותרת', alignment: AlignmentType.CENTER})]}),
      new TableCell({ children:[new Paragraph({text:'תיאור', alignment: AlignmentType.CENTER})]}),
    ]}), ...journalRows ]
  });

  const exRows = Object.values(t.expenses || {}).sort((a,b)=> (a.createdAt||'').localeCompare(b.createdAt||'')).map(e =>
    new TableRow({ children:[
      new TableCell({ children:[new Paragraph(fmtDateTime(e.dateIso || e.createdAt)||'')]}), // 1. תאריך
      new TableCell({ children:[new Paragraph(e.currency||'')]}),                               // 2. מטבע
      new TableCell({ children:[new Paragraph(String(e.amount ?? ''))]}),                       // 3. סכום
      new TableCell({ children:[new Paragraph(e.category||'')]}),                               // 4. קטגוריה
      new TableCell({ children:[new Paragraph(stripLinks(e.desc||''))]}),                                   // 5. תיאור
    ]})
  );
  const exTable = new Table({
    width: { size: 100, type: WidthType.PERCENTAGE },
    rows: [ new TableRow({ children:[
      new TableCell({ children:[new Paragraph({text:'תאריך', alignment: AlignmentType.CENTER})]}),
      new TableCell({ children:[new Paragraph({text:'מטבע', alignment: AlignmentType.CENTER})]}),
      new TableCell({ children:[new Paragraph({text:'סכום', alignment: AlignmentType.CENTER})]}),
      new TableCell({ children:[new Paragraph({text:'קטגוריה', alignment: AlignmentType.CENTER})]}),
      new TableCell({ children:[new Paragraph({text:'תיאור', alignment: AlignmentType.CENTER})]}),
    ]}), ...exRows ]
  });

  const doc = new Document({
    sections:[{
      properties:{},
      children:[
        // כותרת ראשית: שונתה ל"הטיול שלי ל[יעד]"
        new Paragraph({ text:`הטיול שלי ל${t.destination||'המרכז'}`, heading: HeadingLevel.TITLE }),
        new Paragraph({ text:`${fmtDate(t.start)} – ${fmtDate(t.end)}` }),
        // כותרת משנה: "נתוני נסיעה" - הוספת יישור לימין
        new Paragraph({ text:'נתוני נסיעה', heading: HeadingLevel.HEADING_2, alignment: AlignmentType.RIGHT }),
        metaTable,
        // כותרת משנה: "יומן יומי" - הוצמדה לימין
        new Paragraph({ text:'יומן יומי', heading: HeadingLevel.HEADING_2, alignment: AlignmentType.RIGHT }),
        jrTable,
        // כותרת משנה: "הוצאות" - הוצמדה לימין
        new Paragraph({ text:'הוצאות', heading: HeadingLevel.HEADING_2, alignment: AlignmentType.RIGHT }),
        exTable
      ]
    }]
  });
  const blob = await Packer.toBlob(doc);
  const link = document.createElement('a'); link.href = URL.createObjectURL(blob);
  link.download = `FLYMILY_${(t.destination||'trip').replace(/\s+/g,'_')}.docx`; link.click(); URL.revokeObjectURL(link.href);
}


// --- Export Trip Schedule to Word (A4, RTL, Sunday->Saturday) ---
async function exportTripScheduleWord(){
  const t = currentTrip();
  if(!t || !t.id){ toast('פתח נסיעה'); return; }
  const ok = await ensureDOCX(); if(!ok){ toast('בעיה בייצוא Word'); return; }
  const { Document, Packer, Paragraph, Table, TableRow, TableCell, WidthType, AlignmentType, HeadingLevel, TextRun } = window.docx || window;

  // Build inclusive range from Sunday before/at start to Saturday after/at end
  const dStart = dayjs(t.start);
  const dEnd   = dayjs(t.end);
  if(!dStart.isValid() || !dEnd.isValid()){ toast('תאריכי נסיעה לא תקינים'); return; }
  const startSunday = dStart.day()===0 ? dStart.startOf('day') : dStart.subtract(dStart.day(), 'day').startOf('day');
  const endSaturday = dEnd.day()===6 ? dEnd.endOf('day')   : dEnd.add(6 - dEnd.day(), 'day').endOf('day');

  const days = [];
  for(let d = startSunday.clone(); d.isBefore(endSaturday) || d.isSame(endSaturday,'day'); d = d.add(1,'day')){
    days.push(d.clone());
  }

  // Map expenses to date YYYY-MM-DD -> array of lines (max 5 per expense)
  const expMap = Object.create(null);
const expenses = Object.values(t.expenses || {});
for(const e of expenses){
  const dIso = e?.dateIso || e?.createdAt || e?.date;
  const dd = dayjs(dIso);
  if(!dd.isValid()) continue;
  const key = dd.format('YYYY-MM-DD');
  const raw = (e?.desc || e?.text || '').toString();
  const lines = raw.split(/\r?\n/).map(s=>s.trim()).filter(Boolean).slice(0,5);
  if(!expMap[key]) expMap[key] = [];
  expMap[key].push({ t: dd.valueOf(), lines });
}
// Sort expenses within each day by time (earliest first)
Object.keys(expMap).forEach(k=>{
  expMap[k] = expMap[k].sort((a,b)=>a.t-b.t).map(o=>o.lines);
});

  // Header row: days labels, right-to-left visual order (rightmost=Sunday)
  const headerLabels = ['שבת','שישי','חמישי','רביעי','שלישי','שני','ראשון'];
  const headerRow = new TableRow({ children: headerLabels.map(txt => new TableCell({ children:[ new Paragraph({ text: txt, alignment: AlignmentType.CENTER }) ] })) });

  const weekRows = [];
  for(let i=0; i<days.length; i+=7){
    const slice = days.slice(i, i+7); // [Sunday..Saturday]
    const cells = [];
    for(let col=6; col>=0; col--){ // iterate Saturday->Sunday to render RTL columns (rightmost shows Sunday)
      const d = slice[col];
      if(!d){ cells.push(new TableCell({ children:[ new Paragraph('') ] })); continue; }
      const key = d.format('YYYY-MM-DD');
      const dateLabel = d.format('DD/MM');

      const paras = [ new Paragraph({ children:[ new TextRun({ text: dateLabel, bold: true }) ], alignment: AlignmentType.RIGHT }) ];
      const dayExps = expMap[key] || [];
      dayExps.forEach((arr, idx) => {
        arr.forEach(line => paras.push(new Paragraph({ text: line, alignment: AlignmentType.RIGHT })));
        if(idx < dayExps.length - 1) paras.push(new Paragraph({ text: '', alignment: AlignmentType.RIGHT })); // blank line between expenses
      });

      cells.push(new TableCell({ children: paras }));
    }
    weekRows.push(new TableRow({ children: cells }));
  }

  const doc = new Document({
    sections: [{
      properties: { page: { margin: { top: 720, right: 720, bottom: 720, left: 720 } } },
      children: [
        new Paragraph({ text: (t.destination ? `לו"ז טיול – ${t.destination}` : 'לו"ז טיול'), heading: HeadingLevel.HEADING_2, alignment: AlignmentType.RIGHT }),
        new Paragraph({ text: `${fmtDate(t.start)} – ${fmtDate(t.end)}`, alignment: AlignmentType.RIGHT }),
        new Table({ width: { size: 100, type: WidthType.PERCENTAGE }, columnWidths: Array(7).fill(1200), rows: [headerRow, ...weekRows] })
      ]
    }]
  });

  const fileName = `FLYMILY_Trip_Schedule_${(t.destination||'trip').replace(/\\s+/g,'_')}.docx`;
  const blob = await Packer.toBlob(doc);
  const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = fileName; a.click();
  setTimeout(()=> URL.revokeObjectURL(a.href), 2000);
  toast('נוצר קובץ לו"ז טיול (Word)');
}

// Wire the new Export Trip Schedule button
document.addEventListener('DOMContentLoaded', ()=>{
  const btn = document.getElementById('btnExportTripSchedule');
  if(btn){ btn.addEventListener('click', ()=> exportTripScheduleWord()); }
});






// ---- Explicit login flow only (no auto-submit) ----
let __loginInFlight = false;
async function loginWithCredentials(emailSel='#authEmail', passSel='#authPass', errSel='#authError'){
  if(__loginInFlight) return;
  __loginInFlight = true;
  try{
    const email = document.querySelector(emailSel)?.value?.trim();
    const pass  = document.querySelector(passSel)?.value;
    if(!email || !pass){
      const e = document.querySelector(errSel);
      if(e) e.textContent = 'אנא מלא אימייל וסיסמה';
      return;
    }
    await FB.signInWithEmailAndPassword(FB.auth, email, pass);
    const e = document.querySelector(errSel); if(e) e.textContent = '';
  }catch(err){
    const e = document.querySelector('#authError'); if(e) e.textContent = (err?.code || err?.message || 'שגיאת התחברות');
    showMobileAuthDebug(err);
    console.error('login failed', err);
  }finally{
    __loginInFlight = false;
  }
}
document.addEventListener('click', (ev)=>{
  const t = ev.target;
  if(!t) return;
  if(t.matches('#authPrimary')){ loginWithCredentials(); }
});
// ===== Auth UI helpers (final) =====
// Toggle app/login screens on auth state change + start subscriptions
if (typeof FB !== 'undefined' && FB?.onAuthStateChanged) {
  let __lastAuthUid = null;
  FB.onAuthStateChanged(FB.auth, (user) => {
    if((user?.uid||null)===__lastAuthUid){ return; }
    __lastAuthUid = user?.uid||null;
    applyAuthShellState(user);
    if (user) {
      state.user = user;
      try { subscribeTrips(user.uid); } catch(e){ /*log removed*/ }
    } else {
      state.user = null;
    }
  });
}try { /*log removed*/ } catch(e){}


// === Mobile Preview Presets & Rotation ===
(function(){
  const mobileBtn = document.getElementById('btnMobilePreview');
  const rotateBtn = document.getElementById('btnRotate');
  const presetSel = document.getElementById('devicePreset');
  const appEl = document.querySelector('.app');
  if(!appEl) return;

  // Device map (CSS pixels, portrait)
  const DEVICES = {
    'iphone-13-pro-max': { w: 428, h: 926 },
    'iphone-13-14':      { w: 390, h: 844 },
    'iphone-se-3':       { w: 375, h: 667 },
    'pixel-7':           { w: 412, h: 915 },
    'galaxy-s23':        { w: 360, h: 780 },
  };

  function getState(){
    return {
      on: document.body.classList.contains('mobile-preview'),
      preset: localStorage.getItem('previewMobile.preset') || 'iphone-13-pro-max',
      landscape: localStorage.getItem('previewMobile.landscape') === '1'
    };
  }

  function saveState(s){
    localStorage.setItem('previewMobile.preset', s.preset);
    localStorage.setItem('previewMobile.landscape', s.landscape ? '1':'0');
  }
  const emailSpan = document.getElementById('currentUserEmail');
  function applyDims(){
    const s = getState();
    const d = DEVICES[s.preset] || DEVICES['iphone-13-pro-max'];
    const w = s.landscape ? d.h : d.w;
    const h = s.landscape ? d.w : d.h;
    if (document.body.classList.contains('mobile-preview')) {
      appEl.style.width = w + 'px';
      appEl.style.height = h + 'px';
    } else {
      appEl.style.width = '';
      appEl.style.height = '';
    }
    // Invalidate maps after resize (best-effort)
    try {
      setTimeout(() => {
        if (window.state?.maps?.big) window.invalidateMap(state.maps.big);
        if (window.state?.maps?.mini) window.invalidateMap(state.maps.mini);
      }, 120);
    } catch(_){}
  }

  // init UI state
  const preset = localStorage.getItem('previewMobile.preset') || 'iphone-13-pro-max';
  if (presetSel) presetSel.value = preset;
  const landscape = localStorage.getItem('previewMobile.landscape') === '1';
  if (landscape && rotateBtn) rotateBtn.classList.add('active');
  if (localStorage.getItem('previewMobile') === '1') {
    document.body.classList.add('mobile-preview');
    if (mobileBtn) mobileBtn.classList.add('active');
  }
  applyDims();

  // handlers
  mobileBtn && mobileBtn.addEventListener('click', () => {
    const on = document.body.classList.toggle('mobile-preview');
    mobileBtn.classList.toggle('active', on);
    localStorage.setItem('previewMobile', on ? '1':'0');
    applyDims();
  });

  presetSel && presetSel.addEventListener('change', (e) => {
    const s = getState();
    s.preset = e.target.value;
    saveState(s);
    applyDims();
  });

  rotateBtn && rotateBtn.addEventListener('click', () => {
    const s = getState();
    s.landscape = !s.landscape;
    rotateBtn.classList.toggle('active', s.landscape);
    saveState(s);
    applyDims();
  });

  // Re-apply on window resize or theme toggle
  window.addEventListener('resize', applyDims);
})();
// === end Mobile Preview Presets & Rotation ===


// --- Keyword highlighting helpers (all occurrences) ---
function clearMarks(root){
  try{
    root.querySelectorAll('mark').forEach(m=>{
      const t = document.createTextNode(m.textContent);
      m.replaceWith(t);
    });
  }catch(e){ /* ignore */ }
}

// Small Set wrapper with safe fallback (older environments)
function hookupSet(arr){
  try { return new Set(arr); } catch(e){
    // Fallback: array "set"
    return { has: (x)=> arr.indexOf(x) !== -1 };
  }
}

// Escape a string for safe use inside a RegExp, without regex literals.
// This prevents edge-case parse errors in some environments when code is bundled/edited.
function escapeRegExpString(str){
  if(str == null) return '';
  const s = String(str);
  const specials = hookupSet(['\\', '^', '$', '.', '*', '+', '?', '(', ')', '[', ']', '{', '}', '|']);
  let out = '';
  for(let i=0;i<s.length;i++){
    const ch = s[i];
    out += specials.has(ch) ? ('\\' + ch) : ch;
  }
  return out;
}
function highlightAllInContainer(container, s){
  if(!container || !s) return null;
  clearMarks(container);
  let rx;
  try{
    const esc = escapeRegExpString(s);
    rx = new RegExp('(' + esc + ')', 'gi');
  }catch(e){
    // If something still goes wrong, do not break the app.
    return null;
  }
  try{
    container.innerHTML = container.innerHTML.replace(rx, '<mark>$1</mark>');
  }catch(e){
    // Last-resort: skip highlighting if container is not safe to rewrite.
    return null;
  }
  const first = container.querySelector('mark');
  if(first){ first.scrollIntoView({behavior:'smooth', block:'center'}); }
  return first;
}

// --- Make highlight pills clickable: jump to appropriate tab and highlight there ---
document.addEventListener('click', (ev) => {
  const el = ev.target.closest('.hl-pill');
  if (!el) return;
  const tripId = el.dataset.trip;
  const term = el.dataset.term || '';
  const type = el.dataset.type || 'meta';
  const itemId = el.dataset.item || null;
  searchAndNavigate(tripId, term, type, itemId);
});
// --- end Keyword highlighting helpers ---


// --- Make types pill clickable: jump to Meta and highlight all occurrences ---
document.addEventListener('click', (ev)=>{
  const pill = ev.target.closest('.types-pill');
  if(!pill) return;
  const row = pill.closest('.trip-row');
  const tripId = row ? row.getAttribute('data-trip') : pill.getAttribute('data-trip');
  const kw = (pill.getAttribute('data-keyword') || pill.textContent || '').trim();
  if(!tripId || !kw) return;
  ev.stopPropagation();
  openTrip(tripId).then(()=>{
    const btn = document.querySelector('#tabs [data-tab="meta"]');
    if(btn) btn.click();
    setTimeout(()=>{
      const cont = document.querySelector('#view-meta') || document;
      highlightAllInContainer(cont, kw);
      pill.classList.add('active');
    }, 250);
  });
}, true);
// --- end types pill click ---

// expose for inline onclick in templates
window.searchAndNavigate = searchAndNavigate;


// === ensureExpenseCurrencyOption auto-run on select appear ===
(function(){
  let armed = false;
  const run = () => {
    if (typeof ensureExpenseCurrencyOption === 'function') {
      requestAnimationFrame(() => ensureExpenseCurrencyOption());
    }
  };
  const obs = new MutationObserver(muts => {
    if (armed) return;
    for (const m of muts) {
      if (m.addedNodes && m.addedNodes.length) {
        if (document.querySelector('select[id*="curr"], select[name*="curr"], select[id*="Currency"], select[name*="Currency"]')) {
          armed = true;
          run();
          setTimeout(() => armed = false, 1500); // allow future loads
          break;
        }
      }
    }
  });
  obs.observe(document.documentElement, { childList: true, subtree: true });
  // also try once on DOM ready
  if (document.readyState !== 'loading') run();
  else document.addEventListener('DOMContentLoaded', run, { once: true });
})();


// --- Utils: linkify plain text into clickable <a> tags (http/https + www + emails) ---

function normalizeEditorLinks(editor){
  if(!editor) return;
  editor.querySelectorAll('a').forEach(a=>{
    try{
      const href = a.getAttribute('href')||'';
      const txt = (a.textContent||'').trim();
      const looksRaw = (txt === href) || /^https?:\/\//.test(txt);
      const tooLong = txt.length > 40 || href.length > 60;
      if (looksRaw || tooLong){
        a.classList.add('link-icon');
        a.textContent = '';
        a.style.display = 'inline-flex';
      }
      a.setAttribute('target','_blank');
      a.setAttribute('rel','noopener');
      a.style.display = 'inline';
    }catch(_){}
  });
}

function pasteAsIconLink(editor, url){
  const a = document.createElement('a');
  a.href = url;
  a.className = 'link-icon';
  a.textContent = '';
  a.style.display = 'inline-flex';
  a.target = '_blank';
  a.rel = 'noopener';
  const sel = window.getSelection();
  if(sel && sel.rangeCount){ sel.getRangeAt(0).deleteContents(); sel.getRangeAt(0).insertNode(a); }
}


// --- Added: sanitizeExpenseNoLinks ---
// Keeps simple formatting (b/i/u, lists, line breaks, colored spans) and strips links & unsafe attributes.
// This mirrors the journal sanitizer policy but forbids anchors entirely for expenses.
function sanitizeExpenseNoLinks(html){
  try{
    const tmp = document.createElement('div');
    tmp.innerHTML = html || '';

    // remove dangerous nodes
    tmp.querySelectorAll('script,style,iframe,object,embed,link,meta').forEach(n => n.remove());

    // 0) Convert raw URLs in text nodes into <a class="link-icon">
    const urlRe = /((https?:\/\/|www\.)[^\s<]+)/gi;
    const walker = document.createTreeWalker(tmp, NodeFilter.SHOW_TEXT, null);
    const nodes = [];
    while(walker.nextNode()) nodes.push(walker.currentNode);
    nodes.forEach(node => {
      const text = node.nodeValue || '';
      if(!text) return;
      let m; urlRe.lastIndex = 0;
      if(!urlRe.test(text)) return;
      urlRe.lastIndex = 0;
      const frag = document.createDocumentFragment();
      let last = 0;
      text.replace(urlRe, (match, _p1, _p2, offset) => {
        if(offset > last) frag.appendChild(document.createTextNode(text.slice(last, offset)));
        const href = match.startsWith('http') ? match : 'http://' + match;
        const a = document.createElement('a');
        a.href = href;
        a.className = 'link-icon';
        a.target = '_blank';
        a.rel = 'noopener';
        a.textContent = '';
        a.style.display = 'inline-flex';
        frag.appendChild(a);
        last = offset + match.length;
        return match;
      });
      if(last < text.length) frag.appendChild(document.createTextNode(text.slice(last)));
      node.replaceWith(frag);
    });

    // 1) Normalize any existing anchors to be icon-only + safe
    tmp.querySelectorAll('a').forEach(a => {
      const href = a.getAttribute('href') || a.textContent || '';
      if(!href) { a.remove(); return; }
      if(!/^https?:\/\//i.test(href) && !/^mailto:/i.test(href)) {
        a.setAttribute('href', href.startsWith('www.') ? 'http://' + href : 'http://' + href);
      }
      a.setAttribute('target','_blank');
      a.setAttribute('rel','noopener');
      // strip unsafe attributes
      [...a.attributes].forEach(attr => {
        const n = attr.name.toLowerCase();
        if (n.startsWith('on') || n === 'style') a.removeAttribute(attr.name);
      });
      a.classList.add('link-icon');
      a.textContent = '';
      a.style.display = 'inline-flex';
    });

    // 2) Sanitize attributes on remaining nodes (allow limited inline styles)
    tmp.querySelectorAll('*').forEach(el => {
      [...el.attributes].forEach(attr => {
        const n = attr.name.toLowerCase();
        if (n.startsWith('on') || n === 'src') el.removeAttribute(attr.name);
        if (n === 'style'){
          const allowed = ['color','background-color','font-weight','font-style','text-decoration'];
          const rules = (attr.value||'').split(';').map(s=>s.trim()).filter(Boolean)
            .map(rule => {
              const i = rule.indexOf(':');
              if (i === -1) return null;
              const k = rule.slice(0,i).trim().toLowerCase();
              const v = rule.slice(i+1).trim();
              return allowed.includes(k) ? `${k}:${v}` : null;
            }).filter(Boolean);
          if (rules.length) el.setAttribute('style', rules.join('; '));
          else el.removeAttribute('style');
        }
      });
    });

    return tmp.innerHTML;
  }catch(_){ return (html||''); }
}
function sanitizeJournalHTML(html){
  // Convert to DOM, post-process anchors
  const tmp = document.createElement('div');
  tmp.innerHTML = html;
  
  tmp.querySelectorAll('a').forEach(a=>{
    try{
      const href = a.getAttribute('href')||'';
      a.setAttribute('target','_blank');
      a.setAttribute('rel','noopener');

      const txt = (a.textContent||'').trim();
      const looksRaw = (txt === href) || /^https?:\/\//.test(txt);
      const tooLong = txt.length > 40 || href.length > 60;

      // If long/raw, render as a blue link icon only
      if (looksRaw || tooLong){
        a.classList.add('link-icon');
        a.textContent = '';
        a.style.display = 'inline-flex'; // icon only
        return;
      }

      // Otherwise keep user label but ensure anchors remain inline
      a.style.display = 'inline';
    }catch(_){}
  });

  return tmp.innerHTML;
}

function linkifyText(str, label){
  if (!str) return '';
  const escMap = {'&':'&','<':'<','>':'>','"':'"','\'':'\''};
  const safe = String(str).replace(/[&<>"']/g, m=>escMap[m]);
  const urlPattern = /(?:https?:\/\/|www\.)[\w.-]+(?:\.[a-z]{2,})(?:[\w\-._~:\/?#\[\]@!$&'()*+,;=%]*)/gi;
  const singleUrlPattern = new RegExp('^' + urlPattern.source + '$','i');
  const emailPattern = /[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi;

  // Handle multi-line: each line that is purely a URL becomes a text anchor with the given label.
  const out = safe.split(/\r?\n/).map(line => {
    const trimmed = line.trim();
    if (trimmed && singleUrlPattern.test(trimmed)){
      const href = trimmed.startsWith('http') ? trimmed : 'http://' + trimmed;
      return '<a class="link-icon" href="'+href+'" target="_blank" rel="noopener" aria-label="קישור"></a>';
    }
    return line
      .replace(urlPattern, m=>{
        const href = m.startsWith('http') ? m : 'http://' + m;
        return '<a class="link-icon" href="'+href+'" target="_blank" rel="noopener" aria-label="קישור"></a>';
      })
      .replace(emailPattern, m=>'<a class="mail-icon" href="mailto:'+m+'" aria-label="מייל"></a>');
  }).join('<br>');
  return out;
}

function linkifyToIcons(str){
  if(!str) return '';
  // Escape '&','<','>' minimally for safety when input is plain text (not HTML)
  const escaped = String(str).replace(/[&<>]/g, m=>({'&':'&','<':'<','>':'>'}[m]));
  // If looks like HTML (has tags), continue; otherwise work on text
  const tmp = document.createElement('div');
  tmp.innerHTML = escaped;
  const urlRe = /((https?:\/\/|www\.)[^\s<]+)/gi;
  const walker = document.createTreeWalker(tmp, NodeFilter.SHOW_TEXT, null);
  const nodes = [];
  while(walker.nextNode()) nodes.push(walker.currentNode);
  nodes.forEach(node => {
    const text = node.nodeValue || '';
    if(!text) return;
    urlRe.lastIndex = 0;
    if(!urlRe.test(text)) return;
    urlRe.lastIndex = 0;
    const frag = document.createDocumentFragment();
    let last = 0;
    text.replace(urlRe, (match, _p1, _p2, offset) => {
      if(offset > last) frag.appendChild(document.createTextNode(text.slice(last, offset)));
      const href = match.startsWith('http') ? match : 'http://' + match;
      const a = document.createElement('a');
      a.href = href; a.target = '_blank'; a.rel = 'noopener'; a.className = 'link-icon'; a.textContent=''; a.style.display='inline-flex';
      frag.appendChild(a);
      last = offset + match.length;
      return match;
    });
    if(last < text.length) frag.appendChild(document.createTextNode(text.slice(last)));
    node.replaceWith(frag);
  });
  return tmp.innerHTML;
}

// --- Add small X to remove links inside contenteditable editors ---
function enableLinkRemoval(container){
  try{
    if(!container) return;
    // Add remove buttons on link/mail icons
    const ensureButtons = ()=>{
      container.querySelectorAll('a.link-icon, a.mail-icon').forEach(a=>{
        if(!a.querySelector('.link-x')){
          const x = document.createElement('span');
          x.className = 'link-x';
          x.textContent = '×';
          x.title = 'מחק קישור';
          a.appendChild(x);
        }
      });
    };
    ensureButtons();
    container.addEventListener('click', function(ev){
      const x = ev.target.closest('.link-x');
      if(x){
        ev.preventDefault(); ev.stopPropagation();
        const a = x.closest('a');
        if(a){ a.replaceWith(document.createTextNode('')); }
      }
    });
    container.addEventListener('input', function(){ setTimeout(ensureButtons,0); });
  }catch(e){ /*log removed*/ }
}




// --- Normalize place display: "name, city, country" ---
function formatPlace(raw){
  if (!raw) return '';
  const parts = String(raw).split(',').map(s=>s.trim()).filter(Boolean);
  // remove pure house numbers / postal codes
  const cleaned = parts.filter(p=>!/^\d+[A-Za-z-]*$/.test(p));
  if (cleaned.length === 0) return raw;
  const country = cleaned[cleaned.length-1];
  const cityOrRegion = cleaned.length>=2 ? cleaned[cleaned.length-2] : '';
  const name = cleaned[0];
  // Avoid duplication if name equals city
  const arr = [name];
  if (cityOrRegion && cityOrRegion.toLowerCase() !== name.toLowerCase()) arr.push(cityOrRegion);
  if (country && country.toLowerCase() !== cityOrRegion.toLowerCase()) arr.push(country);
  return arr.join(', ');
}



/** Safe stub: expense summary bar is currently removed from DOM.
 * Keep API stable so callers don't crash.
 */

function renderExpenseSummary(t){
  const bar = document.getElementById('expenseSummary');
  if(!bar || !t) return;

  const payload = buildBudgetSummaryPayload(t);
  if(!payload) return;
  const { cur, pct, isNeg, band, budget: budgetLabel, paid: paidLabel, balance: balanceLabel } = payload;

  bar.classList.add('budget-bar-structured');
  if(isMobileViewport()){
    bar.classList.add('budget-bar-mobile');
    bar.hidden = true;
    bar.innerHTML = '';
    return;
  }

  bar.hidden = false;
  bar.classList.remove('budget-bar-mobile');
  bar.innerHTML = `
    <button id="barCurrency" class="btn" title="החלף מטבע">${cur}</button>
    <div class="kpi"><span class="lbl">תקציב</span><span class="val">${budgetLabel}</span></div>
    <div class="kpi"><span class="lbl">שולם</span><span class="val">${paidLabel}</span></div>
    <div class="kpi"><span class="lbl">יתרה</span><span class="val bold ${isNeg ? 'neg' : ''}">${balanceLabel}</span></div>
    <div class="budget-progress ${band}" aria-label="התקדמות תקציב">
      <div class="track"><div class="fill" style="width:${pct}%"></div></div>
      <div class="pct" aria-hidden="true">${pct}%</div>
    </div>
  `;
}

function __textQualityScore(text){
  const s = String(text || '');
  const hebrew = (s.match(/[\u0590-\u05FF]/g) || []).length;
  const printable = (s.match(/[A-Za-z0-9 .,;:!?\-_/()[\]{}"'@\n\r]/g) || []).length;
  const suspicious = (s.match(/(?:Ã.|×.|�)/g) || []).length;
  return (hebrew * 4) + (printable * 0.05) - (suspicious * 6);
}

function __repairUtf8Mojibake(text){
  try{
    const src = String(text || '');
    const bytes = Uint8Array.from(Array.from(src, ch => ch.charCodeAt(0) & 255));
    return new TextDecoder('utf-8', { fatal:false }).decode(bytes);
  }catch(_){
    return String(text || '');
  }
}

function __normalizeImportedText(text){
  const src = String(text || '').trim();
  if(!src) return '';
  const repaired = __repairUtf8Mojibake(src).trim();
  return __textQualityScore(repaired) > __textQualityScore(src) ? repaired : src;
}

async function __readXmlFileText(file){
  const bytes = new Uint8Array(await file.arrayBuffer());
  const decoders = [];
  const seen = new Set();

  function addDecoder(label){
    if(!label || seen.has(label)) return;
    seen.add(label);
    try{
      decoders.push({ label, decoder: new TextDecoder(label, { fatal:false }) });
    }catch(_){}
  }

  addDecoder('utf-8');
  addDecoder('windows-1255');
  addDecoder('iso-8859-8');

  let probe = '';
  try{ probe = new TextDecoder('utf-8', { fatal:false }).decode(bytes.slice(0, 256)); }catch(_){}
  const encMatch = probe.match(/encoding\s*=\s*["']([^"']+)["']/i);
  if(encMatch && encMatch[1]) addDecoder(String(encMatch[1]).trim().toLowerCase());

  let best = '';
  let bestScore = -Infinity;
  for(const { decoder } of decoders){
    let decoded = '';
    try{ decoded = decoder.decode(bytes); }catch(_){ continue; }
    const normalized = __normalizeImportedText(decoded);
    const score = __textQualityScore(normalized);
    if(score > bestScore){
      best = normalized;
      bestScore = score;
    }
  }

  return best || new TextDecoder('utf-8', { fatal:false }).decode(bytes);
}


// === GPX Import (to Journal) [FIXED for Namespaces, v2] ===
importGPXFromFile = async function(file, opts={}){
  try{
    if(!file){ if(typeof toast==='function') toast('לא נבחר קובץ'); return; }
    const tid = state.currentTripId;
    if(!tid){ if(typeof toast==='function') toast('פתח נסיעה לפני ייבוא'); return; }
    const xmlText = await __readXmlFileText(file);
    const parser = new DOMParser();
    const xml = parser.parseFromString(xmlText, 'application/xml');
    const gpxNamespace = 'http://www.topografix.com/GPX/1/1';
    
    // Check for parser errors
    const parserError = xml.getElementsByTagName('parsererror');
    if (parserError.length > 0) {
      console.error('GPX XML Parse Error:', parserError[0].textContent);
      throw new Error('קובץ GPX לא תקין');
    }

    let wpts = Array.from(xml.getElementsByTagNameNS(gpxNamespace, 'wpt'));
    if (wpts.length === 0) wpts = Array.from(xml.getElementsByTagName('wpt'));
    
    const points = [];

    // --- פונקציית עזר מתוקנת v2 ---
    function getTag(el, name){
      if (!el) return '';
      let t = el.getElementsByTagNameNS(gpxNamespace, name)[0];
      if (!t) t = el.getElementsByTagName(name)[0]; // Fallback
      return t ? __normalizeImportedText(t.textContent || '') : '';
    }
    // --- פונקציית עזר מתוקנת v2 ---
    function getExt(el, name){
      let exts = el.getElementsByTagNameNS(gpxNamespace, 'extensions')[0];
      if (!exts) exts = el.getElementsByTagName('extensions')[0];
      if(!exts) return '';
      
      let found = exts.getElementsByTagNameNS(gpxNamespace, name)[0];
      if (!found) found = exts.getElementsByTagName(name)[0];
      
      return found ? __normalizeImportedText(found.textContent || '') : '';
    }

    wpts.forEach(el=>{
      const lat = Number(el.getAttribute('lat'));
      const lng = Number(el.getAttribute('lon'));
      if(Number.isFinite(lat) && Number.isFinite(lng)){
        points.push({
          lat, lng,
          _name: getTag(el,'name') || 'נקודה',
          _desc: getTag(el,'desc'),
          _time: getTag(el,'time'),
          _source: getExt(el,'source') || 'journal'
        });
      }
    });

    if(!points.length){ if(typeof toast==='function') toast('לא נמצאו נקודות GPX'); return; }

    const ref = FB.doc(db, 'trips', state.currentTripId);
    const snap = await FB.getDoc(ref);
    const t = snap.exists() ? (snap.data() || {}) : {};
    t.journal = t.journal || {};

    const journalPatch = {};
    let added = 0;
    points.forEach(p=>{
      const id = (crypto.randomUUID ? crypto.randomUUID() : String(Date.now()+Math.random()));
      
      const _point_dateIso = p._time ? new Date(p._time).toISOString() : new Date().toISOString();
      const __dt = new Date(_point_dateIso);
      const pad2 = n => String(n).padStart(2, '0');
      const __dateStr = `${pad2(__dt.getDate())}/${pad2(__dt.getMonth()+1)}/${__dt.getFullYear()}`;
      const __timeStr = `${pad2(__dt.getHours())}:${pad2(__dt.getMinutes())}`;

      journalPatch[`journal.${id}`] = {
        text: p._desc || '',
        placeName: p._name || 'נקודת מסלול',
        placeUrl: '',
        lat: p.lat, 
        lng: p.lng,
        gpxType: 'point',
        gpxFileName: (file && file.name ? String(file.name) : 'Point GPX'),
        gpxColor: '#7c3aed',
        createdAt: _point_dateIso,
        dateIso: _point_dateIso,
        date: __dateStr,
        time: __timeStr
      };
      added++;
    });

    await FB.updateDoc(ref, journalPatch);
    if(typeof toast==='function') toast(`ייבוא GPX הושלם — נוספו ${added} נקודות ליומן`);
    if(!opts.suppressReload){
      await loadTrip();
      switchToTab('map');
    }
  }catch(e){
    console.error('GPX import failed', e);
    if(typeof toast==='function') toast('שגיאה בייבוא GPX');
  }
}

/// === GPX Import (as single Trek) [FIXED for Firestore Nested Arrays] ===
importGPXAsTrek = async function(file, opts){
  opts = opts || {};
  try{
    if(!file){ if(typeof toast==='function') toast('לא נבחר קובץ'); return; }
    const tid = state.currentTripId;
    if(!tid){ if(typeof toast==='function') toast('פתח נסיעה לפני ייבוא'); return; }

    const xmlText = await __readXmlFileText(file);
    const parser = new DOMParser();
    const xml = parser.parseFromString(xmlText, 'application/xml');
    const gpxNamespace = 'http://www.topografix.com/GPX/1/1';

    // Check for parser errors
    const parserError = xml.getElementsByTagName('parsererror');
    if (parserError.length > 0) {
      console.error('GPX XML Parse Error:', parserError[0].textContent);
      throw new Error('קובץ GPX לא תקין');
    }
    
    // --- Robustly find track points ---
    let trkpts = Array.from(xml.getElementsByTagNameNS(gpxNamespace, 'trkpt'));
    if (trkpts.length === 0) {
      trkpts = Array.from(xml.getElementsByTagName('trkpt')); // Fallback
    }
    
    // --- התיקון: שמירה כמערך של אובייקטים ---
    const path = trkpts.map(el => ({
      lat: Number(el.getAttribute('lat')), 
      lng: Number(el.getAttribute('lon'))
    })).filter(p => Number.isFinite(p.lat) && Number.isFinite(p.lng));
    // --- סוף התיקון ---

    if(path.length < 2){ if(typeof toast==='function') toast('לא נמצא מסלול (לפחות 2 נקודות) בקובץ'); return; }

    // --- פונקציית עזר מתוקנת v2 ---
    function getTag(el, name){
      if (!el) return '';
      let t = el.getElementsByTagNameNS(gpxNamespace, name)[0];
      if (!t) t = el.getElementsByTagName(name)[0]; // Fallback
      return t ? __normalizeImportedText(t.textContent || '') : '';
    }

    // נתוני נקודות קצה ושם
    const firstPtEl = trkpts[0];
    const lastPtEl = trkpts[trkpts.length - 1];
    
    // --- התיקון: קריאה ממבנה אובייקט ---
    const firstPt = path[0]; // {lat: ..., lng: ...}
    const lastPt = path[path.length - 1]; // {lat: ..., lng: ...}
    
    // --- שליפת שם מתוקנת v2 ---
    let trackNameEl = xml.getElementsByTagNameNS(gpxNamespace, 'name')[0];
    if (!trackNameEl) trackNameEl = xml.getElementsByTagName('name')[0]; // Fallback
    const trackName = __normalizeImportedText(trackNameEl?.textContent || 'מסלול GPX');
    
    // --- שליפת זמן מתוקנת v2 ---
    const startTime = getTag(firstPtEl, 'time') || new Date().toISOString();

    // (rest of the function is the same)
    const ref = FB.doc(db, 'trips', state.currentTripId);
    const snap = await FB.getDoc(ref);
    const t = snap.exists() ? (snap.data() || {}) : {};
    t.journal = t.journal || {};
    const id = (crypto.randomUUID ? crypto.randomUUID() : String(Date.now()+Math.random()));
    const __dt = new Date(startTime);
    const pad2 = n => String(n).padStart(2, '0');
    const __dateStr = `${pad2(__dt.getDate())}/${pad2(__dt.getMonth()+1)}/${__dt.getFullYear()}`;
    const __timeStr = `${pad2(__dt.getHours())}:${pad2(__dt.getMinutes())}`;
    
    // --- התיקון: קבלת שמות מקומות במקום קואורדינטות ---
    const [startPlace, endPlace] = await Promise.all([
      reverseGeocode(firstPt.lat, firstPt.lng),
      reverseGeocode(lastPt.lat, lastPt.lng)
    ]);

    const text = `מסלול: ${trackName}\nתאריך: ${__dateStr} ${__timeStr}\nנקודת התחלה: ${startPlace}\nנקודת סיום: ${endPlace}`;
    // --- סוף התיקון ---
    
    t.journal[id] = {
      text: text,
      html: text.replace(/\n/g, '<br>'),
      placeName: trackName,
      // --- התיקון: שמירת lat/lng מנקודת ההתחלה ---
      lat: firstPt.lat,
      lng: firstPt.lng,
      createdAt: startTime,
      dateIso: startTime,
      date: __dateStr,
      time: __timeStr,
      path: __downsamplePath(path, 800) // <-- מדולל כדי לא לעבור מגבלת גודל
    };
    
    await FB.updateDoc(ref, { [`journal.${id}`]: t.journal[id] });
    if(typeof toast==='function') toast(`מסלול GPX יובא בהצלחה כרשומה אחת`);
    if(!opts.suppressReload){
      await loadTrip();
      switchToTab('map');
    }

  }catch(e){
    console.error('GPX Trek import failed', e);
    if(typeof toast==='function') toast('שגיאה בייבוא מסלול GPX');
  }
}
// --- delegated handler: works even if button is injected later ---
document.addEventListener('click', async (e)=>{
  const btn = e.target && e.target.closest && e.target.closest('#btnDeleteSelectedJournal');
  if(!btn) return;
  e.preventDefault();
  if(!state.journalSelectionMode){
    state.journalSelectedIds = new Set();
    state._jrLastIndex = null;
    state.journalSelectionMode = true;
    syncJournalSelectionUi();
    if(state.current) renderJournal(state.current, state.journalSort);
    return;
  }
  const count = state.journalSelectedIds ? state.journalSelectedIds.size : 0;
  if(count === 0){
    state.journalSelectionMode = false;
    state.journalSelectedIds = new Set();
    syncJournalSelectionUi();
    if(state.current) renderJournal(state.current, state.journalSort);
    return;
  }
  showConfirm(`למחוק ${count} רשומות?`, async ()=>{
    const ids = Array.from(state.journalSelectedIds);
    try{ await deleteJournalBulkLocal(ids); }catch(_){}
    state.journalSelectionMode = false;
    state.journalSelectedIds = new Set();
    state._jrLastIndex = null;
    syncJournalSelectionUi();
    document.getElementById('confirmDeleteModal')?.close?.();
  });
});
// --- end delegated handler ---

document.addEventListener('click', async (e)=>{
  const btn = e.target && e.target.closest && e.target.closest('#btnOverviewDeleteSelectedJournal');
  if(!btn) return;
  e.preventDefault();
  if(getOverviewMode() !== 'journal') return;
  if(!state.journalSelectionMode){
    state.journalSelectedIds = new Set();
    state._jrLastIndex = null;
    state.journalSelectionMode = true;
    syncOverviewJournalBulkUi();
    if(state.current) renderAllTimeline(state.current, state.allSort);
    return;
  }
  const count = state.journalSelectedIds ? state.journalSelectedIds.size : 0;
  if(count === 0){
    state.journalSelectionMode = false;
    state.journalSelectedIds = new Set();
    state._jrLastIndex = null;
    syncOverviewJournalBulkUi();
    if(state.current) renderAllTimeline(state.current, state.allSort);
    return;
  }
  showConfirm(`למחוק ${count} רשומות?`, async ()=>{
    const ids = Array.from(state.journalSelectedIds);
    try{ await deleteJournalBulkLocal(ids); }catch(_){}
    state.journalSelectionMode = false;
    state.journalSelectedIds = new Set();
    state._jrLastIndex = null;
    syncOverviewJournalBulkUi();
    document.getElementById('confirmDeleteModal')?.close?.();
    if(state.current) renderAllTimeline(state.current, state.allSort);
  });
});

document.addEventListener('click', (e)=>{
  const btn = e.target && e.target.closest && e.target.closest('#btnOverviewCancelSelectionJournal');
  if(!btn) return;
  e.preventDefault();
  e.stopPropagation();
  state.journalSelectionMode = false;
  state.journalSelectedIds = new Set();
  state._jrLastIndex = null;
  syncOverviewJournalBulkUi();
  if(state.current) renderAllTimeline(state.current, state.allSort);
});

document.addEventListener('click', (e)=>{
  const btn = e.target && e.target.closest && e.target.closest('#btnCancelSelectionJournal');
  if(!btn) return;
  e.preventDefault();
  state.journalSelectionMode = false;
  state.journalSelectedIds = new Set();
  state._jrLastIndex = null;
  syncJournalSelectionUi();
  if(state.current) renderJournal(state.current, state.journalSort);
});

document.addEventListener('change', (e)=>{
  const target = e.target;
  if(!(target instanceof HTMLInputElement)) return;
  if(!target.matches('#view-journal .jr-select, #view-overview .jr-select')) return;

  state.journalSelectedIds = state.journalSelectedIds || new Set();
  const id = (target.dataset.id || '').trim();
  if(!id) return;

  if(target.checked) state.journalSelectedIds.add(id);
  else state.journalSelectedIds.delete(id);

  syncJournalSelectionUi();
  syncOverviewJournalBulkUi();
});


// === Logout wiring ===
document.addEventListener('DOMContentLoaded', ()=>{
  const out = document.getElementById('btnLogout');
  if(out && !out.dataset.wired){
    out.dataset.wired='1';
    out.addEventListener('click', async ()=>{
      try{ if(typeof FB?.signOut==='function') await FB.signOut(FB.auth); }catch(e){ console.error(e); }
    });
  }
});

// === Export GPX from journal points ===
function exportGPX(){
  try{
    const t = state.current || {};
    const journal = t.journal || {};
    const points = Object.values(journal).filter(x=>Number.isFinite(x?.lat) && Number.isFinite(x?.lng));
    const name = (t.destination||'Trip');
    const gpxPts = points.map(p=>`  <wpt lat="${p.lat}" lon="${p.lng}">
    <name>${(p.placeName||'').replace(/[<&>]/g,s=>({'<':'<','>':'>','&':'&'}[s]))}</name>
    <desc>${(p.text||'').replace(/[<&>]/g,s=>({'<':'<','>':'>','&':'&'}[s]))}</desc>
  </wpt>`).join('\n');
    const xml = `<?xml version="1.0" encoding="UTF-8"?>\n<gpx version="1.1" creator="FLYMILY" xmlns="http://www.topografix.com/GPX/1/1">\n<metadata><name>${name}</name></metadata>\n${gpxPts}\n</gpx>`;
    const blob = new Blob([xml], {type:'application/gpx+xml'});
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = `FLYMILY_${name.replace(/\s+/g,'_')}.gpx`;
    document.body.appendChild(a); a.click(); setTimeout(()=>{ URL.revokeObjectURL(a.href); a.remove(); }, 0);
    if(typeof toast==='function') toast('ייצוא GPX הושלם');
  }catch(e){ console.error(e); if(typeof toast==='function') toast('שגיאה ביצוא GPX'); }
}

// === Wire Import/Export/Share buttons in Share tab ===
document.addEventListener('DOMContentLoaded', ()=>{
  // Import JSON (legacy)
  const jsonBtn = document.getElementById('btnImportJSON');
  const legacyFile = document.getElementById('importFile');
  const legacyBtn = document.getElementById('btnImport');
  if(jsonBtn && legacyFile){
    jsonBtn.addEventListener('click', ()=> legacyFile.click());
    legacyFile.addEventListener('change', ()=> { if(legacyBtn) legacyBtn.click(); });
  }

  // Import GPX
  const gpxBtn = document.getElementById('btnImportGPX');
  const gpxFile = document.getElementById('importGPXFile');
  if(gpxBtn && gpxFile){
    gpxBtn.addEventListener('click', ()=> gpxFile.click());
    gpxFile.addEventListener('change', async ()=>{
      const list = Array.from(gpxFile.files||[]);
      if(!list.length){ gpxFile.value=''; return; }
      let ok=0, fail=0;
      for(const f of list){
        try{ await importGPXFromFile(f, {suppressReload:true}); ok++; }
        catch(e){ console.error('Import GPX failed', f?.name, e); fail++; if(typeof toast==='function') toast(`שגיאה בטעינת GPX: ${f?.name||''}`); }
      }
      gpxFile.value='';
      if(ok && typeof toast==='function') toast(`יובאו ${ok} קבצי GPX${fail?` (נכשלו ${fail})`:''}`);
      if(ok){ await loadTrip(); switchToTab('map'); }
    });
  }

// Import Trek GPX (New)
  const trekBtn = document.getElementById('btnImportTrekGPX');
  const trekFile = document.getElementById('importTrekGPXFile');
  if(trekBtn && trekFile){
    trekBtn.addEventListener('click', ()=> trekFile.click());
    trekFile.addEventListener('change', async ()=>{
      const list = Array.from(trekFile.files||[]);
      if(!list.length){ trekFile.value=''; return; }
      let ok=0, fail=0;
      for(const f of list){
        try{ await importGPXAsTrek(f, {suppressReload:true}); ok++; }
        catch(e){ console.error(e); fail++; }
      }
      trekFile.value='';
      if(typeof toast==='function') toast(`ייבוא GPX: ${ok} הצליחו${fail?` · ${fail} נכשלו`:''}`);
      try{ await loadTrip(); }catch(_){ }
      try{ switchToTab('map'); }catch(_){ }
    });
  }
  // Import KML
  const kmlBtn = document.getElementById('btnImportKML');
  const kmlFile = document.getElementById('importKMLFile');
  if(kmlBtn && kmlFile){
    kmlBtn.addEventListener('click', ()=> kmlFile.click());
    kmlFile.addEventListener('change', ()=>{ const f=kmlFile.files?.[0]; if(f) importKMLFromFile(f); kmlFile.value=''; });
  }

  // Export
  const exl = document.getElementById('btnExportExcel');
  if(exl && typeof exportExcel==='function') exl.addEventListener('click', ()=> exportExcel());
  const wrd = document.getElementById('btnExportWord');
  if(wrd && typeof exportWord==='function') wrd.addEventListener('click', ()=> exportWord());
  const gpxOut = document.getElementById('btnExportGPX');
  if(gpxOut) gpxOut.addEventListener('click', ()=> exportGPX());

  // Share controls
  const start = document.getElementById('btnShareStart');
  const stop  = document.getElementById('btnShareStop');
  const sel   = document.getElementById('shareDuration');
  if(start){
    start.addEventListener('click', ()=>{
      const val = sel?.value || '1w';
      state.shareDuration = val;
      if(typeof startShare==='function') startShare(val);
      else if(typeof toast==='function') toast('שיתוף הופעל: ' + val);
    });
  }
  if(stop){
    stop.addEventListener('click', ()=>{
      if(typeof stopShare==='function') stopShare();
      else if(typeof toast==='function') toast('שיתוף בוטל');
    });
  }
});

window.getEmailSpan = function(){ return document.getElementById('currentUserEmail'); };


// === Logout wiring (robust) ===
document.addEventListener('DOMContentLoaded', ()=>{
  const out = document.getElementById('btnLogout');
  if(out && !out.dataset.wired){
    out.dataset.wired='1';
    out.addEventListener('click', async (e)=>{
      try{
        e.preventDefault();
        if (typeof FB !== 'undefined' && FB?.signOut) { await FB.signOut(FB.auth); }
        else if (window.firebase?.auth) { await window.firebase.auth().signOut(); }
      }catch(err){ console.error('logout failed', err); }
    });
  }
});

function safeHide(el){ if(el){ el.hidden = true; } }
function safeShow(el){ if(el){ el.hidden = false; } }


// === SAFE OVERRIDES: maps (placed at end to override corrupted earlier versions) ===
window.initMiniMap = function(t){
  try{
    if(!state.maps) state.maps = {};
    if(!state.maps.mini){
      state.maps.mini = L.map('miniMap', { zoomControl:false });
      L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', { attribution: '© OpenStreetMap' })
        .addTo(state.maps.mini);
    }
    // clear old
    if(state.maps.layers?.miniGroup){
      state.maps.mini.removeLayer(state.maps.layers.miniGroup);
    }
    const group = L.layerGroup().addTo(state.maps.mini);
    state.maps.layers = state.maps.layers || {};
    state.maps.layers.miniGroup = group;

    const pts = [];
    (Object.entries(t.expenses||{})).forEach(([id,e])=>{
      if(typeof e.lat==='number' && typeof e.lng==='number'){
        pts.push([e.lat,e.lng]);
        L.circleMarker([e.lat,e.lng], { radius:4 }).addTo(group);
      }
    });
    (Object.entries(t.journal||{})).forEach(([id,j])=>{
      if(typeof j.lat==='number' && typeof j.lng==='number'){
        pts.push([j.lat,j.lng]);
        const isGpxPoint = j && j.gpxType === 'point';
        L.circleMarker([j.lat,j.lng], isGpxPoint
          ? { radius:4, color:'#7c3aed', fillColor:'#a855f7', fillOpacity:0.9, weight:2 }
          : { radius:4, color:'#3b82f6', fillColor:'#93c5fd', fillOpacity:0.9, weight:2 }
        ).addTo(group);
      }
    });
    if(pts.length){
      state.maps.mini.fitBounds(L.latLngBounds(pts).pad(0.2));
    }else{
      state.maps.mini.setView([32.0853,34.7818], 6);
    }
  }catch(e){ console.error('initMiniMap (safe) error', e); }
};

window.initBigMap = function(){
  try{
    if(!state.maps) state.maps = {};
    if(!state.maps.big){
      state.maps.big = L.map('bigMap');
      L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', { attribution: '© OpenStreetMap' })
        .addTo(state.maps.big);
    }
    try{
      state.maps.big.eachLayer(layer=>{
        const isTile = layer instanceof L.TileLayer;
        if(!isTile){
          try{ state.maps.big.removeLayer(layer); }catch(_){}
        }
      });
    }catch(_){}
    // clear old layers
    state.maps.layers = state.maps.layers || {};
    if(state.maps.layers.expenses) state.maps.big.removeLayer(state.maps.layers.expenses);
    if(state.maps.layers.journal)  state.maps.big.removeLayer(state.maps.layers.journal);
    if(state.maps.layers.gpxPoints) state.maps.big.removeLayer(state.maps.layers.gpxPoints);

    const expensesLG = L.layerGroup().addTo(state.maps.big);
    const journalLG  = L.layerGroup().addTo(state.maps.big);
    const gpxPointsLG = L.layerGroup().addTo(state.maps.big);
    state.maps.layers.expenses = expensesLG;
    state.maps.layers.journal  = journalLG;
    state.maps.layers.gpxPoints = gpxPointsLG;

    const t = state._lastTripObj || {};
    const pts = [];

    Object.entries(t.expenses||{}).forEach(([id,e])=>{
      if(typeof e.lat==='number' && typeof e.lng==='number'){
        pts.push([e.lat,e.lng]);
        const marker = L.circleMarker([e.lat,e.lng], { radius:5 });
        marker.__itemType = 'expense';
        marker.__itemId = id;
        marker.addTo(expensesLG);
      }
    });
    Object.entries(t.journal||{}).forEach(([id,j])=>{
      if(typeof j.lat==='number' && typeof j.lng==='number'){
        pts.push([j.lat,j.lng]);
        if(j && j.gpxType === 'point'){
          const marker = L.circleMarker([j.lat,j.lng], {
            radius:6,
            color:'#6d28d9',
            fillColor:'#8b5cf6',
            fillOpacity:0.95,
            weight:2
          });
          marker.__itemType = 'journal';
          marker.__itemId = id;
          attachMapPopup(marker, 'journal', id, j);
          marker.addTo(gpxPointsLG);
        }else{
          const marker = L.circleMarker([j.lat,j.lng], {
            radius:5,
            color:'#2563eb',
            fillColor:'#93c5fd',
            fillOpacity:0.95,
            weight:2
          });
          marker.__itemType = 'journal';
          marker.__itemId = id;
          attachMapPopup(marker, 'journal', id, j);
          marker.addTo(journalLG);
        }
      }
    });

    const btnSpent = document.getElementById('btnToggleSpent');
    const btnVisited = document.getElementById('btnToggleVisited');

    if(btnSpent && !btnSpent.classList.contains('active')) btnSpent.classList.add('active');
    if(btnVisited && !btnVisited.classList.contains('active')) btnVisited.classList.add('active');

    function applyMapToolbarVisibility(){
      const showSpent = !btnSpent || btnSpent.classList.contains('active');
      const showVisited = !btnVisited || btnVisited.classList.contains('active');

      if(showSpent){
        if(!state.maps.big.hasLayer(expensesLG)) state.maps.big.addLayer(expensesLG);
      }else{
        if(state.maps.big.hasLayer(expensesLG)) state.maps.big.removeLayer(expensesLG);
      }

      if(showVisited){
        if(!state.maps.big.hasLayer(journalLG)) state.maps.big.addLayer(journalLG);
        if(!state.gpx?.enabled && !state.maps.big.hasLayer(gpxPointsLG)) state.maps.big.addLayer(gpxPointsLG);
      }else{
        if(state.maps.big.hasLayer(journalLG)) state.maps.big.removeLayer(journalLG);
        if(state.maps.big.hasLayer(gpxPointsLG)) state.maps.big.removeLayer(gpxPointsLG);
      }

      try{ __syncManagedGpxWithVisited(); }catch(_){}

      invalidateMap(state.maps.big);
    }

    if(btnSpent){
      btnSpent.onclick = ()=>{
        btnSpent.classList.toggle('active');
        applyMapToolbarVisibility();
      };
    }
    if(btnVisited){
      btnVisited.onclick = ()=>{
        btnVisited.classList.toggle('active');
        applyMapToolbarVisibility();
      };
    }

    applyMapToolbarVisibility();

    if(pts.length){
      state.maps.big.fitBounds(L.latLngBounds(pts).pad(0.2));
    }else{
      state.maps.big.setView([32.0853,34.7818], 6);
    }
  }catch(e){ console.error('initBigMap (safe) error', e); }
};


// === KML Import (to Journal) ===
async function importKMLFromFile(file){
  try{
    if(!file){ if(typeof toast==='function') toast('לא נבחר קובץ'); return; }
    const tid = state.currentTripId;
    if(!tid){ if(typeof toast==='function') toast('פתח נסיעה לפני ייבוא'); return; }

    const xmlText = await __readXmlFileText(file);
    const parser = new DOMParser();
    const xml = parser.parseFromString(xmlText, 'application/xml');

    // KML coordinates are "lon,lat[,alt]"
    function parseCoord(txt){
      if(!txt) return null;
      const parts = txt.trim().split(/[\s,]+/);
      if(parts.length < 2) return null;
      const lon = Number(parts[0]);
      const lat = Number(parts[1]);
      if(Number.isFinite(lat) && Number.isFinite(lon)) return {lat, lng: lon};
      return null;
    }
    function getText(el, tag){
      const t = el.getElementsByTagName(tag)[0];
      return t ? __normalizeImportedText(t.textContent || '') : '';
    }

    const placemarks = Array.from(xml.getElementsByTagName('Placemark'));
    const points = [];

    placemarks.forEach(pm=>{
      const name = getText(pm, 'name') || 'נקודה';
      const desc = getText(pm, 'description');
      // Point
      const point = pm.getElementsByTagName('Point')[0];
      if(point){
        const coordsTxt = getText(point, 'coordinates');
        const c = parseCoord(coordsTxt);
        if(c) points.push({lat:c.lat, lng:c.lng, _name:name, _desc:desc});
      }
      // LineString/coordinates -> sample each coordinate as a journal point
      const line = pm.getElementsByTagName('LineString')[0];
      if(line){
        const coordsTxt = getText(line, 'coordinates');
        const chunks = (coordsTxt||'').trim().split(/\s+/);
        chunks.forEach(ch=>{
          const c = parseCoord(ch);
          if(c) points.push({lat:c.lat, lng:c.lng, _name:name, _desc:desc});
        });
      }
    });

    if(!points.length){ if(typeof toast==='function') toast('לא נמצאו נקודות KML'); return; }

    const ref = FB.doc(db, 'trips', state.currentTripId);
    const snap = await FB.getDoc(ref);
    const t = snap.exists() ? (snap.data() || {}) : {};
    t.journal = t.journal || {};

    let added = 0;
    points.forEach(p=>{
      const id = (crypto.randomUUID ? crypto.randomUUID() : String(Date.now()+Math.random()));
      
      // --- התחלת התיקון ---
      // 1. הגדרת משתני התאריך והשעה על בסיס הזמן מהקובץ
      const _point_dateIso = p._time ? new Date(p._time).toISOString() : new Date().toISOString();
      const __dt = new Date(_point_dateIso);
      const pad2 = n => String(n).padStart(2, '0');
      const __dateStr = `${pad2(__dt.getDate())}/${pad2(__dt.getMonth()+1)}/${__dt.getFullYear()}`;
      const __timeStr = `${pad2(__dt.getHours())}:${pad2(__dt.getMinutes())}`;

      // 2. בניית אובייקט היומן
      t.journal[id] = {
        text: p._desc || '',
        placeName: p._name || '',
        placeUrl: '',
        lat: p.lat, 
        lng: p.lng,
        createdAt: _point_dateIso, // 3. הוסר הפסיק המיותר
        dateIso: _point_dateIso,   // 4. שימוש במשתנה החדש
        date: __dateStr,         // 5. שימוש במשתנה החדש
        time: __timeStr          // 6. שימוש במשתנה החדש
      };
      // --- סוף התיקון ---
      
      added++;
    });

    await FB.updateDoc(ref, { [`journal.${id}`]: t.journal[id] });
    if(typeof toast==='function') toast(`ייבוא KML הושלם — נוספו ${added} נקודות ליומן`);
    if(!opts.suppressReload){
      await loadTrip();
      switchToTab('map');
    }
  }catch(e){
    console.error('KML import failed', e);
    if(typeof toast==='function') toast('שגיאה בייבוא KML');
  }
}


/* === Shift-Select for Journal checkboxes ===
   Allows selecting a continuous range using Shift+Click in the Journal tab.
   Works with any checkbox inside #view-journal (delegated handler, survives re-render).
*/
(function(){
  let lastIndex = null;

  function getJournalCheckboxes(){
    const selectors = [
      '#view-journal .jr-select',
      '#view-overview .jr-select'
    ];
    return selectors
      .flatMap(sel => Array.from(document.querySelectorAll(sel)))
      .filter(cb => cb instanceof HTMLInputElement && !cb.disabled && cb.offsetParent !== null);
  }

  // Use capture on 'click' so we can see e.shiftKey reliably
  document.addEventListener('click', function(e){
    const target = e.target;
    if(!(target instanceof HTMLElement)) return;
    if(target.matches('#view-journal .jr-select, #view-overview .jr-select')){
      const boxes = getJournalCheckboxes();
      const idx = boxes.indexOf(target);
      if(idx === -1) return;

      if(e.shiftKey && lastIndex !== null && lastIndex !== idx){
        const [start, end] = idx > lastIndex ? [lastIndex, idx] : [idx, lastIndex];
        const shouldCheck = target.checked; // mirror the state of the clicked box
        for(let i=start; i<=end; i++){
          const cb = boxes[i];
          if(cb && !cb.disabled){
            cb.checked = shouldCheck;
            cb.dispatchEvent(new Event('change', { bubbles:true })); // notify any listeners
          }
        }
        // Prevent native text selection while shift-click dragging
        e.preventDefault();
      }else{
        // Single click – still let any selection-mode listeners know
        target.dispatchEvent(new Event('change', { bubbles:true }));
      }
      lastIndex = idx;
    }
  }, true);

  // Reset lastIndex when leaving the tab to avoid cross-view ranges
  document.addEventListener('keydown', (e)=>{
    if(e.key === 'Escape') lastIndex = null;
  });
  window.addEventListener('hashchange', ()=>{ lastIndex = null; });
  document.addEventListener('visibilitychange', ()=>{ if(document.hidden) lastIndex = null; });
})();
// === End Shift-Select ===

function renderCategoryBreakdownNode(targetId){
  const el = document.getElementById(targetId); if(!el) return;
  const local = 'ILS';
  const trip = normalizeTripShape(state?.current || {});
  const expenses = (trip && (Array.isArray(trip.expenses)
    ? trip.expenses
    : Object.entries(trip.expenses||{}).map(([id,e])=>({ id, ...e }))
  )) || [];

  const breakdown = {}; let total = 0;
  const byCategory = {}; // cat -> { sum:number, items:[{id, category, amount, currency, desc, date, time, ils:number|NaN}] }
  const unconverted = []; // flat list for footer section

  const toILS = (amt, fromCur, ratesObj)=>{
    const a = Number(amt||0);
    const cur = (fromCur||'ILS').toUpperCase();
    if(!isFinite(a) || a===0) return 0;
    if(cur === 'ILS') return a;
    try{
      const M = rateMatrix(ratesObj || {});
      const r = (M && M[cur] && M[cur].ILS) ? Number(M[cur].ILS) : null;
      if(r && isFinite(r)) return a * r;
    }catch(_){/* ignore */}
    return NaN;
  };

  // normalize expenses and build per-category lists
  expenses.forEach(e=>{
    const cat = (e?.category || 'אחר').toString();
    const amt = Number(e?.amount||0);
    const from = (e?.currency || 'ILS');
    const rates = e?.rates || state?.rates || {};

    let ils = NaN;
    if(typeof convertAmount==='function'){
      try{ ils = convertAmount(amt, from, local, rates); }catch(_){ ils = NaN; }
    }
    if(!isFinite(ils)) ils = toILS(amt, from, rates);

    const item = {
      id: e?.id,
      category: cat,
      amount: isFinite(amt)?amt:0,
      currency: (from||'').toString(),
      desc: (e?.desc || e?.descHtml || '').toString(),
      date: (e?.date || '').toString(),
      time: (e?.time || '').toString(),
      ils
    };

    if(!byCategory[cat]) byCategory[cat] = { sum:0, items:[] };
    byCategory[cat].items.push(item);

    if(isFinite(ils)){
      byCategory[cat].sum += ils;
      breakdown[cat] = (breakdown[cat]||0) + ils;
      total += ils;
    }else{
      unconverted.push({
        category: cat,
        amount: item.amount,
        currency: item.currency || '???',
        desc: item.desc.slice(0, 80)
      });
    }
  });

  const cats = Object.entries(breakdown).sort((a,b)=>b[1]-a[1]);
  const fmtILS = (n)=> (Number(n||0)).toLocaleString('he-IL',{maximumFractionDigits:0});
  const fmtAmt = (n)=> (Number(n||0)).toLocaleString('he-IL',{maximumFractionDigits:2});
  // הפילוח חייב להיות מבוסס על מה ששולם בפועל בש"ח, ולא על התקציב.
  const pctBase = total;
  const pctLabel = 'אחוז מסך ששולם';

  let html = `
    <div class="breakdown-head" dir="rtl">
      <div class="breakdown-note">לחיצה על קטגוריה תפתח את ההוצאות שבקטגוריה</div>
      <div class="muted">החישוב מבוסס על סך ששולם בפועל: ${fmtILS(total)} ILS</div>
    </div>
    <table class="breakdown-table" dir="rtl">
      <thead>
        <tr>
          <th class="bd-cat">קטגוריה</th>
          <th class="bd-sum">סכום (ILS)</th>
          <th class="bd-pct">${pctLabel}</th>
        </tr>
      </thead>
      <tbody>
  `;

  cats.forEach(([cat,sum], idx)=>{
    const pct = pctBase ? (sum/pctBase*100) : 0;
    const barPct = Math.min(Math.max(pct, 0), 100);
    const safeCat = esc(cat);
    const rowId = `bd_${idx}`;

    html += `
      <tr class="breakdown-cat-row" data-bd-cat="${safeCat}" data-bd-row="${rowId}" role="button" tabindex="0">
        <td class="bd-cat">
          <span class="bd-toggle" aria-hidden="true">▸</span>
          <span class="bd-cat-name">${safeCat}</span>
          <span class="bd-count">(${(byCategory[cat]?.items?.length||0)})</span>
        </td>
        <td class="bd-sum">${fmtILS(sum)}</td>
        <td class="bd-pct">
          <div class="breakdown-row-bar"><span style="width:${barPct.toFixed(1)}%"></span></div>
          <div class="muted">${pct.toFixed(1)}%</div>
        </td>
      </tr>
    `;

    // details row (collapsed by default)
    const items = (byCategory[cat]?.items || []);
    const detailsRows = items.map(it=>{
      const ilsTxt = isFinite(it.ils) ? fmtILS(it.ils) : '—';
      const when = [it.date, it.time].filter(Boolean).join(' ');
      const desc = esc((it.desc||'').trim());
      const cur = esc((it.currency||'').toUpperCase());
      return `
        <tr>
          <td class="bd-item-desc">
            <div class="bd-item-title">${desc || '<span class="muted">(ללא תיאור)</span>'}</div>
            ${when ? `<div class="muted bd-item-when">${esc(when)}</div>` : ''}
          </td>
          <td class="bd-item-amt">${fmtAmt(it.amount)} ${cur}</td>
          <td class="bd-item-ils">${ilsTxt}</td>
        </tr>
      `;
    }).join('');

    html += `
      <tr class="breakdown-details" data-bd-details="${rowId}" aria-hidden="true">
        <td colspan="3">
          <div class="bd-details-wrap">
            <table class="bd-items">
              <thead>
                <tr>
                  <th>הוצאה</th>
                  <th>סכום</th>
                  <th>ILS</th>
                </tr>
              </thead>
              <tbody>
                ${detailsRows || `<tr><td colspan="3" class="muted">אין הוצאות בקטגוריה.</td></tr>`}
              </tbody>
            </table>
          </div>
        </td>
      </tr>
    `;
  });

  html += `
      <tr>
        <td class="breakdown-total">סה"כ</td>
        <td class="breakdown-total">${fmtILS(total)}</td>
        <td></td>
      </tr>
      </tbody>
    </table>
  `;

  if(unconverted.length){
    const byCur = {};
    unconverted.forEach(u=>{ byCur[u.currency] = (byCur[u.currency]||0) + Number(u.amount||0); });
    const parts = Object.entries(byCur).map(([c,s])=>`${c}: ${fmtAmt(s)}`);
    html += `
      <div class="breakdown-warning" dir="rtl">
        <div>שימו לב: יש ${unconverted.length} הוצאות ללא שער המרה ל-ILS. הן מוצגות כאן כדי ששום הוצאה לא תיעלם.</div>
        <div class="muted">סיכום לפי מטבע: ${parts.join(' , ')}</div>
      </div>
      <div class="breakdown-missing" dir="rtl">
        <div class="breakdown-missing-title">הוצאות ללא המרה</div>
        <table class="breakdown-missing-table">
          <thead><tr><th>קטגוריה</th><th>סכום</th><th>מטבע</th><th>תיאור</th></tr></thead>
          <tbody>
            ${unconverted.map(u=>`
              <tr>
                <td>${esc(u.category||'')}</td>
                <td>${fmtAmt(u.amount)}</td>
                <td>${esc(u.currency||'')}</td>
                <td class="muted">${esc(u.desc||'')}</td>
              </tr>
            `).join('')}
          </tbody>
        </table>
      </div>
    `;
  }

  el.innerHTML = html;

  // One-time delegation: toggle category details on click/Enter/Space
  if(!el.dataset.bdBound){
    const toggleRow = (row)=>{
      const rowId = row?.dataset?.bdRow;
      if(!rowId) return;
      // Robust: rely on DOM adjacency instead of CSS.escape/querySelector
      // (some layouts/tables can make querySelector brittle).
      const details = row.nextElementSibling;
      if(!details || !details.classList.contains('breakdown-details')) return;
      const isOpen = details.classList.contains('open');
      details.classList.toggle('open', !isOpen);
      details.setAttribute('aria-hidden', isOpen ? 'true' : 'false');
      row.classList.toggle('open', !isOpen);
      const icon = row.querySelector('.bd-toggle');
      if(icon) icon.textContent = isOpen ? '▸' : '▾';
    };

    el.addEventListener('click', (ev)=>{
      const row = ev.target?.closest?.('.breakdown-cat-row');
      if(row && el.contains(row)) toggleRow(row);
    });

    el.addEventListener('keydown', (ev)=>{
      if(ev.key !== 'Enter' && ev.key !== ' ') return;
      const row = ev.target?.closest?.('.breakdown-cat-row');
      if(row && el.contains(row)){
        ev.preventDefault();
        toggleRow(row);
      }
    });

    el.dataset.bdBound = '1';
  }
}


// === Bind "סיכום פילוח" button reliably ===
(function(){
  function openBreakdown(){
    const dlg = document.getElementById('breakdownDialog');
    if(!dlg) return;
    if (typeof renderCategoryBreakdownNode === 'function'){
      renderCategoryBreakdownNode('categoryBreakdownDialog');
    }
    try{
      if(dlg.open) return;
      if(dlg.showModal) dlg.showModal(); else dlg.setAttribute('open','');
    }catch(err){
      // Fallback for browsers / edge cases
      try{ dlg.setAttribute('open',''); }catch(_){ }
    }
  }
  function closeBreakdown(){ document.getElementById('breakdownDialog')?.close(); }

  function bindOnce(){
    const btn = document.getElementById('openBreakdownBtn');
    if(btn && !btn.dataset.bound){
      btn.type = btn.type || 'button';
      btn.addEventListener('click', (e)=>{ e.preventDefault(); e.stopPropagation(); openBreakdown(); });
      btn.dataset.bound = '1';
    }
    const closeBtn = document.getElementById('closeBreakdownDlg');
    const dlg = document.getElementById('breakdownDialog');
    if(closeBtn && !closeBtn.dataset.bound){
      closeBtn.addEventListener('click', (e)=>{ e.preventDefault(); closeBreakdown(); });
      closeBtn.dataset.bound = '1';
    }
    // Close on Esc/outside
    if(dlg && !dlg.dataset.bound){
      document.addEventListener('keydown', (e)=>{ if(e.key==='Escape' && dlg.open) closeBreakdown(); });
      document.addEventListener('click', (e)=>{
        if(!dlg.open) return;
        const r = dlg.getBoundingClientRect();
        const inside = e.clientX>=r.left && e.clientX<=r.right && e.clientY>=r.top && e.clientY<=r.bottom;
        if(!inside) closeBreakdown();
      });
      dlg.dataset.bound = '1';
    }
  }

  // Bind now + keep trying (handles dynamic DOM)
  document.addEventListener('DOMContentLoaded', ()=>{
    // Expose for other UI entry points (e.g., Overview quick toolbar)
    try{ window.__openBreakdownDialog = openBreakdown; }catch(_){ }

    // Robust global click binding (covers cases where the toolbar is re-rendered
    // or when the button sits inside tab containers with other delegated handlers)
    if(!document.documentElement.dataset.bdGlobalBound){
      document.addEventListener('click', (e)=>{
        const t = e.target && e.target.closest ? e.target.closest('#btnQuickBreakdown') : null;
        if(!t) return;
        e.preventDefault();
        e.stopPropagation();
        openBreakdown();
      }, true);
      document.documentElement.dataset.bdGlobalBound = '1';
    }
    bindOnce();
    let tries = 0;
    const iv = setInterval(()=>{
      tries++;
      bindOnce();
      if(tries>20) clearInterval(iv); // try ~20 times (~20s)
    }, 1000);
  });
})();

// === Hard bind for Overview "פילוח" button (guards against layout refactors) ===
// Some UI refactors moved the button into tab chrome; use capture delegation so it always works.
(function(){
  function handler(e){
    const btn = e.target && (e.target.closest ? e.target.closest('#btnQuickBreakdown') : null);
    if(!btn) return;
    e.preventDefault();
    e.stopPropagation();
    if (typeof window.__openBreakdownDialog === 'function'){
      window.__openBreakdownDialog();
      return;
    }
    const dlgBtn = document.getElementById('openBreakdownBtn');
    if(dlgBtn) dlgBtn.click();
  }
  document.addEventListener('click', handler, true);
})();

// === Print Preview (Trip Schedule) ===
(function(){
  function openPrintPreview(){
    try{
      const source = document.querySelector('#view-overview') || document.querySelector('#overview') || document.body;
      const clone = source.cloneNode(true);
      const w = window.open('', '_blank', 'noopener,noreferrer');
      if(!w){ alert('לא ניתן לפתוח חלון תצוגה (יתכן שחסימת פופ-אפים פעילה).'); return; }
      const html = `<!doctype html>
<html lang="he" dir="rtl">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>תצוגה לפני הדפסה</title>
  <link rel="stylesheet" href="./style.css">
  <style>
    body{padding:16px}
    .toolbar{display:flex;gap:8px;margin-bottom:12px}
    .toolbar .btn{border:1px solid #ccc;border-radius:10px;padding:8px 12px;background:transparent;cursor:pointer}
    @media print {.toolbar{display:none !important}}
    table{width:100%;border-collapse:collapse} th,td{border:1px solid #e3e3e3;padding:6px 8px} th{background:#f7f7f7}
    .card{break-inside:avoid;page-break-inside:avoid}
  </style>
</head>
<body>
  <div class="toolbar"><button class="btn" onclick="print()">🖨️ הדפס</button><button class="btn" onclick="close()">✖️ סגור</button></div>
  <main id="printRoot"></main>
</body>
</html>`;
      w.document.open(); w.document.write(html); w.document.close();
      w.document.getElementById('printRoot')?.appendChild(clone);
      Array.from(w.document.querySelectorAll('[hidden]')).forEach(el=>el.removeAttribute('hidden'));
    }catch(e){ console.error('print preview error', e); alert('שגיאה בתצוגה לפני הדפסה'); }
  }
  window.openTripPrintPreview = openPrintPreview;
  document.addEventListener('DOMContentLoaded', ()=>{
    const btn = document.getElementById('btnExportTripSchedule');
    if(btn && !btn.dataset._ppBound){
      btn.dataset._ppBound = '1';
      btn.textContent = 'ייצא הוצאות ל WORD';
      btn.addEventListener('click', (ev)=>{ ev.preventDefault(); ev.stopPropagation(); openPrintPreview(); });
    }
  });
})();
// === End Print Preview ===


// === Robust RTF toolbar wiring for contentEditable editors ===
(function(){
  // Robust RTF binder for Chrome desktop + mobile
  function saveSelWithin(root){
    const sel = window.getSelection();
    if(!sel || sel.rangeCount===0) return null;
    const r = sel.getRangeAt(0).cloneRange();
    if(root && r && !root.contains(r.commonAncestorContainer)) return null;
    return r;
  }
  function restoreSel(r){
    if(!r) return;
    const sel=window.getSelection();
    sel.removeAllRanges();
    sel.addRange(r);
  }
  function ensureFocus(el){ if(document.activeElement!==el) el.focus({preventScroll:true}); }
  function exec(cmd,val){
    try{ document.execCommand('styleWithCSS', false, true); }catch(_){}
    try{ document.execCommand(cmd,false,val); return true; }catch(_){ return false; }
  }
  function wrapSelection(style, tag){
    const sel = window.getSelection();
    if(!sel || sel.rangeCount===0) return false;
    const r = sel.getRangeAt(0);
    const span = document.createElement(tag||'span');
    Object.assign(span.style, style||{});
    try{
      r.surroundContents(span);
      return true;
    }catch(_){
      // fallback: insert nodes
      const frag = r.extractContents();
      span.appendChild(frag);
      r.insertNode(span);
      return true;
    }
  }
  function bind(editor, bubble){
    if(!editor || !bubble) return;
    if(editor.dataset._rtfBound) return;
    editor.dataset._rtfBound='1';
    bubble.hidden=false;
    bubble.classList.remove('hidden');

    let saved=null;
    const remember=()=>{ saved = saveSelWithin(editor); };

    // save on most selection changes
    editor.addEventListener('keyup', remember);
    editor.addEventListener('mouseup', remember);
    editor.addEventListener('touchend', remember); /* <--- תיקון למובייל */
    document.addEventListener('selectionchange', ()=>{
      const sel = window.getSelection();
      if(!sel || sel.rangeCount===0) return;
      const n = sel.anchorNode;
      if(n && editor.contains(n)) saved = saveSelWithin(editor);
    });

    // keep selection when clicking toolbar
    bubble.addEventListener('mousedown', e=> e.preventDefault());

    // format buttons
    bubble.querySelectorAll('.fmt[data-cmd]').forEach(btn=>{
      btn.addEventListener('click', ()=>{
        ensureFocus(editor);
        // if selection lost, try to restore
        if(!saveSelWithin(editor)) restoreSel(saved);
        // try execCommand, else manual wrap
        const c = btn.getAttribute('data-cmd');
        let ok=false;
        if(c==='bold'||c==='italic'||c==='underline'){
          ok = exec(c);
          if(!ok){
            const tag = c==='bold'?'strong':(c==='italic'?'em':'span');
            const style = c==='underline'?{textDecoration:'underline'}:{};
            ok = wrapSelection(style, tag);
          }
        }else{
          ok = exec(c);
        }
        editor.dispatchEvent(new Event('input'));
      });
    });

    // color dots -> highlight background; black clears
    bubble.querySelectorAll('.dot[data-color]').forEach(dot=>{
      dot.addEventListener('click', ()=>{
        ensureFocus(editor);
        if(!saveSelWithin(editor)) restoreSel(saved);
        const color = dot.getAttribute('data-color')||'#000000';
        let ok=false;
        if(color==='#000000'){
          try{ exec('removeFormat'); ok=true; }catch(_){}
          if(!ok){ wrapSelection({backgroundColor:'transparent'}); }
        }else{
          ok = exec('hiliteColor', color) || exec('backColor', color);
          if(!ok){ wrapSelection({backgroundColor: color}); }
        }
        editor.dispatchEvent(new Event('input'));
      });
    });
  }

  window._bindRTFEditors = function(){
    bind(document.getElementById('jrText'), document.getElementById('rtfBubble'));
    bind(document.getElementById('expText'), document.getElementById('rtfBubbleExp'));
  };

  document.addEventListener('DOMContentLoaded', ()=>{ try{ window._bindRTFEditors(); }catch(_){} });
  // also after expense modal open
  document.addEventListener('openExpenseModal', ()=>{ try{ window._bindRTFEditors(); }catch(_){} });
})();// === End RTF wiring ===


// === Text color (foreColor) utilities ===
(function(){
  function saveSelection(){
    const sel = window.getSelection();
    if(!sel || sel.rangeCount===0) return null;
    return sel.getRangeAt(0).cloneRange();
  }
  function restoreSelection(r){
    if(!r) return;
    const sel = window.getSelection();
    sel.removeAllRanges();
    sel.addRange(r);
  }
  function ensureFocus(el){ if(document.activeElement!==el){ el.focus({preventScroll:true}); } }
  function exec(cmd,val){
    try { document.execCommand(cmd,false,val); } catch(e){}
  }
  function wrapWithSpan(range, styleObj){
    if(!range || range.collapsed) return;
    const span = document.createElement('span');
    Object.assign(span.style, styleObj);
    span.appendChild(range.extractContents());
    range.insertNode(span);
  }
  window._applyTextColor = function(editor, color){
    // Try the standard command first
    exec('styleWithCSS', true);
    exec('foreColor', color);
    // Fallback: manual wrap if the command didn't change anything (Chrome sometimes no-op)
    // Heuristic: if there's a selection and no parent with inline color, wrap it.
    const sel = window.getSelection();
    if(sel && sel.rangeCount){
      const r = sel.getRangeAt(0);
      const parent = r.commonAncestorContainer.nodeType===1 ? r.commonAncestorContainer : r.commonAncestorContainer.parentElement;
      const hasColor = parent && (parent.style && parent.style.color);
      if(!hasColor && color && color!=='initial' && color!==''){
        wrapWithSpan(r, { color });
      }
    }
    editor.dispatchEvent(new Event('input'));
  };
  window._clearInlineColor = function(editor){
    // remove inline color by selecting and removing format, then normalize
    exec('removeFormat');
    // also remove color styles from nested spans in selection
    const sel = window.getSelection();
    if(sel && sel.rangeCount){
      const r = sel.getRangeAt(0).cloneRange();
      const container = r.commonAncestorContainer.nodeType===1 ? r.commonAncestorContainer : r.commonAncestorContainer.parentElement;
      if(container){
        container.querySelectorAll('span[style*="color"]').forEach(s=>{
          s.style.color='';
          if(!s.getAttribute('style')) s.removeAttribute('style');
        });
      }
    }
    editor.dispatchEvent(new Event('input'));
  };

  // Re-bind color dots to text color instead of highlight
  window._retargetDotsToTextColor = function(editor, bubble){
    if(!editor || !bubble) return;
    bubble.querySelectorAll('.dot[data-color]').forEach(dot=>{
      // Remove previous listeners by cloning
      const newDot = dot.cloneNode(true);
      dot.parentNode.replaceChild(newDot, dot);
      newDot.addEventListener('click', ()=>{
        const color = newDot.getAttribute('data-color') || '#000000';
        const sel = window.getSelection();
        let savedRange = null;
        if(sel && sel.rangeCount) savedRange = sel.getRangeAt(0).cloneRange();
        ensureFocus(editor);
        restoreSelection(savedRange);
        if(color === '#000000'){
          window._clearInlineColor(editor);
        }else{
          window._applyTextColor(editor, color);
        }
      });
    });
  };

  // Hook into our previous binder if exists
  document.addEventListener('DOMContentLoaded', ()=>{
    try{
      const jrText = document.getElementById('jrText');
      const jrBubble = document.getElementById('rtfBubble');
      const expText = document.getElementById('expText');
      const expBubble = document.getElementById('rtfBubbleExp');
      if(jrText && jrBubble) window._retargetDotsToTextColor(jrText, jrBubble);
      if(expText && expBubble) window._retargetDotsToTextColor(expText, expBubble);
    }catch(e){}
  });

  // Also expose a manual rebind if modals recreate DOM
  window._rebindTextColorDots = function(){
    const jrText = document.getElementById('jrText');
    const jrBubble = document.getElementById('rtfBubble');
    const expText = document.getElementById('expText');
    const expBubble = document.getElementById('rtfBubbleExp');
    if(jrText && jrBubble) window._retargetDotsToTextColor(jrText, jrBubble);
    if(expText && expBubble) window._retargetDotsToTextColor(expText, expBubble);
  };
})();

// [auto-url->anchor + icon-only]
// 1) Convert raw URLs in the DOM into <a href="...">...</a>
// 2) Turn those anchors into icon-only links (blue icon), unless opted out.
//
// Opt-out container: add data-no-autolink on any ancestor to skip.
// Opt-out link: .no-link-icon or [data-no-link-icon]
// Keep text: .show-link-text or [data-show-text]

(function(){
  var URL_RE = /(?:https?:\/\/)[^\s<>"']+/gi;

  function isEditable(node){
    if(!node || node.nodeType !== 1) return false;
    var tag = node.tagName;
    if(tag === 'INPUT' || tag === 'TEXTAREA') return true;
    if(node.isContentEditable) return true;
    return false;
  }

  function inNoAutolink(node){
    try{
      return !!(node.closest && node.closest('[data-no-autolink]'));
    }catch(e){ return false; }
  }

  function autolink(root){
    var walker = document.createTreeWalker(
      root,
      NodeFilter.SHOW_TEXT,
      {
        acceptNode: function(node){
          if(!node.nodeValue) return NodeFilter.FILTER_REJECT;
          var parent = node.parentNode;
          if(!parent || parent.nodeType !== 1) return NodeFilter.FILTER_REJECT;
          var tag = parent.tagName;
          if(tag === 'A' || tag === 'SCRIPT' || tag === 'STYLE' || tag === 'NOSCRIPT') return NodeFilter.FILTER_REJECT;
          if(isEditable(parent)) return NodeFilter.FILTER_REJECT;
          if(inNoAutolink(parent)) return NodeFilter.FILTER_REJECT;
          if(!URL_RE.test(node.nodeValue)) return NodeFilter.FILTER_REJECT;
          return NodeFilter.FILTER_ACCEPT;
        }
      }
    );
    var nodes = [];
    var n;
    while(n = walker.nextNode()){
      nodes.push(n);
    }
    nodes.forEach(function(textNode){
      var html = textNode.nodeValue.replace(URL_RE, function(url){
        var safe = url.replace(/"/g, '&quot;');
        return '<a href="'+safe+'" rel="noopener" target="_blank">'+safe+'</a>';
      });
      var span = document.createElement('span');
      span.innerHTML = html;
      textNode.parentNode.replaceChild(span, textNode);
    });
  }

  function shouldSkip(a){
    try{
      if(!a || !a.getAttribute) return true;
      if(!a.hasAttribute('href')) return true;
      if(a.classList.contains('btn')) return true;
      if(a.getAttribute('role') === 'button') return true;
      if(a.classList.contains('menu-btn')) return true;
      if(a.closest('.leaflet-control')) return true;
      if(a.classList.contains('no-link-icon') || a.hasAttribute('data-no-link-icon')) return true;
    }catch(e){}
    return false;
  }

  function applyIconOnly(a){
    var label = (a.getAttribute('aria-label') || a.textContent || a.getAttribute('title') || a.href || '').trim();
    if(label) a.setAttribute('aria-label', label);
    a.classList.add('link-icon-only');
    if(!(a.classList.contains('show-link-text') || a.hasAttribute('data-show-text'))){
      a.textContent = '';
      if(!a.getAttribute('title')) a.setAttribute('title', a.href);
    }
  }

  function transform(root){
    autolink(root);
    var anchors = (root.querySelectorAll ? root.querySelectorAll('a[href]') : []);
    anchors.forEach(function(a){
      if(!shouldSkip(a)) applyIconOnly(a);
    });
  }

  function runInitial(){
    transform(document.body || document.documentElement);
  }

  if(document.readyState === 'loading'){
    document.addEventListener('DOMContentLoaded', runInitial);
  } else {
    runInitial();
  }

  var obs = new MutationObserver(function(muts){
    for (var m of muts){
      for (var node of m.addedNodes){
        if(node.nodeType === 1){
          if(!inNoAutolink(node)) transform(node);
        }else if(node.nodeType === 3){
          var parent = node.parentNode;
          if(parent && !isEditable(parent) && !inNoAutolink(parent)){
            autolink(parent);
            if(parent.querySelectorAll){
              parent.querySelectorAll('a[href]').forEach(function(a){ if(!shouldSkip(a)) applyIconOnly(a); });
            }
          }
        }
      }
    }
  });
  try{
    obs.observe(document.documentElement, {childList:true, subtree:true});
  }catch(e){}

})();

// --- Logout button wiring (robust, FB-agnostic) ---
(function(){
  async function dynamicFirebaseSignOut(){
    // Try to import modular Firebase if globals aren't available
    try{
      const appMod  = await import("https://www.gstatic.com/firebasejs/10.12.2/firebase-app.js");
      const authMod = await import("https://www.gstatic.com/firebasejs/10.12.2/firebase-auth.js");
      const { getApps, getApp } = appMod;
      const { getAuth, signOut } = authMod;
      let auth;
      try{
        const app = getApps().length ? getApp() : undefined;
        auth = app ? getAuth(app) : getAuth();
      }catch(_){ auth = (window.auth ? window.auth : null); }
      if (auth){
        await signOut(auth);
      }
    }catch(e){
      // Fallback: if modular import fails, try classic globals or FB wrapper
      try{
        if (window.FB && window.FB.auth && typeof window.FB._rawSignOut === 'function'){
          await window.FB._rawSignOut(window.FB.auth);
        } else if (window.signOut && window.auth){
          await window.signOut(window.auth);
        }
      }catch(_) {}
    }
  }

  async function clearFirebaseCaches(){
    try{
      for (const store of [localStorage, sessionStorage]){
        const keys = [];
        for (let i=0;i<store.length;i++){ keys.push(store.key(i)); }
        for (const k of keys){
          if (!k) continue;
          if (k.includes('firebase') || k.startsWith('FIREBASE') || k.includes('g_state') || k.includes('fb_')){
            try{ store.removeItem(k); }catch(_){}
          }
        }
      }
    }catch(_){}
    try{ if (indexedDB) indexedDB.deleteDatabase('firebaseLocalStorageDb'); }catch(_){}
    try{ if (indexedDB) indexedDB.deleteDatabase('firebase-installations-database'); }catch(_){}
    try{ if (indexedDB) indexedDB.deleteDatabase('firebase-heartbeat-database'); }catch(_){}
  }

  function cleanReload(){
    try{
      const url = location.origin + location.pathname + `?signedout=${Date.now()}`;
      location.replace(url);
    }catch(_){ location.reload(); }
  }

  function attachLogout(){
    const btn = document.getElementById('logoutBtn');
    if(!btn) return;
    btn.addEventListener('click', async function(){
      try{
        btn.disabled = true;
        const original = btn.textContent;
        btn.textContent = 'מתנתק...';
        await dynamicFirebaseSignOut();
        await clearFirebaseCaches();
        cleanReload();
        setTimeout(()=>{ btn.textContent = original; btn.disabled = false; }, 1200);
      }catch(e){
        console.error('Logout failed', e);
        try{ await clearFirebaseCaches(); }catch(_){}
        cleanReload();
      }
    });
  }

  if (document.readyState === 'complete' || document.readyState === 'interactive'){
    attachLogout();
  } else {
    document.addEventListener('DOMContentLoaded', attachLogout, { once: true });
  }
})();
// === Shared Details Expand/Collapse Manager ===
(function(){
  function createDetailsToggleManager({
    buttonId,
    bodyId,
    storageKey,
    applyHook,
    ignoreSelectors = []
  }){
    const button = document.getElementById(buttonId);
    const body = document.getElementById(bodyId);
    if (!button || !body || button.dataset.wired === '1') return;
    button.dataset.wired = '1';

    const shouldIgnoreClick = (target) => {
      const selectors = ['.menu-btn', 'a', ...ignoreSelectors];
      return selectors.some(sel => {
        try{ return !!target.closest(sel); }catch(_){ return false; }
      });
    };

    function getNotesRows(){
      return body.querySelectorAll('tr.exp-item:has(td.notes)');
    }

    function isRowHidden(row){
      if (!row) return false;
      if (row.style.display === 'none') return true;
      if (row.style.display === '') {
        try{ return window.getComputedStyle(row).display === 'none'; }
        catch(_){ return false; }
      }
      return false;
    }

    function areAllCollapsed(){
      const rows = getNotesRows();
      if (!rows.length) return false;
      return Array.from(rows).every(isRowHidden);
    }

    function updateLabel(){
      button.textContent = areAllCollapsed() ? 'פתח הכל' : 'צמצם הכל';
    }

    function persistState(){
      try{
        localStorage.setItem(storageKey, areAllCollapsed() ? '1' : '0');
      }catch(_){ }
    }

    function setAllCollapsed(collapsed){
      getNotesRows().forEach(row => {
        row.style.display = collapsed ? 'none' : '';
      });
      persistState();
      updateLabel();
    }

    function applyPreference(){
      try{
        const pref = localStorage.getItem(storageKey);
        if (pref === '1') setAllCollapsed(true);
        else if (pref === '0') setAllCollapsed(false);
        else updateLabel();
      }catch(_){
        updateLabel();
      }
    }

    button.addEventListener('click', () => {
      setAllCollapsed(!areAllCollapsed());
    });

    body.addEventListener('click', (event) => {
      const row = event.target && event.target.closest && event.target.closest('tr.exp-item');
      if (!row || !body.contains(row)) return;
      if (row.querySelector('td.notes')) return;
      if (shouldIgnoreClick(event.target)) return;

      const notesRow = row.nextElementSibling;
      if (!notesRow || !notesRow.matches('tr.exp-item') || !notesRow.querySelector('td.notes')) return;

      const currentlyHidden = isRowHidden(notesRow);
      if (areAllCollapsed() && currentlyHidden) {
        getNotesRows().forEach(item => { item.style.display = 'none'; });
        notesRow.style.display = '';
      } else {
        notesRow.style.display = currentlyHidden ? '' : 'none';
      }

      persistState();
      updateLabel();
    });

    applyPreference();
    try{ window[applyHook] = applyPreference; }catch(_){ }
  }

  function init(){
    createDetailsToggleManager({
      buttonId: 'btnToggleJournalDetails',
      bodyId: 'tblJournal',
      storageKey: 'journalDetailsCollapsed',
      applyHook: '__applyJournalCollapsePref',
      ignoreSelectors: ['input[type="checkbox"]']
    });

    createDetailsToggleManager({
      buttonId: 'btnToggleExpenseDetails',
      bodyId: 'tblExpenses',
      storageKey: 'expenseDetailsCollapsed',
      applyHook: '__applyExpenseCollapsePref'
    });
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();

// --- הוספה: לוגיקה חסרה לייבוא קובץ JSON (מטפל בפורמט פולין 2018 + רומניה 2016) ---
// *** גרסה 2: תומך בקואורדינטות ושמות מקומות מהקובץ ***
(function() {
    /**
     * פונקציית עזר לניתוח תאריך במבנה DD/MM/YYYY
     */
    function parseDMY(dmyStr) {
        if (!dmyStr) return new Date();
        const parts = String(dmyStr).split('/');
        if (parts.length === 3) {
            // new Date(year, monthIndex, day)
            const d = new Date(Number(parts[2]), Number(parts[1]) - 1, Number(parts[0]), 9, 0, 0);
            if (!isNaN(d)) return d;
        }
        return new Date(); // גיבוי
    }

    /**
     * פונקציית עזר לביצוע Geocoding (עבור קובץ פולין)
     */
    async function geocodePlaceName(name) {
        if (!name) return null;
        const lang = 'he';
        try {
            const res = await fetch(`https://nominatim.openstreetmap.org/search?q=${encodeURIComponent(name)}&format=json&accept-language=${lang}&limit=1`);
            const data = await res.json();
            if (data.length > 0) {
                return {
                    lat: Number(data[0].lat),
                    lng: Number(data[0].lon)
                };
            }
            return null;
        } catch (e) {
            console.error('Geocoding network error for:', name, e);
            return null;
        }
    }

    function attachJsonImportListener() {
        const fileInput = document.getElementById('importFile');
        const importBtn = document.getElementById('btnImport'); // הכפתור הנסתר

        if (!fileInput || !importBtn || importBtn.dataset.wired) return;
        importBtn.dataset.wired = '1';

        // פונקציית ייבוא חדשה שתומכת בשני הפורמטים
        importBtn.addEventListener('click', async () => {
            const tid = state.currentTripId;
            if (!tid) {
                toast('הקובץ לא נטען. עליך לפתוח נסיעה קיימת קודם.');
                return;
            }

            const file = fileInput.files[0];
            if (!file) {
                toast('הקובץ לא נטען. לא נבחר קובץ.');
                return;
            }

            toast('מעבד קובץ, נא להמתין...'); // הודעת "מעבד"

            try {
                const text = await file.text();
                const data = JSON.parse(text);

                const ref = FB.doc(db, 'trips', tid);
                const snap = await FB.getDoc(ref);
                if (!snap.exists()) {
                    throw new Error('הנסיעה הפעילה לא נמצאה.');
                }
                const t = snap.data() || {};
                t.journal = t.journal || {};
                t.expenses = t.expenses || {};

                let expensesAdded = 0;
                let journalAdded = 0;
                const pad = n => String(n).padStart(2, '0');

                // --- זיהוי מבנה הקובץ ---

                // פורמט 1: פולין 2018 (מערך של ימים)
                if (Array.isArray(data)) {
                    for (const day of data) {
                        const dayDate = new Date(day.date);
                        if (isNaN(dayDate)) continue;
                        
                        const dayIso = dayDate.toISOString();
                        const dateStr = `${pad(dayDate.getDate())}/${pad(dayDate.getMonth() + 1)}/${dayDate.getFullYear()}`;
                        const timeStr = '09:00';
                        
                        const placeName = day.title || null;
                        let coords = null;
                        if (placeName) {
                            coords = await geocodePlaceName(placeName);
                            await new Promise(resolve => setTimeout(resolve, 500)); // מניעת חסימת API
                        }
                        
                        const journalId = (crypto.randomUUID ? crypto.randomUUID() : String(Date.now() + Math.random()));
                        t.journal[journalId] = {
                            text: day.content || '',
                            html: (day.content || '').replace(/\n/g, '<br>'),
                            placeName: placeName || (day.locations ? day.locations.join(', ') : 'מתוך ייבוא'),
                            createdAt: dayIso, dateIso: dayIso, date: dateStr, time: timeStr,
                            lat: coords ? coords.lat : null,
                            lng: coords ? coords.lng : null 
                        };
                        journalAdded++;

                        if (Array.isArray(day.expenses)) {
                            for (const exp of day.expenses) {
                                const expId = (crypto.randomUUID ? crypto.randomUUID() : String(Date.now() + Math.random()));
                                let currency = 'ILS'; 
                                if (exp.currency === '₪') currency = 'ILS';
                                if (exp.currency === 'זלוטי') currency = 'PLN';
                                if (exp.currency === 'יורו' || exp.currency === 'אירו') currency = 'EUR';

                                t.expenses[expId] = {
                                    desc: exp.type || 'ייבוא מ-JSON',
                                    descHtml: exp.type || 'ייבוא מ-JSON',
                                    category: exp.type || 'אחר',
                                    amount: Number(exp.amount) || 0,
                                    currency: currency,
                                    locationName: placeName || '',
                                    lat: coords ? coords.lat : null,
                                    lng: coords ? coords.lng : null,
                                    createdAt: dayIso, dateIso: dayIso, date: dateStr, time: timeStr,
                                    rates: { ...(state.rates || {}) }
                                };
                                expensesAdded++;
                            }
                        }
                    }
                }
                // פורמט 2: רומניה 2016 (אובייקט עם {journal, expenses}) - *** עם תמיכה בקואורדינטות ***
                else if (typeof data === 'object' && data.journal && Array.isArray(data.journal) && data.expenses && Array.isArray(data.expenses)) {
                    
                    for (const j of data.journal) {
                        const id = crypto.randomUUID ? crypto.randomUUID() : String(Date.now() + Math.random());
                        const d = parseDMY(j.date);
                        const iso = d.toISOString();
                        const dateStr = `${pad(d.getDate())}/${pad(d.getMonth() + 1)}/${d.getFullYear()}`;
                        const timeStr = '09:00';

                        t.journal[id] = { 
                            text: j.text || '', 
                            html: (j.text || '').replace(/\n/g, '<br>'), 
                            placeName: j.placeName || '', // <-- תמיכה חדשה
                            lat: j.lat || null,           // <-- תמיכה חדשה
                            lng: j.lng || null,           // <-- תמיכה חדשה
                            createdAt: iso, dateIso: iso, date: dateStr, time: timeStr 
                        };
                        journalAdded++;
                    }

                    for (const e of data.expenses) {
                        const id = crypto.randomUUID ? crypto.randomUUID() : String(Date.now() + Math.random());
                        const d = parseDMY(e.date);
                        const iso = d.toISOString();
                        const dateStr = `${pad(d.getDate())}/${pad(d.getMonth() + 1)}/${d.getFullYear()}`;
                        const timeStr = '09:00';

                        t.expenses[id] = {
                            desc: e.desc || 'ייבוא מ-JSON', 
                            descHtml: e.desc || 'ייבוא מ-JSON', 
                            category: e.category || 'אחר', // <-- תמיכה חדשה
                            amount: Number(e.amount) || 0, 
                            currency: e.currency || 'ILS', 
                            locationName: e.locationName || e.placeName || '', // <-- תמיכה חדשה
                            lat: e.lat || null,           // <-- תמיכה חדשה
                            lng: e.lng || null,           // <-- תמיכה חדשה
                            createdAt: iso, dateIso: iso, date: dateStr, time: timeStr, 
                            rates: { ...(state.rates || {}) } 
                        };
                        expensesAdded++;
                    }
                }
                // פורמט לא מזוהה
                else {
                    throw new Error('מבנה הקובץ אינו נתמך.');
                }

                // שמירה והודעת הצלחה
                await FB.updateDoc(ref, {
                    journal: t.journal,
                    expenses: t.expenses
                });

                toast(`הקובץ נטען בהצלחה! (נוספו ${journalAdded} יומן ו-${expensesAdded} הוצאות)`);
                await loadTrip(); 

            } catch (err) {
                console.error('JSON import error:', err);
                toast('הקובץ לא נטען: ' + err.message); // הודעת כישלון
            } finally {
                fileInput.value = '';
            }
        });
    }

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', attachJsonImportListener);
    } else {
        attachJsonImportListener();
    }
})();
// --- סוף הקוד החסר ---

// ======================================================
// תוספות חדשות: הסתרת תווית "מיקום" + מציאת קואורדינטות אוטומטית
// ======================================================

// 1. פונקציה להסתרת/הצגת התווית "מיקום"
function updateLocLabelState(prefix) {
  const inputId = prefix + 'LocationName';
  const el = document.getElementById(inputId);
  if (!el) return;
  const labelSpan = el.parentElement ? el.parentElement.querySelector('.loc-label') : null;
  if (labelSpan) {
    // אם יש טקסט בשדה, הסתר את המילה "מיקום"
    labelSpan.style.display = (el.value && el.value.trim() !== '') ? 'none' : '';
  }
}

// 2. פונקציה משודרגת לסריקת קואורדינטות (מנסה עברית ואז אנגלית)
async function autoFetchCoords(prefix) {
  // פונקציה מנוטרלת: שדה הכותרת הוא טקסט חופשי בלבד, לא מחפשים מיקום לפי הטקסט.
  return;
}


// 3. הפעלת המאזינים בטעינה
document.addEventListener('DOMContentLoaded', () => {
  ['exp', 'jr'].forEach(prefix => {
    const el = document.getElementById(prefix + 'LocationName');
    if (el) {
      // בעת הקלדה: עדכן הסתרת תווית וגם נקה קואורדינטות כדי לכפות חיפוש מחדש
      el.addEventListener('input', () => {
          updateLocLabelState(prefix);
          document.getElementById(prefix + 'Lat').value = '';
          document.getElementById(prefix + 'Lng').value = '';
      });
      
      // בוטל: אין יותר חיפוש אוטומטי על blur – השדה הוא כותרת טקסט בלבד

      // בדיקה ראשונית
      updateLocLabelState(prefix);
    }
  });
});

// Global UI wiring: FX details + expense location editor sync
document.addEventListener('DOMContentLoaded', ()=>{
  try{
    const fxClose = document.getElementById('fxClose');
    const fxDlg = document.getElementById('fxDetailsModal');
    if(fxClose && fxDlg && !fxClose.dataset.wired){
      fxClose.dataset.wired='1';
      fxClose.addEventListener('click', ()=>{ try{ fxDlg.close(); }catch(_){ } });
    }
  }catch(_){ }
});

// Delegated click for small FX arrow in rows
document.addEventListener('click', (ev)=>{
  const btn = ev.target && ev.target.closest ? ev.target.closest('button.fx-btn[data-fx="1"]') : null;
  if(!btn) return;
  ev.preventDefault();
  ev.stopPropagation();
  const curr = (btn.getAttribute('data-curr')||'').trim();
  const amountNum = Number(btn.getAttribute('data-amt')||0);
  const rateToILS = (btn.getAttribute('data-rate')==='' ? null : Number(btn.getAttribute('data-rate')));
  const ilsNum = (btn.getAttribute('data-ils')==='' ? null : Number(btn.getAttribute('data-ils')));
  openFxDetailsModal({ curr, amountNum, rateToILS, ilsNum });
});
// ======================================================
function __downsamplePath(path, maxPoints){
  try{
    const p = Array.isArray(path) ? path : [];
    const n = p.length;
    const maxN = Math.max(50, Number(maxPoints)||800);
    if(n <= maxN) return p;
    const step = n / maxN;
    const out = [];
    for(let i=0;i<maxN;i++){
      const idx = Math.floor(i * step);
      const pt = p[idx];
      if(pt && Number.isFinite(+pt.lat) && Number.isFinite(+pt.lng)) out.push({lat:+pt.lat, lng:+pt.lng});
    }
    const last = p[n-1];
    if(last && Number.isFinite(+last.lat) && Number.isFinite(+last.lng)){
      const tail = {lat:+last.lat, lng:+last.lng};
      const prev = out[out.length-1];
      if(!prev || prev.lat!==tail.lat || prev.lng!==tail.lng) out.push(tail);
    }
    return out;
  }catch(_){
    return Array.isArray(path) ? path : [];
  }
}

function __isVisitedLayerEnabled(){
  const btnVisited = document.getElementById('btnToggleVisited');
  return !btnVisited || btnVisited.classList.contains('active');
}

function __syncManagedGpxWithVisited(){
  const map = state.maps && state.maps.big;
  if(!map || !state.gpx?.files) return;
  const allowVisited = __isVisitedLayerEnabled();
  for(const id of state.gpx.order || []){
    const f = state.gpx.files.get(id);
    if(!f) continue;
    if(f.visible && allowVisited){
      if(!map.hasLayer(f.layer)) map.addLayer(f.layer);
    }else{
      if(map.hasLayer(f.layer)) map.removeLayer(f.layer);
    }
  }
}

function __initGpxManager(){
  state.gpx = state.gpx || { files:new Map(), order:[], enabled:false };
  const btn = document.getElementById('btnToggleGPX');
  const panel = document.getElementById('gpxManagerPanel');
  if(!btn || !panel) return;

  btn.addEventListener('click', ()=>{
    const isPanelHidden = !!panel.hidden;
    if(state.gpx.enabled && isPanelHidden){
      panel.hidden = false;
      btn.classList.add('active');
      __renderGpxPanel();
      return;
    }

    state.gpx.enabled = !state.gpx.enabled;
    btn.classList.toggle('active', state.gpx.enabled);
    panel.hidden = !state.gpx.enabled;
    if(state.gpx.enabled){
      __refreshGpxFromCurrent();
      __renderGpxPanel();
    }else{
      try{ initBigMap(); }catch(e){ console.error('initBigMap refresh failed', e); }
    }
  });
}

function __refreshGpxFromCurrent(){
  const map = state.maps && state.maps.big;
  if(!map) return;

  try{
    const inlineGpxPoints = state.maps.layers && state.maps.layers.gpxPoints;
    if(inlineGpxPoints && map.hasLayer(inlineGpxPoints)) map.removeLayer(inlineGpxPoints);
  }catch(_){}

  // clear old layers
  try{
    for(const f of state.gpx.files.values()){
      if(map.hasLayer(f.layer)) map.removeLayer(f.layer);
      try{ f.layer.clearLayers(); }catch(_){}
    }
  }catch(_){}

  state.gpx.files.clear();
  state.gpx.order = [];

  const t = state.current || {};
  const journal = t.journal || {};

  for(const id of Object.keys(journal)){
    const j = journal[id] || {};
    if(j.gpxType === 'point' && Number.isFinite(+j.lat) && Number.isFinite(+j.lng)){
      const layer = L.featureGroup();
      const marker = L.circleMarker([+j.lat, +j.lng], {
        radius: 6,
        color: '#6d28d9',
        fillColor: j.gpxColor || '#8b5cf6',
        fillOpacity: 0.95,
        weight: 2
      });
      marker.__itemType = 'journal';
      marker.__itemId = id;
      attachMapPopup(marker, 'journal', id, j);
      marker.addTo(layer);
      layer.addTo(map);

      let bounds = null;
      try{
        const b = layer.getBounds();
        if(b && b.isValid && b.isValid()) bounds = b;
      }catch(_){}

      const fileName = (j.gpxFileName || 'Point GPX').toString().trim() || 'Point GPX';
      const pointName = (j.placeName || j.text || 'נקודת GPX').toString().trim() || 'נקודת GPX';
      const rowName = `${fileName} / ${pointName}`;
      state.gpx.files.set(id, {
        id,
        name: rowName,
        type: 'point',
        ids: [id],
        layer,
        bounds,
        visible: true
      });
      state.gpx.order.push(id);
      continue;
    }

    const path = Array.isArray(j.path) ? j.path : null;
    if(!path || path.length < 2) continue;

    const name = (j.placeName || j.text || 'GPX').toString().split('\n')[0].slice(0,80);
    const layer = L.featureGroup();
    const latlngs = [];
    for(const pt of path){
      const lat = +pt.lat, lng = +pt.lng;
      if(Number.isFinite(lat) && Number.isFinite(lng)) latlngs.push([lat,lng]);
    }
    if(latlngs.length < 2) continue;

    const polyline = L.polyline(latlngs, { color:'#7c3aed', weight:4, opacity:0.95 }).addTo(layer);
    polyline.__itemType = 'journal';
    polyline.__itemId = id;
    layer.addTo(map);

    let bounds = null;
    try{
      const b = layer.getBounds();
      if(b && b.isValid && b.isValid()) bounds = b;
    }catch(_){}

    state.gpx.files.set(id, { id, name, type:'track', ids:[id], layer, bounds, visible:true });
    state.gpx.order.push(id);
  }

  try{ __syncManagedGpxWithVisited(); }catch(_){}

}

function __renderGpxPanel(){
  const panel = document.getElementById('gpxManagerPanel');
  if(!panel) return;
  const ids = state.gpx.order.filter(id=> state.gpx.files.has(id));
  const count = ids.length;

  panel.innerHTML = `
    <div class="gpx-head">
      <button class="btn small gpx-close" id="gpxClosePanel" aria-label="סגור">×</button>
      <button class="btn small" id="gpxShowAll">הצג הכל</button>
      <button class="btn small" id="gpxHideAll">הסתר הכל</button>
      <button class="btn small" id="gpxFitAll">זום להכל</button>
      <button class="btn small danger" id="gpxClearAll">מחק הכל</button>
      <div class="gpx-count">${count} פריטי GPX</div>
    </div>
    <div class="gpx-list">
      ${ids.map(id=>{
        const f = state.gpx.files.get(id);
        return `
          <div class="gpx-row" data-id="${id}">
            <label>
              <input type="checkbox" class="gpx-toggle" ${f.visible?'checked':''}/>
              <span class="gpx-name">${__escapeHtml(f.name)}</span>
            </label>
            <div class="gpx-actions">
              <button class="btn small danger" data-act="del">מחק</button>
              <button class="btn small" data-act="fit">Fit</button>
              <button class="btn small" data-act="solo">Solo</button>
            </div>
          </div>
        `;
      }).join('')}
    </div>
  `;

  panel.querySelector('#gpxClosePanel')?.addEventListener('click', ()=>{
    panel.hidden = true;
    document.getElementById('btnToggleGPX')?.classList.add('active');
  });
  panel.querySelector('#gpxShowAll')?.addEventListener('click', ()=>{ __setAllGpx(true); __renderGpxPanel(); });
  panel.querySelector('#gpxHideAll')?.addEventListener('click', ()=>{ __setAllGpx(false); __renderGpxPanel(); });
  panel.querySelector('#gpxFitAll')?.addEventListener('click', ()=>{ __fitAllGpx(); });
  panel.querySelector('#gpxClearAll')?.addEventListener('click', async ()=>{ await __deleteAllGpx(); });

  panel.querySelectorAll('.gpx-row').forEach(row=>{
    const id = row.dataset.id;
    row.querySelector('.gpx-toggle')?.addEventListener('change', (e)=>{ __setGpxVisible(id, e.target.checked); });
    row.querySelectorAll('button[data-act]').forEach(btn=>{
      btn.addEventListener('click', async ()=>{
        const act = btn.dataset.act;
        if(act==='solo'){ __soloGpx(id); __renderGpxPanel(); }
        if(act==='fit'){ __fitGpx(id); }
        if(act==='del'){ await __deleteGpx(id); }
      });
    });
  });
}

function __setGpxVisible(id, on){
  const map = state.maps && state.maps.big;
  if(!map) return;
  const f = state.gpx.files.get(id);
  if(!f) return;
  f.visible = !!on;
  if(f.visible && __isVisitedLayerEnabled()){
    if(!map.hasLayer(f.layer)) map.addLayer(f.layer);
  }else{
    if(map.hasLayer(f.layer)) map.removeLayer(f.layer);
  }
}

function __setAllGpx(on){
  for(const id of state.gpx.order) __setGpxVisible(id, on);
}

function __soloGpx(id){
  for(const fid of state.gpx.order) __setGpxVisible(fid, fid===id);
  __fitGpx(id);
}

function __fitGpx(id){
  const map = state.maps && state.maps.big;
  if(!map) return;
  const f = state.gpx.files.get(id);
  if(!f) return;
  const b = f.bounds || (f.layer.getBounds && f.layer.getBounds());
  if(b && b.isValid && b.isValid()) map.fitBounds(b.pad(0.15));
}

function __fitAllGpx(){
  const map = state.maps && state.maps.big;
  if(!map) return;
  let merged = null;
  for(const id of state.gpx.order){
    const f = state.gpx.files.get(id);
    if(!f || !f.visible) continue;
    const b = f.bounds || (f.layer.getBounds && f.layer.getBounds());
    if(b && b.isValid && b.isValid()){
      merged = merged ? merged.extend(b) : b;
    }
  }
  if(merged && merged.isValid && merged.isValid()) map.fitBounds(merged.pad(0.15));
}

async function __deleteGpx(id){
  const map = state.maps && state.maps.big;
  const f = state.gpx.files.get(id);
  if(!f) return;
  try{ if(map && map.hasLayer(f.layer)) map.removeLayer(f.layer); }catch(_){}
  try{ f.layer.clearLayers(); }catch(_){}

  try{
    const ref = FB.doc(db, 'trips', state.currentTripId);
    const patch = {};
    const ids = Array.isArray(f.ids) && f.ids.length ? f.ids : [id];
    ids.forEach(journalId => { patch[`journal.${journalId}`] = FB.deleteField(); });
    await FB.updateDoc(ref, patch);
  }catch(e){
    console.error('delete gpx failed', e);
  }

  state.gpx.files.delete(id);
  state.gpx.order = state.gpx.order.filter(x=>x!==id);
  try{
    if(state.current && state.current.journal){
      const ids = Array.isArray(f.ids) && f.ids.length ? f.ids : [id];
      ids.forEach(journalId => { delete state.current.journal[journalId]; });
    }
  }catch(_){}
  try{
    if(state.current) renderJournal(state.current, state.journalSort);
  }catch(_){}
  try{
    if(state.current) renderAllTimeline(state.current, state.allSort);
  }catch(_){}
  if(typeof toast==='function') toast('נמחק');
  __renderGpxPanel();
}

async function __deleteAllGpx(){
  const ids = [...state.gpx.order];
  for(const id of ids) await __deleteGpx(id);
  __renderGpxPanel();
}

function __escapeHtml(s){
  return String(s||'').replaceAll('&','&amp;').replaceAll('<','&lt;').replaceAll('>','&gt;').replaceAll('"','&quot;').replaceAll("'","&#39;");
}


document.addEventListener('DOMContentLoaded', ()=>{ try{ __initGpxManager(); }catch(e){ console.error(e); } });



/* ===========================
   Overview (הצג הכל) Search + Toggle All
   =========================== */
(function(){
  function $(sel, root){ return (root||document).querySelector(sel); }
  function $all(sel, root){ return Array.from((root||document).querySelectorAll(sel)); }

  const INVISIBLE = /[\u200E\u200F\u200B\u200C\u200D\u2066\u2067\u2068\u2069\u202A-\u202E\uFEFF]/g;

  function escapeRegex(s){
    return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  }

  // Allow invisible RTL/LTR control characters between letters so "עינת" matches "עי‎נת"
  function buildLooseMatcher(q){
    q = (q || '').trim();
    if (!q) return null;
    const chars = Array.from(q);
    const between = '(?:[\\u200E\\u200F\\u200B\\u200C\\u200D\\u2066\\u2067\\u2068\\u2069\\u202A-\\u202E\\uFEFF])*';
    const pat = chars.map(ch => escapeRegex(ch)).join(between);
    try{
      return new RegExp(pat, 'g');
    }catch(e){
      return null;
    }
  }

  function clearMarks(root){
    const marks = root.querySelectorAll('mark');
    marks.forEach(m=>{
      const txt = document.createTextNode(m.textContent);
      m.replaceWith(txt);
    });
    // merge adjacent text nodes
    root.normalize();
  }

  // highlight within text nodes (does not rewrite innerHTML; preserves listeners)
  function highlightMatches(root, regex){
    clearMarks(root);
    if (!regex) return [];

    const walker = document.createTreeWalker(
      root,
      NodeFilter.SHOW_TEXT,
      {
        acceptNode(node){
          if (!node.nodeValue || !node.nodeValue.trim()) return NodeFilter.FILTER_REJECT;
          const p = node.parentElement;
          if (!p) return NodeFilter.FILTER_REJECT;
          const tag = p.tagName;
          if (tag === 'SCRIPT' || tag === 'STYLE' || tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || tag === 'OPTION' || tag === 'BUTTON' || tag === 'MARK') {
            return NodeFilter.FILTER_REJECT;
          }
          // skip menu cell
          if (p.closest && p.closest('.menu-cell')) return NodeFilter.FILTER_REJECT;
          return NodeFilter.FILTER_ACCEPT;
        }
      }
    );

    const allMarks = [];
    const nodes = [];
    while(walker.nextNode()) nodes.push(walker.currentNode);

    nodes.forEach(node=>{
      const text = node.nodeValue;
      regex.lastIndex = 0;
      let m, last = 0;
      const hits = [];
      while((m = regex.exec(text)) !== null){
        hits.push({ index: m.index, length: m[0].length });
        // avoid infinite loops for empty
        if (m[0].length === 0) regex.lastIndex++;
      }
      if (!hits.length) return;

      const frag = document.createDocumentFragment();
      hits.forEach((h, i)=>{
        const before = text.slice(last, h.index);
        if (before) frag.appendChild(document.createTextNode(before));
        const marked = document.createElement('mark');
        marked.textContent = text.slice(h.index, h.index + h.length);
        frag.appendChild(marked);
        allMarks.push(marked);
        last = h.index + h.length;
      });
      const after = text.slice(last);
      if (after) frag.appendChild(document.createTextNode(after));
      node.parentNode.replaceChild(frag, node);
    });

    return allMarks;
  }

  function setCurrent(marks, idx){
    marks.forEach(m=>m.classList.remove('current-hit'));
    if (!marks.length) return -1;
    const i = ((idx % marks.length) + marks.length) % marks.length;
    const el = marks[i];
    el.classList.add('current-hit');
    try{ el.scrollIntoView({ behavior:'smooth', block:'center' }); }catch(_){ el.scrollIntoView(); }
    return i;
  }

  function applyCollapsedUI(){
    const root = document.getElementById('view-overview');
    if (!root) return;
    const btn = document.getElementById('btnAllToggle');
    if (!btn) return;
    const collapsed = root.classList.contains('all-collapsed');
    btn.textContent = collapsed ? 'פתח הכל' : 'צמצם הכל';
  }

  function setCollapsed(collapsed){
    const root = document.getElementById('view-overview');
    if (!root) return;
    root.classList.toggle('all-collapsed', !!collapsed);
    if (collapsed){
      // Clear any per-row open state (single-item overrides)
      const body = document.getElementById('tblAllTimeline');
      if (body){
        body.querySelectorAll('tr.exp-details.force-open').forEach(tr=>tr.classList.remove('force-open'));
        body.querySelectorAll('tr.exp-item.force-open').forEach(tr=>tr.classList.remove('force-open'));
      }
    }
    try{ localStorage.setItem('allDetailsCollapsed', collapsed ? '1' : '0'); }catch(_){}
    applyCollapsedUI();
  }

  function getCollapsed(){
    try{ return localStorage.getItem('allDetailsCollapsed') === '1'; }catch(_){ return false; }
  }

  function init(){
    const root = document.getElementById('view-overview');
    if (!root) return;

    const input = document.getElementById('searchAll');
    const count = document.getElementById('allHitCount');
    const prev = document.getElementById('btnAllPrev');
    const next = document.getElementById('btnAllNext');
    const toggle = document.getElementById('btnAllToggle');

    if (!input || !count || !prev || !next || !toggle) return;

    try{
      const stored = localStorage.getItem('overviewMode');
      if (stored) state.overviewMode = stored;
    }catch(_){ }
    if (!state.overviewMode) state.overviewMode = 'all';

    // In global-collapsed mode, clicking a header row should toggle ONLY its own details row
    const tbody = document.getElementById('tblAllTimeline');
    if (tbody && !tbody.dataset.rowToggleBound){
      tbody.addEventListener('click', (e)=>{
        // Ignore interactive elements (menu buttons, links, etc.)
        if (e.target.closest('button') || e.target.closest('a') || e.target.closest('input') || e.target.closest('textarea') || e.target.closest('select')) return;
        if (!root.classList.contains('all-collapsed')) return;
        const tr = e.target.closest('tr.exp-item');
        if (!tr || tr.classList.contains('exp-details')) return;
        const details = tr.nextElementSibling;
        if (!details || !details.classList.contains('exp-details')) return;
        const open = details.classList.contains('force-open');
        details.classList.toggle('force-open', !open);
        tr.classList.toggle('force-open', !open);
      }, { passive:true });
      tbody.dataset.rowToggleBound = '1';
    }

    // initial collapse state
    setCollapsed(getCollapsed());

    let marks = [];
    let idx = -1;

    function updateCounter(){
      count.textContent = marks.length ? `${idx+1}/${marks.length}` : '0/0';
    }

    function runSearch(){
      const q = (input.value || '').trim();
      // If searching, expand all so results are visible.
      if (q) setCollapsed(false);

      const regex = buildLooseMatcher(q);
      // Search in the whole overview table (headers + notes)
      const container = document.getElementById('tblAllTimeline') || root;

      marks = highlightMatches(container, regex);
      idx = marks.length ? 0 : -1;
      if (marks.length) idx = setCurrent(marks, idx);
      updateCounter();
    }

    input.addEventListener('input', runSearch);
    input.addEventListener('keydown', (e)=>{
      if (e.key === 'Enter'){
        e.preventDefault();
        if (!marks.length) return;
        idx = setCurrent(marks, idx + (e.shiftKey ? -1 : 1));
        updateCounter();
      }
    });

    prev.addEventListener('click', ()=>{
      if (!marks.length) return;
      idx = setCurrent(marks, idx - 1);
      updateCounter();
    });
    next.addEventListener('click', ()=>{
      if (!marks.length) return;
      idx = setCurrent(marks, idx + 1);
      updateCounter();
    });

    // Quick actions (keep existing functionality; just expose entry points from "הצג הכל")
    const qAddExpense = document.getElementById('btnQuickAddExpense');
    const qAddJournal = document.getElementById('btnQuickAddJournal');
    const qBreakdown = document.getElementById('btnQuickBreakdown');

    qAddExpense?.addEventListener('click', ()=>{
      // Prefer existing handler button if present
      const btn = document.getElementById('btnAddExpense');
      if (btn) btn.click();
    });
    qAddJournal?.addEventListener('click', ()=>{
      const btn = document.getElementById('btnAddJournal');
      if (btn) btn.click();
    });
    qBreakdown?.addEventListener('click', ()=>{
      // Do NOT proxy through a hidden button (programmatic click may lose the user-gesture context)
      if (typeof window.__openBreakdownDialog === 'function'){
        window.__openBreakdownDialog();
        return;
      }
      const btn = document.getElementById('openBreakdownBtn');
      if (btn) btn.click();
    });

    toggle.addEventListener('click', ()=>{
      const root = document.getElementById('view-overview');
      const collapsed = root.classList.contains('all-collapsed');
      setCollapsed(!collapsed);
    });

    // expose so renderAllTimeline can re-apply after rerender
    window.__overviewApplyAfterRender = function(){
      applyCollapsedUI();
      // re-run search to re-create marks after DOM changes
      runSearch();
    };

    // initial
    runSearch();
  }

  // init after DOM ready
  if (document.readyState === 'loading'){
    document.addEventListener('DOMContentLoaded', init);
  }else{
    init();
  }
})();

// --- Auth Fallback (Fixed for reliable login) ---
(function(){
  const isMobile = () => /Android|iPhone|iPad|iPod/i.test(navigator.userAgent) || window.innerWidth < 820;
  function $q(s){ return document.querySelector(s); }
  function on(el, ev, fn){ el && el.addEventListener(ev, fn, {passive:false}); }
  function bindTap(el, fn){
    if(!el) return;
    let locked = false;
    const wrap = async (e)=>{ if(locked) return; locked=true; try{ e?.preventDefault?.(); e?.stopPropagation?.(); await fn(e);} finally{ locked=false; } };
    on(el, 'click', wrap);
    on(el, 'touchend', wrap);
  }
  function show(el){ el && (el.style.display='flex'); }
  function hide(el){ el && (el.style.display='none'); }
  function setErr(msg){ const e = $q('#mError'); if(e) e.textContent = msg||''; }

  async function doLogin(){
    const email = $q('#mEmail')?.value?.trim();
    const pass  = $q('#mPass')?.value||'';
    if(!email || !pass){ setErr('אנא מלא אימייל וסיסמה'); return; }
    setErr('מתחבר...');
    try{
      await import('./firebase.js').then(async (m) => {
        const FBNS = window.FB || m.FB;
        const auth = window.auth || m.auth;
        if (!FBNS || !auth) throw new Error('Firebase Auth לא אותחל');
        await FBNS.signInWithEmailAndPassword(auth, email, pass);
      });
      setErr('');
    }catch(err){
      console.error('Mobile fallback login error:', err);
      setErr('שגיאה בהתחברות: ' + (err?.message||err));
    }
  }

  async function doLogout(){
    setErr('מתנתק...');
    try{
      if(typeof window.hardSignOut === 'function') await window.hardSignOut();
      else if(window.FB?.signOut && (window.auth||window.FB?.auth)) await window.FB.signOut(window.auth||window.FB.auth);
      setErr('נותק.');
      setTimeout(()=>setErr(''), 600);
    }catch(err){
      console.error('Mobile fallback logout error:', err);
      setErr('שגיאה בהתנתקות');
    }
  }

  function wire(){
    const overlay = document.getElementById('mobileAuthOverlay');
    if(!overlay) return;
    bindTap(document.getElementById('mLogin'), doLogin);
    bindTap(document.getElementById('mLogout'), doLogout);
    const email = document.getElementById('mEmail');
    const pass  = document.getElementById('mPass');
    if(email && pass){
      const submitOnEnter = (ev)=>{ if(ev.key === 'Enter'){ ev.preventDefault(); doLogin(); } };
      email.addEventListener('keydown', submitOnEnter);
      pass.addEventListener('keydown', submitOnEnter);
    }
    try{
      const currentUser = (window.auth || window.FB?.auth)?.currentUser || null;
      if(typeof window.__applyAuthShellState === 'function'){
        window.__applyAuthShellState(currentUser);
      }else{
        if(currentUser){
          overlay.style.display = 'none';
          document.body.dataset.authstate = 'in';
        }else{
          overlay.style.display = 'none';
          document.body.dataset.authstate = 'out';
        }
      }
    }catch(err){
      console.error('Mobile auth wire error:', err);
    }
  }

  if(document.readyState === 'loading'){
    document.addEventListener('DOMContentLoaded', wire);
  }else{
    wire();
  }
})();


/* === responsive repair override === */
document.addEventListener('DOMContentLoaded', ()=>{
  try{ normalizeMobileOverviewHeader(); }catch(_){}
});
window.addEventListener('resize', ()=>{
  try{ normalizeMobileOverviewHeader(); }catch(_){}
});
