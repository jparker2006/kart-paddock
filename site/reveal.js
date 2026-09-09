const button = document.getElementById('reveal');
button.addEventListener('click', () => {
  const revealed = button.getAttribute('aria-pressed') !== 'true';
  button.setAttribute('aria-pressed', String(revealed));
  document.body.dataset.modelsRevealed = String(revealed);
  button.innerHTML = revealed ? 'Hide models <span aria-hidden="true">↑</span>' : 'Reveal models <span aria-hidden="true">↓</span>';
  for (const id of ['model-a', 'model-b', 'model-c', 'model-d', 'model-e', 'run-notes']) document.getElementById(id).hidden = !revealed;
  window.KartMotion?.reveal(revealed);
});
