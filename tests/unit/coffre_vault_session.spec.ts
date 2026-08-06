import { test } from '@japa/runner'
import { DateTime } from 'luxon'
import {
  VAULT_UNLOCK_MINUTES,
  unlockMarkerFor,
  unlockedKeyId,
} from '#modules/coffre/services/vault_session'

/**
 * Le marqueur d'élévation du coffre (CC-178) — pur, testé sans passer par HTTP.
 *
 * Pendant exact de `two_factor_challenge`, avec deux conditions de plus : le compte et la
 * connexion. Chacune ferme un trou distinct, et chacune a son test ci-dessous.
 */
test.group('Coffre / marqueur d’élévation', () => {
  const NOW = DateTime.fromISO('2026-08-06T10:00:00.000+02:00')
  const LOGIN = NOW.minus({ hours: 2 }).toISO()!
  const USER = 7

  function marqueur(at: DateTime = NOW, userId = USER) {
    return unlockMarkerFor(userId, 'cle-abc', at)
  }

  test('un marqueur frais rend son pointeur de clé', ({ assert }) => {
    assert.equal(unlockedKeyId(marqueur(), USER, LOGIN, NOW), 'cle-abc')
  })

  test('il expire, et la borne est bien celle qui est déclarée', ({ assert }) => {
    const limite = NOW.minus({ minutes: VAULT_UNLOCK_MINUTES })

    // Juste en dessous : encore ouvert. Juste au-dessus : fermé. Tester loin des deux côtés
    // laisserait passer un `>=` mis pour un `>`, ou une constante devenue décorative.
    assert.equal(unlockedKeyId(marqueur(limite.plus({ seconds: 1 })), USER, LOGIN, NOW), 'cle-abc')
    assert.isNull(unlockedKeyId(marqueur(limite.minus({ seconds: 1 })), USER, LOGIN, NOW))
  })

  test('le marqueur d’un autre compte ne vaut rien', ({ assert }) => {
    // Le cookie est chiffré, donc infalsifiable — mais rien ne garantit qu'une session ne
    // change pas de compte : `auth.logout()` n'efface que la clé du guard, pas la session.
    assert.isNull(unlockedKeyId(marqueur(NOW, 99), USER, LOGIN, NOW))
  })

  test('⚠️ une élévation ne survit PAS à une reconnexion', ({ assert }) => {
    // Le trou que ce test ferme, et il est réel : `SessionGuard.logout()` fait un
    // `session.forget` sur SA seule clé. Sans la comparaison au tampon de connexion de CC-78,
    // ouvrir le coffre, se déconnecter, puis se reconnecter dans le quart d'heure rouvrirait
    // le coffre **sans passphrase**.
    const eleveAvant = marqueur(NOW.minus({ minutes: 5 }))
    const reconnexionApres = NOW.minus({ minutes: 1 }).toISO()!

    assert.isNull(unlockedKeyId(eleveAvant, USER, reconnexionApres, NOW))
    // La même élévation, sous la connexion qui l'a produite : elle vaut.
    assert.equal(
      unlockedKeyId(eleveAvant, USER, NOW.minus({ minutes: 10 }).toISO()!, NOW),
      'cle-abc'
    )
  })

  test('un tampon de connexion absent ou illisible ferme', ({ assert }) => {
    // ⚠️ Asymétrie voulue avec `isStampExpired`, qui tolère l'absence pour ne déconnecter
    // personne au déploiement : un marqueur d'élévation, lui, ne se pose qu'APRÈS une
    // connexion. Un tampon manquant devant un marqueur présent n'est pas un état légitime.
    assert.isNull(unlockedKeyId(marqueur(), USER, undefined, NOW))
    assert.isNull(unlockedKeyId(marqueur(), USER, 'pas-une-date', NOW))
  })

  test('un marqueur illisible est traité comme absent', ({ assert }) => {
    for (const valeur of [
      undefined,
      null,
      'coffre-ouvert',
      42,
      {},
      { userId: USER },
      { userId: USER, keyId: 'cle-abc' },
      { userId: USER, keyId: '', at: NOW.toISO() },
      { userId: '7', keyId: 'cle-abc', at: NOW.toISO() },
      { userId: USER, keyId: 'cle-abc', at: 'hier' },
    ]) {
      assert.isNull(
        unlockedKeyId(valeur, USER, LOGIN, NOW),
        `accepté à tort : ${JSON.stringify(valeur)}`
      )
    }
  })
})
