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

router.on('/').renderInertia('home')

router
  .group(() => {
    router.get('/', [ServicesController, 'index'])
    router.post('/:id/start', [ServicesController, 'start'])
    router.post('/:id/stop', [ServicesController, 'stop'])
    router.post('/:id/restart', [ServicesController, 'restart'])
  })
  .prefix('/services')
