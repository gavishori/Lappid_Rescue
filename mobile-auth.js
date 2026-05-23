(() => {
  'use strict';

  const MOBILE_QUERY = '(max-width: 820px)';
  const EDITOR_DIALOG_IDS = ['expenseModal', 'journalModal'];
  const ALL_DIALOG_IDS = [
    'authModal',
    'tripModal',
    'expenseModal',
    'journalModal',
    'confirmDeleteModal',
    'filterModal',
    'breakdownDialog',
    'unsavedChangesModal',
    'mapSelectModal',
    'tripTodayModal',
    'rowMenuModal',
    'expLocationModal',
    'jrLocationModal',
    'fxDetailsModal'
  ];

  const mq = window.matchMedia ? window.matchMedia(MOBILE_QUERY) : null;

  function isMobile(){
    return mq ? mq.matches : window.innerWidth <= 820;
  }

  function px(value){
    return `${Math.max(0, Math.round(value))}px`;
  }

  function getViewport(){
    const vv = window.visualViewport;
    return {
      width: vv ? vv.width : window.innerWidth,
      height: vv ? vv.height : window.innerHeight,
      offsetTop: vv ? vv.offsetTop : 0,
      pageTop: vv ? vv.pageTop : window.scrollY || 0
    };
  }

  function updateViewportVars(){
    const root = document.documentElement;
    const layoutHeight = window.innerHeight || document.documentElement.clientHeight || 0;
    const layoutWidth = window.innerWidth || document.documentElement.clientWidth || 0;
    const vv = getViewport();
    const keyboardSpace = Math.max(0, layoutHeight - vv.height - vv.offsetTop);
    const editorHeight = isMobile()
      ? Math.max(220, Math.min(layoutHeight * 0.5, Math.max(220, vv.height - 12), 430))
      : Math.min(layoutHeight, 720);

    root.style.setProperty('--mobile-vh', px(vv.height));
    root.style.setProperty('--mobile-vw', px(vv.width || layoutWidth));
    root.style.setProperty('--mobile-keyboard-space', px(keyboardSpace));
    root.style.setProperty('--mobile-editor-height', px(editorHeight));
    document.body.classList.toggle('mobile-ui', isMobile());
    document.body.classList.toggle('keyboard-open', keyboardSpace > 80);
  }

  function addLogoutButtons(){
    ALL_DIALOG_IDS.forEach((id) => {
      const dialog = document.getElementById(id);
      if (!dialog) return;

      const header = dialog.querySelector('header') || dialog.querySelector('.header');
      if (!header || header.querySelector('.btn-logout-mobile')) return;

      const button = document.createElement('button');
      button.className = 'btn danger btn-logout-mobile';
      button.type = 'button';
      button.setAttribute('aria-label', 'התנתקות');
      button.style.display = 'none';
      button.style.marginInlineStart = '.5rem';
      button.textContent = 'התנתקות';
      header.appendChild(button);
    });
  }

  function markOpenEditorDialog(){
    const active = EDITOR_DIALOG_IDS.some((id) => document.getElementById(id)?.open);
    document.body.classList.toggle('mobile-editor-open', active && isMobile());
  }

  function normalizeDialog(dialog){
    if (!dialog || !isMobile()) return;

    dialog.style.maxWidth = '';
    dialog.style.width = '';
    dialog.style.left = '';
    dialog.style.right = '';
    dialog.style.transform = '';

    if (EDITOR_DIALOG_IDS.includes(dialog.id)) {
      dialog.scrollTop = 0;
      const body = dialog.querySelector('.body');
      if (body) body.scrollTop = 0;
    }
  }

  function normalizeOpenDialogs(){
    updateViewportVars();
    ALL_DIALOG_IDS.forEach((id) => normalizeDialog(document.getElementById(id)));
    markOpenEditorDialog();
  }

  function removeHorizontalOverflow(){
    if (!isMobile()) return;

    const viewportWidth = document.documentElement.clientWidth || window.innerWidth || 0;
    if (!viewportWidth) return;

    document.querySelectorAll('body *').forEach((el) => {
      if (!(el instanceof HTMLElement)) return;
      if (el.closest('dialog[open]') && !el.closest('#expenseModal, #journalModal')) return;

      const rect = el.getBoundingClientRect();
      if (rect.width <= viewportWidth + 1) return;

      const tag = el.tagName.toLowerCase();
      if (['html', 'body', 'script', 'style'].includes(tag)) return;

      el.style.maxWidth = '100%';
      el.style.minWidth = '0';
      if (getComputedStyle(el).overflowX === 'visible') el.style.overflowX = 'hidden';
    });
  }

  function wireDialogEvents(){
    ALL_DIALOG_IDS.forEach((id) => {
      const dialog = document.getElementById(id);
      if (!dialog || dialog.dataset.mobileAuthWired) return;
      dialog.dataset.mobileAuthWired = '1';
      dialog.addEventListener('close', () => setTimeout(normalizeOpenDialogs, 0));
      dialog.addEventListener('cancel', () => setTimeout(normalizeOpenDialogs, 0));
    });
  }

  function wireEditorFocus(){
    ['expText', 'jrText', 'expTitle', 'jrTitle', 'expAmount', 'expDate', 'expTime', 'jrDate', 'jrTime'].forEach((id) => {
      const el = document.getElementById(id);
      if (!el || el.dataset.mobileKeyboardWired) return;
      el.dataset.mobileKeyboardWired = '1';
      el.addEventListener('focus', () => {
        updateViewportVars();
        const dialog = el.closest('dialog');
        normalizeDialog(dialog);
      }, { passive: true });
      el.addEventListener('blur', () => setTimeout(normalizeOpenDialogs, 80), { passive: true });
    });
  }

  function patchShowModal(){
    if (HTMLDialogElement.prototype.__mobileAuthPatched) return;
    HTMLDialogElement.prototype.__mobileAuthPatched = true;

    const original = HTMLDialogElement.prototype.showModal;
    HTMLDialogElement.prototype.showModal = function patchedShowModal(){
      const result = original.apply(this, arguments);
      requestAnimationFrame(() => {
        normalizeDialog(this);
        normalizeOpenDialogs();
        setTimeout(removeHorizontalOverflow, 60);
      });
      return result;
    };
  }

  function boot(){
    updateViewportVars();
    addLogoutButtons();
    wireDialogEvents();
    wireEditorFocus();
    patchShowModal();
    normalizeOpenDialogs();
    removeHorizontalOverflow();

    const refresh = () => {
      updateViewportVars();
      normalizeOpenDialogs();
      requestAnimationFrame(removeHorizontalOverflow);
    };

    window.addEventListener('resize', refresh, { passive: true });
    window.addEventListener('orientationchange', () => setTimeout(refresh, 120), { passive: true });

    if (window.visualViewport) {
      window.visualViewport.addEventListener('resize', refresh, { passive: true });
      window.visualViewport.addEventListener('scroll', refresh, { passive: true });
    }

    if (mq) {
      const onChange = () => setTimeout(refresh, 0);
      if (mq.addEventListener) mq.addEventListener('change', onChange);
      else mq.addListener(onChange);
    }

    const observer = new MutationObserver(() => {
      wireDialogEvents();
      wireEditorFocus();
      normalizeOpenDialogs();
      removeHorizontalOverflow();
    });
    observer.observe(document.body, { childList: true, subtree: true, attributes: true, attributeFilter: ['open'] });
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', boot, { once: true });
  } else {
    boot();
  }
})();
