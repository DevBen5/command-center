<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import { Head, Link, router } from '@inertiajs/vue3'
import AppLayout from '~/layouts/AppLayout.vue'
import LeitnerTabs from '../components/LeitnerTabs.vue'

defineOptions({ layout: AppLayout })

type Grade = 'again' | 'hard' | 'good' | 'easy'

interface LeitnerCard {
  id: number
  front: string
  back: string
  box: number
  // Note de la révision précédente : deux `hard` d'affilée ramènent en boîte 1.
  lastGrade: Grade | null
  theme: { id: number; name: string; category: { id: number; name: string } } | null
}

interface Stats {
  reviewedToday: number
  streak: number
  dueCount: number
  totalCards: number
  retention: number | null
}

const props = defineProps<{
  dueCards: LeitnerCard[]
  boxCounts: Record<number, number>
  // Intervalles envoyés par le serveur (BOX_INTERVAL_DAYS) : ne pas les redéclarer ici.
  boxIntervals: Record<number, number>
  stats: Stats
}>()

/** « tous les jours » / « tous les 4 j » — libellé de la grille des boîtes. */
function boxIntervalLabel(box: number): string {
  const days = props.boxIntervals[box] ?? 0
  return days === 1 ? 'tous les jours' : `tous les ${days} j`
}

/** « demain » / « dans 4 j » — échéance annoncée par un bouton de note. */
function dueLabel(box: number): string {
  const days = props.boxIntervals[box] ?? 0
  return days === 1 ? 'demain' : `dans ${days} j`
}

const currentCard = computed(() => props.dueCards[0] ?? null)
const revealed = ref(false)

// Chaque bouton annonce la boîte atteinte et l'échéance : quatre notes, quatre effets.
const gradeActions = computed(() => {
  const card = currentCard.value
  if (!card) return []

  const good = Math.min(5, card.box + 1)
  const easy = Math.min(5, card.box + 2)
  const hardDemotes = card.lastGrade === 'hard'

  return [
    { grade: 'again' as Grade, label: 'À revoir', hint: 'boîte 1 · revient dans la session' },
    {
      grade: 'hard' as Grade,
      label: 'Difficile',
      hint: hardDemotes
        ? `2ᵉ d'affilée · boîte 1 · ${dueLabel(1)}`
        : `reste boîte ${card.box} · ${dueLabel(card.box)}`,
    },
    { grade: 'good' as Grade, label: 'Correct', hint: `boîte ${good} · ${dueLabel(good)}` },
    { grade: 'easy' as Grade, label: 'Facile', hint: `boîte ${easy} · ${dueLabel(easy)}` },
  ]
})

watch(
  () => currentCard.value?.id,
  () => {
    revealed.value = false
  }
)

function grade(g: Grade): void {
  if (!currentCard.value) return
  router.post(`/revision/${currentCard.value.id}/review`, { grade: g }, { preserveScroll: true })
}
</script>

