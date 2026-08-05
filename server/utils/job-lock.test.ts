import { describe, expect, it } from 'vitest'
import { acquireJob, currentJob } from './job-lock'

describe('acquireJob', () => {
  it('пускает одну задачу и отказывает второй', () => {
    const first = acquireJob('первая')
    expect(first).not.toBeNull()
    expect(acquireJob('вторая')).toBeNull()
    expect(currentJob()?.name).toBe('первая')
    first!.release()
  })

  it('после release снова можно захватить', () => {
    const a = acquireJob('a')!
    a.release()
    const b = acquireJob('b')
    expect(b).not.toBeNull()
    expect(currentJob()?.name).toBe('b')
    b!.release()
    expect(currentJob()).toBeNull()
  })

  it('освобождает блокировку после ошибки в задаче', async () => {
    // Ровно то, ради чего release живёт в finally внутри stream-задачи.
    const job = acquireJob('падающая')!
    try {
      await Promise.reject(new Error('bang'))
    } catch {
      // ожидаемо
    } finally {
      job.release()
    }
    const next = acquireJob('следующая')
    expect(next).not.toBeNull()
    next!.release()
  })

  it('повторный release не снимает чужую блокировку', () => {
    const a = acquireJob('a')!
    a.release()
    const b = acquireJob('b')!
    a.release() // запоздалый вызов от уже завершённой задачи
    expect(currentJob()?.name).toBe('b') // b не должна пострадать
    b.release()
  })

  it('снимает блокировку по дедлайну и отменяет signal', async () => {
    const job = acquireJob('вечная', 30)!
    expect(job.signal.aborted).toBe(false)
    await new Promise((r) => setTimeout(r, 60))
    expect(job.signal.aborted).toBe(true)
    // Повисшая задача не должна блокировать кнопки до перезапуска процесса.
    const next = acquireJob('после дедлайна')
    expect(next).not.toBeNull()
    next!.release()
  })
})
