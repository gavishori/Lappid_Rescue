document.addEventListener('DOMContentLoaded', function () {
  // Wire logout buttons that already exist in modal headers (visible only when logged in).
  // Buttons with class .btn-logout-mobile are declared in index.html;
  // visibility is controlled by app.js via onAuthStateChanged.
  document.querySelectorAll('.btn-logout-mobile').forEach(function (btn) {
    if (btn.dataset.logoutBound === '1') return;
    btn.dataset.logoutBound = '1';
    btn.addEventListener('click', function () {
      try {
        if (typeof window.hardSignOut === 'function') {
          window.hardSignOut();
        } else if (window.FB && typeof window.FB.signOut === 'function') {
          window.FB.signOut(window.FB.auth);
        }
      } catch (e) {
        console.warn('logout failed', e);
      }
    });
  });
});
