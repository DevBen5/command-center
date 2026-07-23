/*
|--------------------------------------------------------------------------
| Routes file
|--------------------------------------------------------------------------
|
| The routes file is used for defining the HTTP routes.
|
| ⚠️ **Aucune route ne répond sans avoir déclaré sa condition d'accès.** Trois formes, et
| une seule doit apparaître par route :
|
|   middleware.can('module.action')  — exige une capacité
|   middleware.admin()               — réservé à is_admin (Services, Agents, administration)
|   middleware.openRoute()           — intentionnellement sans capacité (voir ci-dessous)
|
| Une route qui n'en porte aucune est **refusée** au runtime par le garde-barrière global
| (`declared_capability_middleware`, enregistré dans `start/kernel.ts`), et fait rougir
| `tests/functional/core/capabilities_routes.spec.ts`. L'oubli va vers le refus : c'est ce
| qui rend le modèle sûr pour les routes que personne n'a encore écrites.
|
*/

import router from '@adonisjs/core/services/router'
import { middleware } from '#start/kernel'

const AuthController = () => import('#core/auth/controllers/auth_controller')
const InvitationController = () => import('#core/auth/controllers/invitation_controller')
const AdminUsersController = () => import('#core/auth/controllers/admin_users_controller')
const AdminRolesController = () => import('#core/auth/controllers/admin_roles_controller')
const LocaleController = () => import('#core/i18n/controllers/locale_controller')
const NoAccessController = () => import('#core/shared/controllers/no_access_controller')
const HomeController = () => import('#core/dashboard/controllers/home_controller')
const ServicesController = () => import('#modules/services/controllers/services_controller')
const AgentsController = () => import('#modules/agents/controllers/agents_controller')
const VeilleController = () => import('#modules/veille/controllers/veille_controller')
const VeilleSourcesController = () =>
  import('#modules/veille/controllers/veille_sources_controller')
const VeilleMediaController = () => import('#modules/veille/controllers/veille_media_controller')
const LeitnerController = () => import('#modules/leitner/controllers/leitner_controller')
const LeitnerSettingsController = () =>
  import('#modules/leitner/controllers/leitner_settings_controller')
const LeitnerIngestionController = () =>
  import('#modules/leitner/controllers/leitner_ingestion_controller')
const LeitnerLlmController = () => import('#modules/leitner/controllers/leitner_llm_controller')
const LeitnerStatsController = () => import('#modules/leitner/controllers/leitner_stats_controller')

/*
|--------------------------------------------------------------------------
| Routes publiques (invité)
|--------------------------------------------------------------------------
|
| `openRoute()` parce qu'on les emprunte **avant d'avoir une identité** : exiger une
| capacité pour se connecter n'aurait pas de sens.
|
*/
router
  .group(() => {
    router.get('/login', [AuthController, 'show'])
    router.post('/login', [AuthController, 'store'])
  })
  .use([middleware.guest(), middleware.openRoute()])

/*
|--------------------------------------------------------------------------
| Acceptation d'une invitation
|--------------------------------------------------------------------------
|
| Le compte existe déjà mais n'a pas encore de mot de passe : son porteur ne peut donc pas
| se connecter, et n'a aucune capacité à faire valoir. Le jeton **est** l'autorisation —
| à usage unique, expirant, et connu de la base par sa seule empreinte SHA-256.
|
| Ni `guest()` ni `auth()` : un admin connecté doit pouvoir ouvrir le lien pour le vérifier.
|
*/
router
  .group(() => {
    router.get('/invitation/:token', [InvitationController, 'show'])
    router.post('/invitation/:token', [InvitationController, 'accept'])
  })
  .use(middleware.openRoute())

// Se déconnecter ne donne accès à rien, et changement de langue non plus (la page de login
// en a besoin, donc avant toute authentification).
router.post('/logout', [AuthController, 'destroy']).use([middleware.auth(), middleware.openRoute()])
router.post('/locale', [LocaleController, 'switch']).use(middleware.openRoute())

/*
| L'écran d'un compte actif à qui aucun droit n'a encore été attribué (CC-81).
|
| `openRoute()` et non `can(…)` : exiger une capacité pour voir « vous n'avez aucune capacité »
| serait un cercle — c'est la seule page dont un compte sans le moindre droit a besoin. Elle ne
| rend aucune donnée, et le contrôleur renvoie ailleurs quiconque a une vraie destination.
| `auth()` reste, elle : cet écran s'adresse à quelqu'un de connecté.
*/
router
  .get('/aucun-acces', [NoAccessController, 'index'])
  .use([middleware.auth(), middleware.openRoute()])

