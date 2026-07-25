<script setup lang="ts">
import { computed } from 'vue'
import { useI18n } from 'vue-i18n'
import { Head, Link } from '@inertiajs/vue3'
import AppLayout from '~/layouts/AppLayout.vue'
import LeitnerTabs from '../components/LeitnerTabs.vue'

defineOptions({ layout: AppLayout })

const { t } = useI18n()

/**
 * « révision(s) » / « carte(s) » accordés en nombre. On garde EXACTEMENT la règle du module
 * (`n > 1 ? pluriel : singulier` — donc 0 et 1 au singulier) plutôt que la pluralisation de
 * vue-i18n, dont le choix par défaut diffère à `n = 0` : une case de heatmap vide afficherait
 * « 0 révisions » au lieu de « 0 révision ».
 */
const reviews = (n: number): string =>
  n > 1 ? t('leitner.stats.reviewsPlural') : t('leitner.stats.reviewsSingular')
const cards = (n: number): string =>
  n > 1 ? t('leitner.stats.cardsPlural') : t('leitner.stats.cardsSingular')

interface RecentSession {
  startedAt: string
  durationSeconds: number
  cardCount: number
}

interface RetentionWindow {
  days: number
  rate: number | null
}

interface WeaknessTheme {
  themeId: number
  name: string
  total: number
  again: number
  rate: number
  enoughData: boolean
}

interface WeaknessCategory {
  categoryId: number | null
  name: string
  total: number
  again: number
  rate: number
  enoughData: boolean
  themes: WeaknessTheme[]
}

interface ProblemCard {
  id: number
  front: string
  box: number
  path: string
  count: number
}

interface ProblemCards {
  mostAgain: ProblemCard[]
  stuck: ProblemCard[]
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

const props = defineProps<{
  habits: HabitStats
  stats: EffortStats
  retention: RetentionWindow[]
  weakness: WeaknessCategory[]
  problemCards: ProblemCards
}>()

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
const WEEKDAY_LABELS = computed(() => [
  t('leitner.stats.weekday.mon'),
  t('leitner.stats.weekday.tue'),
  t('leitner.stats.weekday.wed'),
  t('leitner.stats.weekday.thu'),
  t('leitner.stats.weekday.fri'),
  t('leitner.stats.weekday.sat'),
  t('leitner.stats.weekday.sun'),
])

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

/** Rétention : `null` → `—`, jamais `0 %` (une base neuve n'a pas une rétention nulle). */
function formatRate(rate: number | null): string {
  return rate === null ? '—' : `${rate} %`
}

/**
 * Le classement à afficher : une catégorie n'entre que si elle a assez de volume — sauf
 * « Non classées » (`categoryId === null`), qui reste toujours visible (le ticket l'exige).
 * Sous chaque catégorie, seuls les thèmes au-dessus du seuil (`enoughData`) : les autres
 * comptent dans l'agrégat mais ne se donnent pas à voir comme un point faible.
 */
const displayedWeakness = computed(() =>
  props.weakness
    .filter((category) => category.enoughData || category.categoryId === null)
    .map((category) => ({
      ...category,
      shownThemes: category.themes.filter((theme) => theme.enoughData),
    }))
)

/** Un taux d'oubli élevé se lit rouge, moyen orange — c'est un défaut, pas un score. */
function rateClass(rate: number): string {
  if (rate >= 50) return 'text-bad'
  if (rate >= 25) return 'text-warn'
  return 'text-txt-2'
}

/** Vers `/revision/settings`, seul point de saisie — la carte exacte via le filtre de recherche. */
function cardLink(front: string): string {
  return `/revision/settings?search=${encodeURIComponent(front)}`
}
</script>

<template>
  <Head :title="t('leitner.stats.title')" />

  <LeitnerTabs />

  <div class="mb-4">
    <div class="text-[18px] font-bold">{{ t('leitner.stats.heading') }}</div>
    <div class="mt-0.5 text-[11.5px] text-txt-3">
      {{ t('leitner.stats.intro') }}
    </div>
  </div>

  <div class="mx-auto max-w-[880px]">
    <!-- ================= Les points faibles : la rétention rendue actionnable ================= -->
    <div class="mb-2 text-[12.5px] font-semibold text-txt-2">{{ t('leitner.stats.weakness.title') }}</div>

