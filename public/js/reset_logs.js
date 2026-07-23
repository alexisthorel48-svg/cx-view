(() => {
  function addResetButton() {
    const page = document.getElementById('page-history');
    if (!page || !page.classList.contains('active')) return;
    if (document.getElementById('reset-cx-logs')) return;

    const header = page.querySelector('.page-header');
    if (!header) return;

    const button = document.createElement('button');
    button.id = 'reset-cx-logs';
    button.className = 'btn btn-danger';
    button.textContent = '🗑️ Réinitialiser les logs';
    button.title = 'Supprime définitivement tous les historiques de diffusion';

    button.addEventListener('click', async () => {
      const ok = window.confirm(
        'Supprimer tous les logs de diffusion ?\n\nCette action réinitialise les statistiques et ne peut pas être annulée.'
      );
      if (!ok) return;

      button.disabled = true;
      button.textContent = 'Suppression...';

      try {
        const result = await POST('/api/logs/reset');
        toast(`${result.deleted || 0} log(s) supprimé(s)`);
        if (typeof loadHistory === 'function') loadHistory();
      } catch (e) {
        toast(e.message || 'Impossible de réinitialiser les logs', 'error');
        button.disabled = false;
        button.textContent = '🗑️ Réinitialiser les logs';
      }
    });

    header.appendChild(button);
  }

  const observer = new MutationObserver(addResetButton);
  observer.observe(document.documentElement, { childList: true, subtree: true });
  document.addEventListener('DOMContentLoaded', addResetButton);
  setInterval(addResetButton, 800);
})();
