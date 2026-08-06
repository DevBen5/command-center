import { test } from '@japa/runner'
import { DateTime } from 'luxon'
import { VaultKeyring } from '#modules/coffre/services/vault_keyring'
import { VAULT_UNLOCK_MINUTES } from '#modules/coffre/services/vault_session'

/**
 * Le trousseau en mémoire (CC-178) : où vit la clé pendant une session élevée.
 *
 * ⚠️ **Une instance neuve par test, jamais le singleton.** Le singleton est un état de process
 * partagé : le réutiliser ferait dépendre chaque test de l'ordre d'exécution, et un `open` laissé
 * par un test voisin rendrait l'un d'eux vert pour la mauvaise raison. C'est la raison d'être de
 * l'export nommé `VaultKeyring` à côté du singleton.
 */
test.group('Coffre / trousseau en mémoire', () => {
  const NOW = DateTime.fromISO('2026-08-06T10:00:00.000+02:00')
  const CLE = () => Buffer.alloc(32, 1)

  test('une clé rangée se retrouve par son pointeur', ({ assert }) => {
    const keyring = new VaultKeyring()
    const keyId = keyring.open(7, CLE(), NOW)

    assert.deepEqual(keyring.keyFor(keyId, 7, NOW), CLE())
  })

  test('deux ouvertures rendent deux pointeurs distincts', ({ assert }) => {
    // ⚠️ Le pointeur est tiré au sort, jamais dérivé du compte ni de la passphrase : dérivé, il
    // réapparaîtrait à l'identique et sa présence dans un cookie dirait quelque chose du secret.
    const keyring = new VaultKeyring()

    assert.notEqual(keyring.open(7, CLE(), NOW), keyring.open(7, CLE(), NOW))
  })

  test('elle expire à la même borne que le marqueur', ({ assert }) => {
    // ⚠️ La constante est **partagée** avec `vault_session.ts`. Deux TTL divergents laisseraient
    // une des deux moitiés ouverte : un marqueur encore valide devant une clé purgée donne un 403
    // incompréhensible, et l'inverse laisse une clé vivre sans que rien ne la réclame.
    const keyring = new VaultKeyring()
    const keyId = keyring.open(7, CLE(), NOW)

    const juste = NOW.plus({ minutes: VAULT_UNLOCK_MINUTES }).minus({ seconds: 1 })
    assert.isNotNull(keyring.keyFor(keyId, 7, juste))

    assert.isNull(keyring.keyFor(keyId, 7, NOW.plus({ minutes: VAULT_UNLOCK_MINUTES })))
  })

  test('le pointeur d’un compte n’ouvre pas la clé d’un autre', ({ assert }) => {
    const keyring = new VaultKeyring()
    const keyId = keyring.open(7, CLE(), NOW)

    assert.isNull(keyring.keyFor(keyId, 8, NOW))
  })

  test('un pointeur inconnu — le cas d’un redémarrage — rend null', ({ assert }) => {
    // C'est la propriété qu'on achète en gardant la clé hors du cookie : après un redémarrage,
    // le pointeur que porte le cookie ne désigne plus rien et le coffre est refermé.
    assert.isNull(new VaultKeyring().keyFor('pointeur-d-avant-le-redemarrage', 7, NOW))
  })

  test('verrouiller referme, et referme tout ce que le compte avait ouvert', ({ assert }) => {
    const keyring = new VaultKeyring()
    const premier = keyring.open(7, CLE(), NOW)
    const second = keyring.open(7, CLE(), NOW)
    const autreCompte = keyring.open(8, CLE(), NOW)

    keyring.closeAllFor(7)

    assert.isNull(keyring.keyFor(premier, 7, NOW))
    assert.isNull(keyring.keyFor(second, 7, NOW))
    // Fermer chez l'un ne ferme pas chez l'autre.
    assert.isNotNull(keyring.keyFor(autreCompte, 8, NOW))
  })

  test('close ne ferme que le pointeur visé', ({ assert }) => {
    const keyring = new VaultKeyring()
    const premier = keyring.open(7, CLE(), NOW)
    const second = keyring.open(7, CLE(), NOW)

    keyring.close(premier)

    assert.isNull(keyring.keyFor(premier, 7, NOW))
    assert.isNotNull(keyring.keyFor(second, 7, NOW))
  })

  test('la clé est écrasée quand on la lâche', ({ assert }) => {
    // Geste modeste et assumé : le ramasse-miettes ne promet pas quand il libérera le tampon,
    // et d'ici là ses octets restent lisibles dans un vidage mémoire. Le test tient parce qu'on
    // garde une référence sur le même Buffer que celui rangé.
    const keyring = new VaultKeyring()
    const cle = CLE()
    const keyId = keyring.open(7, cle, NOW)

    keyring.close(keyId)

    assert.deepEqual(cle, Buffer.alloc(32, 0))
  })
})
