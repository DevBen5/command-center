import type { HttpContext } from '@adonisjs/core/http'
import Service from '#models/service'
import SystemStatsService from '#services/system_stats_service'

export default class ServicesController {
  async index({ inertia }: HttpContext) {
    const services = await Service.query().orderBy('category').orderBy('name')
    return inertia.render('services/index', { services })
  }

  async start({ params, response }: HttpContext) {
    const service = await Service.findOrFail(params.id)
    await new SystemStatsService().control(service, 'start')
    return response.redirect().back()
  }

  async stop({ params, response }: HttpContext) {
    const service = await Service.findOrFail(params.id)
    await new SystemStatsService().control(service, 'stop')
    return response.redirect().back()
  }

  async restart({ params, response }: HttpContext) {
    const service = await Service.findOrFail(params.id)
    await new SystemStatsService().control(service, 'restart')
    return response.redirect().back()
  }
}
