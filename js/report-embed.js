(function () {
  'use strict';

  const frame = document.querySelector('[data-report-frame]');
  if (!frame) return;

  const reportOrigin = new URL(frame.src, window.location.href).origin;
  const minimumHeight = 760;
  const maximumHeight = 30000;

  window.addEventListener('message', function (event) {
    if (event.origin !== reportOrigin || event.source !== frame.contentWindow) return;

    const message = event.data;
    if (!message || message.source !== 'tourism-market-signal' || message.type !== 'resize') return;

    const reportedHeight = Number(message.height);
    if (!Number.isFinite(reportedHeight)) return;

    const height = Math.min(maximumHeight, Math.max(minimumHeight, Math.ceil(reportedHeight)));
    frame.style.height = height + 'px';
    frame.removeAttribute('aria-busy');
  });
})();
