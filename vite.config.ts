import { defineConfig } from 'vite'
import { getDirname } from '@adonisjs/core/helpers'
import inertia from '@adonisjs/inertia/client'
import vue from '@vitejs/plugin-vue'
import adonisjs from '@adonisjs/vite/client'
import tailwindcss from '@tailwindcss/vite'

export default defineConfig({
  plugins: [
    inertia({ ssr: { enabled: false } }),
    vue(),
    tailwindcss(),
    adonisjs({ entrypoints: ['inertia/app/app.ts'], reload: ['resources/views/**/*.edge'] }),
  ],

  server: {
    /**
     * ⚠️ **Pas de WebSocket de dev pendant les tests, et ce n'est pas une optimisation.**
     *
     * `@adonisjs/vite` démarre un vrai serveur Vite en environnement `test` — c'est voulu en
     * amont (`shouldRunVite = (inDev || inTest) && (env === 'web' || env === 'test')`), et c'est
     * nécessaire : les tests fonctionnels qui demandent une page HTML complète passent par le
     * tag `@vite` d'Edge, qui a besoin du service.
     *
     * Mais un exécuteur de tests n'a **rien** à faire du rechargement à chaud, et le port 24678
     * est global à la machine. Trois conséquences, toutes constatées :
     *
     * - `npm test` pendant que `npm run dev` tourne affiche `Port 24678 is already in use` ;
     * - deux exécutions de tests en parallèle se marchent dessus ;
     * - surtout, un run de tests **interrompu** laisse un orphelin qui garde le port
     *   indéfiniment (sous Windows, arrêter le parent ne tue pas les descendants) — et tous les
     *   runs suivants héritent du message, sans que rien n'indique d'où il vient. Deux orphelins
     *   de ce type tenaient le port depuis des heures quand ce réglage a été écrit.
     *
     * ⚠️ **C'est bien `ws`, et surtout PAS `hmr: false`** — qui paraît pourtant être le réglage
     * évident, et qui ne marche pas. Dans Vite, seul `server.ws === false` court-circuite la
     * création du serveur WebSocket ; `hmr: false` se contente de rendre `hmr` falsy, après quoi
     * le port retombe sur `hmrPort || 24678` et **s'ouvre quand même**. Vérifié : avec
     * `hmr: false`, le message réapparaît à l'identique. Ne le « simplifie » pas dans ce sens.
     *
     * Le reste du serveur Vite (résolution des modules, transformation, tag `@vite`) est intact.
     *
     * ⚠️ Ne remplace pas la condition par une valeur figée : hors `test`, `undefined` laisse Vite
     * appliquer son défaut, et `npm run dev` garde son rechargement à chaud.
     */
    ws: process.env.NODE_ENV === 'test' ? false : undefined,
  },

  /**
   * Define aliases for importing modules from
   * your frontend code
   */
  resolve: {
    alias: {
      '~/': `${getDirname(import.meta.url)}/inertia/`,
    },
  },
})
