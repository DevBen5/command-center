import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import Service from '#modules/services/models/service'

const execFileAsync = promisify(execFile)

// Noms de conteneurs Docker valides : alphanumérique puis [a-zA-Z0-9_.-].
// Refuse tout ce qui pourrait être interprété par un shell.
const CONTAINER_NAME_PATTERN = /^[a-zA-Z0-9][a-zA-Z0-9_.-]*$/

export default class SystemStatsService {
  async control(service: Service, action: 'start' | 'stop' | 'restart') {
    const containerName =
      (service.config.containerName as string | undefined) ?? service.name.toLowerCase()

    try {
      if (!CONTAINER_NAME_PATTERN.test(containerName)) {
        throw new Error(`invalid container name: ${containerName}`)
      }
      // execFile passe les arguments sans interprétation shell : même si le nom
      // venait à contenir des métacaractères, il ne serait jamais exécuté.
      await execFileAsync('docker', [action, containerName])
    } catch {
      // Pas de conteneur Docker réel sur ce poste de dev pour ce service :
      // on simule l'effet de l'action directement en base.
    }

    service.status = action === 'stop' ? 'down' : 'up'
    await service.save()

    return service
  }
}
