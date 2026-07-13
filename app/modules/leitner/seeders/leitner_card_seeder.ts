import { DateTime } from 'luxon'
import { BaseSeeder } from '@adonisjs/lucid/seeders'
import LeitnerCard from '#modules/leitner/models/leitner_card'
import LeitnerCategory from '#modules/leitner/models/leitner_category'
import LeitnerTheme from '#modules/leitner/models/leitner_theme'

// Taxonomie de départ : catégorie → thèmes.
const TAXONOMY: Record<string, string[]> = {
  'Développement': ['AdonisJS', 'TypeScript', 'Vue', 'TailwindCSS'],
  'Base de données': ['PostgreSQL', 'Lucid'],
  'DevOps': ['Docker', 'Kubernetes', 'Git'],
  'Infrastructure': ['Réseau', 'TLS'],
  'Méthode': ['Leitner'],
}

export default class extends BaseSeeder {
  async run() {
    const today = DateTime.now().startOf('day')

    // Catégories et thèmes d'abord : les cartes ont besoin de leurs ids.
    const themeIds = new Map<string, number>()
    for (const [categoryName, themeNames] of Object.entries(TAXONOMY)) {
      const category = await LeitnerCategory.updateOrCreate(
        { name: categoryName },
        { name: categoryName }
      )

      for (const name of themeNames) {
        const theme = await LeitnerTheme.updateOrCreate(
          { leitnerCategoryId: category.id, name },
          { leitnerCategoryId: category.id, name }
        )
        themeIds.set(`${categoryName}/${name}`, theme.id)
      }
    }

    const theme = (path: string): number => themeIds.get(path)!

    await LeitnerCard.updateOrCreateMany('front', [
      // Boîte 1 — dues aujourd'hui ou en retard
      {
        front: "Qu'est-ce qu'une route Inertia dans AdonisJS ?",
        back: "Une route qui répond avec `.renderInertia('page')`, retournant une page Vue au lieu d'une vue Edge classique.",
        box: 1,
        nextReview: today,
        leitnerThemeId: theme('Développement/AdonisJS'),
      },
      {
        front: 'Que fait `strict: true` dans tsconfig.json ?',
        back: 'Active toutes les vérifications strictes de TypeScript (strictNullChecks, noImplicitAny, etc.) en une seule option.',
        box: 1,
        nextReview: today.minus({ days: 1 }),
        leitnerThemeId: theme('Développement/TypeScript'),
      },
      {
        front: "Qu'est-ce qu'un layout persistant Inertia ?",
        back: 'Un composant Vue (ex. sidebar) qui reste monté entre les navigations Inertia, via `defineOptions({ layout })`.',
        box: 1,
        nextReview: today,
        leitnerThemeId: theme('Développement/Vue'),
      },
      {
        front: "Qu'est-ce qu'une colonne JSONB en PostgreSQL ?",
        back: 'Un type de colonne qui stocke du JSON binaire indexable, plus rapide à interroger que du JSON texte.',
        box: 1,
        nextReview: today.minus({ days: 2 }),
        leitnerThemeId: theme('Base de données/PostgreSQL'),
      },
      {
        front: "Qu'est-ce qu'une image Docker, par rapport à un conteneur ?",
        back: "L'image est le modèle figé (couches de système de fichiers) ; le conteneur est une instance en cours d'exécution de cette image.",
        box: 1,
        nextReview: today,
        leitnerThemeId: theme('DevOps/Docker'),
      },
      // Boîte 2 — dues tous les 2 jours
      {
        front: "Qu'est-ce que l'effet d'espacement en mémoire ?",
        back: 'Le fait de mieux mémoriser une information quand les révisions sont espacées dans le temps plutôt que groupées.',
        box: 2,
        nextReview: today,
        leitnerThemeId: theme('Méthode/Leitner'),
      },
      {
        front: 'Que fait `@tailwindcss/vite` ?',
        back: 'Un plugin Vite qui compile TailwindCSS v4 directement dans le pipeline de build, sans PostCSS séparé.',
        box: 2,
        nextReview: today,
        leitnerThemeId: theme('Développement/TailwindCSS'),
      },
      {
        front: "Qu'est-ce qu'un `tsvector` en PostgreSQL ?",
        back: "Une représentation optimisée d'un texte pour la recherche full-text, découpée en lexèmes normalisés.",
        box: 2,
        nextReview: today,
        leitnerThemeId: theme('Base de données/PostgreSQL'),
      },
      {
        front: "Qu'est-ce qu'un Pod Kubernetes ?",
        back: 'La plus petite unité déployable : un ou plusieurs conteneurs qui partagent réseau et stockage, planifiés ensemble sur un nœud.',
        box: 2,
        nextReview: today,
        leitnerThemeId: theme('DevOps/Kubernetes'),
      },
      // Boîte 3 — dues tous les 4 jours
      {
        front: 'Que fait `node ace migration:run` ?',
        back: "Exécute les migrations Lucid qui n'ont pas encore été appliquées à la base de données.",
        box: 3,
        nextReview: today,
        leitnerThemeId: theme('Base de données/Lucid'),
      },
      {
        front: "Qu'est-ce que le système Leitner ?",
        back: "Un algorithme de répétition espacée : bonne réponse → carte monte d'une boîte, échec → retour en boîte 1.",
        box: 3,
        nextReview: today,
        leitnerThemeId: theme('Méthode/Leitner'),
      },
      // Boîte 4 — hebdomadaire, pas encore dues
      {
        front: "Qu'est-ce qu'un guard de session dans Adonis Auth ?",
        back: "Un mécanisme d'authentification qui stocke l'identité de l'utilisateur dans la session côté serveur (cookie).",
        box: 4,
        nextReview: today.plus({ days: 5 }),
        leitnerThemeId: theme('Développement/AdonisJS'),
      },
      {
        front: 'Que fait `@column()` dans un modèle Lucid ?',
        back: "Déclare qu'une propriété correspond à une colonne de la table, avec cast automatique des types.",
        box: 4,
        nextReview: today.plus({ days: 5 }),
        leitnerThemeId: theme('Base de données/Lucid'),
      },
      {
        front: "Qu'est-ce qu'un Conventional Commit ?",
        back: "Un format de message de commit `type(scope): description` qui permet d'automatiser changelog et versioning.",
        box: 4,
        nextReview: today.plus({ days: 6 }),
        leitnerThemeId: theme('DevOps/Git'),
      },
      // Boîte 5 — mensuelle, pas encore dues
      {
        front: "Qu'est-ce que le Composition API de Vue 3 ?",
        back: "Une façon d'organiser la logique des composants avec des fonctions (`ref`, `computed`...) plutôt qu'un objet options.",
        box: 5,
        nextReview: today.plus({ days: 20 }),
        leitnerThemeId: theme('Développement/Vue'),
      },
      {
        front: "Qu'est-ce qu'un reverse proxy ?",
        back: 'Un serveur qui reçoit les requêtes externes et les redirige vers le bon service interne (ex. DSM → conteneur Docker).',
        box: 5,
        nextReview: today.plus({ days: 22 }),
        leitnerThemeId: theme('Infrastructure/Réseau'),
      },
      {
        front: "Qu'est-ce que Let's Encrypt ?",
        back: 'Une autorité de certification gratuite qui délivre des certificats TLS renouvelés automatiquement.',
        box: 5,
        nextReview: today.plus({ days: 25 }),
        leitnerThemeId: theme('Infrastructure/TLS'),
      },
    ])
  }
}
