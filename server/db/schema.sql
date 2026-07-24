-- Посты. id = ditemid из URL поста (/<ditemid>.html).
CREATE TABLE IF NOT EXISTS posts (
  id           INTEGER PRIMARY KEY,
  url          TEXT    NOT NULL,
  title        TEXT    NOT NULL,
  published_at INTEGER NOT NULL, -- unix seconds
  tags         TEXT    NOT NULL DEFAULT '[]', -- JSON-массив строк
  body_html    TEXT    NOT NULL,
  scraped_at   INTEGER NOT NULL  -- unix seconds
);

-- Комментарии. id = dtalkid из RPC. parent_id = 0 для верхнеуровневых.
CREATE TABLE IF NOT EXISTS comments (
  id             INTEGER PRIMARY KEY,
  post_id        INTEGER NOT NULL REFERENCES posts(id) ON DELETE CASCADE,
  parent_id      INTEGER NOT NULL DEFAULT 0,
  level          INTEGER NOT NULL DEFAULT 0,
  author         TEXT    NOT NULL DEFAULT '',
  author_journal TEXT    NOT NULL DEFAULT '',
  body_html      TEXT    NOT NULL DEFAULT '',
  created_at     INTEGER NOT NULL DEFAULT 0, -- unix seconds
  position       INTEGER NOT NULL DEFAULT 0  -- порядок внутри поста (из RPC)
);

CREATE INDEX IF NOT EXISTS idx_comments_post ON comments(post_id);
CREATE INDEX IF NOT EXISTS idx_comments_parent ON comments(post_id, parent_id);

-- Единый полнотекстовый индекс по постам и комментариям.
-- Токенайзер unicode61 → пословный поиск (целые слова, не подстроки), unicode-aware
-- (корректно бьёт кириллицу). Метаданные (kind/post_id/ref_id) не токенизируются.
CREATE VIRTUAL TABLE IF NOT EXISTS search USING fts5(
  kind    UNINDEXED,  -- 'post' | 'comment'
  post_id UNINDEXED,  -- id поста, к которому относится запись
  ref_id  UNINDEXED,  -- id записи: posts.id или comments.id
  title,              -- заголовок поста (у комментов пусто)
  author,             -- автор коммента (у поста пусто)
  content,            -- основной текст, очищенный от HTML
  tokenize = 'unicode61 remove_diacritics 2'
);

-- Мелкий key-value кэш (напр. общее число постов блога и время его подсчёта).
CREATE TABLE IF NOT EXISTS meta (
  key   TEXT PRIMARY KEY,
  value TEXT NOT NULL
);
