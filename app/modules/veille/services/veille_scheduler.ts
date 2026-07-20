import app from '@adonisjs/core/services/app'
import logger from '@adonisjs/core/services/logger'
import VeilleCollectorService from '#modules/veille/services/veille_collector_service'

/**
 * Le déclenchement automatique de la collecte.
 *
 * Ce projet n'a **aucune infrastructure de job** — pas de file, pas de worker. Le module Leitner
 * a résolu le même problème par une tâche de fond dans le processus, démarrée par un provider :
 * c'est ce pattern qu'on reprend, plutôt que d'en inventer un second.
 *
 * Une différence assumée avec Leitner : **aucun statut « en cours » n'est persisté**, donc rien à
 * balayer au démarrage. Une passe interrompue par un redémarrage n'a rien laissé de sale — la
 * collecte est idempotente par construction (contrainte d'unicité sur `dedup_key`), elle sera
 * simplement rejouée au tick suivant. Un `sweepInterrupted` ici serait du code sans objet.
 */

/**
 * On regarde toutes les minutes **quelles sources sont dues**, on ne collecte pas tout à chaque
 * fois : la cadence réelle est portée par `fetch_interval_minutes`, source par source.
 */
const TICK_MS = 60_000

let timer: ReturnType<typeof setInterval> | null = null

/**
 * Garde anti-chevauchement. Une passe lente ne doit pas se superposer à la suivante, ni à un
 * rafraîchissement manuel déclenché au même moment.
 *
 * ⚠️ Elle vit **en mémoire** : elle suppose une seule instance du serveur. À plusieurs, deux
 * processus feraient le travail en double — sans rien corrompre pour autant, c'est la contrainte
 * d'unicité en base qui garantit l'absence de doublon, pas ce booléen.
 */
let running = false

async function tick(): Promise<void> {
  if (running) {
    logger.debug('Veille : passe précédente encore en cours, tick ignoré.')
    return
  }

  running = true
  try {
    const collector = await app.container.make(VeilleCollectorService)
    const outcomes = await collector.collectDue()

    const failed = outcomes.filter((outcome) => !outcome.ok)
    const inserted = outcomes.reduce((total, outcome) => total + outcome.inserted, 0)

    if (outcomes.length > 0) {
      logger.info(
        `Veille : ${outcomes.length} source(s) collectée(s), ${inserted} item(s) nouveau(x), ` +
          `${failed.length} en échec.`
      )
    }
  } catch (error) {
    // `collectSource` écrit déjà chaque échec de flux en base. Ici, c'est la passe elle-même
    // qui a lâché (base coupée, conteneur indisponible) : il ne reste que le log — mais un
    // `catch {}` muet ferait mourir la collecte sans que rien ne le dise.
    logger.error({ err: error }, 'Veille : la passe de collecte a échoué.')
  } finally {
    running = false
  }
}

/** Démarre la boucle. Idempotent : un second appel ne crée pas un second timer. */
export function startScheduler(): void {
  if (timer !== null) return

  timer = setInterval(() => {
    void tick()
  }, TICK_MS)

  // Sans `unref`, ce timer suffit à retenir le processus : `node ace` ne rendrait plus la main
  // et un arrêt propre attendrait la fin du monde.
  timer.unref()

  // Une première passe immédiate : au démarrage, les sources jamais collectées sont dues, et
  // attendre une minute pour s'en apercevoir n'apporte rien.
  void tick()
}

/** Arrête la boucle. Appelé au `shutdown()` du provider. */
export function stopScheduler(): void {
  if (timer === null) return
  clearInterval(timer)
  timer = null
}
