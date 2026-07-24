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

interface DayCell {
  date: string
  count: number
  level: number
}

interface HeatmapMonth {
  column: number
  label: string
}

interface RegularityWindow {
  windowDays: number
  activeDays: number
  percent: number
}

interface HabitStats {
  currentStreak: number
  bestStreak: number
  regularity: RegularityWindow[]
  heatmap: DayCell[]
  heatmapMonths: HeatmapMonth[]
  heatmapDays: number
  maxPerDay: number
  byWeekday: number[]
  byHour: number[]
}

defineProps<{ habits: HabitStats; stats: EffortStats }>()

/**
 * Les cinq paliers de la heatmap, en **classes littérales complètes**.
 *
 * ⚠️ **Ne remplace jamais cette table par une classe construite** (`` `bg-accent/${…}` ``) :
 * Tailwind scanne du texte, il ne résout pas d'expression. Aucune règle ne serait
 * générée, la grille serait uniformément grise — et `lint`, `typecheck` et toute la
 * suite resteraient **verts**, jsdom ne faisant aucun layout. Ça se vérifie à
 * `npm run build`, en greppant le `.css` de `public/assets/`.
 */
const LEVEL_CLASS = [
  'bg-panel-2',
  'bg-accent/25',
  'bg-accent/45',
  'bg-accent/70',
  'bg-accent',
] as const

/** Les initiales des jours, dans l'ordre de `byWeekday` — index 0 = lundi. */
const WEEKDAY_LABELS = ['L', 'M', 'M', 'J', 'V', 'S', 'D']

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

/** Le jour d'une case de la heatmap, tel qu'il apparaît dans son infobulle. */
function formatDay(iso: string): string {
  return new Date(`${iso}T12:00:00`).toLocaleDateString('fr-FR', {
    weekday: 'long',
    day: 'numeric',
    month: 'long',
  })
}

/**
 * La hauteur d'une barre d'histogramme, en **style inline** — donc hors de portée du
 * piège ci-dessus, une valeur continue ne pouvant de toute façon pas être une classe.
 * Un creux réel garde un trait visible plutôt que de disparaître.
 */
function barHeight(count: number, max: number): string {
  if (count === 0 || max === 0) return '2px'
  return `${Math.max(8, Math.round((count / max) * 100))}%`
}

function maxOf(counts: number[]): number {
  return counts.reduce((max, count) => Math.max(max, count), 0)
}
</script>

