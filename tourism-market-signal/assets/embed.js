(function () {
  'use strict';

  if (window.parent === window || !document.referrer) return;

  const parentOriginKey = 'tourism-market-signal-parent-origin';

  function isAllowedParentOrigin(value) {
    try {
      const url = new URL(value);
      return url.origin === 'https://lab.ugatta-llc.com' || url.hostname === '127.0.0.1' || url.hostname === 'localhost';
    } catch (error) {
      return false;
    }
  }

  let parentOrigin = window.sessionStorage.getItem(parentOriginKey);
  try {
    if (!isAllowedParentOrigin(parentOrigin)) {
      const referrerOrigin = new URL(document.referrer).origin;
      if (!isAllowedParentOrigin(referrerOrigin)) return;
      parentOrigin = referrerOrigin;
      window.sessionStorage.setItem(parentOriginKey, parentOrigin);
    }
  } catch (error) {
    return;
  }

  let lastHeight = 0;
  let scheduled = false;

  function reportHeight() {
    scheduled = false;
    const height = document.body ? Math.ceil(Array.from(document.body.children).reduce(function (bottom, element) {
      return Math.max(bottom, element.getBoundingClientRect().bottom + window.scrollY);
    }, 0)) : 0;
    if (height < 320 || height === lastHeight) return;
    lastHeight = height;
    window.parent.postMessage({
      source: 'tourism-market-signal',
      type: 'resize',
      height: height
    }, parentOrigin);
  }

  function scheduleHeightReport() {
    if (scheduled) return;
    scheduled = true;
    window.requestAnimationFrame(reportHeight);
  }

  window.addEventListener('load', scheduleHeightReport);
  window.addEventListener('pageshow', scheduleHeightReport);
  window.addEventListener('resize', scheduleHeightReport);

  if (document.fonts && document.fonts.ready) {
    document.fonts.ready.then(scheduleHeightReport);
  }

  if (typeof ResizeObserver === 'function') {
    const observer = new ResizeObserver(scheduleHeightReport);
    observer.observe(document.documentElement);
  }

  scheduleHeightReport();
})();
