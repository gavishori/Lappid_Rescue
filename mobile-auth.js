document.addEventListener('DOMContentLoaded', function () {
  const modalIds = [
    'authModal',
    'tripModal',
    'expenseModal',
    'journalModal',
    'confirmDeleteModal',
    'filterModal',
    'breakdownDialog',
    'unsavedChangesModal',
    'mapSelectModal',
    'tripTodayModal'
  ];

  modalIds.forEach((id) => {
    const dialog = document.getElementById(id);
    if (!dialog) return;

    const header = dialog.querySelector('header') || dialog.querySelector('.header');
    if (!header || header.querySelector('.btn-logout-mobile')) return;

    const button = document.createElement('button');
    button.className = 'btn danger btn-logout-mobile';
    button.setAttribute('aria-label', 'התנתקות');
    button.style.display = 'none';
    button.style.marginInlineStart = '.5rem';
    button.textContent = 'התנתקות';
    header.appendChild(button);
  });
});
