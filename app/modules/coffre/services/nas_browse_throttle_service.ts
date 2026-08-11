import { CatalogBrowseThrottleService } from '#modules/coffre/services/catalog_browse_throttle_service'

/**
 * Le throttle de `GET /coffre/nas/browse` (CC-239) — instance DÉDIÉE de la même classe que le
 * catalogue (`catalog_browse_<userId>`), avec un préfixe de clé distinct (`nas_browse_<userId>`) :
 * même doctrine que ce dernier vis-à-vis de `ReauthThrottleService`, la navigation par dossier ne
 * doit consommer ni le budget d'essais de la porte, ni celui de la grille du catalogue.
 */
export default new CatalogBrowseThrottleService({ requests: 60, duration: '1 min' }, 'nas_browse')
