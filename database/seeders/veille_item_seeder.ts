import { BaseSeeder } from '@adonisjs/lucid/seeders'
import VeilleItem from '#models/veille_item'

export default class extends BaseSeeder {
  async run() {
    await VeilleItem.createMany([
      {
        type: 'rss',
        title: 'Construire un pipeline RAG local sans cloud',
        url: 'https://blog.exemple.dev/rag-local',
        content: "Un tour d'horizon des briques pour monter un pipeline RAG entièrement local.",
        tags: ['ia'],
        readingQueue: true,
      },
      {
        type: 'note',
        title: 'Sauvegarde 3-2-1 pour le homelab',
        content: '3 copies, 2 supports différents, 1 copie hors site. À appliquer sur le NAS.',
        tags: ['self-host'],
        readingQueue: true,
      },
      {
        type: 'bookmark',
        title: 'Comparatif des moteurs vectoriels',
        url: 'https://github.com/exemple/vector-db-comparison',
        tags: [],
        readingQueue: false,
      },
      {
        type: 'rss',
        title: 'Sortie de Traefik 3.x : ce qui change',
        url: 'https://flux.reseau.io/traefik-3',
        content: 'Nouveautés de la v3 de Traefik : middlewares, observabilité, config dynamique.',
        tags: ['self-host'],
        readingQueue: false,
      },
      {
        type: 'bookmark',
        title: "L'oubli et la répétition espacée",
        url: 'https://papier.recherche.org/spaced-repetition',
        tags: ['à-lire'],
        readingQueue: true,
      },
      {
        type: 'rss',
        title: 'Le point sur Rust en 2026',
        url: 'https://blog.rust-lang.org/2026-roadmap',
        content: 'Feuille de route Rust pour 2026 : async, edition, tooling.',
        tags: ['rust'],
        readingQueue: false,
      },
      {
        type: 'note',
        title: 'Idée : dashboard de monitoring unifié',
        content: 'Regrouper Uptime-Kuma, les stats Docker et les logs agents dans un seul écran.',
        tags: ['design'],
        readingQueue: false,
      },
    ])
  }
}
