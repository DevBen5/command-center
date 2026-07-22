<script setup lang="ts">
import { computed, ref } from 'vue'
import { Head, Link, router } from '@inertiajs/vue3'
import AppLayout from '~/layouts/AppLayout.vue'
// ⚠️ Import **relatif**, jamais `#modules/*` : l'alias vise des `.js` qui n'existent qu'après un
// build, Vite ne les résout pas et la page casse. Le `.js` bascule sur le `.ts` côté Vite.
import {
  durationLabel,
  immichHref,
  isMediaItem,
  thumbnailHref,
  type ItemType,
} from '../shared/media_item.js'
import {
  confirmationMessage,
  summarizeSelection,
  toggleAll,
  toggleSelected,
} from '../shared/item_selection.js'

defineOptions({ layout: AppLayout })

interface VeilleItem {
  id: number
  type: ItemType
  veilleSourceId: number | null
  url: string | null
  title: string
  content: string | null
  tags: string[]
  metadata: Record<string, unknown> | null
  readingQueue: boolean
  publishedAt: string | null
  readAt: string | null
  /** L'asset a quitté l'album de veille (CC-55). Toujours nul pour un article. */
  unavailableAt: string | null
  /** Dérivé de `dedup_key` côté serveur. Nul pour tout ce qui ne vient pas d'Immich. */
  immichAssetId: string | null
  createdAt: string
}

interface VeilleSource {
  id: number
  title: string
  active: boolean
}

interface Filters {
  type: string | null
  tag: string | null
  readingQueue: boolean
  unread: boolean
  search: string | null
  sourceId: number | null
}

interface Stats {
  total: number
  articles: number
  queue: number
  unread: number
  tags: number
}

interface Pagination {
  total: number
  perPage: number
  currentPage: number
  lastPage: number
}

const props = defineProps<{
  items: VeilleItem[]
  pagination: Pagination
  stats: Stats
  tags: string[]
  sources: VeilleSource[]
  filters: Filters
  /** ⚠️ `webBaseUrl` seulement : `IMMICH_API_KEY` ne descend jamais au navigateur. */
  immich: { configured: boolean; webBaseUrl: string | null }
  /** Le retour d'une suppression — dont un échec Immich, rendu tel quel. */
  notification: { type: string; message: string } | null
}>()

const searchInput = ref(props.filters.search ?? '')

const queueItems = computed(() => props.items.filter((item) => item.readingQueue))

/**
 * Les identifiants cochés (CC-63).
 *
 * ⚠️ **Vidée à tout changement de filtre et de page.** Une sélection qui survivrait afficherait
 * un compteur portant sur des items qui ne sont plus à l'écran — et le dialogue de confirmation
 * annoncerait un nombre invérifiable. `summarizeSelection` recoupe de toute façon avec les items
 * affichés, mais l'état ne doit pas mentir non plus.
 */
const selected = ref<number[]>([])

const selection = computed(() => summarizeSelection(props.items, selected.value))

const isSelected = (item: VeilleItem): boolean => selected.value.includes(item.id)

function toggleItem(item: VeilleItem): void {
  selected.value = toggleSelected(selected.value, item.id)
}

function toggleEveryItem(): void {
  selected.value = toggleAll(selected.value, props.items)
}

/**
 * La suppression. **Rien ne part sans confirmation** — et le message dit combien d'assets Immich
 * sont concernés, pas seulement combien de lignes disparaissent de l'écran.
 */
function deleteSelected(): void {
  const message = confirmationMessage(selection.value)
  if (message === null || !confirm(message)) return

  router.post(
    '/veille/items/delete',
    { ids: selected.value },
    {
      preserveScroll: true,
      // La sélection ne survit pas au geste : les lignes visées n'existent plus, et celles qui
      // ont échoué doivent être re-choisies sciemment plutôt que resoumises par un second clic.
      onFinish: () => {
        selected.value = []
      },
    }
  )
}