<template>
  <Head title="Révision" />

  <LeitnerTabs />

  <div class="mb-4 flex items-center gap-3">
    <div>
      <div class="text-[18px] font-bold">
        {{ stats.dueCount }} carte{{ stats.dueCount > 1 ? 's' : '' }} due{{
          stats.dueCount > 1 ? 's' : ''
        }}
        aujourd'hui
      </div>
    </div>
    <div class="ml-auto flex gap-3">
      <div class="rounded-[12px] border border-line bg-panel px-4 py-2.5 text-center">
        <div class="font-mono text-[20px] font-bold">{{ stats.streak }} j</div>
        <div class="text-[10.5px] text-txt-3">série</div>
      </div>
      <div class="rounded-[12px] border border-line bg-panel px-4 py-2.5 text-center">
        <div class="font-mono text-[20px] font-bold">{{ stats.reviewedToday }}</div>
        <div class="text-[10.5px] text-txt-3">révisées auj.</div>
      </div>
      <div class="rounded-[12px] border border-line bg-panel px-4 py-2.5 text-center">
        <div class="font-mono text-[20px] font-bold">
          {{ stats.retention !== null ? `${stats.retention}%` : '—' }}
        </div>
        <div class="text-[10.5px] text-txt-3">rétention (30j)</div>
      </div>
      <div class="rounded-[12px] border border-line bg-panel px-4 py-2.5 text-center">
        <div class="font-mono text-[20px] font-bold">{{ stats.totalCards }}</div>
        <div class="text-[10.5px] text-txt-3">total cartes</div>
      </div>
    </div>
  </div>

  <div class="mx-auto max-w-[880px]">
    <div
      v-if="currentCard"
      class="flex min-h-[230px] flex-col items-center justify-center gap-4 rounded-[14px] border border-line-2 bg-panel p-9 text-center"
    >
      <div class="flex flex-wrap items-center justify-center gap-1.5">
        <span class="rounded-full border border-line-2 bg-panel-2 px-2.5 py-1 text-[11px] text-txt-2">
          Boîte {{ currentCard.box }} · {{ dueCards.length }} restantes
        </span>
        <span
          v-if="currentCard.theme"
          class="rounded-full border border-accent bg-accent-soft px-2.5 py-1 text-[11px] text-txt-2"
        >
          {{ currentCard.theme.category.name }} · {{ currentCard.theme.name }}
        </span>
      </div>
      <div class="max-w-[420px] text-[19px] font-semibold">{{ currentCard.front }}</div>

      <button
        v-if="!revealed"
        type="button"
        class="w-3/5 rounded-[10px] border border-dashed border-line-2 bg-accent-soft py-3.5 text-[11.5px] text-txt-2"
        @click="revealed = true"
      >
        verso masqué — cliquer pour révéler
      </button>
      <div v-else class="w-3/5 rounded-[10px] border border-line bg-bg-2 p-4 text-[13px] text-txt-2">
        {{ currentCard.back }}
      </div>

      <div v-if="revealed" class="flex flex-wrap justify-center gap-2">
        <button
          v-for="action in gradeActions"
          :key="action.grade"
          type="button"
          class="min-w-[140px] rounded-[9px] border px-3.5 py-2 transition"
          :class="
            action.grade === 'easy'
              ? 'border-accent bg-accent text-white hover:opacity-90'
              : 'border-line-2 bg-panel-2 hover:border-accent'
          "
          @click="grade(action.grade)"
        >
          <span class="block text-[12.5px] font-semibold">{{ action.label }}</span>
          <span
            class="mt-0.5 block text-[10.5px]"
            :class="action.grade === 'easy' ? 'text-white opacity-75' : 'text-txt-3'"
          >
            {{ action.hint }}
          </span>
        </button>
      </div>
    </div>
    <div
      v-else
      class="flex min-h-[230px] flex-col items-center justify-center gap-2 rounded-[14px] border border-dashed border-line-2 bg-bg-2 p-9 text-center"
    >
      <template v-if="stats.totalCards">
        <div class="text-[16px] font-semibold">Tout est à jour — aucune carte due</div>
        <div class="max-w-[380px] text-[12.5px] text-txt-2">
          Revenez demain, ou enrichissez votre base depuis la gestion des cartes.
        </div>
      </template>
      <template v-else>
        <div class="text-[16px] font-semibold">Votre base de révision est vide</div>
        <div class="max-w-[380px] text-[12.5px] text-txt-2">
          Créez vos catégories, vos thèmes et vos cartes depuis la gestion des cartes : elles
          apparaîtront ici dès la prochaine session.
        </div>
      </template>
      <Link
        href="/revision/settings"
        class="mt-2 rounded-[10px] border border-accent bg-accent px-3.5 py-2 text-[12.5px] text-white transition hover:opacity-90"
      >
        Gérer les cartes
      </Link>
    </div>

    <div class="mt-6 mb-3 flex items-center gap-3">
      <h2 class="text-[12px] font-bold tracking-[.12em] text-txt-2 uppercase">Boîtes Leitner</h2>
      <span class="h-px flex-1 bg-line"></span>
    </div>
    <div class="grid grid-cols-5 gap-3.5">
      <div
        v-for="box in [1, 2, 3, 4, 5]"
        :key="box"
        class="rounded-[12px] border p-4 text-center"
        :class="box <= 3 ? 'border-accent bg-accent-soft' : 'border-line bg-panel'"
      >
        <div class="text-[10px] tracking-[.1em] text-txt-3 uppercase">Boîte {{ box }}</div>
        <div
          class="my-2 font-mono text-[26px] font-bold"
          :class="box <= 3 ? 'text-accent' : 'text-txt'"
        >
          {{ boxCounts[box] ?? 0 }}
        </div>
        <div class="text-[10.5px] text-txt-2">{{ boxIntervalLabel(box) }}</div>
      </div>
    </div>
  </div>
</template>
