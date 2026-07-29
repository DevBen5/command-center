import { describe, expect, test } from 'vitest'
import { i18n } from '../index'
import { namespaceFromPath } from '../messages'
import { countCalls, extractKeys } from './extract_keys'

/*
| Les clés i18n écrites dans les templates résolvent-elles dans l'instance que le boot construit ?
| (CC-113)
|
| Aucun exécuteur ne posait la question. Vitest bâtit une instance **locale** par spec
| (`createI18n({ messages: { fr: { dashboard: fr } } })`) : ça prouve qu'un composant sait lire *un*
| jeu de messages, pas celui de l'application. `messages.spec.ts` prouve la **fusion**, sur des
| entrées synthétiques — le vrai `import.meta.glob` n'y passe jamais. Japa ne voit que la charge
| utile des contrôleurs, jamais le rendu Vue. Conséquence : une clé mal orthographiée s'affichait en
| texte brut à l'écran (`dashboard.home.veille.titel`) et **rien ne rougissait**. Le `CLAUDE.md`
| racine dit vrai — « c'est visible, pas silencieux » — mais seulement pour qui ouvre la page.
|
| Ce spec est le seul endroit du dépôt qui touche l'instance **réelle** : il importe `../index`, donc
| le vrai glob s'exécute et la vraie fusion a lieu. Deux choses en découlent, et la seconde est un
| bonus : les clés sont vérifiées contre ce que l'application charge, et une collision de namespace
| — qui ferait lever au boot — est attrapée ici (voir le groupe « la fusion réelle », qui en fait un
| échec nommé plutôt qu'un plantage au chargement du fichier).
|
| ⚠️ **Ce qui n'est PAS couvert, et ne peut pas l'être ici :**
|
| 1. **Les clés calculées.** 20 sites du dépôt en portent, en deux familles : l'interpolation
|    (`t(`agents.status.${status}`)`, `t(`nav.${item.key}`)`) et la clé venue d'une variable
|    (`t(filter.labelKey)`, `t(p.labelKey)`, `t(urlLabelKey(source)!)` — dont les valeurs vivent en
|    constantes dans `app/modules/veille/shared/`). Aucune extraction statique ne les atteint. Les
|    faire passer pour couvertes serait pire que de les nommer.
| 2. **Le sens inverse** — une clé déclarée que plus aucun template n'utilise. Hors périmètre, et
|    pas seulement par choix de portée : les sites du point 1 consomment des clés que le balayage ne
|    voit pas, donc ce sens produirait des faux positifs indiscernables d'une vraie clé morte.
| 3. **`en.json`.** On vérifie `fr`, la locale de référence. Aucun module n'a d'`en.json` : la
|    fusion `en` ne porte que le châssis et tout le reste retombe sur `fr` via `fallbackLocale`.
|    C'est la dette « FR d'abord » documentée, pas une panne — l'assertion la ferait rougir sans
|    qu'aucun code ne soit en cause.
| 4. **Les paramètres d'interpolation.** `t('sidebar.host')` écrit sans `{ host }` affiche
|    `Hôte : {host}` à l'écran : clé valide, rendu faux. Même famille de panne, hors de portée.
| 5. **Le rendu.** Rien ici ne monte de page. jsdom ne fait aucun layout de toute façon —
|    l'apparence se vérifie au navigateur, et nulle part ailleurs.
|
| ⚠️ **Un `t('…')` écrit dans un commentaire est traité comme du code.** Assumé : un commentaire qui
| nomme une clé morte est faux, et le corriger est le bon geste. Deux commentaires d'`AppLayout.vue`
| citent `t(…)` aujourd'hui, aucun ne produit de clé (`t('nav.<key>')` porte des chevrons, il tombe
| donc du côté calculé).
*/

