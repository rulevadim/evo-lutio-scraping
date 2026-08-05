import { describe, expect, it } from 'vitest'
import { rateLimited } from './rate-limit'

describe('rateLimited', () => {
  it('пропускает до лимита и режет сверх него', () => {
    const key = `test:${Math.floor(performance.now())}:a`
    for (let i = 0; i < 3; i++) expect(rateLimited(key, 3, 60_000)).toBe(false)
    expect(rateLimited(key, 3, 60_000)).toBe(true)
  })

  it('считает ключи независимо', () => {
    const a = `test:${Math.floor(performance.now())}:b`
    const b = `test:${Math.floor(performance.now())}:c`
    for (let i = 0; i < 3; i++) rateLimited(a, 3, 60_000)
    expect(rateLimited(a, 3, 60_000)).toBe(true)
    expect(rateLimited(b, 3, 60_000)).toBe(false)
  })

  it('сбрасывает счётчик после окна', async () => {
    const key = `test:${Math.floor(performance.now())}:d`
    expect(rateLimited(key, 1, 30)).toBe(false)
    expect(rateLimited(key, 1, 30)).toBe(true)
    await new Promise((r) => setTimeout(r, 50))
    expect(rateLimited(key, 1, 30)).toBe(false)
  })
})