    <!-- La rétention sur trois fenêtres, pour lire une tendance. « Difficile » compte
         comme une réussite ; seul « à revoir » est un échec de rappel. -->
    <div class="mb-3 grid grid-cols-3 gap-3">
      <div
        v-for="window in retention"
        :key="window.days"
        class="rounded-[12px] border border-line bg-panel px-4 py-3 text-center"
      >
        <div class="font-mono text-[22px] font-bold">{{ formatRate(window.rate) }}</div>
        <div class="text-[10.5px] text-txt-3">{{ t('leitner.stats.retention', { days: window.days }) }}</div>
      </div>
    </div>

    <!-- Le taux d'« à revoir » par thème, agrégé par catégorie. Le classement n'affiche
         que ce qui a au moins 10 révisions — en dessous, un taux ne veut rien dire. -->
    <div
      v-if="displayedWeakness.length === 0"
      class="mb-3 rounded-[12px] border border-line bg-panel px-4 py-6 text-center"
    >
      <div class="text-[12.5px] text-txt-2">{{ t('leitner.stats.weakness.empty') }}</div>
      <div class="mt-1 text-[11.5px] text-txt-3">
        {{ t('leitner.stats.weakness.emptyHint') }}
      </div>
    </div>

    <div v-else class="mb-3 space-y-2">
      <template v-for="category in displayedWeakness" :key="category.categoryId ?? 'unclassified'">
        <!-- Catégorie avec des thèmes assez révisés → dépliable. -->
        <details
          v-if="category.shownThemes.length > 0"
          class="rounded-[12px] border border-line bg-panel"
        >
          <summary
            class="flex cursor-pointer items-center gap-3 px-4 py-2.5 text-[12.5px] font-semibold"
          >
            <span>{{ category.name }}</span>
            <span class="ml-auto font-mono text-[11px] text-txt-3">{{ t('leitner.stats.reviewsShort', { n: category.total }) }}</span>
            <span class="w-[52px] text-right font-mono font-bold" :class="rateClass(category.rate)">
              {{ category.rate }} %
            </span>
          </summary>

          <Link
            v-for="theme in category.shownThemes"
            :key="theme.themeId"
            :href="`/revision/settings?themeId=${theme.themeId}`"
            class="flex items-center gap-3 border-t border-line px-4 py-2 pl-8 text-[12px] hover:bg-panel-2"
          >
            <span class="text-txt-2">{{ theme.name }}</span>
            <span class="ml-auto font-mono text-[11px] text-txt-3">{{ t('leitner.stats.reviewsShort', { n: theme.total }) }}</span>
            <span class="w-[52px] text-right font-mono" :class="rateClass(theme.rate)">
              {{ theme.rate }} %
            </span>
          </Link>
        </details>

        <!-- Sans thème affichable (« Non classées », ou catégorie au volume juste au global). -->
        <Link
          v-else-if="category.categoryId === null"
          href="/revision/settings?unclassified=1"
          class="flex items-center gap-3 rounded-[12px] border border-line bg-panel px-4 py-2.5 text-[12.5px] font-semibold hover:bg-panel-2"
        >
          <span>{{ category.name }}</span>
          <span class="ml-auto font-mono text-[11px] text-txt-3">{{ t('leitner.stats.reviewsShort', { n: category.total }) }}</span>
          <span
            class="w-[52px] text-right font-mono font-bold"
            :class="category.enoughData ? rateClass(category.rate) : 'text-txt-3'"
          >
            {{ category.rate }} %
          </span>
        </Link>

        <div
          v-else
          class="flex items-center gap-3 rounded-[12px] border border-line bg-panel px-4 py-2.5 text-[12.5px] font-semibold"
        >
          <span>{{ category.name }}</span>
          <span class="ml-auto font-mono text-[11px] text-txt-3">{{ t('leitner.stats.reviewsShort', { n: category.total }) }}</span>
          <span class="w-[52px] text-right font-mono font-bold" :class="rateClass(category.rate)">
            {{ category.rate }} %
          </span>
        </div>
      </template>
    </div>

    <!-- Deux listes de cartes à corriger. Un clic ouvre la carte dans les réglages — le
         seul endroit où on l'édite. -->
    <div class="mb-5 grid grid-cols-2 gap-3">
      <div class="rounded-[12px] border border-line bg-panel">
        <div class="border-b border-line px-4 py-2.5 text-[12.5px] font-semibold">
          {{ t('leitner.stats.mostAgainTitle') }}
        </div>

        <div v-if="problemCards.mostAgain.length === 0" class="px-4 py-6 text-center">
          <div class="text-[12px] text-txt-3">{{ t('leitner.stats.mostAgainEmpty') }}</div>
        </div>

