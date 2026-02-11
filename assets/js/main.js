// Theme toggle – the only JS this site needs.
(function () {
  'use strict';

  var btn = document.querySelector('.theme-toggle');
  if (!btn) return;

  function setTheme(theme) {
    document.documentElement.setAttribute('data-theme', theme);
    localStorage.setItem('theme', theme);
    btn.setAttribute('aria-label',
      theme === 'dark' ? 'Switch to light theme' : 'Switch to dark theme'
    );
    btn.textContent = theme === 'dark' ? '\u2600' : '\u263E'; // ☀ / ☾
  }

  btn.addEventListener('click', function () {
    var current = document.documentElement.getAttribute('data-theme');
    setTheme(current === 'dark' ? 'light' : 'dark');
  });

  // Sync button label and icon with the theme already set by the inline <head> script
  var initial = document.documentElement.getAttribute('data-theme') || 'light';
  setTheme(initial);
})();