/*
|--------------------------------------------------------------------------
| Tableau de bord — tout est protégé par le guard de session
|--------------------------------------------------------------------------
*/
router
  .group(() => {
    router.get('/', [HomeController, 'index']).use(middleware.can('dashboard.view'))

    /*
    |------------------------------------------------------------------
    | Administration — is_admin, et rien d'autre
    |------------------------------------------------------------------
    |
    | Aucune capacité ne couvre ces routes : c'est délibéré. Une capacité pourrait être
    | accordée par un rôle, et l'écran qui distribue les droits ne doit pas pouvoir être
    | ouvert par les droits qu'il distribue.
    |
    */
    router
      .group(() => {
        router.get('/users', [AdminUsersController, 'index'])
        router.post('/users', [AdminUsersController, 'store'])
        router.get('/users/:id', [AdminUsersController, 'show'])
        router.put('/users/:id', [AdminUsersController, 'update'])
        router.put('/users/:id/capabilities', [AdminUsersController, 'updateCapabilities'])
        // Désactiver plutôt que supprimer : aucune table métier n'a de `user_id` aujourd'hui,
        // mais CC-70 prévoit une progression Leitner par personne — supprimer poserait alors
        // la question des données rattachées.
        router.post('/users/:id/activation', [AdminUsersController, 'toggleActivation'])
        // ⚠️ **La seule suppression possible : un compte dont l'invitation n'a jamais été
        // consommée**, donc qui n'a jamais pu se connecter et ne peut rien avoir produit.
        // Tout le reste se désactive. Voir `AdminUsersController.destroy`.
        router.delete('/users/:id', [AdminUsersController, 'destroy'])
        // Rend le lien d'invitation **une fois**, en JSON, et révoque le précédent.
        router.post('/users/:id/invitation', [AdminUsersController, 'issueInvitation'])

        router.get('/roles', [AdminRolesController, 'index'])
        router.post('/roles', [AdminRolesController, 'store'])
        router.put('/roles/:id', [AdminRolesController, 'update'])
        router.delete('/roles/:id', [AdminRolesController, 'destroy'])
      })
      .prefix('/admin')
      .use(middleware.admin())

    /*
    |------------------------------------------------------------------
    | Services et Agents — is_admin, et rien d'autre
    |------------------------------------------------------------------
    |
    | ⚠️ Pas d'oubli ici : ces deux modules **exécutent des commandes sur la machine hôte**
    | (`AgentRunnerService` lance `agent.config.command` telle quelle, `SystemStatsService`
    | pilote Docker). Leur donner des capacités permettrait à un rôle d'y ouvrir l'accès.
    |
    */
    router
      .group(() => {
        router.get('/', [ServicesController, 'index'])
        router.post('/:id/start', [ServicesController, 'start'])
        router.post('/:id/stop', [ServicesController, 'stop'])
        router.post('/:id/restart', [ServicesController, 'restart'])
      })
      .prefix('/services')
      .use(middleware.admin())

    router
      .group(() => {
        router.get('/', [AgentsController, 'index'])
        router.post('/:id/run', [AgentsController, 'run'])
        router.post('/:id/stop', [AgentsController, 'stop'])
      })
      .prefix('/agents')
      .use(middleware.admin())

    router
      .group(() => {
        router.get('/', [VeilleController, 'index']).use(middleware.can('veille.view'))
        router.post('/', [VeilleController, 'store']).use(middleware.can('veille.items.write'))

        // ⚠️ Les routes littérales `/sources...` sont déclarées **avant** les `/:id/...` :
        // dans l'autre ordre, `/veille/sources` serait capté comme un `:id` valant « sources ».
        router
          .get('/sources', [VeilleSourcesController, 'index'])
          .use(middleware.can('veille.view'))
        router
          .post('/sources', [VeilleSourcesController, 'store'])
          .use(middleware.can('veille.sources.write'))
        // Rafraîchir n'est pas consulter : ça fait sortir des requêtes et écrit des items.
        router
          .post('/sources/refresh', [VeilleSourcesController, 'refreshAll'])
          .use(middleware.can('veille.sources.write'))
        router
          .post('/sources/:id', [VeilleSourcesController, 'update'])
          .where('id', router.matchers.number())
          .use(middleware.can('veille.sources.write'))
        router
          .post('/sources/:id/refresh', [VeilleSourcesController, 'refresh'])
          .where('id', router.matchers.number())
          .use(middleware.can('veille.sources.write'))

        // La suppression, simple ou en lot (CC-63). ⚠️ Déclarée **avant** `/items/:id/...` :
        // dans l'autre ordre, « delete » serait capté comme un `:id` — que le `where(number)`
        // rejetterait, mais en 404 muette plutôt qu'en atteignant cette route.
        //
        // ⚠️ La suppression d'un média met l'asset à la **corbeille d'Immich** : c'est la seule
        // route du module qui écrive dans un système tiers. Voir `VeilleDeletionService`.
        router
          .post('/items/delete', [VeilleController, 'destroyMany'])
          .use(middleware.can('veille.items.write'))

        // La vignette d'un asset Immich (CC-55). ⚠️ Le paramètre est l'id d'item de **notre**
        // base, jamais l'identifiant Immich : c'est ce qui empêche le proxy de servir n'importe
        // quel asset de la bibliothèque personnelle. Voir `VeilleMediaController`.
        // Sous `veille.view` : l'image d'un item est du contenu comme son titre.
        router
          .get('/items/:id/thumbnail', [VeilleMediaController, 'thumbnail'])
          .where('id', router.matchers.number())
          .use(middleware.can('veille.view'))

        router
          .post('/:id/queue', [VeilleController, 'toggleQueue'])
          .where('id', router.matchers.number())
          .use(middleware.can('veille.items.write'))
        router
          .post('/:id/read', [VeilleController, 'toggleRead'])
          .where('id', router.matchers.number())
          .use(middleware.can('veille.items.write'))
      })
      .prefix('/veille')

    router
      .group(() => {
        router.get('/', [LeitnerController, 'index']).use(middleware.can('leitner.view'))

        // Écran de gestion : catalogue des cartes + taxonomie catégorie → thème
        // + intervalles des boîtes.
        // Toute la saisie de cartes passe par là ; /revision ne fait que réviser.
        // Le catalogue en LECTURE tombe sous `leitner.view` — voir les cartes et leur
        // classement, c'est de la consultation. L'écriture, plus bas, ne l'est pas.
        router
          .get('/settings', [LeitnerSettingsController, 'index'])
          .use(middleware.can('leitner.view'))
        router
          .put('/settings/intervals', [LeitnerSettingsController, 'updateIntervals'])
          .use(middleware.can('leitner.settings'))

        // L'effort de révision, déduit des seuls horodatages de `leitner_reviews` :
        // sessions, durées, cartes par session. Aucun paquet ici — comme la série et
        // la rétention, ce sont des mesures d'habitude, pas de thème.
        // `stats.view` et non `view` : lecture pure, séparable de la vue des cartes.
        router
          .get('/stats', [LeitnerStatsController, 'index'])
          .use(middleware.can('leitner.stats.view'))

        // Téléchargement JSON : réponse HTTP nue, hors Inertia (voir le contrôleur).
        // ⚠️ Sous `leitner.backup`, PAS sous une capacité de lecture : l'export rend
        // l'intégralité du contenu — réponses écrites comprises — en un fichier. Voir les
        // cartes n'est pas repartir avec la base ; c'est tout l'intérêt de la séparation.
        router
          .get('/export', [LeitnerSettingsController, 'exportBackup'])
          .use(middleware.can('leitner.backup'))
        // L'import partage la même capacité : il n'ajoute que ce qui manque, mais il ajoute,
        // et c'est le pendant naturel de l'export dans l'écran de sauvegarde.
        router
          .post('/import', [LeitnerSettingsController, 'importBackup'])
          .use(middleware.can('leitner.backup'))
        router
          .post('/cards', [LeitnerSettingsController, 'store'])
          .use(middleware.can('leitner.cards.write'))
        router
          .put('/cards/:id', [LeitnerSettingsController, 'update'])
          .use(middleware.can('leitner.cards.write'))
        router
          .delete('/cards/:id', [LeitnerSettingsController, 'destroy'])
          .use(middleware.can('leitner.cards.write'))
        router
          .post('/cards/delete', [LeitnerSettingsController, 'destroyMany'])
          .use(middleware.can('leitner.cards.write'))
        router
          .post('/cards/theme', [LeitnerSettingsController, 'assignTheme'])
          .use(middleware.can('leitner.cards.write'))

        // La taxonomie (catégories, thèmes) est un geste d'écriture distinct du contenu
        // des cartes : `leitner.taxonomy.write`, pas `cards.write`.
        router
          .post('/categories', [LeitnerSettingsController, 'storeCategory'])
          .use(middleware.can('leitner.taxonomy.write'))
        router
          .put('/categories/:id', [LeitnerSettingsController, 'updateCategory'])
          .use(middleware.can('leitner.taxonomy.write'))
        router
          .delete('/categories/:id', [LeitnerSettingsController, 'destroyCategory'])
          .use(middleware.can('leitner.taxonomy.write'))

        router
          .post('/themes', [LeitnerSettingsController, 'storeTheme'])
          .use(middleware.can('leitner.taxonomy.write'))
        router
          .put('/themes/:id', [LeitnerSettingsController, 'updateTheme'])
          .use(middleware.can('leitner.taxonomy.write'))
        router
          .delete('/themes/:id', [LeitnerSettingsController, 'destroyTheme'])
          .use(middleware.can('leitner.taxonomy.write'))

        // Ingestion d'un cours par un LLM local : le modèle **propose** des cartes,
        // l'utilisateur relit et valide. Rien n'entre en base sans relecture.
        // (Déclaré avant `/:id/review` : « ingest » n'est pas un id de carte.)
        //
        // Le POST ne fait qu'amorcer le travail : il crée l'ingestion en `pending`, la
        // lance en tâche de fond et redirige vers sa page de suivi — **une URL par
        // travail**, qu'on peut quitter, partager et retrouver à jour.
        router
          .get('/ingest', [LeitnerIngestionController, 'index'])
          .use(middleware.can('leitner.ingest'))
        router
          .post('/ingest', [LeitnerIngestionController, 'store'])
          .use(middleware.can('leitner.ingest'))
        // Un fichier (.txt · .md · .pdf) → son texte, pour qu'il se relise AVANT que le
        // travail n'existe. Cette route n'écrit RIEN : ni ingestion, ni brouillon — c'est
        // ici l'équivalent du « aucune écriture » des routes de diagnostic LLM. Elle rend
        // du JSON nu : la page l'appelle en fetch, donc avec l'en-tête `x-xsrf-token`.
        router
          .post('/ingest/extract', [LeitnerIngestionController, 'extract'])
          .use(middleware.can('leitner.ingest'))
        router
          .put('/ingest/drafts/:id', [LeitnerIngestionController, 'updateDraft'])
          .use(middleware.can('leitner.ingest'))
        router
          .post('/ingest/drafts/accept', [LeitnerIngestionController, 'accept'])
          .use(middleware.can('leitner.ingest'))
        router
          .post('/ingest/drafts/reject', [LeitnerIngestionController, 'reject'])
          .use(middleware.can('leitner.ingest'))
        // `where(number)` : sans lui, « drafts » serait un id d'ingestion recevable.
        router
          .get('/ingest/:id', [LeitnerIngestionController, 'show'])
          .where('id', router.matchers.number())
          .use(middleware.can('leitner.ingest'))
        router
          .put('/ingest/:id/title', [LeitnerIngestionController, 'rename'])
          .where('id', router.matchers.number())
          .use(middleware.can('leitner.ingest'))
        router
          .delete('/ingest/:id', [LeitnerIngestionController, 'destroy'])
          .where('id', router.matchers.number())
          .use(middleware.can('leitner.ingest'))

        // Configuration du LLM : détecter le serveur, lister ses modèles, tester une
        // génération. Ces routes n'écrivent RIEN (ni base, ni disque) : elles rendent le
        // bloc à coller dans `.env`, et l'utilisateur redémarre.
        // ⚠️ Sous `leitner.llm`, sa propre capacité et non `settings` : elles font émettre
        // au serveur des requêtes vers une URL saisie — la surface la plus proche d'une
        // SSRF du dépôt, bornée par la seule liste blanche des validateurs. Régler un
        // intervalle (`settings`) n'atteint aucun réseau ; le risque n'est pas le même.
        router.get('/llm', [LeitnerLlmController, 'index']).use(middleware.can('leitner.llm'))
        router
          .post('/llm/detect', [LeitnerLlmController, 'detect'])
          .use(middleware.can('leitner.llm'))
        router
          .post('/llm/models', [LeitnerLlmController, 'models'])
          .use(middleware.can('leitner.llm'))
        router.post('/llm/test', [LeitnerLlmController, 'test']).use(middleware.can('leitner.llm'))

        // La réponse écrite → un verdict, AVANT le dévoilement du verso. JSON nu (la
        // page l'appelle en fetch, donc avec `x-xsrf-token`), et elle n'écrit RIEN :
        // l'historisation se fait à la note. Un juge éteint rend 200 + `verdict: null`,
        // jamais une erreur — la révision ne tombe pas parce que LM Studio est éteint.
        //
        // Sous `leitner.review` et non `leitner.view` : le juge fait travailler le LLM
        // local, et il n'est demandé que dans le geste de réviser.
        router
          .post('/:id/judge', [LeitnerController, 'judge'])
          .use(middleware.can('leitner.review'))
        // ⚠️ Écrit `box` et `next_review`, qui sont des colonnes de la **carte** et non
        // d'une progression par personne : une note donnée par quelqu'un d'autre déplace
        // le planning du propriétaire. C'est la raison d'être de la capacité séparée.
        router
          .post('/:id/review', [LeitnerController, 'review'])
          .use(middleware.can('leitner.review'))
      })
      .prefix('/revision')
  })
  .use(middleware.auth())
