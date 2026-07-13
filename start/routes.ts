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

        router.post('/:id/review', [LeitnerController, 'review'])
      })
      .prefix('/revision')
  })
  .use(middleware.auth())
