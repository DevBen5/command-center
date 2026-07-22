import { test } from '@japa/runner'
import { isBlockedAddress, isPublicFeedUrl } from '#modules/veille/validators/veille'

/**
 * La garde SSRF des flux — **le test qui compte** de ce lot, comme
 * `leitner_llm_url.spec.ts` l'est pour la liste blanche du LLM.
 *
 * C'est exactement le miroir inverse : Leitner n'accepte QUE le local, la veille le refuse.
 */
test.group('Veille / garde SSRF sur l’URL d’un flux', () => {
  test('accepte un flux public', ({ assert }) => {
    for (const url of [
      'https://blog.exemple.dev/feed.xml',
      'http://exemple.org/rss',
      'https://github.com/torvalds/linux/releases.atom',
      'https://www.exemple.dev/feed?format=rss&lang=fr',
    ]) {
      assert.isTrue(isPublicFeedUrl(url), `${url} devrait être accepté`)
    }
  })

  test('refuse le loopback et les plages privées', ({ assert }) => {
    for (const url of [
      'http://127.0.0.1/feed',
      'http://127.1.2.3/feed',
      'http://localhost/feed',
      'http://mon-app.localhost/feed',
      'http://10.0.0.5/feed',
      'http://172.16.0.1/feed',
      'http://172.31.255.254/feed',
      'http://192.168.1.1/feed',
      'http://100.64.0.1/feed',
      'http://[::1]/feed',
      'http://[fd00::1]/feed',
      'http://[fe80::1]/feed',
    ]) {
      assert.isFalse(isPublicFeedUrl(url), `${url} devrait être refusé`)
    }
  })

  test('refuse 169.254.169.254 — les métadonnées du fournisseur cloud', ({ assert }) => {
    assert.isFalse(isPublicFeedUrl('http://169.254.169.254/latest/meta-data/'))
    assert.isFalse(isPublicFeedUrl('http://169.254.1.1/feed'))
  })

  test('refuse une IP privée déguisée — décimal, hexadécimal, IPv4 en IPv6', ({ assert }) => {
    // Le parseur d'URL normalise : ces trois formes arrivent en `127.0.0.1`. La garde compare
    // donc `url.hostname`, jamais la chaîne saisie.
    assert.isFalse(isPublicFeedUrl('http://2130706433/feed'))
    assert.isFalse(isPublicFeedUrl('http://0x7f000001/feed'))
    assert.isFalse(isPublicFeedUrl('http://127.1/feed'))
    assert.isFalse(isPublicFeedUrl('http://[::ffff:127.0.0.1]/feed'))
  })

  test('refuse des identifiants dans l’URL : l’hôte n’est pas celui qu’on lit', ({ assert }) => {
    // `http://flux.exemple.dev@169.254.169.254/` : l'œil lit « flux.exemple.dev », le serveur
    // contacte la seconde partie.
    assert.isFalse(isPublicFeedUrl('http://flux.exemple.dev@169.254.169.254/'))
    assert.isFalse(isPublicFeedUrl('https://user:pass@exemple.dev/feed'))
  })

  test('refuse tout ce qui n’est pas http(s)', ({ assert }) => {
    for (const url of [
      'file:///etc/passwd',
      'gopher://exemple.dev/',
      'ftp://exemple.dev/feed',
      'data:text/xml,<rss/>',
      'pas une url',
      '',
    ]) {
      assert.isFalse(isPublicFeedUrl(url), `${url} devrait être refusé`)
    }
  })

  test('refuse les noms qui ne désignent jamais un service public', ({ assert }) => {
    // Un flux public a toujours un domaine ; `intranet` ou `nas.local` sont des hôtes de LAN.
    assert.isFalse(isPublicFeedUrl('http://intranet/feed'))
    assert.isFalse(isPublicFeedUrl('http://nas.local/feed'))
    assert.isFalse(isPublicFeedUrl('http://db.internal/feed'))
  })

  test('isBlockedAddress juge une IP résolue, pas une URL', ({ assert }) => {
    // C'est cette fonction que le fetcher applique aux adresses rendues par le DNS : la garde
    // de forme ne suffit pas, `flux.exemple.dev` peut parfaitement pointer sur 127.0.0.1.
    assert.isTrue(isBlockedAddress('127.0.0.1'))
    assert.isTrue(isBlockedAddress('169.254.169.254'))
    assert.isTrue(isBlockedAddress('192.168.0.42'))
    assert.isTrue(isBlockedAddress('::1'))
    assert.isFalse(isBlockedAddress('93.184.216.34'))
    assert.isFalse(isBlockedAddress('2606:2800:220:1:248:1893:25c8:1946'))
  })

  test('la frontière des plages privées est exacte', ({ assert }) => {
    // 172.16/12 s'arrête à 172.31 : 172.15 et 172.32 sont publiques, et les exclure à tort
    // interdirait des flux légitimes.
    assert.isTrue(isBlockedAddress('172.16.0.0'))
    assert.isTrue(isBlockedAddress('172.31.255.255'))
    assert.isFalse(isBlockedAddress('172.15.255.255'))
    assert.isFalse(isBlockedAddress('172.32.0.0'))
    assert.isFalse(isBlockedAddress('11.0.0.1'))
    assert.isFalse(isBlockedAddress('192.167.1.1'))
  })
})
