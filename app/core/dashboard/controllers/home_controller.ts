import { DateTime } from 'luxon'
import type { HttpContext } from '@adonisjs/core/http'
import Service from '#modules/services/models/service'
import Agent from '#modules/agents/models/agent'
import VeilleItem from '#modules/veille/models/veille_item'
import LeitnerCard from '#modules/leitner/models/leitner_card'
import { capabilitiesFor } from '#core/auth/services/capability_service'

/**
 * Le tableau de bord : un résumé par module, **réduit à ce que le lecteur a le droit de voir**.
 *
 * ⚠️ **Le filtrage est ici, pas dans `home.vue`.** Un `v-if` côté Vue laisserait les noms des
 * services arrêtés et des agents en échec dans le payload Inertia, lisibles dans le source de
 * la page : masquer n'est pas fermer, et c'est le serveur qui ferme. La page masque **aussi**,
 * pour ne pas afficher un cadre vide — les deux, jamais l'un sans l'autre (CC-81).
 *
 * ⚠️ Services et Agents sont réservés à `is_admin` et à rien d'autre, **précisément parce
 * qu'ils exécutent des commandes sur la machine hôte** (`AgentRunnerService`,
 * `SystemStatsService`). Le tableau de bord contournait cette frontière en publiant leurs noms
 * à quiconque portait `dashboard.view` : accorder cette capacité pour donner une page d'accueil
 * à un collègue ouvrait donc la fuite. C'est le piège que ce contrôleur ferme.
 *
 * ⚠️ Une section vaut `null` quand le lecteur n'y a pas accès — même convention que
 * `NavStatsService`, et pour la même raison : `null` se distingue d'un compteur à zéro, qui
 * veut dire « accès accordé, rien à signaler ».
 */
export default class HomeController {
  async index(ctx: HttpContext) {
    const { inertia, auth } = ctx
    const user = auth.getUserOrFail()
    const granted = await capabilitiesFor(ctx)
    const can = (capability: string) => user.isAdmin || granted.has(capability)

    const today = DateTime.now().startOf('day')

    // ⚠️ Les requêtes elles-mêmes sont conditionnées, pas seulement leur publication : ce qu'on
    // n'a pas le droit de voir n'est pas chargé du tout.
    const [services, agents, veille, leitner] = await Promise.all([
      user.isAdmin ? this.#services() : null,
      user.isAdmin ? this.#agents() : null,
      can('veille.view') ? this.#veille() : null,
      can('leitner.view') ? this.#leitner(today) : null,
    ])

    return inertia.render('core/dashboard/home', {
      cards: { services, agents, veille, leitner },
    })
  }

  async #services() {
    const services = await Service.all()

    return {
      up: services.filter((s) => s.status === 'up').length,
      total: services.length,
      down: services.filter((s) => s.status === 'down').map((s) => s.name),
      highRam: services
        .filter((s) => s.status === 'up' && (s.ramPercent ?? 0) >= 90)
        .map((s) => ({ name: s.name, ram: s.ramPercent })),
    }
  }

  async #agents() {
    const agents = await Agent.all()

    // ⚠️ On publie l'**id** en plus du nom pour que la carte d'accueil puisse pointer chaque agent
    // vers `/agents?id=<id>` (sa sélection + ses logs). L'id reste sous la même frontière que le
    // nom : `#agents()` n'est appelé que pour un `is_admin`, et `/agents` est `middleware.admin()`.
    return {
      active: agents.filter((a) => a.status === 'active').length,
      running: agents
        .filter((a) => a.status === 'running')
        .map((a) => ({ id: a.id, name: a.name })),
      failed: agents.filter((a) => a.status === 'failed').map((a) => ({ id: a.id, name: a.name })),
    }
  }

  async #veille() {
    const items = await VeilleItem.all()

    return {
      total: items.length,
      queue: items.filter((i) => i.readingQueue).length,
      untagged: items.filter((i) => i.tags.length === 0).length,
    }
  }

  async #leitner(today: DateTime) {
    const [due, total] = await Promise.all([
      LeitnerCard.query().where('next_review', '<=', today.toSQLDate()!),
      LeitnerCard.query()
        .count('* as total')
        .then((r) => Number(r[0].$extras.total)),
    ])

    return { due: due.length, total }
  }
}
