<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import { Head, Link, router } from '@inertiajs/vue3'
import AppLayout from '~/layouts/AppLayout.vue'
import {
  fromMinutes,
  formatInterval,
  formatQuantity,
  toMinutes,
  unitBounds,
  type IntervalUnit,
} from '../shared/interval.js'

defineOptions({ layout: AppLayout })

interface VeilleSource {
  id: number
  kind: string
  url: string
  title: string
  fetchIntervalMinutes: number
  lastFetchedAt: string | null
  lastError: string | null
  lastErrorAt: string | null
  lastItemCount: number | null
  active: boolean
}

/** Le couple saisi tel qu'il est en cours d'édition — jamais converti côté page. */
interface IntervalDraft {
  interval: number
  intervalUnit: IntervalUnit
}

const props = defineProps<{
  sources: VeilleSource[]
  notification: { type: string; message: string } | null
  // `sourceId` n'est présent que sur une erreur venue de la modification d'une source :
  // il dit sur quelle ligne afficher le message.
  sourceErrors: (Record<string, string> & { sourceId?: number }) | null
}>()

/**
 * Les erreurs du formulaire d'ajout. Un refus venu de la **modification** d'une source porte un
 * `sourceId` et s'affiche sur sa ligne : sans ce tri, il s'afficherait aussi sous le formulaire
 * d'ajout, qui n'a rien envoyé.
 */
const addErrors = computed(() =>
  props.sourceErrors && props.sourceErrors.sourceId === undefined ? props.sourceErrors : null
)

const UNIT_OPTIONS: { value: IntervalUnit; label: string }[] = [
  { value: 'minutes', label: 'minutes' },
  { value: 'hours', label: 'heures' },
  { value: 'days', label: 'jours' },
]

/**
 * ⚠️ La page **ne convertit jamais avant d'envoyer** : elle poste `{ interval, intervalUnit }`
 * et c'est le serveur qui fait les minutes. Convertir ici ne laisserait au validateur qu'un
 * nombre de minutes, sans moyen de re-valider ce que l'utilisateur voulait dire — toute la
 * garde reposerait sur ce fichier.
 */
const DEFAULT_DRAFT: IntervalDraft = { interval: 1, intervalUnit: 'hours' }

const form = ref({ url: '', title: '', ...DEFAULT_DRAFT })
const submitting = ref(false)
const refreshing = ref<number | null>(null)
const saving = ref<number | null>(null)

/** Le couple affiché pour chaque source, re-dérivé des minutes stockées à chaque chargement. */
const drafts = ref<Record<number, IntervalDraft>>({})

watch(
  () => props.sources,
  (sources) => {
    const next: Record<number, IntervalDraft> = {}
    for (const source of sources) {
      const { value, unit } = fromMinutes(source.fetchIntervalMinutes)
      next[source.id] = { interval: value, intervalUnit: unit }
    }
    drafts.value = next
  },
  { immediate: true }
)

function isWithinBounds(draft: IntervalDraft): boolean {
  const { min, max } = unitBounds(draft.intervalUnit)
  return Number.isInteger(draft.interval) && draft.interval >= min && draft.interval <= max
}

/** « de 1 à 7 jours » — dit la règle avant qu'on la viole, plutôt qu'après. */
function boundsHint(unit: IntervalUnit): string {
  const { min, max } = unitBounds(unit)
  return `de ${min} à ${formatQuantity(max, unit)}`
}

/**
 * Changement d'unité : on convertit la durée **si elle tombe juste** (60 minutes → 1 heure),
 * sinon on garde le nombre tel quel (90 minutes → 90 heures). Jamais d'arrondi : « 1,5 heure »
 * se saisit en 90 minutes.
 *
 * ⚠️ Le `<select>` n'est donc pas en `v-model` — il faut lire l'ancienne unité avant qu'elle
 * ne soit écrasée.
 */
