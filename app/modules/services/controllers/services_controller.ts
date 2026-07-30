import type { HttpContext } from '@adonisjs/core/http'
import dockerConfig from '#config/docker'
import Service from '#modules/services/models/service'
import SystemStatsService from '#modules/services/services/system_stats_service'

export default class ServicesController {
  async index({ inertia }: HttpContext) {
    // Sans Docker (config/docker.ts, CC-116), on n'envoie RIEN : des statuts lus en base
    // seraient les conteneurs imaginaires que ce ticket supprime. La page n'affiche alors
    // que la bannière « hors service » — les stats à zéro ne sont jamais rendues.
    if (!dockerConfig.disponible) {
      return inertia.render('modules/services/index', {
        dockerDisponible: false,
        services: [],
        stats: { total: 0, up: 0, down: 0, cpuAvg: 0, ramAvg: 0 },
      })
    }

    const services = await Service.query().orderBy('category').orderBy('name')

    const up = services.filter((s) => s.status === 'up')
    const stats = {
      total: services.length,
      up: up.length,
      down: services.filter((s) => s.status === 'down').length,
      cpuAvg: up.length
        ? Math.round(up.reduce((sum, s) => sum + (s.cpuPercent ?? 0), 0) / up.length)
        : 0,
      ramAvg: up.length
        ? Math.round(up.reduce((sum, s) => sum + (s.ramPercent ?? 0), 0) / up.length)
        : 0,
    }

    return inertia.render('modules/services/index', { dockerDisponible: true, services, stats })
  }

  // ⚠️ Hors service, les trois actions ne font RIEN — « masquer un bouton n'est pas un
  // droit » : sans cette garde, un POST direct (curl + cookie de session) continuerait de
  // fabriquer des statuts inventés en base. Le flag est lu à chaque requête, jamais
  // destructuré à l'import (couture du test fonctionnel).

  async start({ params, response }: HttpContext) {
    if (!dockerConfig.disponible) return response.redirect().back()

    const service = await Service.findOrFail(params.id)
    await new SystemStatsService().control(service, 'start')
    return response.redirect().back()
  }

  async stop({ params, response }: HttpContext) {
    if (!dockerConfig.disponible) return response.redirect().back()

    const service = await Service.findOrFail(params.id)
    await new SystemStatsService().control(service, 'stop')
    return response.redirect().back()
  }

  async restart({ params, response }: HttpContext) {
    if (!dockerConfig.disponible) return response.redirect().back()

    const service = await Service.findOrFail(params.id)
    await new SystemStatsService().control(service, 'restart')
    return response.redirect().back()
  }
}
