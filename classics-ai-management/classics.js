document.addEventListener('DOMContentLoaded', function () {
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
    const published = articles.filter(function (article) { return article.status === 'published'; });
    const coming = articles.filter(function (article) { return article.status === 'coming'; });
    featuredRoot.replaceChildren(...published.map(createArticleCard));
    const empty = document.querySelector('[data-empty-results]');
    articleRoot.replaceChildren(...coming.map(createArticleCard));
    if (empty) empty.classList.toggle('is-visible', coming.length === 0);
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