        <Link
          v-for="card in problemCards.mostAgain"
          :key="card.id"
          :href="cardLink(card.front)"
          class="flex items-center gap-3 border-b border-line px-4 py-2 text-[12px] last:border-b-0 hover:bg-panel-2"
        >
          <span class="min-w-0 flex-1">
            <span class="block truncate text-txt-2">{{ card.front }}</span>
            <span class="block truncate text-[10.5px] text-txt-3">{{ card.path }}</span>
          </span>
          <span class="shrink-0 font-mono text-[10.5px] text-txt-3">{{ t('leitner.stats.boxShort', { n: card.box }) }}</span>
          <span class="w-[54px] shrink-0 text-right font-mono font-bold text-bad">
            {{ card.count }}×
          </span>
        </Link>
      </div>

      <div class="rounded-[12px] border border-line bg-panel">
        <div class="border-b border-line px-4 py-2.5 text-[12.5px] font-semibold">
          {{ t('leitner.stats.stuckTitle') }}
        </div>

        <div v-if="problemCards.stuck.length === 0" class="px-4 py-6 text-center">
          <div class="text-[12px] text-txt-3">{{ t('leitner.stats.stuckEmpty') }}</div>
        </div>

        <Link
          v-for="card in problemCards.stuck"
          :key="card.id"
          :href="cardLink(card.front)"
          class="flex items-center gap-3 border-b border-line px-4 py-2 text-[12px] last:border-b-0 hover:bg-panel-2"
        >
          <span class="min-w-0 flex-1">
            <span class="block truncate text-txt-2">{{ card.front }}</span>
            <span class="block truncate text-[10.5px] text-txt-3">{{ card.path }}</span>
          </span>
          <span class="shrink-0 font-mono text-[10.5px] text-warn">{{ t('leitner.stats.boxShort', { n: card.box }) }}</span>
          <span class="w-[54px] shrink-0 text-right font-mono text-txt-3">
            {{ t('leitner.stats.reviewsShort', { n: card.count }) }}
          </span>
        </Link>
      </div>
    </div>

    <div class="mb-2 text-[12.5px] font-semibold text-txt-2">{{ t('leitner.stats.habit.title') }}</div>

    <!-- La heatmap : le graphique le plus parlant du lot. Une case par jour, du lundi
         qui précède la fenêtre jusqu'à aujourd'hui — la dernière colonne reste
         partielle, un jour à venir au palier 0 se lirait comme un jour sans révision. -->
    <div class="mb-3 rounded-[12px] border border-line bg-panel px-4 py-3">
      <div class="mb-2 flex items-center gap-2">
        <div class="text-[12.5px] font-semibold">
          {{ t('leitner.stats.habit.lastDays', { n: habits.heatmapDays }) }}
        </div>
        <div class="ml-auto flex items-center gap-1.5 text-[10px] text-txt-3">
          <span>{{ t('leitner.stats.habit.less') }}</span>
          <span
            v-for="level in [0, 1, 2, 3, 4]"
            :key="level"
            class="h-[11px] w-[11px] rounded-[2px]"
            :class="LEVEL_CLASS[level]"
          />
          <span>{{ t('leitner.stats.habit.more') }}</span>
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
                :title="`${formatDay(cell.date)} — ${cell.count} ${reviews(cell.count)}`"
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
        <div class="font-mono text-[22px] font-bold">{{ t('leitner.stats.daysValue', { n: habits.currentStreak }) }}</div>
        <div class="text-[10.5px] text-txt-3">{{ t('leitner.stats.habit.currentStreak') }}</div>
      </div>
      <div class="rounded-[12px] border border-line bg-panel px-4 py-3 text-center">
        <div class="font-mono text-[22px] font-bold text-aqua">{{ t('leitner.stats.daysValue', { n: habits.bestStreak }) }}</div>
        <div class="text-[10.5px] text-txt-3">{{ t('leitner.stats.habit.bestStreak') }}</div>
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
          {{ t('leitner.stats.habit.activeDays', { active: window.activeDays, total: window.windowDays }) }}
        </div>
      </div>
    </div>

