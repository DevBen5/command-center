<script setup lang="ts">
import { Link } from '@inertiajs/vue3'
import LeitnerScopeSearch from './LeitnerScopeSearch.vue'
import type { CategoryChoice } from './leitner_scope_search'

/**
 * L'écran de choix : que réviser ce soir ? Chaque ligne montre son nombre de cartes
 * **dues**, jamais son total — c'est le nombre dû qui décide de ce qu'on ouvre.
 *
 * Une portée à 0 s'affiche (elle existe) mais n'est pas un lien : elle n'invite pas
 * au clic.
 *
 * Deux accès, et le second ne remplace pas le premier : la **barre de recherche**
 * (`LeitnerScopeSearch`) en haut pour atteindre une portée en la nommant, l'**arbre**
 * en dessous pour voir d'un coup d'œil ce qui est dû. Ne retire pas l'arbre au
 * profit de la barre : c'est la seule vue d'ensemble.
 */
defineProps<{
  categories: CategoryChoice[]
  unclassifiedDueCount: number
  totalDueCount: number
}>()

function dueLabel(count: number): string {
  return count > 1 ? `${count} dues` : `${count} due`
}
</script>

<template>
  <div class="flex flex-col gap-4">
    <!-- L'accès rapide, quand on sait déjà ce qu'on veut. L'arbre reste dessous. -->
    <LeitnerScopeSearch :categories="categories" />

    <Link
      href="/revision?scope=all"
      class="flex items-center gap-3 rounded-[14px] border border-accent bg-accent-soft px-5 py-4 transition hover:opacity-90"
    >
      <div class="flex-1">
        <div class="text-[15px] font-semibold">Tout réviser</div>
        <div class="text-[11.5px] text-txt-2">Toutes les cartes dues, tous thèmes confondus</div>
      </div>
      <span class="font-mono text-[18px] font-bold text-accent">{{ dueLabel(totalDueCount) }}</span>
    </Link>

    <div class="flex items-center gap-3">
      <h2 class="text-[12px] font-bold tracking-[.12em] text-txt-2 uppercase">Ou cibler un sujet</h2>
      <span class="h-px flex-1 bg-line"></span>
    </div>

    <div v-for="category in categories" :key="category.id" class="flex flex-col gap-1.5">
      <component
        :is="category.dueCount > 0 ? Link : 'div'"
        v-bind="category.dueCount > 0 ? { href: `/revision?category=${category.id}` } : {}"
        class="flex items-center gap-3 rounded-[12px] border px-4 py-3 transition"
        :class="
          category.dueCount > 0
            ? 'border-line-2 bg-panel hover:border-accent'
            : 'border-line bg-bg-2 text-txt-3'
        "
      >
        <span class="flex-1 text-[13.5px] font-semibold">{{ category.name }}</span>
        <span
          class="font-mono text-[13px] font-bold"
          :class="category.dueCount > 0 ? 'text-accent' : 'text-txt-3'"
        >
          {{ dueLabel(category.dueCount) }}
        </span>
      </component>

      <component
        :is="theme.dueCount > 0 ? Link : 'div'"
        v-for="theme in category.themes"
        :key="theme.id"
        v-bind="theme.dueCount > 0 ? { href: `/revision?theme=${theme.id}` } : {}"
        class="ml-6 flex items-center gap-3 rounded-[10px] border px-4 py-2 transition"
        :class="
          theme.dueCount > 0
            ? 'border-line bg-panel-2 hover:border-accent'
            : 'border-line bg-bg-2 text-txt-3'
        "
      >
        <span class="flex-1 text-[12.5px]">{{ theme.name }}</span>
        <span
          class="font-mono text-[12px]"
          :class="theme.dueCount > 0 ? 'text-accent' : 'text-txt-3'"
        >
          {{ dueLabel(theme.dueCount) }}
        </span>
      </component>

      <div v-if="category.themes.length === 0" class="ml-6 text-[11.5px] text-txt-3">
        Aucun thème dans cette catégorie.
      </div>
    </div>

    <component
      :is="unclassifiedDueCount > 0 ? Link : 'div'"
      v-bind="unclassifiedDueCount > 0 ? { href: '/revision?scope=unclassified' } : {}"
      class="flex items-center gap-3 rounded-[12px] border border-dashed px-4 py-3 transition"
      :class="
        unclassifiedDueCount > 0
          ? 'border-line-2 bg-panel hover:border-accent'
          : 'border-line bg-bg-2 text-txt-3'
      "
    >
      <span class="flex-1 text-[13.5px] font-semibold">Non classées</span>
      <span
        class="font-mono text-[13px] font-bold"
        :class="unclassifiedDueCount > 0 ? 'text-accent' : 'text-txt-3'"
      >
        {{ dueLabel(unclassifiedDueCount) }}
      </span>
    </component>
  </div>
</template>
