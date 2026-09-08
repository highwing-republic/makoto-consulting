document.addEventListener('DOMContentLoaded', function () {
  const toggle = document.querySelector('[data-menu-toggle]');
  const nav = document.querySelector('[data-nav]');
  const mobileQuery = window.matchMedia('(max-width: 900px)');

  if (toggle && nav) {
    const firstLink = nav.querySelector('a');

    const setClosedState = function (restoreFocus) {
      toggle.setAttribute('aria-expanded', 'false');
      toggle.setAttribute('aria-label', 'メニューを開く');
      nav.classList.remove('is-open');
      document.body.classList.remove('nav-open');

      if (mobileQuery.matches) {
        nav.setAttribute('inert', '');
        nav.setAttribute('aria-hidden', 'true');
      } else {
        nav.removeAttribute('inert');
        nav.removeAttribute('aria-hidden');
      }

      if (restoreFocus) toggle.focus();
    };

    const openMenu = function () {
      toggle.setAttribute('aria-expanded', 'true');
      toggle.setAttribute('aria-label', 'メニューを閉じる');
      nav.classList.add('is-open');
      nav.removeAttribute('inert');
      nav.removeAttribute('aria-hidden');
      document.body.classList.add('nav-open');
      if (firstLink) {
        const focusFirstLink = function () {
          if (toggle.getAttribute('aria-expanded') === 'true') firstLink.focus();
        };
        window.setTimeout(focusFirstLink, 0);
        window.setTimeout(focusFirstLink, 300);
      }
    };

    toggle.addEventListener('click', function () {
      if (toggle.getAttribute('aria-expanded') === 'true') {
        setClosedState(true);
      } else {
        openMenu();
      }
    });

    nav.querySelectorAll('a').forEach(function (link) {
      link.addEventListener('click', function () {
        if (mobileQuery.matches) setClosedState(true);
      });
    });

    document.addEventListener('keydown', function (event) {
      if (event.key === 'Escape' && toggle.getAttribute('aria-expanded') === 'true') {
        setClosedState(true);
      }
    });

    const syncMenuMode = function () { setClosedState(false); };
    if (typeof mobileQuery.addEventListener === 'function') {
      mobileQuery.addEventListener('change', syncMenuMode);
    } else {
      mobileQuery.addListener(syncMenuMode);
    }
    syncMenuMode();
  }

  document.querySelectorAll('[data-analytics-event]').forEach(function (element) {
    if (element.dataset.analyticsBound === 'true') return;
    element.dataset.analyticsBound = 'true';
    element.addEventListener('click', function () {
      if (typeof window.gtag !== 'function') return;
      window.gtag('event', element.dataset.analyticsEvent, {
        link_url: element.href || '',
        link_text: element.textContent.trim(),
        contact_location: element.dataset.contactLocation || '',
        article_slug: element.dataset.articleSlug || '',
        page_location: window.location.href
      });
    });
  });
});
