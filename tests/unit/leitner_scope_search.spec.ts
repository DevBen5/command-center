import { test } from '@japa/runner'
import { filterScopes, type CategoryChoice } from '#modules/leitner/components/leitner_scope_search'

/**
 * Le filtrage de la barre de recherche de l'écran de choix est **du code pur** : ni
 * base, ni requête — l'arbre entier est déjà dans les props. C'est donc ici, et nulle
 * part ailleurs, qu'il se prouve : ce dépôt n'a aucun test de composant Vue, et ce
 * lot n'est pas le prétexte à trancher cette question.
 *
 * Ce que ces tests enterrent : un `toLowerCase().includes()` qui ne trouve jamais
 * « Sécurité » quand on tape `securite`.
 */
const CATEGORIES: CategoryChoice[] = [
  {
    id: 1,
    name: 'DevOps',
    dueCount: 5,
    themes: [
      { id: 10, name: 'Docker', dueCount: 3 },
      { id: 11, name: 'Kubernetes', dueCount: 2 },
      // « Linux » est AUSSI une catégorie, plus bas : c'est le cas réel qui rend un
      // thème affiché seul ambigu.
      { id: 12, name: 'Linux', dueCount: 0 },
    ],
  },
  {
    id: 2,
    name: 'Sécurité',
    dueCount: 4,
    themes: [{ id: 20, name: 'Cryptographie', dueCount: 4 }],
  },
  {
    id: 3,
    name: 'Linux',
    dueCount: 0,
    themes: [{ id: 30, name: 'Systemd', dueCount: 0 }],
  },
]

test.group('Leitner / recherche d’une portée', () => {
  test('taper `securite` trouve « Sécurité » — sans accent, sans casse', ({ assert }) => {
    // LE test du lot : personne ne tape les accents dans une barre de recherche.
    for (const query of ['securite', 'Sécurité', 'SECURITE', 'sÉcUrItE']) {
      const found = filterScopes(CATEGORIES, query).filter((match) => match.kind === 'category')

      assert.lengthOf(found, 1, `« ${query} » aurait dû trouver la catégorie`)
      assert.equal(found[0].categoryName, 'Sécurité')
      assert.equal(found[0].href, '/revision?category=2')
    }
  })

  test('un accent tapé trouve un nom sans accent — la normalisation va dans les deux sens', ({
    assert,
  }) => {
    const matches = filterScopes(CATEGORIES, 'dôckér')

    assert.lengthOf(matches, 1)
    assert.equal(matches[0].themeName, 'Docker')
  })

  test('taper `docker` trouve « DevOps · Docker » — le chemin, jamais le thème seul', ({
    assert,
  }) => {
    const matches = filterScopes(CATEGORIES, 'docker')

    assert.lengthOf(matches, 1)
    assert.deepInclude(matches[0], {
      kind: 'theme',
      categoryName: 'DevOps',
      themeName: 'Docker',
      dueCount: 3,
      href: '/revision?theme=10',
      selectable: true,
    })
  })

  test('taper `devops` propose la catégorie ET ses thèmes', ({ assert }) => {
    const matches = filterScopes(CATEGORIES, 'devops')

    // La catégorie d'abord, puis ses thèmes dans l'ordre du serveur.
    assert.deepEqual(
      matches.map((match) => [match.kind, match.themeName ?? match.categoryName]),
      [
        ['category', 'DevOps'],
        ['theme', 'Docker'],
        ['theme', 'Kubernetes'],
        ['theme', 'Linux'],
      ]
    )
  })

  test('la casse est indifférente', ({ assert }) => {
    const reference = filterScopes(CATEGORIES, 'docker')

    for (const query of ['DOCKER', 'DoCkEr', '  docker  ']) {
      assert.deepEqual(filterScopes(CATEGORIES, query), reference)
    }
  })

  test('une requête vide rend tout l’arbre — c’est ce que déplie le chevron', ({ assert }) => {
    for (const query of ['', '   ']) {
      const matches = filterScopes(CATEGORIES, query)

      // 3 catégories + 5 thèmes, aucune portée perdue en route.
      assert.lengthOf(matches, 8)
      assert.lengthOf(
        matches.filter((match) => match.kind === 'category'),
        3
      )
      assert.lengthOf(
        matches.filter((match) => match.kind === 'theme'),
        5
      )
    }
  })

  test('aucun résultat rend une liste vide — et rien d’autre', ({ assert }) => {
    assert.deepEqual(filterScopes(CATEGORIES, 'informatique quantique'), [])
  })

  test('une portée à 0 carte due est trouvée, mais marquée non sélectionnable', ({ assert }) => {
    const matches = filterScopes(CATEGORIES, 'linux')

    // Elle n'est pas masquée : disparaître ferait croire qu'elle n'existe pas.
    // La catégorie « Linux » ET le thème « DevOps · Linux », distingués par leur chemin.
    assert.deepEqual(
      matches.map((match) => [match.kind, match.categoryName, match.themeName, match.selectable]),
      [
        ['theme', 'DevOps', 'Linux', false],
        ['category', 'Linux', null, false],
        ['theme', 'Linux', 'Systemd', false],
      ]
    )
  })

  test('« sélectionnable » suit le compte dû, et lui seul', ({ assert }) => {
    for (const match of filterScopes(CATEGORIES, '')) {
      assert.equal(
        match.selectable,
        match.dueCount > 0,
        `« ${match.categoryName} · ${match.themeName} » : ${match.dueCount} due(s)`
      )
    }
  })

  test('chaque portée porte l’URL de sa session — jamais une route nouvelle', ({ assert }) => {
    for (const match of filterScopes(CATEGORIES, '')) {
      const expected =
        match.kind === 'category' ? /^\/revision\?category=\d+$/ : /^\/revision\?theme=\d+$/
      assert.match(match.href, expected)
    }
  })

  test('les clés de rendu sont uniques — une catégorie et un thème peuvent partager un id', ({
    assert,
  }) => {
    const keys = filterScopes(CATEGORIES, '').map((match) => match.key)

    assert.lengthOf(new Set(keys), keys.length)
  })
})
