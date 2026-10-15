(() => {
  const key = 'outbox.jobs.theme.v1';
  const allowed = ['white', 'light', 'dark', 'system'];
  const media = matchMedia('(prefers-color-scheme: dark)');
  let preference = 'white';
  try {
    const saved = localStorage.getItem(key);
    if (allowed.includes(saved)) preference = saved;
  } catch {
    /* Keep a usable theme when browser storage is unavailable. */
  }
  function apply() {
    document.documentElement.dataset.theme =
      preference === 'system' ? (media.matches ? 'dark' : 'light') : preference;
    const meta = document.querySelector('meta[name="theme-color"]');
    if (meta) meta.content = getComputedStyle(document.documentElement).getPropertyValue('--canvas').trim();
  }
  apply();
  media.addEventListener('change', () => {
    if (preference === 'system') apply();
  });
  document.addEventListener('DOMContentLoaded', () => {
    const control = document.getElementById('theme-select');
    control.value = preference;
    apply();
    control.addEventListener('change', () => {
      preference = control.value;
      try {
        localStorage.setItem(key, preference);
      } catch {
        /* Theme changes still work for this visit. */
      }
      apply();
    });
  });
})();
