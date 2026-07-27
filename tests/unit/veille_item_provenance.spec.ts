import { test } from '@japa/runner'
import {
  itemProvenance,
  rememberedSourceTitle,
  type ProvenanceItemView,
  type ProvenanceSourceView,
} from '#modules/veille/shared/item_provenance'

/**
 * CC-104 — « d'où vient cet item », sorti du `<script setup>` (règle CC-60) **et** du contrôleur :
 * la fonction est pure, `VeilleController.serialize` l'appelle, le template n'en garde que deux
 * enveloppes d'une ligne.
 *
 * ⚠️ Ce que ce test ne voit **pas** : la pastille. Ni sa couleur, ni sa position, ni le fait
 * qu'elle tienne sur la ligne. jsdom ne fait aucun layout et Japa ne rend aucun template — ça se
 * vérifie au navigateur, et nulle part ailleurs.
 */

const RSS: ProvenanceSourceView = { id: 5, title: 'Korben- Full', kind: 'rss' }
const IMMICH: ProvenanceSourceView = { id: 4, title: 'Immich — album de veille', kind: 'immich' }
const YOUTUBE: ProvenanceSourceView = { id: 6, title: 'Playlist Veille', kind: 'youtube' }
const SOURCES = [RSS, IMMICH, YOUTUBE]

/** Un item collecté par défaut : c'est le cas majoritaire, les autres s'en écartent d'un champ. */
function item(attrs: Partial<ProvenanceItemView> = {}): ProvenanceItemView {
  return {
    veilleSourceId: RSS.id,
    dedupKey: 'url:https://exemple.dev/article',
    metadata: {},
    ...attrs,
  }
}

test.group('Veille / provenance d’un item', () => {
  test('une source vivante donne son titre, non traduit', ({ assert }) => {
    const provenance = itemProvenance(item(), SOURCES)

    assert.equal(provenance.origin, 'source')
    assert.equal(provenance.sourceKind, 'rss')
    // ⚠️ `labelKey` nul est ce qui dit au template « affiche `text` tel quel » : un titre de
    // source vient de la base et n'a aucune clé i18n. Le confondre avec le cas orphelin ferait
    // chercher une traduction qui n'existe pas, donc afficher la clé brute à l'écran.
    assert.isNull(provenance.labelKey)
    assert.equal(provenance.text, 'Korben- Full')
  })

  test('le `kind` suit la source, pas le type de l’item', ({ assert }) => {
    // C'est lui qui colore la pastille : un asset Immich et une vidéo YouTube sont tous deux des
    // items `video`, seule la source les distingue.
    assert.equal(itemProvenance(item({ veilleSourceId: IMMICH.id }), SOURCES).sourceKind, 'immich')
    assert.equal(
      itemProvenance(item({ veilleSourceId: YOUTUBE.id }), SOURCES).sourceKind,
      'youtube'
    )
  })

  test('sans source ET sans clé de dédup, c’est une saisie à la main', ({ assert }) => {
    const provenance = itemProvenance(item({ veilleSourceId: null, dedupKey: null }), SOURCES)

    assert.equal(provenance.origin, 'manual')
    assert.isNull(provenance.sourceKind)
    assert.equal(provenance.labelKey, 'veille.index.provenance.manual')
    assert.isNull(provenance.text)
  })

  /**
   * ⚠️ **Les deux cas orphelins ne diffèrent que par `text`.** N'asserter que `labelKey` laisserait
   * passer une implémentation qui rendrait toujours la même clé, et l'écran afficherait
   * « Source supprimée — {source} » avec le placeholder nu. D'où deux assertions, séparées.
   */
  test('détaché mais collecté : la source est supprimée, et on la nomme', ({ assert }) => {
    const provenance = itemProvenance(
      item({
        veilleSourceId: null,
        dedupKey: 'url:https://news.ycombinator.com/item?id=1',
        metadata: { sourceTitle: 'Hacker News (horaire)' },
      }),
      SOURCES
    )

    assert.equal(provenance.origin, 'orphan')
    assert.isNull(provenance.sourceKind)
    assert.equal(provenance.labelKey, 'veille.index.provenance.deletedNamed')
    assert.equal(provenance.text, 'Hacker News (horaire)')
  })

  test('détaché sans titre mémorisé : on le dit quand même', ({ assert }) => {
    const provenance = itemProvenance(
      item({ veilleSourceId: null, dedupKey: 'guid:3:abc', metadata: {} }),
      SOURCES
    )

    assert.equal(provenance.origin, 'orphan')
    assert.equal(provenance.labelKey, 'veille.index.provenance.deleted')
    assert.isNull(provenance.text)
  })

  /**
   * Inatteignable aujourd'hui — la FK est `ON DELETE SET NULL`, donc un id non nul désigne une
   * source vivante, et `index` les charge toutes sans filtre sur `active`. Un `where('active',
   * true)` ajouté plus tard le rendrait atteignable **en une ligne**, et CC-65 parle justement
   * d'afficher l'état des sources désactivées dans cette barre.
   */
  test('un id de source introuvable retombe sur l’orphelin, jamais sur le vide', ({ assert }) => {
    const provenance = itemProvenance(
      item({ veilleSourceId: 999, metadata: { sourceTitle: 'Blog Rust (intervalle)' } }),
      SOURCES
    )

    assert.equal(provenance.origin, 'orphan')
    assert.equal(provenance.text, 'Blog Rust (intervalle)')
  })

  test('une liste de sources vide ne fait pas mentir la pastille', ({ assert }) => {
    // Le cas du tout premier chargement, avant qu'aucune source n'existe : les captures manuelles
    // doivent rester des captures manuelles.
    const manuel = itemProvenance(item({ veilleSourceId: null, dedupKey: null }), [])

    assert.equal(manuel.origin, 'manual')
  })
})

/**
 * ⚠️ `metadata` est du `jsonb` : son contenu dépend de la version qui a écrit la ligne, et une
 * ligne éditée à la main peut y porter n'importe quoi. Sans ces contrôles, la pastille afficherait
 * `Source supprimée — [object Object]`.
 */
test.group('Veille / le titre de source mémorisé', () => {
  test('rend le titre quand il est exploitable', ({ assert }) => {
    assert.equal(rememberedSourceTitle({ sourceTitle: 'Hacker News' }), 'Hacker News')
    assert.equal(rememberedSourceTitle({ sourceTitle: '  Blog Rust  ' }), 'Blog Rust')
  })

  test('rend null sur tout ce qui n’est pas un texte utilisable', ({ assert }) => {
    assert.isNull(rememberedSourceTitle(null))
    assert.isNull(rememberedSourceTitle({}))
    assert.isNull(rememberedSourceTitle({ sourceTitle: '' }))
    assert.isNull(rememberedSourceTitle({ sourceTitle: '   ' }))
    assert.isNull(rememberedSourceTitle({ sourceTitle: 42 }))
    assert.isNull(rememberedSourceTitle({ sourceTitle: { nom: 'Hacker News' } }))
  })

  test('un titre inexploitable fait retomber sur la pastille anonyme', ({ assert }) => {
    // La conséquence de l'assertion ci-dessus, à l'endroit qui compte : on n'affiche pas
    // « Source supprimée — » avec un tiret orphelin.
    const provenance = itemProvenance(
      {
        veilleSourceId: null,
        dedupKey: 'url:https://exemple.dev/x',
        metadata: { sourceTitle: 42 },
      },
      []
    )

    assert.equal(provenance.labelKey, 'veille.index.provenance.deleted')
    assert.isNull(provenance.text)
  })
})
