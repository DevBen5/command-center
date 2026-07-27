import { test } from '@japa/runner'
import {
  channelLabel,
  durationLabel,
  durationSecondsOf,
  immichHref,
  isMediaItem,
  mediaHref,
  thumbnailHref,
  type MediaItemView,
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

  /**
   * CC-88 — le repli de lien. `isMediaItem` répond vrai pour un `type: 'video'` **quelle que soit
   * sa provenance**, et la page demandait jusqu'ici un lien Immich : une vidéo YouTube affichait
   * donc sa vignette et n'ouvrait rien au clic.
   */
  test('ouvre un média YouTube sur son URL, faute de lien Immich', ({ assert }) => {
    const item: MediaItemView = {
      id: 7,
      type: 'video',
      immichAssetId: null,
      url: 'https://www.youtube.com/watch?v=dQw4w9WgXcQ',
      metadata: null,
    }

    assert.equal(
      mediaHref('https://immich.exemple.fr', item),
      'https://www.youtube.com/watch?v=dQw4w9WgXcQ'
    )
    // Immich non configuré ne change rien : ce n'est pas de lui que vient cet item.
    assert.equal(mediaHref(null, item), 'https://www.youtube.com/watch?v=dQw4w9WgXcQ')
  })

  /**
   * ⚠️ **L'ordre ne s'inverse pas.** Immich d'abord : ses items ont une `url` nulle par
   * conception, donc le repli ne peut pas leur voler leur lien — mais si la priorité était
   * inversée, un item Immich qui aurait une `url` pour une raison quelconque cesserait d'ouvrir
   * Immich, en silence.
   */
  test('garde le lien Immich pour un asset Immich', ({ assert }) => {
    const item: MediaItemView = {
      id: 8,
      type: 'image',
      immichAssetId: '219187d7-5320-498f-9c59-47a03bbdb491',
      url: null,
      metadata: null,
    }

    assert.equal(
      mediaHref('https://immich.exemple.fr', item),
      'https://immich.exemple.fr/photos/219187d7-5320-498f-9c59-47a03bbdb491'
    )
  })

  test('ne fabrique aucun lien quand il n’y a ni asset ni URL', ({ assert }) => {
    // Immich éteint sur un item Immich : la page retombe sur un titre non cliquable, pas sur un
    // lien mort qui a l'air d'un lien.
    assert.isNull(
      mediaHref(null, {
        id: 9,
        type: 'image',
        immichAssetId: '219187d7-5320-498f-9c59-47a03bbdb491',
        url: null,
        metadata: null,
      })
    )
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

  /**
   * CC-103 — le nom de chaîne. La valeur vient de `videoOwnerChannelTitle` et non de
   * `snippet.channelTitle`, qui rendrait le propriétaire de la playlist ; ce libellé est ce qui
   * rend ce piège de l'API visible à l'écran plutôt que constatable en base.
   */
  test('rend le nom de chaîne écrit par la collecte', ({ assert }) => {
    assert.equal(channelLabel({ channelTitle: 'Alex so yes' }), 'Alex so yes')
    // Les espaces de garde d'un titre recopié tel quel ne doivent pas décaler le séparateur.
    assert.equal(channelLabel({ channelTitle: '  Kameto Live  ' }), 'Kameto Live')
  })

  /**
   * ⚠️ **`null`, jamais `''`** : la page suspend le séparateur `·` au même `v-if` que le nom. Une
   * chaîne vide afficherait une puce sans rien après — le cas exact que ce repli existe pour
   * empêcher, et qui vaut pour tout item sans chaîne : un asset Immich, un article, une vidéo
   * collectée avant CC-87, ou une ligne éditée à la main.
   */
  test('ne rend rien plutôt qu’une chaîne vide', ({ assert }) => {
    assert.isNull(channelLabel({}))
    assert.isNull(channelLabel(null))
    assert.isNull(channelLabel({ channelTitle: '' }))
    assert.isNull(channelLabel({ channelTitle: '   ' }))
    assert.isNull(channelLabel({ channelTitle: 42 }))
    assert.isNull(channelLabel({ channelTitle: null }))
  })
})
