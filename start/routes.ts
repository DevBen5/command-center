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

const AuthController = () => import('#controllers/auth_controller')
const LocaleController = () => import('#controllers/locale_controller')
const HomeController = () => import('#controllers/home_controller')
const ServicesController = () => import('#controllers/modules/services_controller')
const AgentsController = () => import('#controllers/modules/agents_controller')
const VeilleController = () => import('#controllers/modules/veille_controller')
const LeitnerController = () => import('#controllers/modules/leitner_controller')

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
        router.post('/cards', [LeitnerController, 'store'])
        router.post('/:id/review', [LeitnerController, 'review'])
      })
      .prefix('/revision')
  })
  .use(middleware.auth())
