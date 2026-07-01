/*
|--------------------------------------------------------------------------
| Routes file
|--------------------------------------------------------------------------
|
| The routes file is used for defining the HTTP routes.
|
*/

import router from '@adonisjs/core/services/router'

const ServicesController = () => import('#controllers/modules/services_controller')
const AgentsController = () => import('#controllers/modules/agents_controller')
const VeilleController = () => import('#controllers/modules/veille_controller')
const LeitnerController = () => import('#controllers/modules/leitner_controller')

router.on('/').renderInertia('home')

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
