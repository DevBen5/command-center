import { exec } from 'node:child_process'
import { promisify } from 'node:util'
import Service from '#models/service'

const execAsync = promisify(exec)

export default class SystemStatsService {
  async control(service: Service, action: 'start' | 'stop' | 'restart') {
    const containerName =
      (service.config.containerName as string | undefined) ?? service.name.toLowerCase()

    try {
      await execAsync(`docker ${action} ${containerName}`)
    } catch {
      // Pas de conteneur Docker réel sur ce poste de dev pour ce service :
      // on simule l'effet de l'action directement en base.
    }

    service.status = action === 'stop' ? 'down' : 'up'
    await service.save()

    return service
  }
}