function switchUnit(draft: IntervalDraft, next: IntervalUnit): void {
  const minutes = toMinutes(draft.interval, draft.intervalUnit)
  const factor = toMinutes(1, next)

  if (minutes > 0 && minutes % factor === 0) {
    draft.interval = minutes / factor
  }
  draft.intervalUnit = next
}

function submit(): void {
  if (!form.value.url.trim() || !form.value.title.trim()) return
  if (!isWithinBounds(form.value)) return

  submitting.value = true
  router.post('/veille/sources', { ...form.value }, {
    preserveScroll: true,
    onSuccess: () => {
      form.value = { url: '', title: '', ...DEFAULT_DRAFT }
    },
    onFinish: () => {
      submitting.value = false
    },
  })
}

/** La cadence est-elle différente de ce qui est enregistré ? */
function isIntervalDirty(source: VeilleSource): boolean {
  const draft = drafts.value[source.id]
  if (!draft) return false
  return toMinutes(draft.interval, draft.intervalUnit) !== source.fetchIntervalMinutes
}

function saveInterval(source: VeilleSource): void {
  const draft = drafts.value[source.id]
  if (!draft || !isWithinBounds(draft)) return

  saving.value = source.id
  router.post(
    `/veille/sources/${source.id}`,
    { interval: draft.interval, intervalUnit: draft.intervalUnit },
    {
      preserveScroll: true,
      onFinish: () => {
        saving.value = null
      },
    }
  )
}

function toggleActive(source: VeilleSource): void {
  router.post(
    `/veille/sources/${source.id}`,
    { active: !source.active },
    { preserveScroll: true, preserveState: true }
  )
}

/** Synchrone côté serveur : le retour dit tout de suite si la source fonctionne. */
function refresh(source: VeilleSource): void {
  refreshing.value = source.id
  router.post(
    `/veille/sources/${source.id}/refresh`,
    {},
    {
      preserveScroll: true,
      onFinish: () => {
        refreshing.value = null
      },
    }
  )
}

function refreshAll(): void {
  router.post('/veille/sources/refresh', {}, { preserveScroll: true })
}

function formatDateTime(value: string | null): string {
  if (!value) return 'jamais'
  return new Date(value).toLocaleString('fr-FR', {
    day: '2-digit',
    month: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  })
}

const NOTIFICATION_CLASSES: Record<string, string> = {
  success: 'border-ok text-ok',
  error: 'border-bad text-bad',
  warning: 'border-warn text-warn',
  info: 'border-line-2 text-txt-2',
}
</script>