/**
 * Tous les `.vue` du dépôt, en source brute.
 *
 * ⚠️ **Deux globs, parce qu'il y a deux racines** — et le châssis n'est pas le moins exposé :
 * `AppLayout.vue` porte la barre latérale, la topbar et la palette, soit les libellés qu'on voit
 * sur *chaque* écran. Le ticket ne parlait que des pages de modules, ce qui aurait laissé la
 * topbar hors garde.
 *
 * ⚠️ **`?raw` court-circuite le plugin `vue()`** : on veut le fichier tel qu'il est écrit,
 * commentaires et branches non rendues comprises. C'est tout l'intérêt par rapport à « monter la
 * page et chercher un préfixe dans le rendu », qui exigerait des props valides pour 26 pages et ne
 * verrait que les branches effectivement parcourues.
 */
const SOURCES: Record<string, string> = {
  ...(import.meta.glob('/app/**/*.vue', {
    eager: true,
    query: '?raw',
    import: 'default',
  }) as Record<string, string>),
  ...(import.meta.glob('/inertia/**/*.vue', {
    eager: true,
    query: '?raw',
    import: 'default',
  }) as Record<string, string>),
}

/**
 * Les fichiers de traduction de modules, par le **même motif** que `index.ts`.
 *
 * Non-`eager` : seules les clés de la map — donc les chemins — nous intéressent. Le contenu, lui,
 * a déjà été chargé et fusionné par l'import de `../index`.
 */
const FICHIERS_MODULES = import.meta.glob('/app/**/i18n/fr.json')

/** Les messages français réellement construits au boot. */
const messagesFr = i18n.global.messages.value.fr as Record<string, unknown>

/** Chaque clé écrite en clair, avec le fichier qui l'écrit — l'attribution sert au message d'erreur. */
function clesEcrites(): { fichier: string; cle: string }[] {
  return Object.entries(SOURCES).flatMap(([fichier, source]) =>
    extractKeys(source).map((cle) => ({ fichier, cle }))
  )
}

describe('i18n / le balayage trouve réellement quelque chose', () => {
  /**
   * ⚠️ **C'est le test qui empêche tous les autres d'être décoratifs**, et le dépôt s'est déjà fait
   * prendre (CC-112). Un glob qui rend `{}` — racine changée dans `vitest.config.ts`, `?raw` cassé
   * par une montée de Vite, motif d'`include` modifié — donne `expect([]).toEqual([])`, vert pour
   * toujours, sur un dépôt dont plus aucune clé n'est vérifiée.
   *
   * Ce sont des **planchers**, jamais des comptes exacts : un compte exact rougirait à chaque page
   * ajoutée et serait retiré au troisième rouge. Et deux **ancrages nommés** en plus des nombres,
   * parce qu'un plancher global reste satisfait si l'un des deux globs meurt seul.
   *
   * **Vérifié en cassant le balayage** : les autres tests passent alors au vert en n'ayant rien
   * comparé. C'est ce test-là, et lui seul, qui rougit.
   */
  test('les deux globs rendent des fichiers, et on y trouve des clés', () => {
    const fichiers = Object.keys(SOURCES)

    expect(fichiers.length).toBeGreaterThanOrEqual(20)

    // Ancrage n° 1 : le glob du châssis. Sans lui, `inertia/**` pourrait mourir seul.
    expect(fichiers).toContain('/inertia/layouts/AppLayout.vue')

    // Ancrage n° 2 : le glob des modules, symétriquement.
    expect(fichiers.filter((chemin) => chemin.startsWith('/app/modules/')).length).toBeGreaterThan(
      0
    )

    // Et l'extraction elle-même : 26 fichiers lus dont on ne tirerait aucune clé serait le même
    // silence, un cran plus loin.
    expect(clesEcrites().length).toBeGreaterThanOrEqual(300)
  })

  /**
   * ⚠️ **La version corpus du mode d'échec « l'extracteur se rétrécit ».** Les tests d'extraction
   * plus bas tiennent chaque forme que j'ai su nommer ; celui-ci tient les autres. Une regex qui
   * cesserait de reconnaître une forme à laquelle personne n'a pensé ferait chuter le taux de
   * couverture sans rien casser d'autre — le plancher de 300 clés resterait satisfait.
   *
   * Un **taux**, pas un compte de sites calculés : ces derniers sont légitimes et peuvent se
   * multiplier (`t(`agents.status.${status}`)` est le bon code à cet endroit). 96 % aujourd'hui —
   * 475 clés littérales sur 495 sites ; le seuil laisse largement la place à quelques sites
   * calculés de plus, et rougit sur une extraction qui perd une forme entière.
   */
  test('l’extraction couvre la grande majorité des sites d’appel', () => {
    const appels = Object.values(SOURCES).reduce((total, source) => total + countCalls(source), 0)

    // Sur un balayage mort la division rend `0/0`, donc `NaN`, qui rougit bien — mais sur
    // « NaN n'est pas > 0.8 », un message qui envoie chercher la regex alors que c'est le glob qui
    // est cassé. Ce plancher-ci n'ajoute pas de couverture, il rend l'échec lisible.
    expect(appels).toBeGreaterThanOrEqual(300)

    // Un site d'appel ne peut pas porter deux clés littérales : l'inverse dirait que l'une des deux
    // regex compte autre chose que ce qu'elle croit.
    expect(clesEcrites().length).toBeLessThanOrEqual(appels)

    expect(clesEcrites().length / appels).toBeGreaterThan(0.8)
  })
})

