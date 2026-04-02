// Mobile auth fallback isolated from the main application bundle.
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
