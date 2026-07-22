/**
 * `tsconfig.json` n'exclut que `inertia/**` : les tests de composant co-localisés sous
 * `app/**` entrent donc dans le graphe de `tsc --noEmit`, et leur `import X from './X.vue'`
 * lèverait TS2307 — TypeScript ne sait pas résoudre un `.vue` tout seul.
 *
 * ⚠️ Contrepartie : les composants importés sont typés `any`. Le typecheck valide la
 * syntaxe et les imports des specs, pas les props qu'on passe à `mount()` — un test qui
 * se trompe de prop échoue à l'exécution, pas au typecheck. La levée de cette limite
 * demanderait `vue-tsc`, donc de changer `npm run typecheck` pour tout le dépôt.
 */
declare module '*.vue' {
  import type { DefineComponent } from 'vue'

  const component: DefineComponent<{}, {}, any>
  export default component
}
