<script setup lang="ts">
import { computed } from 'vue'
import { Link, usePage } from '@inertiajs/vue3'

// Les cinq écrans du module, en une barre unique.
//
// ⚠️ Ce composant ne vit PAS dans `pages/` : la résolution Inertia fait un glob sur
// les fichiers .vue de tout dossier `pages/` (voir `inertia/app/app.ts`), donc un
// fichier posé là deviendrait une page. Il s'importe relativement depuis les pages.
//
// ⚠️ L'onglet actif se décide par `startsWith` (plus bas) : n'ajoute jamais un href
// qui soit le préfixe d'un autre, les deux s'allumeraient ensemble.
const TABS = [
  { href: '/revision', label: 'Révision' },
  { href: '/revision/settings', label: 'Cartes' },
  { href: '/revision/stats', label: 'Stats' },
  { href: '/revision/ingest', label: 'Ingestion' },
  { href: '/revision/llm', label: 'Configuration' },
] as const

const page = usePage()

/**
 * L'onglet courant. `/revision` est le préfixe de tous les autres : il n'est actif
 * qu'en correspondance exacte, sans quoi il resterait allumé partout.
 */
const current = computed(() => {
  const path = page.url.split('?')[0].replace(/\/+$/, '') || '/revision'

  const match = TABS.filter((tab) => tab.href !== '/revision').find((tab) =>
    path.startsWith(tab.href)
  )

  return match?.href ?? '/revision'
})
</script>

<template>
  <nav class="mb-4 flex gap-1 rounded-[12px] border border-line bg-panel p-1">
    <Link
      v-for="tab in TABS"
      :key="tab.href"
      :href="tab.href"
      class="rounded-[9px] px-3.5 py-1.5 text-[12.5px] transition"
      :class="
        current === tab.href
          ? 'bg-accent text-white'
          : 'text-txt-2 hover:bg-panel-2 hover:text-txt'
      "
    >
      {{ tab.label }}
    </Link>
  </nav>
</template>
