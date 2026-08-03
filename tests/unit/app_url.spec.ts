import { test } from '@japa/runner'
import { inspectAppUrl } from '#config/app_url'

test.group('Core / APP_URL — dérivation du secure des cookies (CC-136)', () => {
  test('HTTPS pose secure: true', ({ assert }) => {
    const info = inspectAppUrl('https://cartes.exemple.fr')

    assert.isTrue(info.secureCookies)
    assert.isFalse(info.isInsecureNonLoopback)
  })

  test('HTTP sur localhost pose secure: false, sans avertissement', ({ assert }) => {
    const info = inspectAppUrl('http://localhost:8080')

    assert.isFalse(info.secureCookies)
    assert.isFalse(info.isInsecureNonLoopback)
  })

  test('HTTP sur 127.0.0.1 pose secure: false, sans avertissement', ({ assert }) => {
    const info = inspectAppUrl('http://127.0.0.1:3334')

    assert.isFalse(info.secureCookies)
    assert.isFalse(info.isInsecureNonLoopback)
  })

  test('HTTP sur la boucle locale IPv6 pose secure: false, sans avertissement', ({ assert }) => {
    const info = inspectAppUrl('http://[::1]:8080')

    assert.isFalse(info.secureCookies)
    assert.isFalse(info.isInsecureNonLoopback)
  })

  test('HTTP sur un hôte non-loopback est signalé', ({ assert }) => {
    const info = inspectAppUrl('http://192.168.1.50:8080')

    assert.isFalse(info.secureCookies)
    assert.isTrue(info.isInsecureNonLoopback)
  })

  test('HTTPS sur un hôte non-loopback n’est jamais signalé', ({ assert }) => {
    const info = inspectAppUrl('https://192.168.1.50:8080')

    assert.isTrue(info.secureCookies)
    assert.isFalse(info.isInsecureNonLoopback)
  })
})
