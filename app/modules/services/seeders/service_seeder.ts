import { BaseSeeder } from '@adonisjs/lucid/seeders'
import Service from '#modules/services/models/service'

export default class extends BaseSeeder {
  async run() {
    await Service.updateOrCreateMany('name', [
      { name: 'Jellyfin', category: 'Média', status: 'down', cpuPercent: 0, ramPercent: 0 },
      { name: 'Navidrome', category: 'Média', status: 'up', cpuPercent: 12, ramPercent: 28 },
      { name: 'Immich', category: 'Média', status: 'up', cpuPercent: 34, ramPercent: 52 },
      { name: 'Nextcloud', category: 'Productivité', status: 'up', cpuPercent: 48, ramPercent: 94 },
      { name: 'Gitea', category: 'Productivité', status: 'up', cpuPercent: 6, ramPercent: 22 },
      {
        name: 'Vaultwarden',
        category: 'Productivité',
        status: 'up',
        cpuPercent: 3,
        ramPercent: 14,
      },
      { name: 'Pi-hole', category: 'Réseau & infra', status: 'up', cpuPercent: 8, ramPercent: 18 },
      { name: 'Traefik', category: 'Réseau & infra', status: 'up', cpuPercent: 5, ramPercent: 16 },
      {
        name: 'Uptime-Kuma',
        category: 'Réseau & infra',
        status: 'up',
        cpuPercent: 4,
        ramPercent: 20,
      },
    ])
  }
}
