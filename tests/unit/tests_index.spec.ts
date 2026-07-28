import { test } from '@japa/runner'
import { existsSync, readdirSync, readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

/**
 * L'index de tests d'un module dit ce que sa suite couvre (CC-112).
 *
 * Le `CLAUDE.md` de chaque module envoie lire son `TESTS.md` « avant de modifier un test ».
 * Rien ne tenait cette promesse : celui de veille a accumulé **huit fichiers absents sur six
 * tickets** pendant que `lint`, `typecheck`, les 799 tests et `npm run build` restaient verts.
 * Un index périmé ne casse pas, il **ment** — et il ment précisément à la personne qui s'apprête
 * à toucher aux tests, c'est-à-dire à celle à qui les entrées manquent.
 *
 * ⚠️ **Cette garde asserte la MENTION, jamais l'exactitude.** Un fichier cité par une phrase
 * devenue fausse passe au vert. C'est la même limite que `db_seeders.spec.ts`, qui asserte la
 * liste *déclarée* et non l'*effet* : elle attrape l'oubli, pas la péremption d'une description.
 * La qualité d'une entrée n'est pas automatisable, et prétendre le contraire serait pire que de
 * ne rien faire.
 *
 * ⚠️ **Seuls les modules qui ont un `TESTS.md` sont couverts** — veille et leitner. `services` et
 * `agents` n'en ont pas, donc `app/modules/services/pages/__tests__/index.spec.ts` n'est indexé
 * nulle part et cette garde ne le dit pas. Étendre la règle à un module sans index reviendrait à
 * exiger d'en créer un : un élargissement à assumer, pas à découvrir au premier rouge. Le jour où
 * un module écrit son `TESTS.md`, il entre seul dans les trois assertions ci-dessous.
 *
 * ⚠️ `app/core/**` et `inertia/**` sont hors périmètre pour la même raison, et parce qu'aucune
 * convention de préfixe n'y rattache une spec à quoi que ce soit : les balayer à moitié donnerait
 * une garde qui *paraît* couvrir.
 *
 * ⚠️ **La règle de rattachement ne balaie que `tests/unit/` et `tests/functional/modules/`.** Une
 * spec de module rangée dans `tests/functional/core/` ou `tests/functional/auth/` **et** nommée
 * sans préfixe échappe donc aux deux sens à la fois : le premier ne la reconnaît pas, la seconde
 * ne la regarde pas. Il faut les deux erreurs ensemble — mauvais dossier *et* mauvais nom — et
 * fermer ce cas ferait passer `SPECS_TRANSVERSES` de 8 à 18 entrées, pour lui seul. Limite
 * assumée, nommée ici plutôt que laissée à découvrir : la liste ci-dessus se lirait sinon comme
 * exhaustive.
 *
 * Suite `unit` parce que cette garde ne lit que le disque — ni routeur, ni registre, ni base.
 * C'est l'inverse exact de `navigation_registry.spec.ts`, qui doit vivre en `functional` :
 * `router.toJSON()` et le registre de destinations ne sont peuplés qu'au démarrage du serveur.
 */

const ROOT = fileURLToPath(new URL('../../', import.meta.url))

/**
 * Les deux dossiers **partagés** où les specs de tous les modules cohabitent, et où le préfixe du
 * nom de fichier est donc la seule chose qui rattache une spec à son module.
 */
const DOSSIERS_PARTAGES = ['tests/unit', 'tests/functional/modules']

/**
 * Les specs de ces dossiers qui n'appartiennent **délibérément** à aucun module.
 *
 * ⚠️ Cette liste est le prix de l'assertion « une spec porte un préfixe de module » : sans elle,
 * la garde exigerait de renommer des fichiers transverses pour les faire entrer de force dans un
 * module. Avec elle, une spec sans préfixe reste possible — mais devient une **décision nommée**
 * plutôt qu'un fichier que plus aucun index ne réclame.
 */
const SPECS_TRANSVERSES = [
  'tests/unit/capability_service.spec.ts', // le noyau des capacités
  'tests/unit/db_dumps.spec.ts', // la logique de sauvegarde de `scripts/lib/`
  'tests/unit/db_seeders.spec.ts', // la liste des seeders déclarés
  'tests/unit/declared_capability_middleware.spec.ts', // le middleware, pas un module
  'tests/unit/env_isolation.spec.ts', // Immich, YouTube ET le LLM de Leitner (CC-101)
  'tests/unit/tests_index.spec.ts', // ce fichier
  'tests/unit/user_seeder.spec.ts', // le premier compte (CC-75)
  'tests/functional/modules/pages.spec.ts', // toutes les pages de tous les modules
]

/** Les chemins de spec cités dans un `TESTS.md`, relatifs au dépôt.
 *
 * ⚠️ **Le `/` est exigé, et c'est ce qui laisse vivre la prose.** Les index se citent l'un
 * l'autre par nom nu — « pendant exact de `leitner_llm_url.spec.ts` » en tête de celui de veille.
 * Une regex qui accepterait le nom seul ferait de cette phrase une citation, donc de l'index de
 * veille le domicile d'une spec de leitner.
 */
const CITATION = /(?:tests|app|inertia)\/[\w./-]*\.spec\.ts/g

/** Les specs sous un dossier, relatives au dépôt, séparateurs normalisés en `/`.
 *
 * ⚠️ **`readdirSync` rend des `\` sous Windows.** Sans cette normalisation, la comparaison avec
 * les chemins cités (écrits en `/` dans le Markdown) échouerait sur un poste et pas sur l'autre.
 */
function specsSous(dossier: string): string[] {
  if (!existsSync(`${ROOT}${dossier}`)) return []

  return readdirSync(`${ROOT}${dossier}`, { recursive: true })
    .map((entree) => String(entree).replaceAll('\\', '/'))
    .filter((chemin) => chemin.endsWith('.spec.ts'))
    .map((chemin) => `${dossier}/${chemin}`)
    .sort()
}

/** Tous les modules, lus sur le disque — jamais une liste en dur, qui périmerait au premier ajout. */
function tousLesModules(): string[] {
  return readdirSync(`${ROOT}app/modules`, { withFileTypes: true })
    .filter((entree) => entree.isDirectory())
    .map((entree) => entree.name)
    .sort()
}

/** Ceux qui portent un index, et ceux-là seuls. */
function modulesIndexes(): string[] {
  return tousLesModules().filter((nom) => existsSync(`${ROOT}app/modules/${nom}/TESTS.md`))
}

/** Tout ce qu'un module doit citer : ses specs de `tests/`, et ses tests de composant. */
function specsDuModule(module: string): string[] {
  const prefixees = specsSous('tests').filter((chemin) =>
    chemin.split('/').at(-1)!.startsWith(`${module}_`)
  )

  return [...prefixees, ...specsSous(`app/modules/${module}`)].sort()
}

function citations(module: string): string[] {
  const index = readFileSync(`${ROOT}app/modules/${module}/TESTS.md`, 'utf8')

  return [...new Set(index.match(CITATION) ?? [])].sort()
}

test.group('Core / index de tests des modules', () => {
  /**
   * ⚠️ **C'est le test qui empêche les trois suivants d'être décoratifs.** Un balayage qui ne
   * trouve rien rend `assert.deepEqual([], [])`, donc vert — le mode d'échec de toute garde bâtie
   * sur un glob. Ce sont des **planchers**, jamais des comptes exacts : un compte exact rougirait
   * à chaque spec ajoutée, et serait retiré au troisième rouge.
   *
   * **Vérifié en cassant le balayage** : les trois autres tests passent alors au vert, tous les
   * trois, en n'ayant rien comparé. C'est ce test-là, et lui seul, qui rougit.
   */
  test('le balayage trouve réellement des fichiers', ({ assert }) => {
    const modules = modulesIndexes()

    assert.isAtLeast(modules.length, 2, 'Aucun module indexé trouvé — le balayage est cassé')

    for (const module of modules) {
      assert.isAtLeast(
        specsSous('tests').filter((chemin) => chemin.split('/').at(-1)!.startsWith(`${module}_`))
          .length,
        1,
        `Aucune spec préfixée « ${module}_ » sous tests/ — le balayage est cassé`
      )
    }

    // Le second balayage, celui des tests de composant. Il est vérifié **globalement** et non
    // module par module : un module peut légitimement n'en avoir aucun, alors qu'aucun ne peut
    // être trouvé si le glob est cassé.
    const composants = modules.flatMap((module) => specsSous(`app/modules/${module}`))

    assert.isAtLeast(composants.length, 1, 'Aucun test de composant trouvé — le balayage est cassé')
  })

  test('chaque fichier de test d’un module est cité dans son TESTS.md', ({ assert }) => {
    // ⚠️ Chaque module est lu contre **son** fichier. Concaténer les index laisserait une spec de
    // veille citée chez leitner passer au vert — l'index cesserait de décrire sa propre suite.
    const absents = modulesIndexes().flatMap((module) => {
      const citees = citations(module)

      return specsDuModule(module)
        .filter((chemin) => !citees.includes(chemin))
        .map((chemin) => `${chemin} — absent de app/modules/${module}/TESTS.md`)
    })

    assert.deepEqual(absents, [], 'Des fichiers de test ne sont cités par aucun index')
  })

  test('chaque chemin cité par un TESTS.md existe sur le disque', ({ assert }) => {
    // L'autre moitié du mensonge, au même coût : une entrée qui survit au renommage ou à la
    // suppression de son fichier décrit une couverture qui n'existe plus.
    const fantomes = modulesIndexes().flatMap((module) =>
      citations(module)
        .filter((chemin) => !existsSync(`${ROOT}${chemin}`))
        .map((chemin) => `${chemin} — cité par app/modules/${module}/TESTS.md, absent du disque`)
    )

    assert.deepEqual(fantomes, [], 'Des index citent des fichiers qui n’existent plus')
  })

  test('chaque spec des dossiers partagés se rattache à un module ou est déclarée transverse', ({
    assert,
  }) => {
    // ⚠️ **Le préfixe est la seule chose qui rattache une spec à son module** dans ces deux
    // dossiers. Sans cette assertion, une spec de veille nommée `rss_parser.spec.ts` échapperait
    // à la garde ci-dessus **sans que ça se voie** : elle n'appartiendrait à aucun module, donc
    // aucun index ne la réclamerait. ⚠️ Les préfixes viennent de **tous** les modules, pas
    // seulement de ceux qui ont un index : une spec de `services` correctement préfixée est
    // rattachée, elle n'est simplement réclamée par personne tant que le module n'écrit pas
    // son `TESTS.md`.
    const prefixes = tousLesModules().map((module) => `${module}_`)

    const orphelines = DOSSIERS_PARTAGES.flatMap(specsSous)
      .filter((chemin) => !SPECS_TRANSVERSES.includes(chemin))
      .filter(
        (chemin) => !prefixes.some((prefixe) => chemin.split('/').at(-1)!.startsWith(prefixe))
      )

    assert.deepEqual(
      orphelines,
      [],
      'Specs sans préfixe de module : renomme-les, ou déclare-les dans SPECS_TRANSVERSES'
    )
  })
})
