(function (root) {
  'use strict';

  const CATEGORIES = new Set(['new', 'update', 'note']);
  const CATEGORY_LABELS = { new: 'NEW', update: 'UPDATE', note: 'NOTE' };
  const DATE_PATTERN = /^(\d{4})-(\d{2})-(\d{2})$/;

  function isValidDate(value) {
    const match = typeof value === 'string' && value.match(DATE_PATTERN);
    if (!match) return false;
    const year = Number(match[1]);
    const month = Number(match[2]);
    const day = Number(match[3]);
    const date = new Date(Date.UTC(year, month - 1, day));
    return date.getUTCFullYear() === year && date.getUTCMonth() === month - 1 && date.getUTCDate() === day;
  }

  function safeUrl(value, baseUrl) {
    if (typeof value !== 'string' || !value.trim() || value.length > 2048) return null;
    try {
      const url = new URL(value, baseUrl);
      return url.protocol === 'http:' || url.protocol === 'https:' ? url : null;
    } catch (_error) {
      return null;
    }
  }

  function normalizeRecord(record, baseUrl) {
    if (!record || typeof record !== 'object') return null;
    const id = typeof record.id === 'string' ? record.id.trim() : '';
    const title = typeof record.title === 'string' ? record.title.trim() : '';
    const category = typeof record.category === 'string' ? record.category.toLowerCase() : '';
    const url = safeUrl(record.url, baseUrl);
    if (!id || id.length > 120 || !title || title.length > 200 || !isValidDate(record.date) || !CATEGORIES.has(category) || !url) return null;
    return { id: id, date: record.date, category: category, title: title, url: url };
  }

  function latestRecords(records, baseUrl, limit) {
    if (!Array.isArray(records)) return [];
    const seen = new Set();
    return records
      .map(function (record) { return normalizeRecord(record, baseUrl); })
      .filter(Boolean)
      .sort(function (a, b) { return b.date.localeCompare(a.date) || a.id.localeCompare(b.id); })
      .filter(function (record) {
        if (seen.has(record.id)) return false;
        seen.add(record.id);
        return true;
      })
      .slice(0, Number.isInteger(limit) && limit >= 0 ? limit : 3);
  }

  function formatDate(value) {
    return value.replace(/-/g, '.');
  }

  function renderNews(documentRef, list, records, currentOrigin) {
    const items = records.map(function (record) {
      const item = documentRef.createElement('li');
      const link = documentRef.createElement('a');
      const meta = documentRef.createElement('span');
      const time = documentRef.createElement('time');
      const category = documentRef.createElement('span');
      const title = documentRef.createElement('span');
      const arrow = documentRef.createElement('span');

      item.className = 'news-list__item';
      link.className = 'news-list__link';
      link.href = record.url.href;
      if (record.url.origin !== currentOrigin) {
        link.target = '_blank';
        link.rel = 'noopener noreferrer';
      }

      meta.className = 'news-list__meta';
      time.className = 'news-list__date';
      time.dateTime = record.date;
      time.textContent = formatDate(record.date);
      category.className = 'news-list__category news-list__category--' + record.category;
      category.textContent = CATEGORY_LABELS[record.category];
      title.className = 'news-list__title';
      title.textContent = record.title;
      arrow.className = 'news-list__arrow';
      arrow.setAttribute('aria-hidden', 'true');
      arrow.textContent = '→';

      meta.append(time, category);
      link.append(meta, title, arrow);
      item.append(link);
      return item;
    });
    list.replaceChildren.apply(list, items);
  }

  async function loadNews(documentRef, fetchFn, locationRef) {
    const section = documentRef.querySelector('[data-news-section]');
    const list = documentRef.querySelector('[data-news-list]');
    if (!section || !list || typeof fetchFn !== 'function') return [];

    section.hidden = true;
    list.replaceChildren();
    try {
      const response = await fetchFn(section.dataset.newsUrl);
      if (!response.ok) return [];
      const records = latestRecords(await response.json(), locationRef.href, 3);
      if (!records.length) return [];
      renderNews(documentRef, list, records, locationRef.origin);
      section.hidden = false;
      return records;
    } catch (_error) {
      return [];
    }
  }

  const api = {
    formatDate: formatDate,
    isValidDate: isValidDate,
    latestRecords: latestRecords,
    loadNews: loadNews,
    normalizeRecord: normalizeRecord,
    renderNews: renderNews,
    safeUrl: safeUrl
  };

  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  if (root && root.document) {
    root.NewsFeed = api;
    root.document.addEventListener('DOMContentLoaded', function () {
      loadNews(root.document, root.fetch && root.fetch.bind(root), root.location);
    });
  }
})(typeof window !== 'undefined' ? window : null);
