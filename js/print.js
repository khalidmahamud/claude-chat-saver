(async () => {
  const { _print_temp: html } = await chrome.storage.local.get('_print_temp');
  if (!html) {
    document.getElementById('loading').textContent = 'No data found. Try exporting again.';
    return;
  }
  await chrome.storage.local.remove('_print_temp');
  document.open();
  document.write(html);
  document.close();
  setTimeout(() => window.print(), 400);
})();
