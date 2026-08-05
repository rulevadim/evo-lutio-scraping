import { useDb } from '~~/server/db'
import { META, getMeta } from '~~/server/db/meta'
import { HTML_SANITIZER_VERSION } from '~~/server/utils/lj/sanitize'

// GET /api/healthz — готовность приложения (healthcheck контейнера и smoke-тест деплоя).
//
// Намеренно НЕ `SELECT 1`: при неверно смонтированном томе `useDb()` создаст пустую
// БД, применит схему и радостно ответит успехом — а сайт откроется с пустым списком.
// Поэтому проверяем то, что отличает рабочую базу от свежесозданной.

export default defineEventHandler((event) => {
  const checks: Record<string, boolean> = {}
  let posts = 0
  let sanitizerVersion = 0

  try {
    const db = useDb()

    posts = (db.prepare('SELECT COUNT(*) AS n FROM posts').get() as { n: number }).n
    // Пустая база в проде почти наверняка означает промах с томом.
    checks.hasContent = import.meta.dev || posts > 0

    // Индекс жив и отвечает на MATCH (а не просто существует как таблица).
    db.prepare('SELECT COUNT(*) AS n FROM search WHERE search MATCH ?').get('"а"')
    checks.searchWorks = true

    // Контент прогнан санитайзером нужной версии. Ловит в том числе базу,
    // поднятую из старого бэкапа.
    sanitizerVersion = Number(getMeta(db, META.sanitizerVersion) ?? 0)
    checks.sanitized = sanitizerVersion >= HTML_SANITIZER_VERSION
  } catch {
    checks.db = false
  }

  const ok = Object.values(checks).every(Boolean) && Object.keys(checks).length > 0
  if (!ok) setResponseStatus(event, 503)

  return {
    ok,
    // Сверяется со SHA деплоя: иначе smoke-тест зачтёт здоровый старый контейнер.
    sha: process.env.BUILD_SHA ?? 'dev',
    posts,
    sanitizerVersion,
    checks,
  }
})
