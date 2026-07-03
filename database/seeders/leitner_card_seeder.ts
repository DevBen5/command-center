import { DateTime } from 'luxon'
import { BaseSeeder } from '@adonisjs/lucid/seeders'
import LeitnerCard from '#models/leitner_card'

export default class extends BaseSeeder {
  async run() {
    const today = DateTime.now().startOf('day')

    await LeitnerCard.updateOrCreateMany('front', [
      // Boîte 1 — dues aujourd'hui ou en retard
      {
        front: "Qu'est-ce qu'une route Inertia dans AdonisJS ?",
        back: "Une route qui répond avec `.renderInertia('page')`, retournant une page Vue au lieu d'une vue Edge classique.",
        box: 1,
        nextReview: today,
        tags: ['adonisjs', 'inertia'],
      },
      {
        front: 'Que fait `strict: true` dans tsconfig.json ?',
        back: 'Active toutes les vérifications strictes de TypeScript (strictNullChecks, noImplicitAny, etc.) en une seule option.',
        box: 1,
        nextReview: today.minus({ days: 1 }),
        tags: ['typescript'],
      },
      {
        front: "Qu'est-ce qu'un layout persistant Inertia ?",
        back: 'Un composant Vue (ex. sidebar) qui reste monté entre les navigations Inertia, via `defineOptions({ layout })`.',
        box: 1,
        nextReview: today,
        tags: ['vue', 'inertia'],
      },
      {
        front: "Qu'est-ce qu'une colonne JSONB en PostgreSQL ?",
        back: 'Un type de colonne qui stocke du JSON binaire indexable, plus rapide à interroger que du JSON texte.',
        box: 1,
        nextReview: today.minus({ days: 2 }),
        tags: ['postgresql'],
      },
      // Boîte 2 — dues tous les 2 jours
      {
        front: "Qu'est-ce que l'effet d'espacement en mémoire ?",
        back: 'Le fait de mieux mémoriser une information quand les révisions sont espacées dans le temps plutôt que groupées.',
        box: 2,
        nextReview: today,
        tags: ['leitner'],
      },
      {
        front: 'Que fait `@tailwindcss/vite` ?',
        back: 'Un plugin Vite qui compile TailwindCSS v4 directement dans le pipeline de build, sans PostCSS séparé.',
        box: 2,
        nextReview: today,
        tags: ['tailwindcss'],
      },
      {
        front: "Qu'est-ce qu'un `tsvector` en PostgreSQL ?",
        back: "Une représentation optimisée d'un texte pour la recherche full-text, découpée en lexèmes normalisés.",
        box: 2,
        nextReview: today,
        tags: ['postgresql'],
      },
      // Boîte 3 — dues tous les 4 jours
      {
        front: 'Que fait `node ace migration:run` ?',
        back: "Exécute les migrations Lucid qui n'ont pas encore été appliquées à la base de données.",
        box: 3,
        nextReview: today,
        tags: ['adonisjs', 'lucid'],
      },
      {
        front: "Qu'est-ce que le système Leitner ?",
        back: "Un algorithme de répétition espacée : bonne réponse → carte monte d'une boîte, échec → retour en boîte 1.",
        box: 3,
        nextReview: today,
        tags: ['leitner'],
      },
      // Boîte 4 — hebdomadaire, pas encore dues
      {
        front: "Qu'est-ce qu'un guard de session dans Adonis Auth ?",
        back: "Un mécanisme d'authentification qui stocke l'identité de l'utilisateur dans la session côté serveur (cookie).",
        box: 4,
        nextReview: today.plus({ days: 5 }),
        tags: ['adonisjs', 'auth'],
      },
      {
        front: 'Que fait `@column()` dans un modèle Lucid ?',
        back: "Déclare qu'une propriété correspond à une colonne de la table, avec cast automatique des types.",
        box: 4,
        nextReview: today.plus({ days: 5 }),
        tags: ['lucid'],
      },
      {
        front: "Qu'est-ce qu'un Conventional Commit ?",
        back: "Un format de message de commit `type(scope): description` qui permet d'automatiser changelog et versioning.",
        box: 4,
        nextReview: today.plus({ days: 6 }),
        tags: ['git'],
      },
      // Boîte 5 — mensuelle, pas encore dues
      {
        front: "Qu'est-ce que le Composition API de Vue 3 ?",
        back: "Une façon d'organiser la logique des composants avec des fonctions (`ref`, `computed`...) plutôt qu'un objet options.",
        box: 5,
        nextReview: today.plus({ days: 20 }),
        tags: ['vue'],
      },
      {
        front: "Qu'est-ce qu'un reverse proxy ?",
        back: 'Un serveur qui reçoit les requêtes externes et les redirige vers le bon service interne (ex. DSM → conteneur Docker).',
        box: 5,
        nextReview: today.plus({ days: 22 }),
        tags: ['infra'],
      },
      {
        front: "Qu'est-ce que Let's Encrypt ?",
        back: 'Une autorité de certification gratuite qui délivre des certificats TLS renouvelés automatiquement.',
        box: 5,
        nextReview: today.plus({ days: 25 }),
        tags: ['infra', 'tls'],
      },
    ])
  }
}
