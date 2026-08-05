import { describe, expect, it } from 'vitest'
import { adminErrorText, errorStatus, loginErrorText } from './admin-errors'

const err = (status: number) => ({ status })

describe('errorStatus', () => {
  it('читает status и statusCode', () => {
    expect(errorStatus({ status: 401 })).toBe(401)
    expect(errorStatus({ statusCode: 409 })).toBe(409)
  })

  it('не падает на мусоре', () => {
    expect(errorStatus(null)).toBeUndefined()
    expect(errorStatus(new Error('сеть'))).toBeUndefined()
  })
})

describe('adminErrorText — запрос вошедшего админа', () => {
  it('401 = сессия истекла', () => {
    expect(adminErrorText(err(401))).toBe('Сессия истекла — войдите заново.')
  })

  it.each([
    [403, 'недопустимый источник'],
    [409, 'уже выполняется'],
    [429, 'Слишком часто'],
    [503, 'не настроен'],
  ])('%i объясняется по существу', (status, fragment) => {
    expect(adminErrorText(err(status))).toContain(fragment)
  })

  it('неизвестная ошибка — общий текст', () => {
    expect(adminErrorText(err(500))).toBe('Не удалось выполнить. Попробуйте ещё раз.')
  })
})

describe('loginErrorText — форма входа', () => {
  it('401 = неверный пароль, а НЕ истёкшая сессия', () => {
    // Сессии на форме входа ещё не было, поэтому «войдите заново» бессмысленно.
    expect(loginErrorText(err(401))).toBe('Неверный пароль.')
    expect(loginErrorText(err(401))).not.toContain('истекла')
  })

  it('остальные коды трактуются как обычно', () => {
    expect(loginErrorText(err(429))).toContain('Слишком часто')
    expect(loginErrorText(err(503))).toContain('не настроен')
  })
})
