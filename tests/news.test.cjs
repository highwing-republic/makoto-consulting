const test = require('node:test');
const assert = require('node:assert/strict');
const news = require('../js/news.js');

const BASE = 'https://lab.ugatta-llc.com/';

class FakeElement {
  constructor(tagName) {
    this.tagName = tagName;
    this.children = [];
    this.dataset = {};
    this.hidden = false;
  }
  append(...children) { this.children.push(...children); }
  replaceChildren(...children) { this.children = children; }
  setAttribute(name, value) { this[name] = value; }
}

class FakeDocument {
  constructor() {
    this.section = new FakeElement('section');
    this.section.dataset.newsUrl = 'data/news.json';
    this.list = new FakeElement('ol');
  }
  createElement(tagName) { return new FakeElement(tagName); }
  querySelector(selector) {
    if (selector === '[data-news-section]') return this.section;
    if (selector === '[data-news-list]') return this.list;
    return null;
  }
}

function record(id, date, overrides = {}) {
  return { id, date, category: 'new', title: `お知らせ ${id}`, url: `/${id}`, ...overrides };
}

test('valid records are sorted newest-first, deduplicated, and limited to three', () => {
  const records = news.latestRecords([
    record('old', '2026-01-01'),
    record('newest', '2026-10-10'),
    record('middle', '2026-09-13'),
    record('newest', '2026-10-09'),
    record('invalid-date', '2026-02-30'),
    record('unsafe-url', '2026-10-11', {url: 'javascript:alert(1)'}),
    record('second', '2026-10-06', {category: 'update'})
  ], BASE, 3);
  assert.deepEqual(records.map((item) => item.id), ['newest', 'second', 'middle']);
  assert.equal(news.formatDate(records[0].date), '2026.10.10');
});

test('renderer uses text content and secures external links', () => {
  const document = new FakeDocument();
  const records = news.latestRecords([
    record('external', '2026-10-10', {
      category: 'note',
      title: '<img src=x onerror=alert(1)>',
      url: 'https://note.com/example'
    })
  ], BASE, 3);
  news.renderNews(document, document.list, records, new URL(BASE).origin);

  const link = document.list.children[0].children[0];
  assert.equal(link.target, '_blank');
  assert.equal(link.rel, 'noopener noreferrer');
  assert.equal(link.children[1].textContent, '<img src=x onerror=alert(1)>');
  assert.equal(link.children[0].children[1].textContent, 'NOTE');

  const internal = news.latestRecords([record('internal', '2026-10-09')], BASE, 3);
  news.renderNews(document, document.list, internal, new URL(BASE).origin);
  const internalLink = document.list.children[0].children[0];
  assert.equal(internalLink.href, 'https://lab.ugatta-llc.com/internal');
  assert.equal(internalLink.target, undefined);
  assert.equal(internalLink.rel, undefined);
});

test('loader displays three and one record, and hides the section for zero records', async () => {
  for (const count of [3, 1, 0]) {
    const document = new FakeDocument();
    const rows = Array.from({length: count}, (_, index) => record(`item-${index}`, `2026-10-0${index + 1}`));
    const loaded = await news.loadNews(document, async () => ({ok: true, json: async () => rows}), new URL(BASE));
    assert.equal(loaded.length, count);
    assert.equal(document.list.children.length, count);
    assert.equal(document.section.hidden, count === 0);
  }
});

test('loader fails closed without leaking a rejected fetch', async () => {
  const document = new FakeDocument();
  const loaded = await news.loadNews(document, async () => { throw new Error('network failure'); }, new URL(BASE));
  assert.deepEqual(loaded, []);
  assert.equal(document.section.hidden, true);
  assert.equal(document.list.children.length, 0);
});
