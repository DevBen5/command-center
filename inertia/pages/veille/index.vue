<script setup lang="ts">
import { computed, ref } from 'vue'
import { Head, router } from '@inertiajs/vue3'
import AppLayout from '~/layouts/AppLayout.vue'

defineOptions({ layout: AppLayout })

interface VeilleItem {
  id: number
  type: 'rss' | 'bookmark' | 'note'
  url: string | null
  title: string
  content: string | null
  tags: string[]
  readingQueue: boolean
  createdAt: string
}

interface Filters {
  type: string | null
  tag: string | null
  readingQueue: boolean
  search: string | null
}

const props = defineProps<{ items: VeilleItem[]; filters: Filters }>()

const allTags = computed(() => {
  const tags = new Set<string>()
  for (const item of props.items) for (const tag of item.tags) tags.add(tag)
  return [...tags].sort()
})

const readingQueueItems = computed(() => props.items.filter((item) => item.readingQueue))

const searchInput = ref(props.filters.search ?? '')

function applyFilters(patch: Partial<Filters>): void {
  router.get(
    '/veille',
    {
      type: patch.type !== undefined ? patch.type : props.filters.type,
      tag: patch.tag !== undefined ? patch.tag : props.filters.tag,
      readingQueue:
        patch.readingQueue !== undefined ? patch.readingQueue : props.filters.readingQueue,
      search: patch.search !== undefined ? patch.search : props.filters.search,
    },
    { preserveState: true, preserveScroll: true, replace: true }
  )
}

function submitSearch(): void {
  applyFilters({ search: searchInput.value || null })
}

function toggleQueue(item: VeilleItem): void {
  router.post(`/veille/${item.id}/queue`, {}, { preserveScroll: true, preserveState: true })
}

const capture = ref({ type: 'note' as VeilleItem['type'], title: '', url: '' })
const capturing = ref(false)

function submitCapture(): void {
  if (!capture.value.title.trim()) return
  capturing.value = true
  router.post(
    '/veille',
    { type: capture.value.type, title: capture.value.title, url: capture.value.url || undefined },
    {
      preserveScroll: true,
      onFinish: () => {
        capturing.value = false
        capture.value = { type: 'note', title: '', url: '' }
      },
    }
  )
}
</script>

