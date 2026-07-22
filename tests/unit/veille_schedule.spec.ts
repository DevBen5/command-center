import { test } from '@japa/runner'
import { DateTime, IANAZone } from 'luxon'
import veilleConfig from '#config/veille'
import VeilleSource from '#modules/veille/models/veille_source'

/**
 * CC-59 — l'horaire mural, pendant unitaire de `veille_interval.spec.ts`.
 *
 * `isDue()` accepte déjà une horloge (`isDue(now = DateTime.now())`) : tout se teste ici, sans
 * base ni réseau. C'est le seul filet du lot — le rendu de `sources.vue` n'a aucun test de
 * composant dans ce dépôt.
 *
 * ⚠️ La propriété que le lot achète n'est pas « collecter à 7h », c'est **collecter à 7h le
 * septième jour aussi**. Un intervalle y arrive le premier jour et dérive ensuite ; c'est ce que
 * le groupe « dérive » compare côte à côte.
 */

const ZONE = veilleConfig.timezone

/** Une date lue dans le fuseau de l'application — celui dans lequel « 7h » veut dire 7h. */
function local(iso: string): DateTime {
  return DateTime.fromISO(iso, { zone: ZONE })
}

function makeSource(attrs: Partial<VeilleSource>): VeilleSource {
  const source = new VeilleSource()
  source.active = true
  source.fetchIntervalMinutes = 60
  source.lastFetchedAt = null
  source.dailyAt = null
  Object.assign(source, attrs)
  return source
}

function daily(at: string, lastFetchedAt: DateTime | null = null): VeilleSource {
  return makeSource({ scheduleMode: 'daily', dailyAt: at, lastFetchedAt })
}

/**
 * La boucle du planificateur, en accéléré : un tick par minute, et `lastFetchedAt` avancé à
 * chaque collecte comme le fait `markSuccess`.
 *
 * `lagMinutes` modélise une collecte **en retard** — serveur redémarré, passe lente, garde
 * `running` qui saute un tick. C'est la seule façon de faire apparaître la dérive : sans retard,
 * un intervalle ne dérive pas non plus.
 */
function runScheduler(
  source: VeilleSource,
  from: DateTime,
  to: DateTime,
  lagMinutes = 0
): string[] {
  const fired: string[] = []

  for (let tick = from; tick <= to; tick = tick.plus({ minutes: 1 })) {
    if (source.isDue(tick)) {
      fired.push(tick.setZone(ZONE).toFormat('dd/MM HH:mm'))
      source.lastFetchedAt = tick.plus({ minutes: lagMinutes })
    }
  }

  return fired
}

test.group('Veille / horaire — la fenêtre du jour', () => {
  test('pas due avant l’heure, due juste après, plus due une fois collectée', ({ assert }) => {
    const source = daily('07:00', local('2026-02-09T07:00'))

    assert.isFalse(source.isDue(local('2026-02-10T06:59')), 'due une minute trop tôt')
    assert.isTrue(source.isDue(local('2026-02-10T07:00')), 'pas due à l’heure pile')
    assert.isTrue(source.isDue(local('2026-02-10T07:01')), 'pas due une minute après')

    // La collecte a eu lieu : la fenêtre du jour est consommée.
    source.lastFetchedAt = local('2026-02-10T07:01')
    assert.isFalse(source.isDue(local('2026-02-10T07:02')), 'recollectée dans la même fenêtre')
    assert.isFalse(source.isDue(local('2026-02-10T23:59')), 'recollectée le soir même')
  })

  /**
   * Le second membre de `isDue()` (`lastFetchedAt < window`) existe pour ça, et **rien d'autre**
   * ne le remplace : sans lui, une source horaire serait recollectée à chaque tick une fois
   * l'heure passée — 1020 collectes entre 7h et minuit.
   */
  test('deux ticks consécutifs après l’heure ne déclenchent qu’UNE collecte', ({ assert }) => {
    const source = daily('07:00', local('2026-02-09T07:00'))
    const fired = runScheduler(source, local('2026-02-10T00:00'), local('2026-02-10T23:59'))

    assert.deepEqual(fired, ['10/02 07:00'])
  })

  test('le passage de minuit ne rend pas la source due deux fois', ({ assert }) => {
    const source = daily('07:00', local('2026-02-09T07:00'))
    const fired = runScheduler(source, local('2026-02-10T00:00'), local('2026-02-12T23:59'))

    assert.deepEqual(fired, ['10/02 07:00', '11/02 07:00', '12/02 07:00'])
  })

  test('une heure du jour autre que le matin se comporte pareil', ({ assert }) => {
    const source = daily('23:30', local('2026-02-09T23:30'))
    const fired = runScheduler(source, local('2026-02-10T00:00'), local('2026-02-11T23:59'))

    assert.deepEqual(fired, ['10/02 23:30', '11/02 23:30'])
  })
})

