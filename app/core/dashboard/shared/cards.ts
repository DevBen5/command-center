/**
 * Ce que `HomeController` envoie à `pages/home.vue` — **le contrat, sorti du `<script setup>`**.
 *
 * Il vivait dans la page, donc hors de portée de tout ce qui n'est pas la page : le spec de
 * composant construisait ses jeux d'essai à l'aveugle, sans que rien ne vérifie qu'ils
 * ressemblaient encore à ce que le serveur envoie. Ici, il est importable — par la page **et**
 * par son spec, qui type désormais ses fixtures dessus. Une section qui gagne un champ fait
 * rougir `tsc` sur les fixtures périmées au lieu de les laisser mentir.
 *
 * ⚠️ **Aucun import par alias `#core/*` dans ce fichier** — même raison que les `shared/*.ts` des
 * modules (CC-60) : l'alias mappe vers `./app/core/*.js`, qui n'existe qu'après un build, et Vite
 * ne le résout pas. D'où un type structurel plutôt qu'un import du modèle.
 *
 * ⚠️ **Les quatre sections sont nullables, et ce n'est pas une précaution de style.** Le serveur
 * ne charge ni n'envoie ce que le lecteur n'a pas le droit de voir : Services et Agents valent
 * `null` pour tout non-admin. C'est le `v-if` de chaque bloc de la page qui en découle — voir le
 * commentaire qui l'accompagne.
 */
export interface Cards {
  services: {
    up: number
    total: number
    down: string[]
    highRam: { name: string; ram: number | null }[]
  } | null
  agents: {
    active: number
    running: { id: number; name: string }[]
    failed: { id: number; name: string }[]
  } | null
  veille: { total: number; queue: number; untagged: number } | null
  leitner: { due: number; total: number } | null
}
