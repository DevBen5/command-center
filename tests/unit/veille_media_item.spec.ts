import { test } from '@japa/runner'
import {
  durationLabel,
  durationSecondsOf,
  immichHref,
  isMediaItem,
  thumbnailHref,
} from '#modules/veille/shared/media_item'

/**
 * CC-55 — la logique média de `pages/index.vue`, sortie du `<script setup>` (règle CC-60).
 *
 * ⚠️ Ce que ce test ne voit **pas** : le template, et les enveloppes d'une ligne de la page. La
 * vignette réellement affichée, le lien réellement cliquable et le badge « plus dans l'album » se
 * vérifient au navigateur — `index.vue` n'a pas de test de composant.
 */
test.group('Veille / logique média de la page', () => {
  test('distingue un média d’un article', ({ assert }) => {
    assert.isTrue(isMediaItem('image'))
    assert.isTrue(isMediaItem('video'))
    assert.isFalse(isMediaItem('article'))
    assert.isFalse(isMediaItem('bookmark'))
    assert.isFalse(isMediaItem('note'))
  })

  test('pointe la vignette sur notre proxy, avec l’id d’item', ({ assert }) => {
    // ⚠️ L'id d'item, **jamais** l'identifiant Immich : une route indexée par l'identifiant
    // d'asset serait un proxy de lecture ouvert sur toute la bibliothèque personnelle.
    assert.equal(thumbnailHref(42), '/veille/items/42/thumbnail')
  })

  test('construit le lien Immich à l’affichage', ({ assert }) => {
    assert.equal(
      immichHref('https://immich.exemple.fr', '219187d7-5320-498f-9c59-47a03bbdb491'),
      'https://immich.exemple.fr/photos/219187d7-5320-498f-9c59-47a03bbdb491'
    )
  })

  test('ne fabrique pas de lien quand il manque une moitié', ({ assert }) => {
    // Immich non configuré, ou item qui n'en vient pas : le template retombe sur un titre non
    // cliquable. Un `https://null/photos/null` serait un lien mort qui a l'air d'un lien.
    assert.isNull(immichHref(null, '219187d7-5320-498f-9c59-47a03bbdb491'))
    assert.isNull(immichHref('https://immich.exemple.fr', null))
    assert.isNull(immichHref(null, null))
  })

  test('formate une durée comme un lecteur vidéo', ({ assert }) => {
    assert.equal(durationLabel({ durationSeconds: 64 }), '1:04')
    assert.equal(durationLabel({ durationSeconds: 723 }), '12:03')
    assert.equal(durationLabel({ durationSeconds: 3723 }), '1:02:03')
    // Les secondes sont toujours sur deux chiffres — `1:4` se lirait comme une erreur.
    assert.equal(durationLabel({ durationSeconds: 61 }), '1:01')
  })

  test('n’affiche aucune durée quand il n’y en a pas', ({ assert }) => {
    // Une image n'en a pas ; un item collecté avant ce lot n'a pas le champ du tout. Dans les
    // deux cas la page ne doit rien afficher, pas « 0:00 ».
    assert.isNull(durationLabel({ durationSeconds: 0 }))
    assert.isNull(durationLabel({}))
    assert.isNull(durationLabel(null))
    assert.isNull(durationLabel({ durationSeconds: '64' }))
    assert.isNull(durationSecondsOf({ durationSeconds: Number.NaN }))
  })
})
