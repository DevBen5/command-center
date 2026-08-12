<script setup lang="ts">
import { onMounted, ref } from 'vue'
import { Head, Link } from '@inertiajs/vue3'
import { useI18n } from 'vue-i18n'
import {
  Film,
  FileQuestion,
  Folder,
  FolderInput,
  HardDrive,
  ImageIcon,
  Pencil,
  Trash2,
  Upload,
} from 'lucide-vue-next'
import AppLayout from '~/layouts/AppLayout.vue'
import ConfirmModal from '~/components/ConfirmModal.vue'
import PromptModal from '~/components/PromptModal.vue'
import CatalogGrid from '../components/CatalogGrid.vue'
import VideoPlayerModal from '../components/VideoPlayerModal.vue'
import { xsrfToken } from '../shared/csrf.js'
import {
  buildNasBrowseQueryString,
  nasBreadcrumbFor,
  nasStreamUrl,
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

const confirmModal = ref<InstanceType<typeof ConfirmModal> | null>(null)
const promptModal = ref<InstanceType<typeof PromptModal> | null>(null)
const fileInput = ref<HTMLInputElement | null>(null)
const uploading = ref(false)
const writeError = ref<string | null>(null)

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

/**
 * ⚠️ **La lecture vidéo (CC-241) passe par le MÊME geste que l'entrée dans un dossier** — cliquer
 * la carte. Un second bouton « lire » à côté de renommer/déplacer/supprimer aurait rangé la seule
 * action de consultation parmi trois actions destructrices.
 */
const videoLue = ref<{ url: string; title: string } | null>(null)

function enterEntry(entry: NasBrowseEntry): void {
  if (entry.kind === 'dir') {
    path.value = entry.path
    load()
    return
  }

  if (entry.kind === 'video' && root.value !== null) {
    videoLue.value = { url: nasStreamUrl(root.value, entry.path), title: entry.name }
  }
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

/**
 * L'écriture NAS (CC-240) — envoyer, renommer, déplacer, supprimer. Chaque action réussie
 * recharge simplement le dossier courant (`load()`) plutôt que de maintenir un état local en
 * plus : c'est la même doctrine que la navigation elle-même — lire le disque en direct, jamais
 * une resynchronisation à part.
 */
async function writeErrorMessage(response: Response): Promise<string> {
  if (response.status === 429) return t('coffre.nas.throttled')
  if (response.status === 422) return t('coffre.nas.nameInvalid')
  if (response.status === 409) return t('coffre.nas.nameTaken')
  return t('coffre.nas.writeError')
}

function triggerUpload(): void {
  fileInput.value?.click()
}

async function handleFileSelected(event: Event): Promise<void> {
  const input = event.target as HTMLInputElement
  const file = input.files?.[0]
  input.value = ''
  if (!file || root.value === null) return

  uploading.value = true
  writeError.value = null

  try {
    const body = new FormData()
    body.append('root', root.value)
    body.append('path', path.value)
    body.append('file', file)

    const response = await fetch('/coffre/nas/upload', {
      method: 'POST',
      headers: { 'accept': 'application/json', 'x-xsrf-token': xsrfToken() },
      body,
    })

    if (!response.ok) {
      writeError.value = await writeErrorMessage(response)
      return
    }

    await load()
  } catch {
    writeError.value = t('coffre.nas.writeError')
  } finally {
    uploading.value = false
  }
}

async function startRename(entry: NasBrowseEntry): Promise<void> {
  if (root.value === null) return

  const newName = (await promptModal.value?.ask(t('coffre.nas.renamePrompt'), entry.name)) ?? null
  if (newName === null || newName === entry.name) return

  writeError.value = null
  const response = await fetch('/coffre/nas/rename', {
    method: 'PUT',
    headers: {
      'accept': 'application/json',
      'content-type': 'application/json',
      'x-xsrf-token': xsrfToken(),
    },
    body: JSON.stringify({ root: root.value, path: entry.path, newName }),
  })

  if (!response.ok) {
    writeError.value = await writeErrorMessage(response)
    return
  }

  await load()
}

async function startMove(entry: NasBrowseEntry): Promise<void> {
  if (root.value === null) return

  const targetPath = (await promptModal.value?.ask(t('coffre.nas.movePrompt'), path.value)) ?? null
  if (targetPath === null) return

  writeError.value = null
  const response = await fetch('/coffre/nas/move', {
    method: 'PUT',
    headers: {
      'accept': 'application/json',
      'content-type': 'application/json',
      'x-xsrf-token': xsrfToken(),
    },
    body: JSON.stringify({
      root: root.value,
      path: entry.path,
      targetRoot: root.value,
      targetPath,
    }),
  })

  if (!response.ok) {
    writeError.value = await writeErrorMessage(response)
    return
  }

  await load()
}

async function removeEntry(entry: NasBrowseEntry): Promise<void> {
  if (root.value === null) return
  if (!(await confirmModal.value?.ask(t('coffre.nas.deleteConfirm'), { danger: true }))) return

  writeError.value = null
  const params = new URLSearchParams({ root: root.value, path: entry.path })
  const response = await fetch(`/coffre/nas/file?${params.toString()}`, {
    method: 'DELETE',
    headers: { 'accept': 'application/json', 'x-xsrf-token': xsrfToken() },
  })

  if (!response.ok) {
    writeError.value = await writeErrorMessage(response)
    return
  }

  await load()
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
      <nav
        v-if="root !== null"
        class="flex flex-wrap items-center justify-between gap-1.5 text-[12.5px]"
      >
        <div class="flex flex-wrap items-center gap-1.5">
          <button type="button" class="text-txt-3 hover:text-aqua" @click="goToRootsList">
            <HardDrive :size="14" :stroke-width="1.5" class="inline" aria-hidden="true" />
          </button>
          <template v-for="(segment, index) in nasBreadcrumbFor(root, path)" :key="segment.path">
            <span class="text-txt-3">/</span>
            <button
              type="button"
              class="text-txt-2 hover:text-aqua"
              :class="{
                'font-semibold text-txt': index === nasBreadcrumbFor(root, path).length - 1,
              }"
              @click="goToBreadcrumb(segment.path)"
            >
              {{ segment.label }}
            </button>
          </template>
        </div>

        <button
          type="button"
          class="flex items-center gap-1.5 rounded-[7px] border border-line-2 bg-panel-2 px-3 py-1.5 text-[12px] text-txt-2 hover:border-aqua hover:text-txt disabled:opacity-50"
          :disabled="uploading"
          @click="triggerUpload"
        >
          <Upload :size="14" :stroke-width="1.5" aria-hidden="true" />
          {{ uploading ? t('coffre.nas.uploading') : t('coffre.nas.uploadButton') }}
        </button>
        <input ref="fileInput" type="file" class="hidden" @change="handleFileSelected" />
      </nav>

      <p
        v-if="throttled"
        class="rounded-[10px] border border-warn/40 bg-panel-2 p-4 text-[13px] text-warn"
      >
        {{ t('coffre.nas.throttled') }}
      </p>
      <p
        v-else-if="errorMessage"
        class="rounded-[10px] border border-bad/40 bg-panel-2 p-4 text-[13px] text-bad"
      >
        {{ errorMessage }}
      </p>
      <p
        v-if="writeError"
        class="rounded-[10px] border border-bad/40 bg-panel-2 p-4 text-[13px] text-bad"
      >
        {{ writeError }}
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

        <section v-else class="grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5">
          <p
            v-if="!loading && entries.length === 0"
            class="col-span-full py-8 text-center text-[13px] text-txt-3"
          >
            {{ t('coffre.nas.folderEmpty') }}
          </p>

          <div
            v-for="entry in entries"
            :key="entry.path"
            class="overflow-hidden rounded-[12px] border border-line bg-panel text-left"
          >
            <button type="button" class="block w-full text-left" @click="enterEntry(entry)">
              <div class="grid aspect-square place-items-center bg-panel-2">
                <Folder
                  v-if="entry.kind === 'dir'"
                  :size="32"
                  :stroke-width="1.5"
                  aria-hidden="true"
                />
                <img
                  v-else-if="entry.kind === 'photo' && !brokenThumbnails.has(entry.path)"
                  :src="nasThumbnailUrl(root, entry.path)"
                  class="block h-full w-full object-cover"
                  alt=""
                  loading="lazy"
                  @error="onThumbnailError(entry.path)"
                />
                <div v-else class="grid place-items-center gap-1 text-txt-3">
                  <Film
                    v-if="entry.kind === 'video'"
                    :size="28"
                    :stroke-width="1.5"
                    aria-hidden="true"
                  />
                  <FileQuestion
                    v-else-if="entry.kind === 'other'"
                    :size="28"
                    :stroke-width="1.5"
                    aria-hidden="true"
                  />
                  <ImageIcon v-else :size="28" :stroke-width="1.5" aria-hidden="true" />
                  <span class="text-[10.5px] uppercase tracking-[.08em]">{{
                    natureLabel(entry.kind)
                  }}</span>
                </div>
              </div>
              <p class="truncate p-2 text-[12.5px] font-semibold text-txt" :title="entry.name">
                {{ entry.name }}
              </p>
            </button>

            <div
              v-if="entry.kind !== 'dir'"
              class="flex justify-end gap-1 border-t border-line p-1.5"
            >
              <button
                type="button"
                class="rounded-md p-1 text-txt-3 hover:text-aqua"
                :aria-label="t('coffre.nas.rename')"
                @click="startRename(entry)"
              >
                <Pencil :size="14" :stroke-width="1.5" aria-hidden="true" />
              </button>
              <button
                type="button"
                class="rounded-md p-1 text-txt-3 hover:text-aqua"
                :aria-label="t('coffre.nas.move')"
                @click="startMove(entry)"
              >
                <FolderInput :size="14" :stroke-width="1.5" aria-hidden="true" />
              </button>
              <button
                type="button"
                class="rounded-md p-1 text-txt-3 hover:text-bad"
                :aria-label="t('coffre.nas.delete')"
                @click="removeEntry(entry)"
              >
                <Trash2 :size="14" :stroke-width="1.5" aria-hidden="true" />
              </button>
            </div>
          </div>
        </section>
      </template>
    </template>

    <VideoPlayerModal
      v-if="videoLue !== null"
      :url="videoLue.url"
      :title="videoLue.title"
      @close="videoLue = null"
    />

    <ConfirmModal ref="confirmModal" />
    <PromptModal ref="promptModal" />
  </div>
</template>