test.group('Veille / horaire — le fuseau', () => {
  /**
   * ⚠️ **Le test qui attrape la régression silencieuse n° 1.**
   *
   * `TZ=UTC` dans ce dépôt : sans `setZone`, `isDue()` lirait « 7h » comme 7h UTC, soit 8h ou 9h
   * à Paris selon la saison. La collecte aurait bien lieu — simplement pas quand l'écran le dit,
   * et **rien ne le signalerait**.
   *
   * Le cas ci-dessous ne passe que si la fenêtre est bien située dans le fuseau de
   * l'application : 06:30 UTC, c'est 07:30 à Paris en février. Lu en UTC, `06:30 < 07:00` ferait
   * répondre « pas due ».
   */
  test('la fenêtre est située dans le fuseau de l’app, pas dans celui du process', ({ assert }) => {
    assert.equal(veilleConfig.timezone, 'Europe/Paris', 'ce test suppose le fuseau par défaut')

    const source = daily('07:00', local('2026-02-09T07:00'))
    const nowUtc = DateTime.fromISO('2026-02-10T06:30', { zone: 'utc' })

    assert.equal(nowUtc.setZone(ZONE).toFormat('HH:mm'), '07:30', 'la prémisse du test a bougé')
    assert.isTrue(source.isDue(nowUtc), '« 7h » a été lu en UTC')

    // Et le pendant : 05:30 UTC (= 06:30 à Paris) est bien AVANT la fenêtre.
    assert.isFalse(source.isDue(DateTime.fromISO('2026-02-10T05:30', { zone: 'utc' })))
  })

  /**
   * ⚠️ **Ce que `config/veille.ts` empêche, et pourquoi son `throw` doit rester.**
   *
   * Un nom presque juste (`'Paris'` au lieu de `'Europe/Paris'`) ne lève rien chez Luxon : il rend
   * un DateTime **invalide**, et toute comparaison avec un invalide est fausse — **les deux
   * membres** de `isDue()` répondent `false`. La source ne serait donc plus jamais collectée,
   * sans erreur ni log, dans une boucle que personne ne regarde.
   *
   * Ce test ne vérifie pas la garde (elle est à l'import de la config, hors de portée d'ici) : il
   * pin le **mécanisme** qui la justifie. S'il cessait d'être vrai, on saurait que le `throw` peut
   * être rediscuté. Tant qu'il l'est, le remplacer par un repli silencieux éteindrait la veille.
   */
  test('un fuseau invalide rend toute comparaison fausse — d’où le refus de démarrer', ({
    assert,
  }) => {
    assert.isFalse(IANAZone.isValidZone('Paris'), 'Luxon accepte désormais « Paris »')

    const now = local('2026-02-10T09:00')
    const broken = now.setZone('Paris')

    assert.isFalse(broken.isValid, 'un fuseau invalide ne rend plus un DateTime invalide')

    // Les deux membres de `isDue()`, avec une fenêtre construite sur ce fuseau : tout est faux.
    const window = broken.set({ hour: 7, minute: 0, second: 0, millisecond: 0 })
    assert.isFalse(now >= window, 'now >= window')
    assert.isFalse(now.minus({ days: 1 }) < window, 'lastFetchedAt < window')
  })

  test('l’horloge passée peut être dans n’importe quel fuseau, le résultat ne change pas', ({
    assert,
  }) => {
    const instant = local('2026-02-10T07:30')

    for (const zone of ['utc', 'Europe/Paris', 'America/New_York', 'Asia/Tokyo']) {
      const source = daily('07:00', local('2026-02-09T07:00'))
      assert.isTrue(source.isDue(instant.setZone(zone)), `horloge en ${zone}`)
    }
  })

  /**
   * Les changements d'heure. Le 29 mars 2026, Paris saute 02:00 → 03:00 ; le 25 octobre, 02:00
   * se produit deux fois. Une source ne doit collecter qu'une fois par jour dans les deux cas.
   */
  test('le passage à l’heure d’été ne saute ni ne double la collecte', ({ assert }) => {
    const source = daily('07:00', local('2026-03-27T07:00'))
    const fired = runScheduler(source, local('2026-03-28T00:00'), local('2026-03-30T23:59'))

    assert.deepEqual(fired, ['28/03 07:00', '29/03 07:00', '30/03 07:00'])
  })

  test('le retour à l’heure d’hiver ne double pas la collecte', ({ assert }) => {
    const source = daily('07:00', local('2026-10-23T07:00'))
    const fired = runScheduler(source, local('2026-10-24T00:00'), local('2026-10-26T23:59'))

    assert.deepEqual(fired, ['24/10 07:00', '25/10 07:00', '26/10 07:00'])
  })

  /**
   * L'heure qui **n'existe pas** ce jour-là : 02:30 est sautée le 29 mars. Luxon la décale vers
   * l'avant plutôt que de rendre une date invalide — la source collecte donc une fois, en
   * retard d'une heure, au lieu de disparaître pour la journée.
   */
  test('une heure inexistante le jour du changement ne fait pas sauter la collecte', ({
    assert,
  }) => {
    const source = daily('02:30', local('2026-03-28T02:30'))
    const fired = runScheduler(source, local('2026-03-29T00:00'), local('2026-03-29T23:59'))

    assert.lengthOf(fired, 1, 'la journée du changement d’heure a perdu sa collecte')
  })
})

