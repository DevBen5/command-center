<script setup lang="ts">
import { onMounted, ref } from 'vue'
import { Head, Link } from '@inertiajs/vue3'
import { useI18n } from 'vue-i18n'
import { Film, FileQuestion, Folder, HardDrive, ImageIcon } from 'lucide-vue-next'
import AppLayout from '~/layouts/AppLayout.vue'
import CatalogGrid from '../components/CatalogGrid.vue'
import {
  buildNasBrowseQueryString,
  nasBreadcrumbFor,
  nasThumbnailUrl,
} from '../shared/nas_browse_query.js'

defineOptions({ layout: AppLayout })

/**
 * La carte « NAS » de l'accueil du coffre (CC-239) — navigation par dossier lue EN DIRECT sur le
 * disque (`GET /coffre/nas/browse`), jamais `coffre_catalog_items` : un fichier ajouté depuis le
 * coffre (lots suivants) doit apparaître sans resynchronisation.
 *
 * ⚠️ **La recherche bascule vers `CatalogGrid`, verrouillée sur `source: 'nas'`** — elle porte sur
 * le catalogue SYNCHRONISÉ, jamais sur un parcours disque à chaque frappe (impossible à cette
 * échelle). L'écran le dit explicitement (`coffre.nas.searchHint`) : un résultat de recherche est à
 * jour à la dernière synchronisation, pas à la seconde.
 */
interface NasBrowseEntry {
  name: string
  path: string
  kind: 'dir' | 'photo' | 'video' | 'other'
  sizeBytes: number | null
  capturedAt: string | null
}

type NasBrowseListing =
  | { level: 'roots'; roots: { name: string }[] }
  | { level: 'folder'; root: string; path: string; entries: NasBrowseEntry[] }

const { t } = useI18n()

const root = ref<string | null>(null)
const path = ref('')
const roots = ref<{ name: string }[]>([])
const entries = ref<NasBrowseEntry[]>([])
const loading = ref(false)
const throttled = ref(false)
const errorMessage = ref<string | null>(null)
const brokenThumbnails = ref<Set<string>>(new Set())

const searchInput = ref('')
const searching = ref(false)

async function load(): Promise<void> {
  loading.value = true
  throttled.value = false
  errorMessage.value = null

  try {
    const qs = buildNasBrowseQueryString(root.value, path.value)
    const url = qs === '' ? '/coffre/nas/browse' : `/coffre/nas/browse?${qs}`
    const response = await fetch(url, { headers: { accept: 'application/json' } })

    if (response.status === 429) {
      throttled.value = true
      return
    }
    if (response.status === 404) {
      errorMessage.value = t('coffre.nas.folderError')
      return
    }
    if (!response.ok) {
      errorMessage.value = t('coffre.nas.folderError')
      return
    }

    const data = (await response.json()) as NasBrowseListing
    if (data.level === 'roots') {
      roots.value = data.roots
      entries.value = []
    } else {
      entries.value = data.entries
    }
  } catch {
    errorMessage.value = t('coffre.nas.folderError')
  } finally {
    loading.value = false
  }
}

function enterRoot(name: string): void {
  root.value = name
  path.value = ''
  load()
}

function enterEntry(entry: NasBrowseEntry): void {
  if (entry.kind !== 'dir') return
  path.value = entry.path
  load()
}

function goToRootsList(): void {
  root.value = null
  path.value = ''
  load()
}

function goToBreadcrumb(segmentPath: string): void {
  path.value = segmentPath
  load()
}

function onSearchInput(): void {
  searching.value = searchInput.value.trim().length > 0
}

function exitSearch(): void {
  searching.value = false
  searchInput.value = ''
}

function onThumbnailError(entryPath: string): void {
  brokenThumbnails.value.add(entryPath)
}

function natureLabel(kind: NasBrowseEntry['kind']): string {
  if (kind === 'video') return t('coffre.catalog.natureVideo')
  if (kind === 'other') return t('coffre.catalog.natureOther')
  return t('coffre.catalog.naturePhoto')
}

onMounted(load)
</script>