describe('i18n / le prédicat de résolution', () => {
  /**
   * ⚠️ **Toute la garde repose sur ces trois lignes.** `te()` doit être faux pour une clé absente
   * **et** pour un nœud intermédiaire : sans la seconde propriété, `t('login')` — qui rendrait
   * `[object Object]` à l'écran — passerait au vert, et la garde se dégraderait en « le préfixe
   * existe » sans un seul rouge pour l'annoncer. C'est le genre de propriété qu'une montée de
   * `vue-i18n` peut changer sans que ce dépôt ait rien touché ; épinglée ici, elle ne peut plus
   * bouger en silence.
   */
  test('te() est vrai sur une feuille, faux sur un nœud et sur une clé absente', () => {
    expect(i18n.global.te('nav.accueil', 'fr')).toBe(true)
    expect(i18n.global.te('nav', 'fr')).toBe(false)
    expect(i18n.global.te('nav.cleQuiNExistePas', 'fr')).toBe(false)
  })
})

describe('i18n / la fusion réelle', () => {
  /**
   * Ce que `messages.spec.ts` ne peut **structurellement** pas prouver : il travaille sur des
   * entrées synthétiques, hors `import.meta.glob` — que seul un bundler résout. Ici le vrai motif
   * s'exécute, et on vérifie que chacun des fichiers qu'il ramasse a bien atterri sous son
   * namespace.
   *
   * ⚠️ **C'est aussi ce qui transforme une collision de namespace en échec nommé.** Une collision
   * fait lever `mergeModuleMessages` au boot, donc au chargement de ce fichier : le rouge serait un
   * spec qui ne démarre pas, illisible et qu'on lirait comme un test cassé. Le plancher ci-dessous
   * donne à cet échec un endroit et un message.
   */
  test('chaque i18n/fr.json de module a son namespace dans les messages fusionnés', () => {
    const chemins = Object.keys(FICHIERS_MODULES)

    expect(chemins.length).toBeGreaterThanOrEqual(5)

    const absents = chemins
      .map((chemin) => ({ chemin, namespace: namespaceFromPath(chemin) }))
      .filter(({ namespace }) => !(namespace in messagesFr))
      .map(({ chemin, namespace }) => `${namespace} — ${chemin} n'est pas dans les messages`)

    expect(absents).toEqual([])
  })

  test('le châssis survit à la fusion', () => {
    // L'autre moitié : un `mergeModuleMessages` qui écraserait sa base au lieu de s'y ajouter
    // laisserait le test ci-dessus parfaitement vert.
    expect(typeof messagesFr.nav).toBe('object')
    expect(typeof messagesFr.palette).toBe('object')
  })
})

describe('i18n / les clés écrites dans les templates', () => {
  /**
   * La garde. Chaque clé écrite en clair dans un `.vue` doit résoudre vers une chaîne dans
   * l'instance réelle.
   *
   * Le message porte le fichier : une clé fautive se corrige là où elle est écrite, et une clé
   * partagée par deux pages ne fait pas chercher dans la mauvaise.
   */
  test('chacune résout vers une chaîne dans l’instance réelle', () => {
    const manquantes = clesEcrites()
      .filter(({ cle }) => !i18n.global.te(cle, 'fr'))
      .map(({ cle, fichier }) => `${cle}  ←  ${fichier}`)

    expect([...new Set(manquantes)].sort()).toEqual([])
  })
})

