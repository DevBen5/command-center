import { IANAZone } from 'luxon'
import env from '#start/env'

/**
 * Le fuseau dans lequel s'interprète une collecte à heure fixe (CC-59).
 *
 * ⚠️ **Ce n'est pas `TZ`, et ça ne le remplace pas.** Les deux répondent à des questions
 * différentes :
 *
 * - `TZ` (UTC dans ce dépôt) est le fuseau du **process**. `veille_sources.last_fetched_at` est
 *   un `timestamp without time zone` : il est écrit et relu dans ce fuseau-là. Le changer ferait
 *   dériver l'interprétation de toutes les lignes déjà en base.
 * - `APP_TIMEZONE` ne sert qu'à situer la **fenêtre horaire** d'une source en mode `daily` :
 *   « 7h » veut dire 7h ici, pas 7h UTC.
 *
 * Sans cette séparation, « 7h » saisi à Paris se déclencherait à 9h l'été et 8h l'hiver — et
 * **rien ne le signalerait** : la collecte a bien lieu, simplement pas quand on croit.
 *
 * Le fuseau est celui de l'application, épinglé une fois : ni par source, ni par utilisateur.
 * Il vit dans la config du module parce que la veille en est le seul consommateur aujourd'hui ;
 * si un second module en a besoin, il remonte — le nom de la variable l'anticipe déjà.
 */

const configured = env.get('APP_TIMEZONE') ?? 'Europe/Paris'

/**
 * ⚠️ **La validation est ici, et elle lève.** C'est le mode d'échec que cette variable
 * introduit, et il est silencieux : `DateTime.setZone('Paris')` — un nom presque juste — rend un
 * DateTime **invalide**, et toute comparaison avec un invalide est fausse. `isDue()` répondrait
 * donc `false` à chaque tick, indéfiniment : la source se tairait pour toujours, sans une erreur
 * ni une ligne de log.
 *
 * Refuser de démarrer est le seul endroit où l'échec a un lecteur. Dans la boucle de fond, il
 * n'en a aucun.
 */
if (!IANAZone.isValidZone(configured)) {
  throw new Error(
    `APP_TIMEZONE="${configured}" n'est pas un fuseau IANA valide (attendu : « Europe/Paris », ` +
      `« UTC »…). Sans fuseau valide, les sources de veille en mode horaire ne seraient plus ` +
      `jamais collectées, et rien ne le signalerait.`
  )
}

const veilleConfig = {
  timezone: configured,
}

export default veilleConfig
