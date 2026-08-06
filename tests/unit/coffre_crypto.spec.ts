import { test } from '@japa/runner'
import {
  decrypt,
  deriveKey,
  encrypt,
  generateSalt,
  sealVerifier,
  verifyKey,
} from '#modules/coffre/services/vault_crypto'

/**
 * Le chiffrement au repos du coffre (CC-178) — du code pur, sans base ni requête.
 *
 * ⚠️ **Ce que ces tests prouvent n'est PAS « on relit ce qu'on a écrit »** : cet aller-retour
 * réussirait même sans chiffrement du tout. Ce qui compte ici est ce qui **échoue** — une
 * mauvaise clé refusée par le tag, un chiffré qui ne porte pas le clair, deux IV distincts.
 * La preuve que la base ne porte pas de clair, elle, est ailleurs : `coffre_storage.spec.ts`
 * lit la colonne brute.
 */
test.group('Coffre / chiffrement', () => {
  const PASSPHRASE = 'une passphrase de coffre'

  test('aller-retour : la même passphrase et le même sel rendent le clair', ({ assert }) => {
    const salt = generateSalt()
    const key = deriveKey(PASSPHRASE, salt)

    assert.equal(decrypt(encrypt('mot de passe wifi', key), key), 'mot de passe wifi')
  })

  test('le chiffré ne contient pas le clair', ({ assert }) => {
    const key = deriveKey(PASSPHRASE, generateSalt())

    // ⚠️ Le clair est cherché **et** en base64 : un « ça ne contient pas la chaîne » naïf
    // passerait au vert sur un encodage qui n'est pas un chiffrement.
    const payload = encrypt('identifiant-bancaire', key)

    assert.notInclude(payload, 'identifiant-bancaire')
    assert.notInclude(payload, Buffer.from('identifiant-bancaire').toString('base64'))
  })

  test('deux chiffrements du même clair diffèrent — l’IV est tiré au sort à chaque écriture', ({
    assert,
  }) => {
    // ⚠️ La propriété qui compte : sous GCM, réutiliser un couple (clé, IV) ne dégrade pas la
    // confidentialité « un peu », il la détruit. Deux chiffrés identiques signeraient un IV
    // devenu constant — et rien d'autre dans la suite ne le dirait.
    const key = deriveKey(PASSPHRASE, generateSalt())

    assert.notEqual(encrypt('même clair', key), encrypt('même clair', key))
  })

  test('une clé qui n’est pas la bonne rend null, jamais du bruit', ({ assert }) => {
    const salt = generateSalt()
    const payload = encrypt('secret', deriveKey(PASSPHRASE, salt))

    assert.isNull(decrypt(payload, deriveKey('une autre passphrase', salt)))
    // Le même secret sous un autre sel donne une autre clé : c'est le rôle du sel.
    assert.isNull(decrypt(payload, deriveKey(PASSPHRASE, generateSalt())))
  })

  test('un chiffré altéré est refusé par le tag d’authentification', ({ assert }) => {
    const key = deriveKey(PASSPHRASE, generateSalt())
    const [iv, tag, ciphertext] = encrypt('secret', key).split('.')

    // Un octet retourné dans le corps : sans authentification, AES rendrait du bruit sans
    // broncher. C'est `final()` qui lève, et c'est ce qu'on veut.
    const altere = Buffer.from(ciphertext, 'base64')
    altere[0] ^= 0xff

    assert.isNull(decrypt([iv, tag, altere.toString('base64')].join('.'), key))
  })

  test('une charge malformée rend null au lieu de lever', ({ assert }) => {
    const key = deriveKey(PASSPHRASE, generateSalt())

    // Une ligne éditée à la main, une colonne tronquée : le contrôleur doit recevoir un refus,
    // pas une exception qui remonterait en 500 au milieu d'une liste.
    assert.isNull(decrypt('', key))
    assert.isNull(decrypt('pas.une.charge-valide', key))
    assert.isNull(decrypt('deux.parties', key))
  })

  test('le témoin ne s’ouvre qu’avec la clé du coffre', ({ assert }) => {
    const salt = generateSalt()
    const verifier = sealVerifier(deriveKey(PASSPHRASE, salt))

    assert.isTrue(verifyKey(verifier, deriveKey(PASSPHRASE, salt)))
    assert.isFalse(verifyKey(verifier, deriveKey('presque la bonne', salt)))
  })

  test('un témoin illisible refuse, il n’ouvre pas', ({ assert }) => {
    // ⚠️ Le sens de l'échec est ce qui compte : une ligne corrompue doit **fermer** le coffre.
    // Un `verifyKey` qui rendrait `true` faute de savoir déchiffrer serait exactement la
    // régression que ce test attrape.
    assert.isFalse(verifyKey('valeur.non.chiffree', deriveKey(PASSPHRASE, generateSalt())))
  })

  test('deux sels tirés de suite diffèrent', ({ assert }) => {
    assert.notEqual(generateSalt(), generateSalt())
  })
})
