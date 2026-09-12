(function () {
  'use strict';
  const ALLOWED_EVENTS = new Set(['goal_select', 'tool_open', 'analysis_run', 'analysis_result_view', 'result_export', 'consultation_click', 'tool_error']);
  const ALLOWED_PARAMETERS = new Set(['goal_id', 'tool_id', 'prefecture_code', 'dataset_version', 'export_type', 'error_code', 'source_page']);

  function safeValue(value) {
    return typeof value === 'string' && /^[a-zA-Z0-9_.-]{1,80}$/.test(value) ? value : '';
  }

  function track(eventName, parameters) {
    if (!ALLOWED_EVENTS.has(eventName) || typeof window.gtag !== 'function') return;
    const safe = { source_page: window.location.pathname };
    Object.entries(parameters || {}).forEach(function ([key, value]) {
      if (ALLOWED_PARAMETERS.has(key) && key !== 'source_page') {
        const normalized = safeValue(String(value || ''));
        if (normalized) safe[key] = normalized;
      }
    });
    window.gtag('event', eventName, safe);
  }

  window.LabAnalytics = { track: track };
})();

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
      const aliases = { tool_click: 'tool_open', contact_click: 'consultation_click' };
      const eventName = aliases[element.dataset.analyticsEvent] || element.dataset.analyticsEvent;
      window.LabAnalytics.track(eventName, {
        tool_id: element.dataset.toolId || '',
        goal_id: element.dataset.goalId || ''
      });
    });
  });

  document.querySelectorAll('[data-print-result]').forEach(function (button) {
    button.addEventListener('click', function () {
      window.LabAnalytics.track('result_export', { tool_id: button.dataset.toolId || '', export_type: 'print' });
      window.print();
    });
  });

  document.querySelectorAll('[data-copy-result]').forEach(function (button) {
    button.addEventListener('click', async function () {
      const title = document.querySelector('h1')?.textContent.trim() || '宿泊DXラボ 分析結果';
      const selectedArea = document.getElementById('selected-area-name')?.textContent.trim() || '';
      const period = document.getElementById('analysis-period')?.textContent.trim() || '';
      const score = document.getElementById('primary-score')?.textContent.trim() || '';
      const reason = document.getElementById('analysis-reason')?.textContent.trim() || '';
      const sources = Array.from(document.querySelectorAll('#source-list dt')).map(function (node) { return node.textContent.trim(); }).join('、');
      const resultText = [title, selectedArea && `地域：${selectedArea}`, period, score && `参考スコア：${score}`, reason, sources && `出典：${sources}`, '注意：公開データに基づく参考情報であり、個別施設の成果や投資判断を保証するものではありません。'].filter(Boolean).join('\n');
      if (!navigator.clipboard) return;
      await navigator.clipboard.writeText(resultText);
      const original = button.textContent;
      button.textContent = 'コピーしました';
      window.LabAnalytics.track('result_export', { tool_id: button.dataset.toolId || '', export_type: 'copy' });
      window.setTimeout(function () { button.textContent = original; }, 1800);
    });
  });
});
