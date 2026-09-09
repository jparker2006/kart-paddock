const button = document.querySelector('#copy-prompt');
const status = document.querySelector('#copy-status');

button.addEventListener('click', async () => {
  button.disabled = true;
  status.textContent = '';
  try {
    const response = await fetch('/prompt.md');
    if (!response.ok) throw new Error('Prompt unavailable');
    await navigator.clipboard.writeText(await response.text());
    status.textContent = 'Prompt copied.';
  } catch {
    status.textContent = 'Could not copy. Please download the Markdown instead.';
  } finally {
    button.disabled = false;
  }
});
