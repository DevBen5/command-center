import { defineConfig } from 'vitest/config'
import { getDirname } from '@adonisjs/core/helpers'
import vue from '@vitejs/plugin-vue'

/**
 * Runner des tests de composant Vue — distinct de Japa, qui couvre le backend.
 *
 * ⚠️ Cette config est volontairement séparée de `vite.config.ts`. Sans ce fichier,
 * Vitest chargerait la config applicative, donc les plugins `inertia()` et
 * `adonisjs({ entrypoints })` : ils résolvent des points d'entrée et un manifeste
 * de build, dont un runner de test n'a que faire. Seul `vue()` est nécessaire ici.
 */
export default defineConfig({
  plugins: [vue()],

  resolve: {
    alias: {
      '~/': `${getDirname(import.meta.url)}/inertia/`,
    },
  },

  test: {
    // Les tests de composant sont co-localisés à côté du `.vue` qu'ils couvrent.
    // Aucun recouvrement avec Japa, qui ne balaie que `tests/unit` et `tests/functional`
    // (voir `adonisrc.ts`) : un fichier n'est jamais ramassé deux fois.
    include: ['app/**/*.spec.ts', 'inertia/**/*.spec.ts'],
    // `focus()`, `select()` et les listeners `window` des composants exigent un vrai DOM.
    environment: 'jsdom',
    // Pas de globals : chaque test importe `test`/`expect` depuis `vitest`. C'est ce qui
    // permet à `tsc --noEmit` de typer les specs sans ajouter de `types` au tsconfig.
    globals: false,
  },
})
