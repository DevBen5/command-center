import { BaseSeeder } from '@adonisjs/lucid/seeders'
import Agent from '#models/agent'

export default class extends BaseSeeder {
  async run() {
    await Agent.createMany([
      {
        name: 'Veille-quotidienne',
        framework: 'Hermes',
        status: 'failed',
        config: { trigger: 'cron · 07:00' },
        logs: ["17:02 — exception à l'étape « résumé »"],
      },
      {
        name: 'Tri-inbox',
        framework: 'Hermes',
        status: 'running',
        config: { trigger: 'cron · 5 min', model: 'local-7b', progress: '14/31' },
        logs: [
          '18:20:14 — agent démarré · 31 éléments en file',
          '18:20:15 — élément 12 classé « Veille / IA »',
          '18:20:17 — élément 13 doublon ignoré',
          '18:20:19 — élément 14 résumé généré (240 tk)',
        ],
      },
      {
        name: 'Hermes-orchestrateur',
        framework: 'Hermes',
        status: 'active',
        config: { trigger: 'cron · 06:00' },
        logs: [],
      },
      {
        name: 'Résumeur-PDF',
        framework: 'local',
        status: 'idle',
        config: { trigger: 'à la demande' },
        logs: [],
      },
    ])
  }
}
