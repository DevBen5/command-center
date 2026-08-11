<script setup lang="ts">
import { onMounted, onUnmounted, reactive, ref } from 'vue'
import { useI18n } from 'vue-i18n'
import { Film, FileQuestion, ImageIcon } from 'lucide-vue-next'
import {
  applyFilterChange,
  buildCatalogQueryString,
  DEFAULT_CATALOG_FILTERS,
  type CatalogFilters,
  type CatalogItemNature,
  type CatalogSourceKey,
} from '../shared/catalog_query.js'

/**
 * La grille à plat du catalogue (CC-239) — extraite de `pages/catalog.vue`, source VERROUILLÉE en
 * prop plutôt qu'un sélecteur : consommée par `pages/immich.vue` (toujours) et `pages/nas.vue`
 * (mode recherche, quand la navigation par dossier ne suffit plus). `pages/catalog.vue` reste
 * intacte et n'utilise PAS ce composant — décision du ticket, écran multi-sources distinct, gardé
 * pour ne pas risquer une régression sur un fichier déjà stable et testé.
 *
 * ⚠️ **Reste strictement branchée sur `/coffre/catalog/items` — jamais sur `/coffre/nas/browse`.**
 * La recherche porte sur le catalogue synchronisé (à jour à la dernière synchro), jamais sur une
 * lecture disque en direct — un mélange des deux romprait la promesse affichée à l'écran.
 */
interface CatalogItemView {
  id: number
  source: CatalogSourceKey
  nature: CatalogItemNature
  displayName: string | null
  capturedAt: string | null
  sizeBytes: number | null
  missingSince: string | null
  thumbnailUrl: string | null
  linkedEntry: { id: number; type: string; title: string } | null
}

interface CatalogResponse {
  items: CatalogItemView[]
  page: number
  perPage: number
  total: number
  totalPages: number
}

const props = defineProps<{
  lockedSource: CatalogSourceKey
  /** Une recherche déjà tapée avant la bascule vers cette grille (`pages/nas.vue`) — optionnelle. */
  initialQuery?: string
}>()

const { t } = useI18n()

const SEARCH_DEBOUNCE_MS = 300

const filters = reactive<CatalogFilters>({
  ...DEFAULT_CATALOG_FILTERS,
  source: props.lockedSource,
  q: props.initialQuery ?? '',
})
const searchInput = ref(props.initialQuery ?? '')
const items = ref<CatalogItemView[]>([])
const total = ref(0)
const totalPages = ref(1)
const loading = ref(false)
const throttled = ref(false)
const errorMessage = ref<string | null>(null)
const brokenThumbnails = ref<Set<number>>(new Set())

let debounceTimer: ReturnType<typeof setTimeout> | null = null
// ⚠️ Un jeton par requête : une réponse en retard (recherche tapée vite) ne doit jamais écraser un
// résultat plus récent déjà affiché — même garde que `pages/catalog.vue`.
let requestToken = 0

async function fetchItems(): Promise<void> {
  throttled.value = false
  errorMessage.value = null
  loading.value = true
  const token = ++requestToken

  try {
    const response = await fetch(`/coffre/catalog/items?${buildCatalogQueryString(filters)}`, {
      headers: { accept: 'application/json' },
    })

    if (token !== requestToken) return

    if (response.status === 429) {
      throttled.value = true
      return
    }
    if (!response.ok) {
      errorMessage.value = t('coffre.catalog.loadError')
      return
    }

    const data = (await response.json()) as CatalogResponse
    items.value = data.items
    total.value = data.total
    totalPages.value = data.totalPages
  } catch {
    if (token === requestToken) errorMessage.value = t('coffre.catalog.loadError')
  } finally {
    if (token === requestToken) loading.value = false
  }
}

/** ⚠️ `source` n'est JAMAIS dans le patch — cette grille ne l'expose à aucun geste utilisateur. */
function updateFilters(patch: Partial<Omit<CatalogFilters, 'source'>>): void {
  Object.assign(filters, applyFilterChange(filters, patch))
  fetchItems()
}

function onSearchInput(): void {
  if (debounceTimer !== null) clearTimeout(debounceTimer)
  debounceTimer = setTimeout(() => updateFilters({ q: searchInput.value }), SEARCH_DEBOUNCE_MS)
}

function goToPage(page: number): void {
  if (page < 1 || page > totalPages.value) return
  updateFilters({ page })
}

function onThumbnailError(id: number): void {
  brokenThumbnails.value.add(id)
}

function natureLabel(nature: CatalogItemNature): string {
  if (nature === 'video') return t('coffre.catalog.natureVideo')
  if (nature === 'other') return t('coffre.catalog.natureOther')
  return t('coffre.catalog.naturePhoto')
}

function formattedDate(iso: string | null): string {
  if (iso === null) return t('coffre.catalog.unknownDate')
  return new Date(iso).toLocaleDateString()
}

onMounted(() => {
  // Une recherche déjà tapée avant la bascule part immédiatement — un débounce de plus ici
  // referait attendre une saisie qui a déjà eu lieu.
  fetchItems()
})
onUnmounted(() => {
  if (debounceTimer !== null) clearTimeout(debounceTimer)
})
</script>