    <!-- Le rythme, sur la même fenêtre que la heatmap. -->
    <div class="mb-5 grid grid-cols-2 gap-3">
      <div class="rounded-[12px] border border-line bg-panel px-4 py-3">
        <div class="mb-2 text-[12.5px] font-semibold">{{ t('leitner.stats.habit.byWeekday') }}</div>
        <div class="flex h-[60px] items-end gap-1.5">
          <div
            v-for="(count, index) in habits.byWeekday"
            :key="index"
            class="flex h-full flex-1 items-end"
            :title="`${count} ${reviews(count)}`"
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
        <div class="mb-2 text-[12.5px] font-semibold">{{ t('leitner.stats.habit.byHour') }}</div>
        <div class="flex h-[60px] items-end gap-[2px]">
          <div
            v-for="(count, hour) in habits.byHour"
            :key="hour"
            class="flex h-full flex-1 items-end"
            :title="`${hour} h — ${count} ${reviews(count)}`"
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

    <div class="mb-2 text-[12.5px] font-semibold text-txt-2">{{ t('leitner.stats.effort.title') }}</div>

    <div class="mb-2 text-[11.5px] text-txt-3">
      {{ t('leitner.stats.effort.intro', { n: stats.gapMinutes }) }}
    </div>

    <!-- Le rythme : à quelle fréquence on s'y met. -->
    <div class="mb-3 grid grid-cols-3 gap-3">
      <div class="rounded-[12px] border border-line bg-panel px-4 py-3 text-center">
        <div class="font-mono text-[22px] font-bold">{{ stats.sessions7 }}</div>
        <div class="text-[10.5px] text-txt-3">{{ t('leitner.stats.effort.sessionsWindow', { days: 7 }) }}</div>
      </div>
      <div class="rounded-[12px] border border-line bg-panel px-4 py-3 text-center">
        <div class="font-mono text-[22px] font-bold">{{ stats.sessions30 }}</div>
        <div class="text-[10.5px] text-txt-3">{{ t('leitner.stats.effort.sessionsWindow', { days: 30 }) }}</div>
      </div>
      <div class="rounded-[12px] border border-line bg-panel px-4 py-3 text-center">
        <div class="font-mono text-[22px] font-bold">{{ stats.sessions365 }}</div>
        <div class="text-[10.5px] text-txt-3">{{ t('leitner.stats.effort.sessionsWindow', { days: 365 }) }}</div>
      </div>
    </div>

    <!-- La forme d'une session, sur la fenêtre de détail. Des MÉDIANES : une session
         à deux cartes écraserait une moyenne. -->
    <div class="mb-4 grid grid-cols-4 gap-3">
      <div class="rounded-[12px] border border-line bg-panel px-4 py-3 text-center">
        <div class="font-mono text-[22px] font-bold">
          {{ formatDuration(stats.medianSessionSeconds) }}
        </div>
        <div class="text-[10.5px] text-txt-3">{{ t('leitner.stats.effort.medianDuration') }}</div>
      </div>
      <div class="rounded-[12px] border border-line bg-panel px-4 py-3 text-center">
        <div class="font-mono text-[22px] font-bold">
          {{ formatCards(stats.medianCardsPerSession) }}
        </div>
        <div class="text-[10.5px] text-txt-3">{{ t('leitner.stats.effort.cardsPerSession') }}</div>
      </div>
      <div class="rounded-[12px] border border-line bg-panel px-4 py-3 text-center">
        <div class="font-mono text-[22px] font-bold">
          {{ formatDuration(stats.medianCardSeconds) }}
        </div>
        <div class="text-[10.5px] text-txt-3">{{ t('leitner.stats.effort.medianPerCard') }}</div>
      </div>
      <div class="rounded-[12px] border border-line bg-panel px-4 py-3 text-center">
        <div class="font-mono text-[22px] font-bold text-aqua">
          {{ formatDuration(stats.totalSeconds) }}
        </div>
        <div class="text-[10.5px] text-txt-3">{{ t('leitner.stats.effort.totalTime') }}</div>
      </div>
    </div>

    <div class="mb-2 text-[11.5px] text-txt-3">
      {{ t('leitner.stats.effort.windowNote', { n: stats.windowDays }) }}
    </div>

    <div class="rounded-[12px] border border-line bg-panel">
      <div class="border-b border-line px-4 py-2.5 text-[12.5px] font-semibold">
        {{ t('leitner.stats.effort.recentTitle') }}
      </div>

      <div v-if="stats.recentSessions.length === 0" class="px-4 py-6 text-center">
        <div class="text-[12.5px] text-txt-2">{{ t('leitner.stats.effort.recentEmpty') }}</div>
        <div class="mt-1 text-[11.5px] text-txt-3">
          {{ t('leitner.stats.effort.recentEmptyHint') }}
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
            {{ session.cardCount }} {{ cards(session.cardCount) }}
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
