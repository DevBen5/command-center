import { describe, expect, test } from 'vitest'
import {
  applyFilterChange,
  buildCatalogQueryString,
  DEFAULT_CATALOG_FILTERS,
} from '../catalog_query.js'

describe('Coffre / catalog_query — la construction de la query string', () => {
  test('les filtres par défaut ne posent que page, sort et order', () => {
    const qs = buildCatalogQueryString(DEFAULT_CATALOG_FILTERS)
    expect(qs).toBe('page=1&sort=capturedAt&order=desc')
  })

  test('chaque filtre posé apparaît dans la query string', () => {
    const qs = buildCatalogQueryString({
      page: 3,
      source: 'nas',
      nature: 'photo',
      capturedFrom: '2026-01-01',
      capturedTo: '2026-06-30',
      q: 'plage',
      includeMissing: true,
      sort: 'displayName',
      order: 'asc',
    })

    const params = new URLSearchParams(qs)
    expect(params.get('page')).toBe('3')
    expect(params.get('source')).toBe('nas')
    expect(params.get('nature')).toBe('photo')
    expect(params.get('capturedFrom')).toBe('2026-01-01')
    expect(params.get('capturedTo')).toBe('2026-06-30')
    expect(params.get('q')).toBe('plage')
    expect(params.get('includeMissing')).toBe('true')
    expect(params.get('sort')).toBe('displayName')
    expect(params.get('order')).toBe('asc')
  })

  test('une recherche vide ou faite uniquement d’espaces ne pose PAS de "q"', () => {
    const qs = buildCatalogQueryString({ ...DEFAULT_CATALOG_FILTERS, q: '   ' })
    expect(new URLSearchParams(qs).has('q')).toBe(false)
  })

  test('la recherche est envoyée découpée de ses espaces de tête et de fin', () => {
    const qs = buildCatalogQueryString({ ...DEFAULT_CATALOG_FILTERS, q: '  plage  ' })
    expect(new URLSearchParams(qs).get('q')).toBe('plage')
  })

  test('includeMissing à false ne pose pas le paramètre du tout', () => {
    const qs = buildCatalogQueryString({ ...DEFAULT_CATALOG_FILTERS, includeMissing: false })
    expect(new URLSearchParams(qs).has('includeMissing')).toBe(false)
  })
})

describe('Coffre / catalog_query — applyFilterChange', () => {
  test('changer un filtre ordinaire revient à la page 1', () => {
    const courant = { ...DEFAULT_CATALOG_FILTERS, page: 4 }
    const suivant = applyFilterChange(courant, { source: 'nas' })
    expect(suivant.page).toBe(1)
    expect(suivant.source).toBe('nas')
  })

  test('changer la page elle-même ne la réinitialise PAS — sinon "page suivante" resterait sur place', () => {
    const courant = { ...DEFAULT_CATALOG_FILTERS, page: 4 }
    const suivant = applyFilterChange(courant, { page: 5 })
    expect(suivant.page).toBe(5)
  })
})