test.group('Veille / horaire — la dérive, et ce qui l’empêche', () => {
  /**
   * **La propriété que le lot achète.** Chaque collecte prend une heure de retard ; l'horaire
   * mural se réancre sur le jour courant, donc le retard ne s'accumule pas.
   */
  test('une collecte en retard d’une heure ne décale pas celle du lendemain', ({ assert }) => {
    const source = daily('07:00', local('2026-02-09T08:00'))
    const fired = runScheduler(
      source,
      local('2026-02-10T00:00'),
      local('2026-02-16T23:59'),
      60 // chaque collecte se termine une heure après avoir été déclenchée
    )

    assert.deepEqual(fired, [
      '10/02 07:00',
      '11/02 07:00',
      '12/02 07:00',
      '13/02 07:00',
      '14/02 07:00',
      '15/02 07:00',
      '16/02 07:00',
    ])
  })

  /**
   * Le même scénario en mode intervalle, pour montrer **ce qu'on corrige** : « tous les jours »
   * y devient 14h en une semaine. Ce n'est pas un bug de la branche intervalle — c'est ce qu'un
   * intervalle veut dire. D'où le second mode plutôt qu'un réglage de plus.
   */
  test('le même retard, en mode intervalle, dérive d’une heure par jour', ({ assert }) => {
    const source = makeSource({
      scheduleMode: 'interval',
      fetchIntervalMinutes: 1440,
      lastFetchedAt: local('2026-02-09T08:00'),
    })
    const fired = runScheduler(source, local('2026-02-10T00:00'), local('2026-02-16T23:59'), 60)

    assert.deepEqual(fired, [
      '10/02 08:00',
      '11/02 09:00',
      '12/02 10:00',
      '13/02 11:00',
      '14/02 12:00',
      '15/02 13:00',
      '16/02 14:00',
    ])
  })

  /**
   * La fenêtre manquée : machine éteinte à 7h, rallumée à 9h. On **rattrape** — pour un
   * agrégateur, sauter revient à perdre une journée de flux. La décision est tranchée ici, pas
   * laissée au hasard de l'implémentation.
   */
  test('une fenêtre manquée est rattrapée, pas sautée', ({ assert }) => {
    const source = daily('07:00', local('2026-02-09T07:00'))

    assert.isTrue(source.isDue(local('2026-02-10T09:00')), 'la fenêtre manquée a été sautée')

    // Et le rattrapage ne décale pas le lendemain : c'est toujours 7h.
    source.lastFetchedAt = local('2026-02-10T09:00')
    const fired = runScheduler(source, local('2026-02-11T00:00'), local('2026-02-11T23:59'))
    assert.deepEqual(fired, ['11/02 07:00'])
  })

  /**
   * Un redémarrage relance une passe immédiate (`startScheduler`). En logique d'intervalle, une
   * source horaire y serait due à chaque démarrage ; ici la fenêtre du jour est déjà consommée.
   */
  test('un redémarrage à 10h ne rejoue pas la collecte de 7h', ({ assert }) => {
    const source = daily('07:00', local('2026-02-10T07:00'))

    assert.isFalse(source.isDue(local('2026-02-10T10:00')))
    assert.isFalse(source.isDue(local('2026-02-10T18:00')))
  })
})