<template>
  <Head title="Veille" />

  <div class="mb-4 flex items-center gap-3">
    <input
      v-model="searchInput"
      type="text"
      placeholder="Rechercher dans flux, signets et notes…"
      class="flex-1 rounded-[9px] border border-line-2 bg-panel px-3.5 py-2.5 text-[13px] text-txt placeholder:text-txt-3 outline-none focus:border-accent"
      @keyup.enter="submitSearch"
    />
    <button
      type="button"
      class="rounded-[9px] border border-line-2 bg-panel-2 px-3.5 py-2 text-[12.5px]"
      @click="submitSearch"
    >
      Rechercher
    </button>
  </div>

  <div
    class="grid min-h-[560px] grid-cols-[222px_1fr_286px] overflow-hidden rounded-[14px] border border-line bg-panel"
  >
    <!-- Sources / Tags -->
    <div class="border-r border-line bg-bg-2">
      <div class="border-b border-line p-4 text-[12px] font-semibold">Filtres</div>
      <div class="flex flex-col gap-1 p-2">
        <button
          type="button"
          class="rounded-md px-2.5 py-2 text-left text-[13px]"
          :class="!filters.type ? 'font-semibold text-txt' : 'text-txt-2 hover:bg-panel-2'"
          @click="applyFilters({ type: null })"
        >
          Tout
        </button>
        <button
          v-for="type in ['rss', 'bookmark', 'note']"
          :key="type"
          type="button"
          class="rounded-md px-2.5 py-2 text-left text-[13px] capitalize"
          :class="filters.type === type ? 'font-semibold text-txt' : 'text-txt-2 hover:bg-panel-2'"
          @click="applyFilters({ type: filters.type === type ? null : type })"
        >
          {{ type }}
        </button>
      </div>
      <div class="border-t border-line p-4 text-[12px] font-semibold">Tags</div>
      <div class="flex flex-wrap gap-1.5 p-3">
        <button
          v-for="tag in allTags"
          :key="tag"
          type="button"
          class="rounded-full border px-2.5 py-1 text-[11px]"
          :class="
            filters.tag === tag
              ? 'border-accent bg-accent-soft text-txt'
              : 'border-line-2 bg-panel-2 text-txt-2'
          "
          @click="applyFilters({ tag: filters.tag === tag ? null : tag })"
        >
          #{{ tag }}
        </button>
      </div>
    </div>

    <!-- Flux -->
    <div class="min-w-0">
      <div class="flex items-center gap-2 border-b border-line p-4 text-[12px] font-semibold">
        Flux agrégé
        <span
          class="rounded-full border border-line-2 bg-panel-2 px-2.5 py-0.5 text-[11px] font-normal text-txt-2"
        >
          {{ items.length }} éléments
        </span>
      </div>
      <div
        v-for="item in items"
        :key="item.id"
        class="flex items-center gap-3 border-b border-line px-4 py-3.5"
      >
        <div class="min-w-0 flex-1">
          <div class="text-[13px] font-semibold">{{ item.title }}</div>
          <div class="mt-0.5 flex flex-wrap items-center gap-1.5 text-[11.5px] text-txt-2">
            <span class="capitalize">{{ item.type }}</span>
            <span
              v-for="tag in item.tags"
              :key="tag"
              class="rounded-full border border-line-2 bg-panel-2 px-2 py-0.5 text-[10.5px]"
            >
              #{{ tag }}
            </span>
          </div>
        </div>
        <button
          type="button"
          class="shrink-0 font-mono text-[10.5px] text-txt-3 hover:text-accent"
          @click="toggleQueue(item)"
        >
          {{ item.readingQueue ? '− file' : '+ file' }}
        </button>
      </div>
      <div v-if="items.length === 0" class="p-6 text-center text-[13px] text-txt-2">
        Aucun résultat.
      </div>
    </div>

    <!-- File de lecture + capture -->
    <div class="border-l border-line bg-bg-2">
      <div class="flex items-center gap-2 border-b border-line p-4 text-[12px] font-semibold">
        File de lecture
        <span class="ml-auto font-mono text-[11px] text-txt-3">{{ readingQueueItems.length }}</span>
      </div>
      <div class="flex flex-col gap-2 p-3">
        <div
          v-for="item in readingQueueItems"
          :key="item.id"
          class="rounded-[9px] border border-line bg-panel p-2.5"
        >
          <div class="text-[12px] font-semibold">{{ item.title }}</div>
        </div>
      </div>

      <div class="border-t border-line p-4 text-[12px] font-semibold">Capture rapide</div>
      <form class="flex flex-col gap-2 p-3" @submit.prevent="submitCapture">
        <select
          v-model="capture.type"
          class="rounded-md border border-line-2 bg-panel px-2 py-1.5 text-[12px]"
        >
          <option value="note">Note</option>
          <option value="bookmark">Signet</option>
          <option value="rss">RSS</option>
        </select>
        <input
          v-model="capture.title"
          type="text"
          placeholder="Titre"
          class="rounded-md border border-line-2 bg-panel px-2 py-1.5 text-[12px] placeholder:text-txt-3"
        />
        <input
          v-model="capture.url"
          type="text"
          placeholder="URL (optionnel)"
          class="rounded-md border border-line-2 bg-panel px-2 py-1.5 text-[12px] placeholder:text-txt-3"
        />
        <button
          type="submit"
          class="rounded-md border border-accent bg-accent px-2 py-1.5 text-[12px] text-white disabled:opacity-50"
          :disabled="capturing || !capture.title.trim()"
        >
          Ajouter
        </button>
      </form>
    </div>
  </div>
</template>
