import { describe, expect, it } from 'vitest'
import { UnsafeUrlError, fetchPublic, isBlockedAddress, readCapped } from './safe-fetch'

describe('isBlockedAddress', () => {
  it('блокирует loopback и unspecified', () => {
    for (const ip of ['127.0.0.1', '127.255.255.254', '0.0.0.0', '::1', '::']) {
      expect(isBlockedAddress(ip), ip).toBe(true)
    }
  })

  it('блокирует частные сети', () => {
    for (const ip of ['10.0.0.1', '172.16.0.1', '172.31.255.255', '192.168.1.1', '100.64.0.1']) {
      expect(isBlockedAddress(ip), ip).toBe(true)
    }
  })

  it('блокирует link-local, включая metadata облака', () => {
    // Главная цель SSRF в облаке — 169.254.169.254.
    expect(isBlockedAddress('169.254.169.254')).toBe(true)
    expect(isBlockedAddress('fe80::1')).toBe(true)
  })

  it('блокирует multicast, reserved и IPv6 ULA', () => {
    for (const ip of ['224.0.0.1', '240.0.0.1', '255.255.255.255', 'fc00::1', 'fd12::1', 'ff02::1']) {
      expect(isBlockedAddress(ip), ip).toBe(true)
    }
  })

  it('блокирует IPv4, завёрнутый в IPv6', () => {
    // Классический обход наивной проверки «строка начинается на 127.».
    expect(isBlockedAddress('::ffff:127.0.0.1')).toBe(true)
    expect(isBlockedAddress('::ffff:169.254.169.254')).toBe(true)
    expect(isBlockedAddress('::ffff:10.0.0.1')).toBe(true)
  })

  it('игнорирует zone id', () => {
    expect(isBlockedAddress('fe80::1%eth0')).toBe(true)
  })

  it('блокирует то, что вообще не адрес', () => {
    for (const s of ['', 'localhost', 'не-адрес', '1.2.3', '999.1.1.1']) {
      expect(isBlockedAddress(s), s).toBe(true)
    }
  })

  it('пропускает публичные адреса', () => {
    for (const ip of ['8.8.8.8', '1.1.1.1', '93.184.216.34', '172.32.0.1', '2606:4700::1111']) {
      expect(isBlockedAddress(ip), ip).toBe(false)
    }
  })
})

describe('fetchPublic', () => {
  it('отказывает не-http(s) схемам', async () => {
    for (const url of ['file:///etc/passwd', 'ftp://x.test/a', 'data:text/html,x', 'gopher://x']) {
      await expect(fetchPublic(url), url).rejects.toBeInstanceOf(UnsafeUrlError)
    }
  })

  it('отказывает мусорному URL', async () => {
    await expect(fetchPublic('не-url')).rejects.toBeInstanceOf(UnsafeUrlError)
  })

  it('не соединяется с loopback по имени', async () => {
    // localhost резолвится в 127.0.0.1 → резолвер диспетчера обязан отказать.
    await expect(fetchPublic('http://localhost:1/x')).rejects.toThrow()
  })

  it('не соединяется с адресом metadata облака', async () => {
    await expect(fetchPublic('http://169.254.169.254/latest/meta-data/')).rejects.toThrow()
  })
})

describe('readCapped', () => {
  const streamOf = (chunks: Uint8Array[]) =>
    ({
      body: new ReadableStream<Uint8Array>({
        start(controller) {
          for (const c of chunks) controller.enqueue(c)
          controller.close()
        },
      }),
    }) as unknown as Response

  it('обрезает тело больше лимита', async () => {
    // Ровно тот случай, ради которого он написан: сервер проигнорировал Range.
    const big = [new Uint8Array(50_000), new Uint8Array(50_000), new Uint8Array(50_000)]
    const out = await readCapped(streamOf(big), 64 * 1024)
    expect(out.length).toBe(64 * 1024)
  })

  it('отдаёт тело целиком, если оно меньше лимита', async () => {
    const out = await readCapped(streamOf([new Uint8Array([1, 2, 3]), new Uint8Array([4, 5])]), 1024)
    expect([...out]).toEqual([1, 2, 3, 4, 5])
  })

  it('переживает пустое тело', async () => {
    const out = await readCapped({ body: null } as unknown as Response, 1024)
    expect(out.length).toBe(0)
  })
})
