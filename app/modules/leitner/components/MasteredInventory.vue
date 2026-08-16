<script setup lang="ts">
import { computed, ref } from 'vue'
import { useI18n } from 'vue-i18n'
import { Link } from '@inertiajs/vue3'
import { groupMasteredByMonth, type MasteredCard } from '../shared/mastery_inventory.js'

/**
 * **L'inventaire d'acquis** (CC-262) : « voilà ce que la boîte de Leitner m'a appris ».
 *
 * ⚠️ **Il ne montre pas ce qu'il reste à faire** — c'est le seul endroit du module qui ne
 * parle pas de dette. Tout le reste (file, pastille, tuiles) répond à « que dois-je
 * réviser ? » ; celui-ci répond à « qu'est-ce que je sais ? », et c'est le défaut réel que
 * le lot corrige.
 *
 * ⚠️ **Le regroupement par mois vit dans `shared/mastery_inventory.ts`, pas ici.** Un tri
 * inversé ou un mois décalé d'un jour reste parfaitement plausible à l'écran ; ce qui vit
 * dans un `<script setup>` n'est atteignable par aucun exécuteur. Ce composant ne décide
 * que du **repli**, et c'est ce que son test exerce au geste réel.
 *
 * ⚠️ **Replié par défaut, et la liste n'est alors PAS dans le DOM** (`v-if`, jamais un
 * `v-show`) : sur une base fournie l'inventaire fait des centaines de lignes, et l'écran
 * de choix doit rester l'écran où l'on choisit un paquet.
 */
const props = defineProps<{
  cards: MasteredCard[]
  total: number
  thisMonth: number
  lostThisYear: number
}>()

const { t, locale } = useI18n()

const open = ref(false)
const months = computed(() => groupMasteredByMonth(props.cards))

/**
 * « août 2026 » — dans la langue de l'interface.
 *
 * ⚠️ La clé du mois (`2026-08`) est stable et sert au regroupement ; ce libellé-ci n'est
 * que son affichage. Grouper sur une chaîne localisée mélangerait deux langues sur un
 * compte qui change de langue en cours de route.
 */
function monthLabel(monthStart: string): string {
  return new Intl.DateTimeFormat(locale.value, { month: 'long', year: 'numeric' }).format(
    new Date(monthStart)
  )
}

/** « 12 juin » — la date d'une échéance d'entretien, sans l'année quand elle est proche. */
function dayLabel(iso: string): string {
  return new Intl.DateTimeFormat(locale.value, { day: 'numeric', month: 'long' }).format(
    new Date(iso)
  )
}
</script>

<template>
  <section class="rounded-[14px] border border-line bg-panel p-5">
    <div class="flex flex-wrap items-baseline gap-x-3 gap-y-1">
      <h2 class="text-[12px] font-bold tracking-[.12em] text-txt-2 uppercase">
        {{ t('leitner.index.masteryTitle') }}
      </h2>
      <span class="text-[15px] font-semibold text-ok">
        {{
          total > 1
            ? t('leitner.index.masteryTotalPlural', { n: total })
            : t('leitner.index.masteryTotalSingular', { n: total })
        }}
      </span>
      <!-- Le total nu ne dit rien d'un mouvement : c'est « dont N ce mois-ci » qui fait la
           différence entre un compteur et un inventaire. -->
      <span v-if="thisMonth > 0" class="text-[12.5px] text-txt-2">
        {{ t('leitner.index.masteryThisMonth', { n: thisMonth }) }}
      </span>
      <!-- Et c'est le chiffre des pertes qui le rend crédible plutôt qu'auto-congratulant. -->
      <span v-if="lostThisYear > 0" class="text-[12.5px] text-warn">
        {{
          lostThisYear > 1
            ? t('leitner.index.masteryLostPlural', { n: lostThisYear })
            : t('leitner.index.masteryLostSingular', { n: lostThisYear })
        }}
      </span>
      <button
        v-if="total > 0"
        type="button"
        class="ml-auto rounded-[10px] border border-line-2 bg-panel-2 px-3 py-1.5 text-[11.5px] text-txt-2 transition hover:border-accent hover:text-txt"
        @click="open = !open"
      >
        {{ open ? t('leitner.index.masteryHide') : t('leitner.index.masteryShow') }}
      </button>
    </div>

    <p v-if="total === 0" class="mt-2 max-w-[560px] text-[12.5px] text-txt-3">
      {{ t('leitner.index.masteryEmpty') }}
    </p>

    <div v-if="open" class="mt-4 flex flex-col gap-4">
      <div v-for="month in months" :key="month.key">
        <div class="mb-1.5 flex items-baseline gap-2">
          <span class="text-[12.5px] font-semibold first-letter:uppercase">
            {{ monthLabel(month.monthStart) }}
          </span>
          <span class="text-[11px] text-txt-3">
            {{
              month.cards.length > 1
                ? t('leitner.index.masteryMonthCountPlural', { n: month.cards.length })
                : t('leitner.index.masteryMonthCountSingular', { n: month.cards.length })
            }}
          </span>
        </div>
        <ul class="overflow-hidden rounded-[10px] border border-line">
          <li
            v-for="card in month.cards"
            :key="card.id"
            class="flex items-baseline gap-3 border-b border-line px-3 py-2 last:border-b-0"
          >
            <span class="min-w-0 flex-1 truncate text-[12.5px]">{{ card.front }}</span>
            <span class="shrink-0 text-[11px] text-txt-3">{{ card.path }}</span>
            <span class="shrink-0 font-mono text-[10.5px] text-txt-3">
              {{ t('leitner.index.masteryNextReview', { date: dayLabel(card.nextReview) }) }}
            </span>
          </li>
        </ul>
      </div>

      <!-- Corriger une carte reste le geste du catalogue : `/revision` ne fait que réviser. -->
      <Link href="/revision/settings?box=5" class="text-[11.5px] text-accent hover:opacity-80">
        {{ t('leitner.index.manageCards') }}
      </Link>
    </div>
  </section>
</template>
