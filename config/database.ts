import env from '#start/env'
import { defineConfig } from '@adonisjs/lucid'
import enabledModules, { migrationPathsFor } from '#config/modules'

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
      //
      // ⚠️ Seuls les modules activés par `MODULES` (CC-137) apportent leur chemin —
      // `migrationPathsFor` (`config/modules.ts`) filtre dans l'ordre canonique. Un module
      // absent de la liste n'a donc aucune migration jouée : pas de table, pas de données.
      migrations: {
        naturalSort: true,
        paths: ['app/core/auth/migrations', ...migrationPathsFor(enabledModules)],
      },
      // ⚠️ AUCUN seeder, et la liste vide est une décision, pas un reste (CC-138). Tout ce
      // qui est déclaré ici tournerait à CHAQUE `node ace db:seed` (la leçon de CC-106 : le
      // seeder de veille replantait 7 faux articles dans la veille réelle). Les trois
      // derniers seeders — services et agents (contenu de démo), auth (l'identité du
      // propriétaire en dur) — sont remplacés par l'écran d'installation (`/installation`,
      // premier compte) et une migration (rôle « Lecteur »). Ne réenregistre jamais un path
      // ici : `tests/unit/db_seeders.spec.ts` rougit, et il dit pourquoi.
      seeders: {
        paths: [],
      },
    },
  },
})

export default dbConfig
