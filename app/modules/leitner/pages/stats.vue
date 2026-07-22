<script setup lang="ts">
import { Head } from '@inertiajs/vue3'
import AppLayout from '~/layouts/AppLayout.vue'
import LeitnerTabs from '../components/LeitnerTabs.vue'

defineOptions({ layout: AppLayout })

interface RecentSession {
  startedAt: string
  durationSeconds: number
  cardCount: number
}

interface EffortStats {
  gapMinutes: number
  windowDays: number
  sessions7: number
  sessions30: number
  sessions365: number
  medianSessionSeconds: number | null
  medianCardSeconds: number | null
  medianCardsPerSession: number | null
  totalSeconds: number
  recentSessions: RecentSession[]
}

defineProps<{ stats: EffortStats }>()

/**
 * Une durée en secondes → du lisible. `null` rend `—` : le serveur ne renvoie jamais
 * `0` pour « rien à mesurer », et la page ne doit pas le réintroduire — « 0 min »
 * se lirait comme une mesure alors que c'est une absence.
 *
 * Une vraie durée de 0 (session à une carte) s'affiche, elle, bel et bien `0 s`.
 */
function formatDuration(seconds: number | null): string {
  if (seconds === null) return '—'

  const total = Math.round(seconds)
  if (total < 60) return `${total} s`

  const minutes = Math.floor(total / 60)
  if (minutes < 60) return `${minutes} min`

  return `${Math.floor(minutes / 60)} h ${String(minutes % 60).padStart(2, '0')}`
}

/** La médiane d'un compte de cartes tombe sur un demi quand la fenêtre est paire. */
function formatCards(count: number | null): string {
  if (count === null) return '—'
  return Number.isInteger(count) ? String(count) : count.toFixed(1)
}

function formatDate(iso: string): string {
  return new Date(iso).toLocaleDateString('fr-FR', {
    day: 'numeric',
    month: 'short',
    hour: '2-digit',
    minute: '2-digit',
  })
}
</script>

<template>
  <Head title="Stats" />

  <LeitnerTabs />

  <div class="mb-4">
    <div class="text-[18px] font-bold">L'effort de révision</div>
    <div class="mt-0.5 text-[11.5px] text-txt-3">
      Déduit des horodatages des révisions : une session est une suite de cartes
      séparées de moins de {{ stats.gapMinutes }} minutes. Mesures globales, jamais
      restreintes à un thème.
    </div>
  </div>

  <div class="mx-auto max-w-[880px]">
    <!-- Le rythme : à quelle fréquence on s'y met. -->
    <div class="mb-3 grid grid-cols-3 gap-3">
      <div class="rounded-[12px] border border-line bg-panel px-4 py-3 text-center">
        <div class="font-mono text-[22px] font-bold">{{ stats.sessions7 }}</div>
        <div class="text-[10.5px] text-txt-3">sessions (7 j)</div>
      </div>
      <div class="rounded-[12px] border border-line bg-panel px-4 py-3 text-center">
        <div class="font-mono text-[22px] font-bold">{{ stats.sessions30 }}</div>
        <div class="text-[10.5px] text-txt-3">sessions (30 j)</div>
      </div>
      <div class="rounded-[12px] border border-line bg-panel px-4 py-3 text-center">
        <div class="font-mono text-[22px] font-bold">{{ stats.sessions365 }}</div>
        <div class="text-[10.5px] text-txt-3">sessions (365 j)</div>
      </div>
    </div>

    <!-- La forme d'une session, sur la fenêtre de détail. Des MÉDIANES : une session
         à deux cartes écraserait une moyenne. -->
    <div class="mb-4 grid grid-cols-4 gap-3">
      <div class="rounded-[12px] border border-line bg-panel px-4 py-3 text-center">
        <div class="font-mono text-[22px] font-bold">
          {{ formatDuration(stats.medianSessionSeconds) }}
        </div>
        <div class="text-[10.5px] text-txt-3">durée médiane</div>
      </div>
      <div class="rounded-[12px] border border-line bg-panel px-4 py-3 text-center">
        <div class="font-mono text-[22px] font-bold">
          {{ formatCards(stats.medianCardsPerSession) }}
        </div>
        <div class="text-[10.5px] text-txt-3">cartes / session</div>
      </div>
      <div class="rounded-[12px] border border-line bg-panel px-4 py-3 text-center">
        <div class="font-mono text-[22px] font-bold">
          {{ formatDuration(stats.medianCardSeconds) }}
        </div>
        <div class="text-[10.5px] text-txt-3">médiane par carte</div>
      </div>
      <div class="rounded-[12px] border border-line bg-panel px-4 py-3 text-center">
        <div class="font-mono text-[22px] font-bold text-aqua">
          {{ formatDuration(stats.totalSeconds) }}
        </div>
        <div class="text-[10.5px] text-txt-3">temps total</div>
      </div>
    </div>

    <div class="mb-2 text-[11.5px] text-txt-3">
      Durées, cartes par session et temps par carte portent sur les
      {{ stats.windowDays }} derniers jours.
    </div>

    <div class="rounded-[12px] border border-line bg-panel">
      <div class="border-b border-line px-4 py-2.5 text-[12.5px] font-semibold">
        Dernières sessions
      </div>

      <div v-if="stats.recentSessions.length === 0" class="px-4 py-6 text-center">
        <div class="text-[12.5px] text-txt-2">Aucune session pour l'instant.</div>
        <div class="mt-1 text-[11.5px] text-txt-3">
          Les statistiques se remplissent toutes seules, à mesure des révisions.
        </div>
      </div>

      <div v-else>
        <div
          v-for="session in stats.recentSessions"
          :key="session.startedAt"
          class="flex items-center gap-3 border-b border-line px-4 py-2.5 text-[12.5px] last:border-b-0"
        >
          <span class="text-txt-2">{{ formatDate(session.startedAt) }}</span>
          <span class="ml-auto font-mono text-txt">
            {{ session.cardCount }} carte{{ session.cardCount > 1 ? 's' : '' }}
          </span>
          <!-- Une session à une carte dure 0, et s'affiche telle quelle : la masquer
               serait mentir sur l'effort. -->
          <span class="w-[70px] text-right font-mono text-txt-3">
            {{ formatDuration(session.durationSeconds) }}
          </span>
        </div>
      </div>
    </div>
  </div>
</template>
