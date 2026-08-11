import { describe, expect, test } from 'vitest'
import {
  buildNasBrowseQueryString,
  nasBreadcrumbFor,
  nasThumbnailUrl,
} from '../nas_browse_query.js'

describe('Coffre / nas_browse_query — la requête de navigation', () => {
  test('sans racine, la requête est vide — le contrôleur liste les racines déclarées', () => {
    expect(buildNasBrowseQueryString(null, '')).toBe('')
    expect(buildNasBrowseQueryString('', 'photos')).toBe('')
  })

  test('avec une racine, `root` et `path` sont posés — y compris un chemin vide', () => {
    const qs = buildNasBrowseQueryString('root', '')
    const params = new URLSearchParams(qs)
    expect(params.get('root')).toBe('root')
    expect(params.get('path')).toBe('')
  })

  test('un chemin non vide est transmis tel quel', () => {
    const qs = buildNasBrowseQueryString('root', 'photos/2026')
    expect(new URLSearchParams(qs).get('path')).toBe('photos/2026')
  })
})

describe('Coffre / nas_browse_query — nasThumbnailUrl', () => {
  test('construit une URL avec `root` et `path` — jamais construite ailleurs', () => {
    const url = nasThumbnailUrl('root', 'photos/exemple.jpg')
    expect(url).toBe('/coffre/nas/thumbnail?root=root&path=photos%2Fexemple.jpg')
  })
})

describe('Coffre / nas_browse_query — nasBreadcrumbFor', () => {
  test('à la racine, un seul segment : la racine elle-même, `path` vide', () => {
    expect(nasBreadcrumbFor('root', '')).toEqual([{ label: 'root', path: '' }])
  })

  test('un niveau : la racine puis le dossier, avec son chemin complet', () => {
    expect(nasBreadcrumbFor('root', 'photos')).toEqual([
      { label: 'root', path: '' },
      { label: 'photos', path: 'photos' },
    ])
  })

  test('plusieurs niveaux : chaque segment porte le chemin ACCUMULÉ jusqu’à lui, pas son seul nom', () => {
    expect(nasBreadcrumbFor('root', 'photos/2026/ete')).toEqual([
      { label: 'root', path: '' },
      { label: 'photos', path: 'photos' },
      { label: '2026', path: 'photos/2026' },
      { label: 'ete', path: 'photos/2026/ete' },
    ])
  })
})
