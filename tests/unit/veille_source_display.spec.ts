import { test } from '@japa/runner'
import { sourceUrlLabelKey } from '#modules/veille/shared/source_display'

/**
 * CC-89 — ce que `sources.vue` affiche à la place de l'`url` d'une source auto-provisionnée.
 *
 * ⚠️ Ce que ce test ne voit **pas** : le rendu. Que le libellé s'affiche réellement, et à la bonne
 * place, se vérifie au navigateur — `sources.vue` n'a pas de test de composant.
 */
test.group('Veille / libellé d’une source', () => {
  test('remplace l’identifiant des sources auto-provisionnées', ({ assert }) => {
    assert.equal(sourceUrlLabelKey('immich'), 'veille.sources.immichAlbum')
    assert.equal(sourceUrlLabelKey('youtube'), 'veille.sources.youtubePlaylist')
  })

  /**
   * ⚠️ **Le repli montre l'`url`, il ne masque pas.** Une provenance ajoutée sans sa clé affichera
   * son identifiant brut : moche, mais lisible et diagnostiquable d'un coup d'œil. Un repli qui
   * cacherait la ligne — ou qui rendrait une clé inventée, donc du texte brut à l'écran — laisserait
   * un blanc sans que personne sache de quelle source il s'agit.
   */
  test('laisse l’url visible pour un flux, et pour une provenance inconnue', ({ assert }) => {
    assert.isNull(sourceUrlLabelKey('rss'))
    assert.isNull(sourceUrlLabelKey('une-provenance-a-venir'))
    assert.isNull(sourceUrlLabelKey(''))
  })

  /**
   * ⚠️ Les clés rendues doivent exister dans `app/modules/veille/i18n/fr.json`, sinon la page
   * affiche leur chemin en texte brut. C'est visible, donc pas silencieux — mais autant l'attraper
   * ici plutôt qu'à l'écran.
   */
  test('les clés rendues existent dans le fichier de traduction', async ({ assert }) => {
    // ⚠️ Lu sur le disque, pas importé par l'alias `#modules/*` : celui-ci vise des `.js` qui
    // n'existent qu'après un build, et un `import` de JSON n'y résout rien.
    const { readFile } = await import('node:fs/promises')
    const raw = await readFile(
      new URL('../../app/modules/veille/i18n/fr.json', import.meta.url),
      'utf8'
    )
    const sources = (JSON.parse(raw) as Record<string, Record<string, string>>).sources

    for (const kind of ['immich', 'youtube']) {
      const key = sourceUrlLabelKey(kind)!
      const leaf = key.replace('veille.sources.', '')

      assert.property(sources, leaf, `la clé « ${key} » manque dans i18n/fr.json`)
    }
  })
})