<template>
  <Head title="Sources de veille" />

  <div class="mb-4 flex items-center gap-3">
    <Link
      href="/veille"
      class="rounded-[9px] border border-line-2 bg-panel-2 px-3.5 py-2 text-[12.5px] text-txt-2 hover:text-txt"
    >
      ← Flux
    </Link>
    <div class="text-[13px] font-semibold">Sources</div>
    <button
      type="button"
      class="ml-auto rounded-[9px] border border-line-2 bg-panel-2 px-3.5 py-2 text-[12.5px]"
      @click="refreshAll"
    >
      Tout rafraîchir
    </button>
  </div>

  <div
    v-if="props.notification"
    class="mb-4 rounded-[12px] border bg-panel px-4 py-3 text-[12.5px]"
    :class="NOTIFICATION_CLASSES[props.notification.type] ?? NOTIFICATION_CLASSES.info"
  >
    {{ props.notification.message }}
  </div>

  <div class="grid grid-cols-[1fr_320px] gap-3.5">
    <!-- Liste des sources -->
    <div class="overflow-hidden rounded-[14px] border border-line bg-panel">
      <div class="border-b border-line p-4 text-[12px] font-semibold">
        Sources suivies
        <span class="ml-1 font-normal text-txt-3">({{ props.sources.length }})</span>
      </div>

      <div
        v-for="source in props.sources"
        :key="source.id"
        class="border-b border-line px-4 py-3.5"
        :class="source.active ? '' : 'opacity-55'"
      >
        <div class="flex items-start gap-3">
          <div class="min-w-0 flex-1">
            <div class="flex items-center gap-2">
              <span class="text-[13px] font-semibold">{{ source.title }}</span>
              <span
                class="rounded-full border border-line-2 bg-panel-2 px-2 py-0.5 text-[10.5px] text-txt-3 uppercase"
              >
                {{ source.kind }}
              </span>
              <span v-if="!source.active" class="text-[11px] text-txt-3">désactivée</span>
            </div>
            <div class="mt-0.5 truncate font-mono text-[11px] text-txt-3">{{ source.url }}</div>
            <div class="mt-1 flex flex-wrap items-center gap-2 text-[11.5px] text-txt-3">
              <span>{{ formatInterval(source.fetchIntervalMinutes) }}</span>
              <span>·</span>
              <span>dernière collecte : {{ formatDateTime(source.lastFetchedAt) }}</span>
              <template v-if="source.lastItemCount !== null">
                <span>·</span>
                <span :class="source.lastItemCount === 0 ? 'text-warn' : ''">
                  {{ source.lastItemCount }} entrée(s)
                </span>
              </template>
            </div>
          </div>

          <div class="flex shrink-0 items-center gap-2">
            <button
              type="button"
              class="rounded-md border border-line-2 bg-panel-2 px-2.5 py-1 text-[11.5px] disabled:opacity-40"
              :disabled="refreshing === source.id"
              @click="refresh(source)"
            >
              {{ refreshing === source.id ? '…' : 'Rafraîchir' }}
            </button>
            <button
              type="button"
              class="rounded-md border border-line-2 bg-panel-2 px-2.5 py-1 text-[11.5px]"
              @click="toggleActive(source)"
            >
              {{ source.active ? 'Désactiver' : 'Activer' }}
            </button>
          </div>
        </div>

        <!-- Cadence, modifiable ici. Le couple (valeur, unité) est re-dérivé des minutes
             stockées : une source réglée à 2880 se rouvre sur « 2 jours ». -->
        <div
          v-if="drafts[source.id]"
          class="mt-2 flex flex-wrap items-center gap-2 text-[11.5px] text-txt-3"
        >
          <span>cadence</span>
          <input
            v-model.number="drafts[source.id].interval"
            type="number"
            :min="unitBounds(drafts[source.id].intervalUnit).min"
            :max="unitBounds(drafts[source.id].intervalUnit).max"
            class="w-16 rounded-md border border-line-2 bg-panel px-2 py-1 text-[11.5px] text-txt"
          />
          <select
            :value="drafts[source.id].intervalUnit"
            class="rounded-md border border-line-2 bg-panel px-2 py-1 text-[11.5px] text-txt"
            @change="
              switchUnit(drafts[source.id], ($event.target as HTMLSelectElement).value as IntervalUnit)
            "
          >
            <option v-for="unit in UNIT_OPTIONS" :key="unit.value" :value="unit.value">
              {{ unit.label }}
            </option>
          </select>

          <button
            v-if="isIntervalDirty(source)"
            type="button"
            class="rounded-md border border-accent px-2.5 py-1 text-[11.5px] text-accent disabled:opacity-40"
            :disabled="saving === source.id || !isWithinBounds(drafts[source.id])"
            @click="saveInterval(source)"
          >
            {{ saving === source.id ? '…' : 'Enregistrer' }}
          </button>

          <span v-if="!isWithinBounds(drafts[source.id])" class="text-bad">
            {{ boundsHint(drafts[source.id].intervalUnit) }}
          </span>
        </div>

        <!-- L'erreur du serveur sur CETTE source. Sans elle, une cadence refusée ne se verrait
             nulle part : la page ne lit que `sourceErrors`. -->
        <p
          v-if="props.sourceErrors?.sourceId === source.id && props.sourceErrors.interval"
          class="mt-1 text-[11px] text-bad"
        >
          {{ props.sourceErrors.interval }}
        </p>

        <!-- Le message d'échec, brut, celui du serveur. Un flux mort qui échoue en silence est
             le mode de panne le plus courant d'un agrégateur : il doit se voir ici. -->
        <div v-if="source.lastError" class="mt-2 rounded-[9px] border border-bad bg-bg-2 p-2.5">
          <div class="text-[11.5px] font-semibold text-bad">
            Dernière collecte en échec — {{ formatDateTime(source.lastErrorAt) }}
          </div>
          <p class="mt-0.5 font-mono text-[11px] break-words text-txt-2">{{ source.lastError }}</p>
        </div>

        <div
          v-else-if="source.lastItemCount === 0"
          class="mt-2 rounded-[9px] border border-warn bg-bg-2 p-2.5 text-[11.5px] text-warn"
        >
          Le flux répond, mais aucune entrée n’a été reconnue — format inattendu, ou flux vidé.
        </div>
      </div>

      <div v-if="props.sources.length === 0" class="p-6 text-center text-[13px] text-txt-2">
        Aucune source. Ajoute un flux RSS ou Atom pour que la veille se remplisse toute seule.
      </div>
    </div>

    <!-- Ajout -->
    <div class="h-fit overflow-hidden rounded-[14px] border border-line bg-panel">
      <div class="border-b border-line p-4 text-[12px] font-semibold">Ajouter une source</div>
      <form class="flex flex-col gap-2 p-3" @submit.prevent="submit">
        <input
          v-model="form.url"
          type="text"
          placeholder="https://exemple.dev/feed.xml"
          class="rounded-md border border-line-2 bg-panel px-2 py-1.5 text-[12px] placeholder:text-txt-3"
        />
        <p v-if="addErrors?.url" class="text-[11px] text-bad">
          {{ addErrors.url }}
        </p>

        <input
          v-model="form.title"
          type="text"
          placeholder="Nom affiché"
          class="rounded-md border border-line-2 bg-panel px-2 py-1.5 text-[12px] placeholder:text-txt-3"
        />
        <p v-if="addErrors?.title" class="text-[11px] text-bad">
          {{ addErrors.title }}
        </p>

        <label class="mt-1 text-[11px] text-txt-3">Cadence</label>
        <div class="flex gap-2">
          <input
            v-model.number="form.interval"
            type="number"
            :min="unitBounds(form.intervalUnit).min"
            :max="unitBounds(form.intervalUnit).max"
            class="w-20 rounded-md border border-line-2 bg-panel px-2 py-1.5 text-[12px]"
          />
          <select
            :value="form.intervalUnit"
            class="flex-1 rounded-md border border-line-2 bg-panel px-2 py-1.5 text-[12px]"
            @change="switchUnit(form, ($event.target as HTMLSelectElement).value as IntervalUnit)"
          >
            <option v-for="unit in UNIT_OPTIONS" :key="unit.value" :value="unit.value">
              {{ unit.label }}
            </option>
          </select>
        </div>
        <p class="text-[11px]" :class="isWithinBounds(form) ? 'text-txt-3' : 'text-bad'">
          {{ boundsHint(form.intervalUnit) }}
        </p>
        <p v-if="addErrors?.interval || addErrors?.intervalUnit" class="text-[11px] text-bad">
          {{ addErrors.interval ?? addErrors.intervalUnit }}
        </p>

        <button
          type="submit"
          class="mt-1 rounded-md border border-accent bg-accent px-2 py-1.5 text-[12px] text-white disabled:opacity-50"
          :disabled="
            submitting || !form.url.trim() || !form.title.trim() || !isWithinBounds(form)
          "
        >
          Ajouter
        </button>

        <p class="mt-1 text-[11px] leading-relaxed text-txt-3">
          RSS et Atom. Le serveur va chercher l’URL lui-même : les adresses locales et privées
          sont refusées.
        </p>
      </form>
    </div>
  </div>
</template>
