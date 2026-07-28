import { test } from '@japa/runner'
import {
  addTag,
  isValidTag,
  normalizeTag,
  parseTagInput,
  removeTag,
  TAGS_MAX,
  TAG_MAX_LENGTH,
} from '#modules/veille/shared/tags'

/**
 * CC-21 — ce qu'est un tag de veille, écrit une seule fois pour la page et le validateur.
 *
 * ⚠️ **Le mode d'échec que ces tests gardent est muet.** Un tag est un libellé affiché **et** un
 * paramètre d'URL, et le filtre est un `? = ANY(tags)` **exact** : `IA` et `ia` feraient deux
 * entrées dans la barre de tags et deux filtres qui ne se rejoignent jamais. Rien ne lèverait,
 * rien ne rougirait — l'utilisateur chercherait simplement pourquoi son filtre ne trouve rien.
 */
test.group('Veille / la forme d’un tag', () => {
  test('minuscules et espaces retirés', ({ assert }) => {
    assert.equal(normalizeTag('  IA  '), 'ia')
    assert.equal(normalizeTag('Self-Host'), 'self-host')
  })

  /**
   * ⚠️ Un espace interne devient un tiret plutôt qu'un refus : `#veille perso` s'afficherait comme
   * deux mots dans une pastille, et voyagerait encodé dans l'URL. La transformation est visible —
   * la page normalise à la frappe, donc la pastille montre `veille-perso` avant l'envoi.
   */
  test('les espaces internes deviennent des tirets, sans en empiler', ({ assert }) => {
    assert.equal(normalizeTag('veille perso'), 'veille-perso')
    assert.equal(normalizeTag('a   b'), 'a-b')
    assert.equal(normalizeTag('a - b'), 'a-b')
  })

  /**
   * ⚠️ **Les accents restent autorisés, et ce n'est pas un oubli.** Les quatre tags de la base
   * (`facebook`, `linkedin`, `tiktok`, `youtube`) viennent tous de `networkTagFor`, qui découpe
   * sur `[^a-z0-9]+` et ne peut structurellement produire que de l'ASCII. L'absence d'accent est
   * un artefact des collecteurs, pas une règle.
   */
  test('les accents passent', ({ assert }) => {
    assert.equal(normalizeTag('Sécurité'), 'sécurité')
    assert.equal(normalizeTag('à-lire'), 'à-lire')
  })

  test('les bordures de ponctuation sont rognées', ({ assert }) => {
    assert.equal(normalizeTag('-ia-'), 'ia')
    assert.equal(normalizeTag('__rust__'), 'rust')
  })

  test('ce qui ne donne rien d’exploitable rend null', ({ assert }) => {
    assert.isNull(normalizeTag(''))
    assert.isNull(normalizeTag('   '))
    assert.isNull(normalizeTag('---'))
    assert.isNull(normalizeTag('#'))
    assert.isNull(normalizeTag('!!!'))
  })

  test('la longueur est bornée', ({ assert }) => {
    const long = 'a'.repeat(TAG_MAX_LENGTH + 10)

    assert.lengthOf(normalizeTag(long)!, TAG_MAX_LENGTH)
    assert.isFalse(isValidTag(long))
    assert.isTrue(isValidTag('a'.repeat(TAG_MAX_LENGTH)))
  })

  /**
   * ⚠️ **`isValidTag` juge une valeur déjà normalisée** — c'est ce que reçoit le validateur, la
   * page ayant normalisé à la frappe. Il ne doit donc PAS accepter ce que `normalizeTag` corrige :
   * sinon le serveur laisserait passer un `IA` envoyé par un client forgé, et la barre de tags
   * porterait deux entrées pour une même idée.
   */
  test('le validateur ne repasse pas derrière la normalisation', ({ assert }) => {
    assert.isFalse(isValidTag('IA'))
    assert.isFalse(isValidTag('veille perso'))
    assert.isFalse(isValidTag(' ia'))
    assert.isFalse(isValidTag('-ia'))
    assert.isTrue(isValidTag('ia'))
    assert.isTrue(isValidTag('self-host'))
  })
})

test.group('Veille / une liste de tags', () => {
  test('la saisie libre se découpe, se normalise et se dédoublonne', ({ assert }) => {
    assert.deepEqual(parseTagInput('IA, rust,  IA '), ['ia', 'rust'])
  })

  /**
   * ⚠️ **La déduplication n'est pas du confort.** `tags` est un `text[]` sans contrainte : rien
   * n'empêche `{ia,ia}` en base, et le doublon ferait deux pastilles identiques sur la ligne
   * **et** compterait deux fois dans la barre de tags. Même invariant que celui que CC-109 devra
   * tenir avec `array_append`, qui ne déduplique pas non plus.
   */
  test('ajouter deux fois le même tag est sans effet', ({ assert }) => {
    const une = addTag([], 'ia')
    assert.deepEqual(addTag(une, 'ia'), ['ia'])
    // Et la normalisation compte dans la comparaison : `IA` est déjà là.
    assert.deepEqual(addTag(une, 'IA'), ['ia'])
  })

  /**
   * ⚠️ **L'ordre de saisie est conservé.** Trier alphabétiquement réordonnerait les pastilles à
   * chaque ajout, et on perdrait le fil de ce qu'on vient de poser.
   */
  test('l’ordre de saisie est conservé', ({ assert }) => {
    assert.deepEqual(parseTagInput('rust, ia, docker'), ['rust', 'ia', 'docker'])
  })

  test('un tag inexploitable laisse la liste intacte', ({ assert }) => {
    assert.deepEqual(addTag(['ia'], '   '), ['ia'])
    assert.deepEqual(addTag(['ia'], '###'), ['ia'])
  })

  test('le plafond tient des deux côtés', ({ assert }) => {
    const pleine = Array.from({ length: TAGS_MAX }, (_, index) => `tag${index}`)

    assert.deepEqual(addTag(pleine, 'nouveau'), pleine)
    assert.lengthOf(
      parseTagInput(Array.from({ length: 40 }, (_, i) => `t${i}`).join(',')),
      TAGS_MAX
    )
  })

  test('retirer un tag ne touche pas les autres', ({ assert }) => {
    assert.deepEqual(removeTag(['ia', 'rust', 'docker'], 'rust'), ['ia', 'docker'])
    assert.deepEqual(removeTag(['ia'], 'absent'), ['ia'])
  })
})
