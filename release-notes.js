const trigger = document.querySelector('#releaseNotesButton');
const dialog = document.querySelector('#releaseNotesDialog');
trigger.addEventListener('click', () => {
  if (!dialog.open) dialog.showModal();
});
dialog.querySelector('[data-close-release-notes]').addEventListener('click', () => dialog.close());
dialog.addEventListener('click', event => {
  if (event.target !== dialog) return;
  const rect = dialog.getBoundingClientRect();
  if (event.clientX < rect.left || event.clientX > rect.right || event.clientY < rect.top || event.clientY > rect.bottom) dialog.close();
});
dialog.addEventListener('close', () => trigger.focus({ preventScroll: true }));