/**
 * Tout changement de filtre repart à la page 1 : rester en page 4 d'un résultat qui n'en compte
 * plus qu'une afficherait une liste vide sans rien expliquer.
 */
function applyFilters(patch: Partial<Filters>): void {
  const next = { ...props.filters, ...patch, page: 1 }
  selected.value = []

  router.get(
    '/veille',
    // Les filtres inactifs sont retirés de l'URL plutôt qu'envoyés à `null` / `false` : une
    // query string qui ne porte que ce qui filtre reste lisible et copiable.
    Object.fromEntries(
      Object.entries(next).filter(([, value]) => value !== null && value !== false && value !== '')
    ),
    { preserveState: true, preserveScroll: true, replace: true }
  )
}

function goToPage(page: number): void {
  selected.value = []

  router.get(
    '/veille',
    Object.fromEntries(
      Object.entries({ ...props.filters, page }).filter(
        ([, value]) => value !== null && value !== false && value !== ''
      )
    ),
    { preserveState: true, preserveScroll: false, replace: true }
  )
}

function submitSearch(): void {
  applyFilters({ search: searchInput.value || null })
}

function toggleQueue(item: VeilleItem): void {
  router.post(`/veille/${item.id}/queue`, {}, { preserveScroll: true, preserveState: true })
}

function toggleRead(item: VeilleItem): void {
  router.post(`/veille/${item.id}/read`, {}, { preserveScroll: true, preserveState: true })
}

/** Les trois tons du bandeau de retour. `info` sert aussi de repli sur un type inconnu. */
const NOTIFICATION_STYLES: Record<string, string> = {
  success: 'border-ok/40 bg-panel text-ok',
  error: 'border-bad/40 bg-panel text-bad',
  info: 'border-line-2 bg-panel text-txt-2',
}

const TYPE_LABELS: Record<VeilleItem['type'], string> = {
  article: 'Article',
  bookmark: 'Signet',
  note: 'Note',
  image: 'Image',
  video: 'Vidéo',
}

/**
 * Les enveloppes des fonctions de `shared/media_item.ts` — **une ligne chacune**, pour que le
 * template reste lisible et que la logique reste prouvable (CC-60).
 */
const isMedia = (item: VeilleItem): boolean => isMediaItem(item.type)
const thumbnail = (item: VeilleItem): string => thumbnailHref(item.id)
const duration = (item: VeilleItem): string | null => durationLabel(item.metadata)
const mediaLink = (item: VeilleItem): string | null =>
  immichHref(props.immich.webBaseUrl, item.immichAssetId)

/** Le lien à ouvrir : Immich pour un média, l'URL du flux sinon. */
const itemLink = (item: VeilleItem): string | null =>
  isMedia(item) ? mediaLink(item) : item.url

