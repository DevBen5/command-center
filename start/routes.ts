/*
|--------------------------------------------------------------------------
| Routes file
|--------------------------------------------------------------------------
|
| The routes file is used for defining the HTTP routes.
|
*/

import router from '@adonisjs/core/services/router'
import { middleware } from '#start/kernel'

const AuthController = () => import('#core/auth/controllers/auth_controller')
const LocaleController = () => import('#core/i18n/controllers/locale_controller')
const HomeController = () => import('#core/dashboard/controllers/home_controller')
const ServicesController = () => import('#modules/services/controllers/services_controller')
const AgentsController = () => import('#modules/agents/controllers/agents_controller')
const VeilleController = () => import('#modules/veille/controllers/veille_controller')
const LeitnerController = () => import('#modules/leitner/controllers/leitner_controller')
const LeitnerSettingsController = () =>
  import('#modules/leitner/controllers/leitner_settings_controller')
const LeitnerIngestionController = () =>
  import('#modules/leitner/controllers/leitner_ingestion_controller')
const LeitnerLlmController = () => import('#modules/leitner/controllers/leitner_llm_controller')

/*
|--------------------------------------------------------------------------
| Routes publiques (invité)
|--------------------------------------------------------------------------
*/
router
  .group(() => {
    router.get('/login', [AuthController, 'show'])
    router.post('/login', [AuthController, 'store'])
  })
  .use(middleware.guest())

router.post('/logout', [AuthController, 'destroy']).use(middleware.auth())

// Changement de langue — accessible connecté ou non (page login incluse).
router.post('/locale', [LocaleController, 'switch'])

/*
|--------------------------------------------------------------------------
| Tableau de bord — tout est protégé par le guard de session
|--------------------------------------------------------------------------
*/
router
  .group(() => {
    router.get('/', [HomeController, 'index'])

    router
      .group(() => {
        router.get('/', [ServicesController, 'index'])
        router.post('/:id/start', [ServicesController, 'start'])
        router.post('/:id/stop', [ServicesController, 'stop'])
        router.post('/:id/restart', [ServicesController, 'restart'])
      })
      .prefix('/services')

    router
      .group(() => {
        router.get('/', [AgentsController, 'index'])
        router.post('/:id/run', [AgentsController, 'run'])
        router.post('/:id/stop', [AgentsController, 'stop'])
      })
      .prefix('/agents')

    router
      .group(() => {
        router.get('/', [VeilleController, 'index'])
        router.post('/', [VeilleController, 'store'])
        router.post('/:id/queue', [VeilleController, 'toggleQueue'])
      })
      .prefix('/veille')

    router
      .group(() => {
        router.get('/', [LeitnerController, 'index'])

        // Écran de gestion : catalogue des cartes + taxonomie catégorie → thème
        // + intervalles des boîtes.
        // Toute la saisie de cartes passe par là ; /revision ne fait que réviser.
        router.get('/settings', [LeitnerSettingsController, 'index'])
        router.put('/settings/intervals', [LeitnerSettingsController, 'updateIntervals'])

        // Téléchargement JSON : réponse HTTP nue, hors Inertia (voir le contrôleur).
        router.get('/export', [LeitnerSettingsController, 'exportBackup'])
        router.post('/import', [LeitnerSettingsController, 'importBackup'])
        router.post('/cards', [LeitnerSettingsController, 'store'])
        router.put('/cards/:id', [LeitnerSettingsController, 'update'])
        router.delete('/cards/:id', [LeitnerSettingsController, 'destroy'])
        router.post('/cards/delete', [LeitnerSettingsController, 'destroyMany'])
        router.post('/cards/theme', [LeitnerSettingsController, 'assignTheme'])

        router.post('/categories', [LeitnerSettingsController, 'storeCategory'])
        router.put('/categories/:id', [LeitnerSettingsController, 'updateCategory'])
        router.delete('/categories/:id', [LeitnerSettingsController, 'destroyCategory'])

        router.post('/themes', [LeitnerSettingsController, 'storeTheme'])
        router.put('/themes/:id', [LeitnerSettingsController, 'updateTheme'])
        router.delete('/themes/:id', [LeitnerSettingsController, 'destroyTheme'])

        // Ingestion d'un cours par un LLM local : le modèle **propose** des cartes,
        // l'utilisateur relit et valide. Rien n'entre en base sans relecture.
        // (Déclaré avant `/:id/review` : « ingest » n'est pas un id de carte.)
        //
        // Le POST ne fait qu'amorcer le travail : il crée l'ingestion en `pending`, la
        // lance en tâche de fond et redirige vers sa page de suivi — **une URL par
        // travail**, qu'on peut quitter, partager et retrouver à jour.
        router.get('/ingest', [LeitnerIngestionController, 'index'])
        router.post('/ingest', [LeitnerIngestionController, 'store'])
        // Un fichier (.txt · .md · .pdf) → son texte, pour qu'il se relise AVANT que le
        // travail n'existe. Cette route n'écrit RIEN : ni ingestion, ni brouillon — c'est
        // ici l'équivalent du « aucune écriture » des routes de diagnostic LLM. Elle rend
        // du JSON nu : la page l'appelle en fetch, donc avec l'en-tête `x-xsrf-token`.
        router.post('/ingest/extract', [LeitnerIngestionController, 'extract'])
        router.put('/ingest/drafts/:id', [LeitnerIngestionController, 'updateDraft'])
        router.post('/ingest/drafts/accept', [LeitnerIngestionController, 'accept'])
        router.post('/ingest/drafts/reject', [LeitnerIngestionController, 'reject'])
        // `where(number)` : sans lui, « drafts » serait un id d'ingestion recevable.
        router
          .get('/ingest/:id', [LeitnerIngestionController, 'show'])
          .where('id', router.matchers.number())
        router
          .put('/ingest/:id/title', [LeitnerIngestionController, 'rename'])
          .where('id', router.matchers.number())
        router
          .delete('/ingest/:id', [LeitnerIngestionController, 'destroy'])
          .where('id', router.matchers.number())

        // Configuration du LLM : détecter le serveur, lister ses modèles, tester une
        // génération. Ces trois routes n'écrivent RIEN (ni base, ni disque) : elles
        // rendent le bloc à coller dans `.env`, et l'utilisateur redémarre.
        // ⚠️ Elles font émettre au serveur des requêtes vers une URL saisie : la liste
        // blanche des validateurs (loopback + plages privées) est le seul rempart SSRF.
        router.get('/llm', [LeitnerLlmController, 'index'])
        router.post('/llm/detect', [LeitnerLlmController, 'detect'])
        router.post('/llm/models', [LeitnerLlmController, 'models'])
        router.post('/llm/test', [LeitnerLlmController, 'test'])

        // La réponse écrite → un verdict, AVANT le dévoilement du verso. JSON nu (la
        // page l'appelle en fetch, donc avec `x-xsrf-token`), et elle n'écrit RIEN :
        // l'historisation se fait à la note. Un juge éteint rend 200 + `verdict: null`,
        // jamais une erreur — la révision ne tombe pas parce que LM Studio est éteint.
        router.post('/:id/judge', [LeitnerController, 'judge'])
        router.post('/:id/review', [LeitnerController, 'review'])
      })
      .prefix('/revision')
  })
  .use(middleware.auth())