test.group('Veille / horaire — la source neuve et les cas dégradés', () => {
  /**
   * Une source ajoutée à 14h collecte **tout de suite**, puis s'aligne. Sans ça, on ajoute un
   * flux sans aucun moyen de savoir s'il fonctionne avant le lendemain matin.
   */
  test('une source jamais collectée est due immédiatement, puis s’aligne', ({ assert }) => {
    const source = daily('07:00', null)

    assert.isTrue(source.isDue(local('2026-02-10T14:00')), 'la source neuve a attendu demain')

    source.lastFetchedAt = local('2026-02-10T14:00')
    assert.isFalse(source.isDue(local('2026-02-10T14:01')), 'recollectée juste après')

    const fired = runScheduler(source, local('2026-02-11T00:00'), local('2026-02-11T23:59'))
    assert.deepEqual(fired, ['11/02 07:00'], 'la source ne s’est pas alignée sur l’horaire')
  })

  test('une source désactivée n’est jamais due, quel que soit le mode', ({ assert }) => {
    const source = daily('07:00', local('2026-02-09T07:00'))
    source.active = false

    assert.isFalse(source.isDue(local('2026-02-10T07:30')))
  })

  /**
   * ⚠️ **Le repli, et pourquoi il ne rend pas `false`.**
   *
   * La contrainte `veille_sources_schedule_check` rend ce cas inatteignable. S'il survenait
   * malgré tout, refuser figerait la source pour toujours — sans erreur, sans log, dans une
   * boucle de fond que personne ne regarde. Une source qui collecte à la mauvaise cadence se
   * voit ; une source qui ne collecte plus, non.
   */
  test('un mode horaire sans heure retombe sur l’intervalle, il ne fige pas la source', ({
    assert,
  }) => {
    for (const broken of [null, '', 'sept heures', '25:00', '07:60']) {
      const source = makeSource({
        scheduleMode: 'daily',
        dailyAt: broken,
        fetchIntervalMinutes: 60,
        lastFetchedAt: local('2026-02-10T07:00'),
      })

      assert.isFalse(source.isDue(local('2026-02-10T07:30')), `dailyAt=${broken} : due trop tôt`)
      assert.isTrue(source.isDue(local('2026-02-10T08:00')), `dailyAt=${broken} : source figée`)
    }
  })
})

test.group('Veille / horaire — non-régression du mode intervalle', () => {
  /**
   * Le mode historique doit se comporter **exactement** comme avant CC-59, y compris quand
   * `scheduleMode` n'a jamais été renseigné : le défaut est en base, pas sur le modèle, donc une
   * instance créée sans ce champ le laisse `undefined` en mémoire. `isDue()` teste `=== 'daily'`
   * et non `=== 'interval'` précisément pour ça.
   */
  test('une source sans scheduleMode suit la branche historique', ({ assert }) => {
    const source = makeSource({
      fetchIntervalMinutes: 60,
      lastFetchedAt: local('2026-02-10T07:00'),
    })

    assert.isUndefined(source.scheduleMode, 'la prémisse du test a bougé')
    assert.isFalse(source.isDue(local('2026-02-10T07:59')))
    assert.isTrue(source.isDue(local('2026-02-10T08:00')))
  })

  test('une source jamais collectée reste due immédiatement', ({ assert }) => {
    assert.isTrue(makeSource({ scheduleMode: 'interval' }).isDue(local('2026-02-10T03:00')))
  })

  test('la cadence en minutes est toujours celle qui s’applique', ({ assert }) => {
    const source = makeSource({
      scheduleMode: 'interval',
      fetchIntervalMinutes: 2880,
      lastFetchedAt: local('2026-02-10T07:00'),
    })

    assert.isFalse(source.isDue(local('2026-02-11T07:00')), '2 jours ne valent pas 1 jour')
    assert.isTrue(source.isDue(local('2026-02-12T07:00')))
  })

  test('une heure résiduelle est ignorée en mode intervalle', ({ assert }) => {
    // La contrainte l'interdit en base ; si elle arrivait, le mode reste ce qui décide.
    const source = makeSource({
      scheduleMode: 'interval',
      dailyAt: '07:00',
      fetchIntervalMinutes: 60,
      lastFetchedAt: local('2026-02-10T07:00'),
    })

    assert.isFalse(source.isDue(local('2026-02-10T07:30')), 'l’heure a pris le pas sur le mode')
    assert.isTrue(
      source.isDue(local('2026-02-10T08:00')),
      'la cadence en minutes ne s’applique plus'
    )
  })
})