function formatDate(item: VeilleItem): string {
  const raw = item.publishedAt ?? item.createdAt
  return new Date(raw).toLocaleDateString('fr-FR', { day: '2-digit', month: 'short' })
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

  <!-- Le retour d'une suppression. Un échec Immich s'affiche **tel quel** : « instance éteinte »,
       « clé sans la permission asset.delete » et « asset inconnu » doivent rester distinguables.
       Trois tons, parce qu'un clic sans effet n'est ni un succès ni une erreur. -->
  <div
    v-if="notification"
    class="mb-4 rounded-[9px] border px-3.5 py-2.5 text-[12.5px]"
    :class="NOTIFICATION_STYLES[notification.type] ?? NOTIFICATION_STYLES.info"
  >
    {{ notification.message }}
  </div>

  <div class="mb-4 flex items-center gap-3">
    <input
      v-model="searchInput"
      type="text"
      placeholder="Rechercher dans articles, signets et notes…"
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
    <Link
      href="/veille/sources"
      class="rounded-[9px] border border-line-2 bg-panel-2 px-3.5 py-2 text-[12.5px] text-txt-2 hover:text-txt"
    >
      Sources
    </Link>
  </div>

  <!-- Bande d'indicateurs -->
  <div class="mb-[18px] grid grid-cols-5 gap-3.5">
    <div class="rounded-[12px] border border-line bg-panel px-4 py-3.5">
      <div class="font-mono text-[24px] font-bold text-accent">{{ stats.total }}</div>
      <div class="text-[11px] text-txt-3">éléments au total</div>
    </div>
    <div class="rounded-[12px] border border-line bg-panel px-4 py-3.5">
      <div class="font-mono text-[24px] font-bold">{{ stats.articles }}</div>
      <div class="text-[11px] text-txt-3">articles collectés</div>
    </div>
    <div class="rounded-[12px] border border-line bg-panel px-4 py-3.5">
      <div class="font-mono text-[24px] font-bold text-aqua">{{ stats.unread }}</div>
      <div class="text-[11px] text-txt-3">non lus</div>
    </div>
    <div class="rounded-[12px] border border-line bg-panel px-4 py-3.5">
      <div class="font-mono text-[24px] font-bold">{{ stats.queue }}</div>
      <div class="text-[11px] text-txt-3">en file de lecture</div>
    </div>
    <div class="rounded-[12px] border border-line bg-panel px-4 py-3.5">
      <div class="font-mono text-[24px] font-bold">{{ stats.tags }}</div>
      <div class="text-[11px] text-txt-3">tags distincts</div>
    </div>
  </div>

  <div
    class="grid min-h-[560px] grid-cols-[222px_1fr_286px] overflow-hidden rounded-[14px] border border-line bg-panel"
  >
    <!-- Filtres -->
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
          v-for="(label, type) in TYPE_LABELS"
          :key="type"
          type="button"
          class="rounded-md px-2.5 py-2 text-left text-[13px]"
          :class="filters.type === type ? 'font-semibold text-txt' : 'text-txt-2 hover:bg-panel-2'"
          @click="applyFilters({ type: filters.type === type ? null : type })"
        >
          {{ label }}
        </button>
      </div>

      <div class="border-t border-line p-2">
        <button
          type="button"
          class="w-full rounded-md px-2.5 py-2 text-left text-[13px]"
          :class="filters.unread ? 'font-semibold text-aqua' : 'text-txt-2 hover:bg-panel-2'"
          @click="applyFilters({ unread: !filters.unread })"
        >
          Non lus seulement
        </button>
        <button
          type="button"
          class="w-full rounded-md px-2.5 py-2 text-left text-[13px]"
          :class="filters.readingQueue ? 'font-semibold text-accent' : 'text-txt-2 hover:bg-panel-2'"
          @click="applyFilters({ readingQueue: !filters.readingQueue })"
        >
          File de lecture
        </button>
      </div>

      <template v-if="sources.length > 0">
        <div class="border-t border-line p-4 text-[12px] font-semibold">Sources</div>
        <div class="flex flex-col gap-1 p-2">
          <button
            v-for="source in sources"
            :key="source.id"
            type="button"
            class="truncate rounded-md px-2.5 py-1.5 text-left text-[12px]"
            :class="
              filters.sourceId === source.id
                ? 'font-semibold text-txt'
                : 'text-txt-2 hover:bg-panel-2'
            "
            @click="applyFilters({ sourceId: filters.sourceId === source.id ? null : source.id })"
          >
            {{ source.title }}
          </button>
        </div>
      </template>

      <div class="border-t border-line p-4 text-[12px] font-semibold">Tags</div>
      <div class="flex flex-wrap gap-1.5 p-3">
        <!-- Les tags viennent du serveur (toute la base), pas des items affichés : dérivés de
             la liste filtrée, ils s'effondraient au tag sélectionné dès le premier clic. -->
        <button
          v-for="tag in tags"
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
    <div class="flex min-w-0 flex-col">
      <div class="flex items-center gap-2 border-b border-line p-4 text-[12px] font-semibold">
        <!-- Tout cocher — **de la page affichée seulement**. Aucun geste n'atteint les autres
             pages : le rayon d'action reste ce que la confirmation sait annoncer. -->
        <input
          v-if="items.length > 0"
          type="checkbox"
          class="accent-accent"
          :checked="selection.total === items.length"
          title="Tout sélectionner sur cette page"
          @change="toggleEveryItem"
        />
        Flux agrégé
        <span
          class="rounded-full border border-line-2 bg-panel-2 px-2.5 py-0.5 text-[11px] font-normal text-txt-2"
        >
          {{ pagination.total }} éléments
        </span>
      </div>

      <!-- La barre d'action, seulement quand quelque chose est coché. Elle annonce le nombre
           d'assets Immich concernés : c'est la seule chose que le bouton ne peut pas dire seul. -->
      <div
        v-if="selection.total > 0"
        class="flex items-center gap-3 border-b border-line bg-panel-2 px-4 py-2.5 text-[12px]"
      >
        <span class="font-semibold">
          {{ selection.total }} sélectionné{{ selection.total > 1 ? 's' : '' }}
        </span>
        <span v-if="selection.media > 0" class="text-txt-3">
          dont {{ selection.media }} média{{ selection.media > 1 ? 's' : '' }} à envoyer à la
          corbeille d’Immich
        </span>
        <button
          type="button"
          class="ml-auto rounded-md border border-line-2 bg-panel px-3 py-1.5 text-txt-2 hover:text-txt"
          @click="selected = []"
        >
          Annuler
        </button>
        <button
          type="button"
          class="rounded-md border border-bad/50 bg-panel px-3 py-1.5 text-bad hover:border-bad"
          @click="deleteSelected"
        >
          Supprimer
        </button>
      </div>

      <div
        v-for="item in items"
        :key="item.id"
        class="flex items-start gap-3 border-b border-line px-4 py-3.5"
        :class="item.readAt ? 'opacity-55' : ''"
      >
        <input
          type="checkbox"
          class="mt-0.5 shrink-0 accent-accent"
          :checked="isSelected(item)"
          :title="`Sélectionner « ${item.title} »`"
          @change="toggleItem(item)"
        />
        <button
          type="button"
          class="mt-1 shrink-0 rounded-full border transition-colors"
          :class="
            item.readAt ? 'h-2 w-2 border-line-2 bg-transparent' : 'h-2 w-2 border-aqua bg-aqua'
          "
          :title="item.readAt ? 'Marquer comme non lu' : 'Marquer comme lu'"
          @click="toggleRead(item)"
        />
        <!-- La vignette d'un média. `<img>` natif vers notre proxy : la clé d'API reste au
             serveur, et rien n'est copié — les octets traversent et sont oubliés. -->
        <a
          v-if="isMedia(item) && !item.unavailableAt"
          :href="mediaLink(item) ?? undefined"
          target="_blank"
          rel="noopener noreferrer"
          class="relative shrink-0 overflow-hidden rounded-[8px] border border-line-2 bg-panel-2"
        >
          <img
            :src="thumbnail(item)"
            :alt="item.title"
            loading="lazy"
            class="h-[54px] w-[86px] object-cover"
          />
          <span
            v-if="duration(item)"
            class="absolute right-1 bottom-1 rounded-[4px] bg-bg/80 px-1 py-0.5 font-mono text-[10px] text-txt"
          >
            {{ duration(item) }}
          </span>
        </a>
        <!-- L'asset n'est plus dans l'album : pas de vignette à demander, et on le dit. -->
        <div
          v-else-if="isMedia(item)"
          class="flex h-[54px] w-[86px] shrink-0 items-center justify-center rounded-[8px] border border-dashed border-line-2 bg-panel-2 text-[10px] text-txt-3"
        >
          absent
        </div>

        <div class="min-w-0 flex-1">
          <a
            v-if="itemLink(item)"
            :href="itemLink(item) ?? undefined"
            target="_blank"
            rel="noopener noreferrer"
            class="text-[13px] font-semibold hover:text-accent"
            :class="item.readAt ? 'font-normal' : ''"
          >
            {{ item.title }}
          </a>
          <div v-else class="text-[13px] font-semibold" :class="item.readAt ? 'font-normal' : ''">
            {{ item.title }}
          </div>
          <!-- `content` est du texte : il est réduit à la collecte, jamais du HTML.
               Interpolation uniquement — aucun `v-html` dans ce module. -->
          <p v-if="item.content" class="mt-0.5 line-clamp-2 text-[11.5px] text-txt-2">
            {{ item.content }}
          </p>
          <div class="mt-1 flex flex-wrap items-center gap-1.5 text-[11.5px] text-txt-3">
            <span>{{ TYPE_LABELS[item.type] }}</span>
            <span>·</span>
            <span class="font-mono">{{ formatDate(item) }}</span>
            <!-- ⚠️ « plus dans l'album », pas « supprimé » : la collecte ne distingue pas un
                 asset retiré de l'album d'un asset effacé d'Immich, et ne le prétend pas. -->
            <span
              v-if="item.unavailableAt"
              class="rounded-full border border-warn/40 bg-panel-2 px-2 py-0.5 text-[10.5px] text-warn"
              title="L’asset n’est plus dans l’album de veille : retiré de l’album, ou supprimé d’Immich."
            >
              plus dans l’album
            </span>
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

      <div
        v-if="pagination.lastPage > 1"
        class="mt-auto flex items-center justify-between border-t border-line px-4 py-3 text-[12px]"
      >
        <button
          type="button"
          class="rounded-md border border-line-2 bg-panel-2 px-3 py-1.5 disabled:opacity-40"
          :disabled="pagination.currentPage <= 1"
          @click="goToPage(pagination.currentPage - 1)"
        >
          Précédent
        </button>
        <span class="font-mono text-[11.5px] text-txt-3">
          page {{ pagination.currentPage }} / {{ pagination.lastPage }}
        </span>
        <button
          type="button"
          class="rounded-md border border-line-2 bg-panel-2 px-3 py-1.5 disabled:opacity-40"
          :disabled="pagination.currentPage >= pagination.lastPage"
          @click="goToPage(pagination.currentPage + 1)"
        >
          Suivant
        </button>
      </div>
    </div>

    <!-- File de lecture + capture -->
    <div class="border-l border-line bg-bg-2">
      <div class="flex items-center gap-2 border-b border-line p-4 text-[12px] font-semibold">
        File de lecture
        <span class="ml-auto font-mono text-[11px] text-txt-3">{{ stats.queue }}</span>
      </div>
      <div class="flex flex-col gap-2 p-3">
        <div
          v-for="item in queueItems"
          :key="item.id"
          class="rounded-[9px] border border-line bg-panel p-2.5"
        >
          <div class="text-[12px] font-semibold">{{ item.title }}</div>
        </div>
        <!-- La colonne ne montre que la file **de la page courante** : le compteur ci-dessus est
             global, celui-ci non. Le filtre « File de lecture » donne la liste complète. -->
        <button
          v-if="stats.queue > queueItems.length"
          type="button"
          class="rounded-md px-2 py-1 text-left text-[11.5px] text-txt-3 hover:text-accent"
          @click="applyFilters({ readingQueue: true })"
        >
          voir toute la file ({{ stats.queue }})
        </button>
      </div>

      <div class="border-t border-line p-4 text-[12px] font-semibold">Capture rapide</div>
      <form class="flex flex-col gap-2 p-3" @submit.prevent="submitCapture">
        <select
          v-model="capture.type"
          class="rounded-md border border-line-2 bg-panel px-2 py-1.5 text-[12px]"
        >
          <option value="note">Note</option>
          <option value="bookmark">Signet</option>
          <option value="article">Article</option>
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