describe('i18n / l’extraction des clés', () => {
  /**
   * ⚠️ **Une assertion par forme reconnue, et c'est le point.** Le plancher ci-dessus attrape une
   * extraction qui rend `[]` ; il n'attrape pas une extraction qui se **rétrécit** — une regex
   * « simplifiée » qui cesserait de reconnaître les guillemets doubles ferait passer le compte de
   * 475 à 460, resterait au-dessus du plancher, et laisserait sans garde tous les sites devenus
   * invisibles. Ici l'échec nomme la forme perdue.
   */
  test('reconnaît les trois guillemets et le préfixe $', () => {
    expect(extractKeys(`t('a.un')`)).toEqual(['a.un'])
    expect(extractKeys(`t("a.deux")`)).toEqual(['a.deux'])
    expect(extractKeys('t(`a.trois`)')).toEqual(['a.trois'])
    expect(extractKeys(`$t('a.quatre')`)).toEqual(['a.quatre'])
  })

  test('reconnaît la clé malgré un second argument', () => {
    // Les deux formes réellement utilisées : interpolation nommée, et pluralisation.
    expect(extractKeys(`t('sidebar.host', { host })`)).toEqual(['sidebar.host'])
    expect(extractKeys(`t('services.stats.down', n)`)).toEqual(['services.stats.down'])
  })

  test('reconnaît les deux clés d’un appel imbriqué', () => {
    // `AppLayout.vue` en écrit un : `t('palette.goTo', { label: t('nav.veille') })`.
    expect(extractKeys(`t('palette.goTo', { label: t('nav.veille') })`)).toEqual([
      'palette.goTo',
      'nav.veille',
    ])
  })

  test('reconnaît plusieurs clés sur plusieurs lignes', () => {
    // Le cas nominal d'un template : sans quoi une regex sans `g` passerait tous les tests ci-dessus.
    expect(extractKeys(`<p>{{ t('a.un') }}</p>\n<p>{{ t('a.deux') }}</p>`)).toEqual([
      'a.un',
      'a.deux',
    ])
  })

  test('ignore une clé calculée', () => {
    // La limite n° 1, prouvée plutôt qu'annoncée : ces sites sortent de l'extraction en silence,
    // c'est voulu, et c'est pour ça qu'ils sont nommés en tête de fichier.
    expect(extractKeys('t(`nav.${item.key}`)')).toEqual([])
    expect(extractKeys(`t(filter.labelKey)`)).toEqual([])
    expect(extractKeys(`t(urlLabelKey(source)!)`)).toEqual([])
  })

  test('ignore te(), qui teste précisément l’absence', () => {
    // `AppLayout.vue:144` s'en sert pour choisir entre `crumb` et `title` : une clé absente y est la
    // réponse normale, pas une faute. L'exiger ferait rougir un comportement correct.
    expect(extractKeys(`te('leitner.stats.crumb')`)).toEqual([])
  })

  test('ignore les identifiants qui finissent par un t', () => {
    expect(extractKeys(`it('un test')`)).toEqual([])
    expect(extractKeys(`prompt('a.un')`)).toEqual([])
    expect(extractKeys(`items.at('a.un')`)).toEqual([])
  })

  test('ignore une chaîne dont la clé n’est pas entière', () => {
    // Sans le `[,)]` final, la regex correspondrait sur `a.un`, et on assertirait une clé tronquée —
    // donc un rouge qui accuse le mauvais coupable au lieu d'un site simplement non couvert.
    expect(extractKeys(`t('a.un truc')`)).toEqual([])
  })

  test('countCalls voit les sites que extractKeys laisse passer', () => {
    const source = `t('a.un')\nt(\`nav.\${k}\`)\nt(variable)`

    expect(countCalls(source)).toBe(3)
    expect(extractKeys(source)).toEqual(['a.un'])
  })
})