<template>
  <Head title="Stats" />

  <LeitnerTabs />

  <div class="mb-4">
    <div class="text-[18px] font-bold">L'habitude et l'effort</div>
    <div class="mt-0.5 text-[11.5px] text-txt-3">
      Tout est déduit des horodatages des révisions — aucune colonne n'a été ajoutée pour
      ça, et l'historique se relit rétroactivement. Mesures globales, jamais restreintes à
      un thème.
    </div>
  </div>

  <div class="mx-auto max-w-[880px]">
    <div class="mb-2 text-[12.5px] font-semibold text-txt-2">L'habitude</div>

    <!-- La heatmap : le graphique le plus parlant du lot. Une case par jour, du lundi
         qui précède la fenêtre jusqu'à aujourd'hui — la dernière colonne reste
         partielle, un jour à venir au palier 0 se lirait comme un jour sans révision. -->
    <div class="mb-3 rounded-[12px] border border-line bg-panel px-4 py-3">
      <div class="mb-2 flex items-center gap-2">
        <div class="text-[12.5px] font-semibold">
          {{ habits.heatmapDays }} derniers jours
        </div>
        <div class="ml-auto flex items-center gap-1.5 text-[10px] text-txt-3">
          <span>Moins</span>
          <span
            v-for="level in [0, 1, 2, 3, 4]"
            :key="level"
            class="h-[11px] w-[11px] rounded-[2px]"
            :class="LEVEL_CLASS[level]"
          />
          <span>Plus</span>
        </div>
      </div>

      <div class="overflow-x-auto pb-1">
        <div class="flex gap-2">
          <!-- Les initiales de jour, une ligne sur deux : les sept se chevaucheraient. -->
          <div
            class="mt-[14px] grid grid-rows-7 gap-[3px] text-[9px] leading-[11px] text-txt-3"
          >
            <span v-for="(label, index) in WEEKDAY_LABELS" :key="index">
              {{ index % 2 === 0 ? label : '' }}
            </span>
          </div>

          <div>
            <div class="mb-[3px] grid h-[11px] grid-flow-col gap-[3px] text-[9px] text-txt-3">
              <span
                v-for="month in habits.heatmapMonths"
                :key="month.column"
                class="w-[11px] whitespace-nowrap"
                :style="{ gridColumnStart: month.column }"
              >
                {{ month.label }}
              </span>
            </div>

            <div class="grid grid-flow-col grid-rows-7 gap-[3px]">
              <span
                v-for="cell in habits.heatmap"
                :key="cell.date"
                class="h-[11px] w-[11px] rounded-[2px]"
                :class="LEVEL_CLASS[cell.level]"
                :title="`${formatDay(cell.date)} — ${cell.count} révision${cell.count > 1 ? 's' : ''}`"
              />
            </div>
          </div>
        </div>
      </div>
    </div>

    <!-- Les séries et la régularité. `bestStreak` lit TOUT l'historique : une série
         tenue il y a deux ans reste la meilleure. -->
    <div class="mb-3 grid grid-cols-5 gap-3">
      <div class="rounded-[12px] border border-line bg-panel px-4 py-3 text-center">
        <div class="font-mono text-[22px] font-bold">{{ habits.currentStreak }} j</div>
        <div class="text-[10.5px] text-txt-3">série en cours</div>
      </div>
      <div class="rounded-[12px] border border-line bg-panel px-4 py-3 text-center">
        <div class="font-mono text-[22px] font-bold text-aqua">{{ habits.bestStreak }} j</div>
        <div class="text-[10.5px] text-txt-3">meilleure série</div>
      </div>
      <!-- Le brut est affiché à côté du pourcentage, et jamais l'inverse : sur une base
           jeune, « 8 % » seul se lirait comme un échec plutôt que comme une base jeune. -->
      <div
        v-for="window in habits.regularity"
        :key="window.windowDays"
        class="rounded-[12px] border border-line bg-panel px-4 py-3 text-center"
      >
        <div class="font-mono text-[22px] font-bold">{{ window.percent }} %</div>
        <div class="text-[10.5px] text-txt-3">
          {{ window.activeDays }} / {{ window.windowDays }} j actifs
        </div>
      </div>
    </div>

    <!-- Le rythme, sur la même fenêtre que la heatmap. -->
    <div class="mb-5 grid grid-cols-2 gap-3">
      <div class="rounded-[12px] border border-line bg-panel px-4 py-3">
        <div class="mb-2 text-[12.5px] font-semibold">Par jour de la semaine</div>
        <div class="flex h-[60px] items-end gap-1.5">
          <div
            v-for="(count, index) in habits.byWeekday"
            :key="index"
            class="flex h-full flex-1 items-end"
            :title="`${count} révision${count > 1 ? 's' : ''}`"
          >
            <div
              class="w-full rounded-t-[2px]"
              :class="count === 0 ? 'bg-panel-2' : 'bg-accent/70'"
              :style="{ height: barHeight(count, maxOf(habits.byWeekday)) }"
            />
          </div>
        </div>
        <div class="mt-1 flex gap-1.5 text-center text-[9.5px] text-txt-3">
          <span v-for="(label, index) in WEEKDAY_LABELS" :key="index" class="flex-1">
            {{ label }}
          </span>
        </div>
      </div>

      <div class="rounded-[12px] border border-line bg-panel px-4 py-3">
        <div class="mb-2 text-[12.5px] font-semibold">Par heure</div>
        <div class="flex h-[60px] items-end gap-[2px]">
          <div
            v-for="(count, hour) in habits.byHour"
            :key="hour"
            class="flex h-full flex-1 items-end"
            :title="`${hour} h — ${count} révision${count > 1 ? 's' : ''}`"
          >
            <div
              class="w-full rounded-t-[2px]"
              :class="count === 0 ? 'bg-panel-2' : 'bg-aqua/70'"
              :style="{ height: barHeight(count, maxOf(habits.byHour)) }"
            />
          </div>
        </div>
        <div class="mt-1 flex gap-[2px] text-center text-[9.5px] text-txt-3">
          <span v-for="hour in 24" :key="hour" class="flex-1">
            {{ (hour - 1) % 6 === 0 ? hour - 1 : '' }}
          </span>
        </div>
      </div>
    </div>

    <div class="mb-2 text-[12.5px] font-semibold text-txt-2">L'effort</div>

    <div class="mb-2 text-[11.5px] text-txt-3">
      Une session est une suite de cartes séparées de moins de {{ stats.gapMinutes }}
      minutes. Le seuil est une convention : rien ne distingue une pause café d'une carte
      qu'on rumine.
    </div>

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
