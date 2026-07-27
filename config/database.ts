import env from '#start/env'
import { defineConfig } from '@adonisjs/lucid'

const dbConfig = defineConfig({
  connection: 'postgres',
  connections: {
    postgres: {
      client: 'pg',
      connection: {
        host: env.get('DB_HOST'),
        port: env.get('DB_PORT'),
        user: env.get('DB_USER'),
        password: env.get('DB_PASSWORD'),
        database: env.get('DB_DATABASE'),
      },
      // Migrations et seeders sont co-localisés dans chaque module (organisation
      // feature-based). Lucid lit les fichiers dossier par dossier, dans l'ordre
      // de ce tableau, puis trie chaque dossier (naturalSort). L'ordre ci-dessous
      // garantit un ordre d'exécution global cohérent ; à l'intérieur du module
      // leitner, cards passe avant reviews grâce au tri numérique.
      migrations: {
        naturalSort: true,
        paths: [
          'app/core/auth/migrations',
          'app/modules/services/migrations',
          'app/modules/agents/migrations',
          'app/modules/veille/migrations',
          'app/modules/leitner/migrations',
        ],
      },
      // ⚠️ Ce qui est déclaré ici tourne à CHAQUE `node ace db:seed`, y compris quand
      // on ne l'appelle que pour poser ou faire tourner ADMIN_PASSWORD (CC-75) — c'est
      // le seul outil de rotation, documenté jusqu'en production. Un seeder de contenu
      // réécrirait donc du contenu réel à chaque changement de mot de passe.
      // Règle : on n'enregistre ici que des données que l'application produit elle-même
      // ou qu'aucun écran ne permet de saisir. Le contenu saisi à la main n'a pas de
      // seeder — ni leitner, ni veille (CC-106).
      seeders: {
        paths: [
          'app/core/auth/seeders',
          'app/modules/services/seeders',
          'app/modules/agents/seeders',
        ],
      },
    },
  },
})

export default dbConfig