<template>
  <Head :title="t('coffre.nas.title')" />

  <div class="mx-auto grid w-full max-w-[1100px] gap-6">
    <Link href="/coffre" class="text-[12.5px] text-txt-3 hover:text-aqua">
      {{ t('coffre.index.backToCoffre') }}
    </Link>

    <header class="grid gap-1">
      <h1 class="text-[20px] font-bold">{{ t('coffre.nas.title') }}</h1>
      <p class="text-[13px] text-txt-2">{{ t('coffre.nas.lead') }}</p>
    </header>

    <section class="grid gap-2 rounded-[14px] border border-line bg-panel p-4">
      <input
        v-model="searchInput"
        type="text"
        class="rounded-[7px] border border-line-2 bg-panel-2 px-3 py-2 text-[13px] text-txt"
        :placeholder="t('coffre.nas.searchPlaceholder')"
        @input="onSearchInput"
      />
      <p class="text-[11.5px] text-txt-3">{{ t('coffre.nas.searchHint') }}</p>
    </section>

    <template v-if="searching">
      <button
        type="button"
        class="justify-self-start text-[12.5px] text-aqua hover:underline"
        @click="exitSearch"
      >
        {{ t('coffre.nas.backToBrowse') }}
      </button>
      <CatalogGrid locked-source="nas" :initial-query="searchInput.trim()" />
    </template>

    <template v-else>
      <nav v-if="root !== null" class="flex flex-wrap items-center gap-1.5 text-[12.5px]">
        <button type="button" class="text-txt-3 hover:text-aqua" @click="goToRootsList">
          <HardDrive :size="14" :stroke-width="1.5" class="inline" aria-hidden="true" />
        </button>
        <template v-for="(segment, index) in nasBreadcrumbFor(root, path)" :key="segment.path">
          <span class="text-txt-3">/</span>
          <button
            type="button"
            class="text-txt-2 hover:text-aqua"
            :class="{ 'font-semibold text-txt': index === nasBreadcrumbFor(root, path).length - 1 }"
            @click="goToBreadcrumb(segment.path)"
          >
            {{ segment.label }}
          </button>
        </template>
      </nav>

      <p v-if="throttled" class="rounded-[10px] border border-warn/40 bg-panel-2 p-4 text-[13px] text-warn">
        {{ t('coffre.nas.throttled') }}
      </p>
      <p v-else-if="errorMessage" class="rounded-[10px] border border-bad/40 bg-panel-2 p-4 text-[13px] text-bad">
        {{ errorMessage }}
      </p>

      <template v-else>
        <section v-if="root === null" class="grid gap-2">
          <p v-if="!loading && roots.length === 0" class="text-[13px] text-txt-3">
            {{ t('coffre.nas.rootsEmpty') }}
          </p>
          <button
            v-for="racine in roots"
            :key="racine.name"
            type="button"
            class="flex items-center gap-3 rounded-[10px] border border-line bg-panel px-4 py-3 text-left hover:border-aqua"
            @click="enterRoot(racine.name)"
          >
            <HardDrive :size="18" :stroke-width="1.5" class="text-accent" aria-hidden="true" />
            <span class="text-[13.5px] font-semibold">{{ racine.name }}</span>
          </button>
        </section>

        <section
          v-else
          class="grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5"
        >
          <p v-if="!loading && entries.length === 0" class="col-span-full py-8 text-center text-[13px] text-txt-3">
            {{ t('coffre.nas.folderEmpty') }}
          </p>

          <button
            v-for="entry in entries"
            :key="entry.path"
            type="button"
            class="overflow-hidden rounded-[12px] border border-line bg-panel text-left"
            @click="enterEntry(entry)"
          >
            <div class="grid aspect-square place-items-center bg-panel-2">
              <Folder v-if="entry.kind === 'dir'" :size="32" :stroke-width="1.5" aria-hidden="true" />
              <img
                v-else-if="entry.kind === 'photo' && !brokenThumbnails.has(entry.path)"
                :src="nasThumbnailUrl(root, entry.path)"
                class="block h-full w-full object-cover"
                alt=""
                loading="lazy"
                @error="onThumbnailError(entry.path)"
              />
              <div v-else class="grid place-items-center gap-1 text-txt-3">
                <Film v-if="entry.kind === 'video'" :size="28" :stroke-width="1.5" aria-hidden="true" />
                <FileQuestion
                  v-else-if="entry.kind === 'other'"
                  :size="28"
                  :stroke-width="1.5"
                  aria-hidden="true"
                />
                <ImageIcon v-else :size="28" :stroke-width="1.5" aria-hidden="true" />
                <span class="text-[10.5px] uppercase tracking-[.08em]">{{ natureLabel(entry.kind) }}</span>
              </div>
            </div>
            <p class="truncate p-2 text-[12.5px] font-semibold text-txt" :title="entry.name">
              {{ entry.name }}
            </p>
          </button>
        </section>
      </template>
    </template>
  </div>
</template>
