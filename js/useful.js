document.addEventListener('DOMContentLoaded', function () {
  const toggle = document.querySelector('[data-menu-toggle]');
  const nav = document.querySelector('[data-nav]');

  if (toggle && nav) {
    const closeMenu = function () {
      toggle.setAttribute('aria-expanded', 'false');
      toggle.setAttribute('aria-label', 'メニューを開く');
      nav.classList.remove('is-open');
      document.body.classList.remove('nav-open');
    };

    toggle.addEventListener('click', function () {
      const isOpen = toggle.getAttribute('aria-expanded') === 'true';
      toggle.setAttribute('aria-expanded', String(!isOpen));
      toggle.setAttribute('aria-label', isOpen ? 'メニューを開く' : 'メニューを閉じる');
      nav.classList.toggle('is-open', !isOpen);
      document.body.classList.toggle('nav-open', !isOpen);
    });

    nav.querySelectorAll('a').forEach(function (link) {
      link.addEventListener('click', closeMenu);
    });

    document.addEventListener('keydown', function (event) {
      if (event.key === 'Escape') closeMenu();
    });
  }

  const reveals = document.querySelectorAll('.reveal');
  if ('IntersectionObserver' in window && !window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
    const observer = new IntersectionObserver(function (entries) {
      entries.forEach(function (entry) {
        if (entry.isIntersecting) {
          entry.target.classList.add('is-visible');
          observer.unobserve(entry.target);
        }
      });
    }, { threshold: 0.08, rootMargin: '0px 0px -30px' });
    reveals.forEach(function (element) { observer.observe(element); });
  } else {
    reveals.forEach(function (element) { element.classList.add('is-visible'); });
  }

  document.querySelectorAll('[data-analytics-event]').forEach(function (element) {
    element.addEventListener('click', function () {
      if (typeof window.gtag === 'function') {
        window.gtag('event', element.dataset.analyticsEvent, {
          link_url: element.href || '',
          page_location: window.location.href
        });
      }
    });
  });
});
