// Runs before first paint (loaded synchronously from the same origin, so it passes the CSP) to avoid a theme flash.
try {
  var t = localStorage.getItem('codex-theme');
  if (t !== 'light' && t !== 'dark') t = window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
  document.documentElement.dataset.theme = t;
} catch (e) {}