<template>
  <div class="grid gap-6">
    <section
      class="grid grid-cols-2 gap-3 rounded-[14px] border border-line bg-panel p-4 sm:grid-cols-3 lg:grid-cols-5"
    >
      <input
        v-model="searchInput"
        type="text"
        class="col-span-2 rounded-[7px] border border-line-2 bg-panel-2 px-3 py-2 text-[13px] text-txt sm:col-span-3 lg:col-span-2"
        :placeholder="t('coffre.catalog.searchPlaceholder')"
        @input="onSearchInput"
      />

      <select
        class="rounded-[7px] border border-line-2 bg-panel-2 px-3 py-2 text-[13px] text-txt"
        :value="filters.nature ?? ''"
        @change="updateFilters({ nature: ($event.target as HTMLSelectElement).value === '' ? null : (($event.target as HTMLSelectElement).value as CatalogItemNature) })"
      >
        <option value="">{{ t('coffre.catalog.allNatures') }}</option>
        <option value="photo">{{ t('coffre.catalog.naturePhoto') }}</option>
        <option value="video">{{ t('coffre.catalog.natureVideo') }}</option>
        <option value="other">{{ t('coffre.catalog.natureOther') }}</option>
      </select>

      <select
        class="rounded-[7px] border border-line-2 bg-panel-2 px-3 py-2 text-[13px] text-txt"
        :value="`${filters.sort}:${filters.order}`"
        @change="
          updateFilters({
            sort: (($event.target as HTMLSelectElement).value.split(':')[0] as CatalogFilters['sort']),
            order: (($event.target as HTMLSelectElement).value.split(':')[1] as CatalogFilters['order']),
          })
        "
      >
        <option value="capturedAt:desc">{{ t('coffre.catalog.sortDateDesc') }}</option>
        <option value="capturedAt:asc">{{ t('coffre.catalog.sortDateAsc') }}</option>
        <option value="displayName:asc">{{ t('coffre.catalog.sortNameAsc') }}</option>
        <option value="displayName:desc">{{ t('coffre.catalog.sortNameDesc') }}</option>
      </select>

      <label class="flex items-center gap-2 text-[12.5px] text-txt-2">
        <input
          type="checkbox"
          :checked="filters.includeMissing"
          @change="updateFilters({ includeMissing: ($event.target as HTMLInputElement).checked })"
        />
        {{ t('coffre.catalog.includeMissing') }}
      </label>
    </section>

    <p v-if="throttled" class="rounded-[10px] border border-warn/40 bg-panel-2 p-4 text-[13px] text-warn">
      {{ t('coffre.catalog.throttled') }}
    </p>
    <p v-else-if="errorMessage" class="rounded-[10px] border border-bad/40 bg-panel-2 p-4 text-[13px] text-bad">
      {{ errorMessage }}
    </p>

    <p v-if="!loading && !throttled && !errorMessage" class="text-[12.5px] text-txt-3">
      {{ t('coffre.catalog.resultCount', { count: total }) }}
    </p>

    <section
      v-if="!throttled && !errorMessage"
      class="grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5"
    >
      <article
        v-for="item in items"
        :key="item.id"
        class="overflow-hidden rounded-[12px] border border-line bg-panel"
        :class="{ 'opacity-55': item.missingSince !== null }"
      >
        <div class="grid aspect-square place-items-center bg-panel-2">
          <img
            v-if="item.thumbnailUrl !== null && !brokenThumbnails.has(item.id)"
            :src="item.thumbnailUrl"
            class="block h-full w-full object-cover"
            alt=""
            loading="lazy"
            @error="onThumbnailError(item.id)"
          />
          <div v-else class="grid place-items-center gap-1 text-txt-3">
            <Film v-if="item.nature === 'video'" :size="28" :stroke-width="1.5" aria-hidden="true" />
            <FileQuestion
              v-else-if="item.nature === 'other'"
              :size="28"
              :stroke-width="1.5"
              aria-hidden="true"
            />
            <ImageIcon v-else :size="28" :stroke-width="1.5" aria-hidden="true" />
            <span class="text-[10.5px] uppercase tracking-[.08em]">{{ natureLabel(item.nature) }}</span>
          </div>
        </div>

        <div class="grid gap-1 p-2.5">
          <p class="truncate text-[12.5px] font-semibold text-txt" :title="item.displayName ?? ''">
            {{ item.displayName ?? t('coffre.catalog.unnamed') }}
          </p>
          <p class="text-[11px] text-txt-3">{{ formattedDate(item.capturedAt) }}</p>
          <p v-if="item.missingSince !== null" class="text-[11px] text-warn">
            {{ t('coffre.catalog.missingSince', { date: formattedDate(item.missingSince) }) }}
          </p>
          <p v-if="item.linkedEntry !== null" class="truncate text-[11px] text-aqua">
            {{ t('coffre.catalog.linkedTo', { title: item.linkedEntry.title }) }}
          </p>
        </div>
      </article>

      <p v-if="!loading && items.length === 0" class="col-span-full py-8 text-center text-[13px] text-txt-3">
        {{ t('coffre.catalog.empty') }}
      </p>
    </section>

    <footer v-if="!throttled && !errorMessage && totalPages > 1" class="flex items-center justify-center gap-3">
      <button
        type="button"
        class="rounded-[7px] border border-line-2 px-3.5 py-2 text-[12.5px] text-txt hover:border-aqua disabled:cursor-not-allowed disabled:opacity-50"
        :disabled="filters.page <= 1"
        @click="goToPage(filters.page - 1)"
      >
        {{ t('coffre.catalog.previousPage') }}
      </button>
      <span class="text-[12.5px] text-txt-2">
        {{ t('coffre.catalog.pageOf', { page: filters.page, total: totalPages }) }}
      </span>
      <button
        type="button"
        class="rounded-[7px] border border-line-2 px-3.5 py-2 text-[12.5px] text-txt hover:border-aqua disabled:cursor-not-allowed disabled:opacity-50"
        :disabled="filters.page >= totalPages"
        @click="goToPage(filters.page + 1)"
      >
        {{ t('coffre.catalog.nextPage') }}
      </button>
    </footer>
  </div>
</template>
