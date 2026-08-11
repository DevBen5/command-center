import { CatalogBrowseThrottleService } from '#modules/coffre/services/catalog_browse_throttle_service'

/**
 * Le throttle des écritures NAS (CC-240) — instance DÉDIÉE, préfixe `nas_write_<userId>`, jamais
 * partagée avec `nas_browse` ou `catalog_browse` : un usage normal de la navigation ne doit pas
 * épuiser le budget des écritures, et réciproquement.
 *
 * ⚠️ **30/min, plus bas que la lecture (60/min)** : ces routes sont destructrices (renommer,
 * déplacer, supprimer), un budget plus serré est délibéré.
 */
export default new CatalogBrowseThrottleService({ requests: 30, duration: '1 min' }, 'nas_write')
