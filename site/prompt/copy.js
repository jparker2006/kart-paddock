const button = document.querySelector('#copy-prompt');
const status = document.querySelector('#copy-status');
let resetTimer;
button.addEventListener('click', async () => {
  clearTimeout(resetTimer);
  button.disabled = true;
  button.classList.remove('copied');
  status.classList.remove('copy-error');
  status.textContent = '';
  try {
    const response = await fetch('/prompt.md');
    if (!response.ok) throw new Error('Prompt unavailable');
    await navigator.clipboard.writeText(await response.text());
    button.classList.add('copied');
    button.setAttribute('aria-label', 'Prompt copied');
    button.title = 'Prompt copied';
    status.textContent = 'Prompt copied.';
    resetTimer = setTimeout(() => {
      button.classList.remove('copied');
      button.setAttribute('aria-label', 'Copy prompt');
      button.title = 'Copy prompt';
    }, 2500);
  } catch {
    button.setAttribute('aria-label', 'Copy prompt');
    button.title = 'Copy prompt';
    status.classList.add('copy-error');
    status.textContent = 'Could not copy. Please download the Markdown instead.';
  } finally {
    button.disabled = false;
  }
});
