import { describe, expect, test } from 'vitest'
import { namespaceFromPath, mergeModuleMessages } from '../messages'

/*
| La fusion des traductions co-localisées par module (voir `messages.ts`).
|
| ⚠️ C'est ici que se joue le seul risque de contenu : un namespace mal dérivé range les
| clés d'un module au mauvais endroit — `t('agents.title')` retomberait alors en « missing
| key ». On prouve donc la dérivation, le rangement, et surtout les deux gardes qui doivent
| LEVER plutôt qu'écraser en silence. La logique est testée hors `import.meta.glob` (que
| seul un bundler résout) : ces entrées sont synthétiques, pas de vrais fichiers module.
*/

describe('namespaceFromPath', () => {
  test('dérive le namespace depuis un module', () => {
    expect(namespaceFromPath('/app/modules/agents/i18n/fr.json')).toBe('agents')
  })

  test('dérive le namespace depuis une feature du core', () => {
    expect(namespaceFromPath('/app/core/dashboard/i18n/en.json')).toBe('dashboard')
  })

  test('lève sur un chemin hors convention', () => {
    // Pas de segment `i18n/`
    expect(() => namespaceFromPath('/app/modules/agents/fr.json')).toThrow()
    // Le châssis vit sous `inertia/`, pas `app/` — ne doit jamais être traité comme un module
    expect(() => namespaceFromPath('/inertia/i18n/fr.json')).toThrow()
  })
})

describe('mergeModuleMessages', () => {
  const chassis = { nav: { services: 'Services' }, brand: { title: 'Centre' } }

  test('range chaque module sous son namespace, châssis préservé', () => {
    const merged = mergeModuleMessages(chassis, {
      '/app/modules/agents/i18n/fr.json': { title: 'Agents', empty: 'Aucun' },
      '/app/core/dashboard/i18n/fr.json': { lead: 'Résumé' },
    })
    expect(merged.nav).toEqual({ services: 'Services' })
    expect(merged.brand).toEqual({ title: 'Centre' })
    expect(merged.agents).toEqual({ title: 'Agents', empty: 'Aucun' })
    expect(merged.dashboard).toEqual({ lead: 'Résumé' })
  })

  test('lève si un module collisionne avec une clé du châssis', () => {
    expect(() =>
      mergeModuleMessages(chassis, { '/app/modules/nav/i18n/fr.json': { x: 'y' } })
    ).toThrow(/Collision/)
  })

  test('lève si deux modules partagent le même namespace', () => {
    expect(() =>
      mergeModuleMessages(
        {},
        {
          '/app/modules/agents/i18n/fr.json': { a: '1' },
          '/app/core/agents/i18n/fr.json': { b: '2' },
        }
      )
    ).toThrow(/Collision/)
  })

  test('sans aucun module, renvoie le châssis inchangé', () => {
    expect(mergeModuleMessages(chassis, {})).toEqual(chassis)
  })
})
