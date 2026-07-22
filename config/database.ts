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
      // Le module leitner n'a volontairement pas de seeder : son contenu est saisi
      // depuis l'UI, et une donnée de démo écraserait le contenu réel.
      seeders: {
        paths: [
          'app/core/auth/seeders',
          'app/modules/services/seeders',
          'app/modules/agents/seeders',
          'app/modules/veille/seeders',
        ],
      },
    },
  },
})

export default dbConfig
