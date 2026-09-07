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
      const open = toggle.getAttribute('aria-expanded') === 'true';
      toggle.setAttribute('aria-expanded', String(!open));
      toggle.setAttribute('aria-label', open ? 'メニューを開く' : 'メニューを閉じる');
      nav.classList.toggle('is-open', !open);
      document.body.classList.toggle('nav-open', !open);
    });
    nav.querySelectorAll('a').forEach(function (link) { link.addEventListener('click', closeMenu); });
    document.addEventListener('keydown', function (event) { if (event.key === 'Escape') closeMenu(); });
  }

  document.querySelectorAll('[data-analytics-event]').forEach(function (element) {
    element.addEventListener('click', function () {
      if (typeof window.gtag === 'function') {
        window.gtag('event', element.dataset.analyticsEvent, {
          link_url: element.href || '',
          article_slug: element.dataset.articleSlug || '',
          page_location: window.location.href
        });
      }
    });
  });

  const featuredRoot = document.querySelector('[data-featured-articles]');
  const articleRoot = document.querySelector('[data-article-list]');
  if (featuredRoot && articleRoot) initializeDirectory(featuredRoot, articleRoot);

  const originalRoot = document.querySelector('[data-original-text]');
  if (originalRoot) loadOriginalText(originalRoot);
});

async function initializeDirectory(featuredRoot, articleRoot) {
  try {
    const response = await fetch('/classics-ai-management/data/articles.json');
    if (!response.ok) throw new Error('記事データを読み込めませんでした。');
    const articles = await response.json();
    featuredRoot.replaceChildren(...articles.filter(function (article) { return article.featured; }).map(createArticleCard));

    const published = articles.filter(function (article) { return article.status === 'published'; });
    const search = document.querySelector('[data-article-search]');
    const filters = document.querySelectorAll('[data-theme-filter]');
    const empty = document.querySelector('[data-empty-results]');
    let activeTheme = 'すべて';

    const render = function () {
      const term = search ? search.value.trim().toLowerCase() : '';
      const results = published.filter(function (article) {
        const searchable = [article.chapter_title, article.article_title, article.summary, article.category].concat(article.themes).join(' ').toLowerCase();
        const themeMatch = activeTheme === 'すべて' || article.category === activeTheme || article.themes.includes(activeTheme);
        return themeMatch && (!term || searchable.includes(term));
      });
      articleRoot.replaceChildren(...results.map(createArticleCard));
      empty.classList.toggle('is-visible', results.length === 0);
    };

    if (search) search.addEventListener('input', render);
    filters.forEach(function (button) {
      button.addEventListener('click', function () {
        activeTheme = button.dataset.themeFilter;
        filters.forEach(function (item) { item.setAttribute('aria-pressed', String(item === button)); });
        render();
      });
    });
    render();
  } catch (error) {
    featuredRoot.innerHTML = '<p class="empty-results is-visible">記事一覧を読み込めませんでした。時間をおいて再度お試しください。</p>';
    articleRoot.innerHTML = '<p class="empty-results is-visible">記事一覧を読み込めませんでした。</p>';
  }
}

function createArticleCard(article) {
  const card = document.createElement('article');
  card.className = 'article-card';
  card.dataset.status = article.status;

  const meta = document.createElement('div');
  meta.className = 'article-card__meta';
  meta.innerHTML = '<span>韓非子 第' + String(article.chapter_id).padStart(2, '0') + '篇</span><span>' + article.chapter_title + '</span>';

  const title = document.createElement('h3');
  title.textContent = article.chapter_title + '｜' + article.article_title;
  const summary = document.createElement('p');
  summary.textContent = article.summary;
  const tags = document.createElement('ul');
  tags.className = 'tags';
  article.themes.forEach(function (theme) {
    const item = document.createElement('li');
    item.textContent = theme;
    tags.appendChild(item);
  });

  card.append(meta, title, summary, tags);
  if (article.status === 'published' && article.url) {
    const link = document.createElement('a');
    link.className = 'article-card__action';
    link.href = article.url;
    link.dataset.analyticsEvent = 'article_click';
    link.dataset.articleSlug = article.slug;
    link.textContent = '記事を読む　→';
    link.addEventListener('click', function () {
      if (typeof window.gtag === 'function') window.gtag('event', 'article_click', { article_slug: article.slug, link_url: article.url });
    });
    card.appendChild(link);
  } else {
    const status = document.createElement('span');
    status.className = 'article-card__action coming-label';
    status.textContent = '近日公開';
    card.appendChild(status);
  }
  return card;
}

async function loadOriginalText(root) {
  const chapterId = Number(document.body.dataset.chapterId);
  try {
    const response = await fetch('/classics-ai-management/data/hanfeizi.json');
    if (!response.ok) throw new Error('原文データを読み込めませんでした。');
    const data = await response.json();
    const chapter = data.chapters.find(function (item) { return item.number === chapterId; });
    const source = data.source.chapters.find(function (item) { return item.chapter_id === chapterId; });
    if (!chapter) throw new Error('該当する篇がありません。');
    root.textContent = chapter.original.split(/\n\s*\n/)[0];
    const sourceLink = document.querySelector('[data-source-link]');
    if (sourceLink && source) sourceLink.href = source.permalink;
  } catch (error) {
    root.textContent = '原文データを読み込めませんでした。下記の出典リンクから原文をご確認ください。';
  }
}
