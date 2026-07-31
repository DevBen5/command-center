import { test } from '@japa/runner'
import { currentStep, generateSecret, otpauthUri, verify } from '#core/auth/services/totp'
import { TOTP, Secret } from 'otpauth'

/**
 * Le TOTP (CC-114) — et **ce que ce fichier prouve exactement**.
 *
 * L'algorithme vient d'`otpauth` : le tester reviendrait à tester une dépendance, ce qui ne
 * dit rien de notre code. Ce qui est à nous, et qui casse en silence, c'est le **paramétrage**
 * — SHA-1, six chiffres, période de 30 s — et l'anti-rejeu.
 *
 * D'où le vecteur de la RFC 6238 ci-dessous : il ne vérifie pas qu'`otpauth` sait faire un
 * HMAC, il vérifie que *nos* trois constantes sont celles que suppose toute application
 * d'authentification. Passer à `digits: 8` ou `SHA256` produirait des codes qu'un téléphone
 * refuserait sans jamais lever d'erreur — le mode d'échec le plus coûteux à diagnostiquer,
 * puisqu'il ressemble à « l'utilisateur se trompe en recopiant ».
 */

/**
 * Le secret des vecteurs de la RFC 6238, Appendix B : l'ASCII « 12345678901234567890 », en
 * base32 puisque c'est le format que nous manipulons.
 */
const SECRET_RFC = 'GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ'

/**
 * Les vecteurs SHA-1 de la RFC, **tronqués à six chiffres**.
 *
 * La RFC les publie sur huit chiffres ; les six derniers sont exactement le code à six
 * chiffres, parce que `(x mod 10^8) mod 10^6 === x mod 10^6`. Ce n'est pas un raccourci de
 * confort : c'est ce qui permet de confronter un paramétrage à six chiffres aux vecteurs
 * officiels sans avoir à les recalculer soi-même — donc sans avoir à faire confiance au
 * calcul qu'on est en train de vérifier.
 */
const VECTEURS_RFC = [
  { secondes: 59, code: '287082' }, // RFC : 94287082
  { secondes: 1111111109, code: '081804' }, // RFC : 07081804
  { secondes: 1234567890, code: '005924' }, // RFC : 89005924
  { secondes: 2000000000, code: '279037' }, // RFC : 69279037
]

/** Le code attendu à cet instant, calculé par la lib — pour les cas où le vecteur ne sert pas. */
function codeA(secret: string, now: number): string {
  return new TOTP({
    algorithm: 'SHA1',
    digits: 6,
    period: 30,
    secret: Secret.fromBase32(secret),
  }).generate({ timestamp: now })
}

test.group('Core / TOTP', () => {
  test('les vecteurs de la RFC 6238 passent — donc SHA-1, 6 chiffres, période 30', ({ assert }) => {
    for (const { secondes, code } of VECTEURS_RFC) {
      assert.isNotNull(
        verify(SECRET_RFC, code, { now: secondes * 1000 }),
        `Le vecteur RFC de T=${secondes} est refusé — le paramétrage a changé`
      )
    }
  })

  test('un code d’un autre pas de temps est refusé', ({ assert }) => {
    // Le vecteur de T=59 présenté à T=1234567890 : un code parfaitement bien formé, mais
    // périmé de vingt ans. Sans cette assertion, la précédente passerait même si la fenêtre
    // était infinie.
    assert.isNull(verify(SECRET_RFC, '287082', { now: 1234567890 * 1000 }))
  })

  test('la tolérance couvre un pas de part et d’autre, pas deux', ({ assert }) => {
    const now = 1_700_000_000_000

    // ±30 s : l'horloge du téléphone dérive, et recopier six chiffres prend du temps.
    assert.isNotNull(verify(SECRET_RFC, codeA(SECRET_RFC, now - 30_000), { now }))
    assert.isNotNull(verify(SECRET_RFC, codeA(SECRET_RFC, now + 30_000), { now }))

    // ⚠️ Et la borne, sans quoi « la fenêtre vaut 1 » ne serait pas prouvé : un test qui
    // n'accepte que des codes valides passerait aussi avec une fenêtre de 10.
    assert.isNull(verify(SECRET_RFC, codeA(SECRET_RFC, now - 61_000), { now }))
    assert.isNull(verify(SECRET_RFC, codeA(SECRET_RFC, now + 61_000), { now }))
  })

  test('un pas déjà consommé ne resert pas', ({ assert }) => {
    const now = 1_700_000_000_000
    const code = codeA(SECRET_RFC, now)

    const pas = verify(SECRET_RFC, code, { now })
    assert.isNotNull(pas)

    // ⚠️ **Le geste réel** : le même code, une seconde fois, avec le pas que la première
    // vérification a rendu. C'est ce que fait `TwoFactorService` après avoir enregistré
    // `totp_last_step` — sans cet anti-rejeu, un code intercepté resservirait 90 s durant.
    assert.isNull(verify(SECRET_RFC, code, { now, lastStep: pas }))
  })

  test('un code plus ancien que le dernier consommé est refusé, même valide', ({ assert }) => {
    const now = 1_700_000_000_000
    // Le code du pas précédent est dans la fenêtre, donc accepté en temps normal : ici il
    // arrive après que le pas courant a été consommé. Rejouer en arrière doit échouer aussi,
    // sinon l'anti-rejeu ne fermerait que la moitié de la fenêtre.
    const codePrecedent = codeA(SECRET_RFC, now - 30_000)

    assert.isNotNull(verify(SECRET_RFC, codePrecedent, { now }))
    assert.isNull(verify(SECRET_RFC, codePrecedent, { now, lastStep: currentStep(now) }))
  })

  test('un secret illisible refuse au lieu de lever', ({ assert }) => {
    // APP_KEY changée, ligne modifiée à la main : le déchiffrement rend n'importe quoi. Une
    // exception ici remonterait en 500 depuis le formulaire de connexion ; un refus est le
    // sens sûr — et `TwoFactorService` le distingue d'un « pas de TOTP » par ailleurs.
    assert.isNull(verify('pas-du-base32-!!', '000000', { now: Date.now() }))
    assert.isNull(verify('', '000000', { now: Date.now() }))
  })

  test('un secret neuf est utilisable et n’est jamais deux fois le même', ({ assert }) => {
    const secret = generateSecret()
    const now = Date.now()

    assert.isNotNull(verify(secret, codeA(secret, now), { now }))
    assert.notEqual(secret, generateSecret())
  })

  test('l’URI otpauth porte le compte, l’émetteur et le paramétrage', ({ assert }) => {
    const secret = generateSecret()
    const uri = otpauthUri(secret, 'alice@example.com')

    assert.isTrue(uri.startsWith('otpauth://totp/'))
    assert.include(uri, encodeURIComponent('alice@example.com'))
    assert.include(uri, `secret=${secret}`)
    // ⚠️ Ces trois paramètres sont ce que scanne le téléphone. Les omettre laisserait
    // l'application deviner — la plupart devinent juste, certaines non.
    assert.include(uri, 'algorithm=SHA1')
    assert.include(uri, 'digits=6')
    assert.include(uri, 'period=30')
  })
})
