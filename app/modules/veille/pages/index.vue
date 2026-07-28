<script setup lang="ts">
import { computed, ref } from 'vue'
import { useI18n } from 'vue-i18n'
import { Head, Link, router } from '@inertiajs/vue3'
import AppLayout from '~/layouts/AppLayout.vue'
// ⚠️ Import **relatif**, jamais `#modules/*` : l'alias vise des `.js` qui n'existent qu'après un
// build, Vite ne les résout pas et la page casse. Le `.js` bascule sur le `.ts` côté Vite.
import {
  channelLabel,
  durationLabel,
  isMediaItem,
  mediaHref,
  thumbnailHref,
  type ItemType,
} from '../shared/media_item.js'
import {
  confirmationMessage,
  summarizeSelection,
  toggleAll,
  toggleSelected,
} from '../shared/item_selection.js'
// ⚠️ Types seuls : la provenance est **dérivée au serveur** (`VeilleController.serialize`), pas
// ici. La page reçoit une décision déjà prise et ne fait que la traduire et la colorer — c'est
// ce qui lui évite de connaître `dedupKey`, dont elle n'a par ailleurs aucun usage.
import type { ItemProvenance, SourceKind } from '../shared/item_provenance.js'
// La sentinelle est importée, jamais réécrite : `'none'` défini des deux côtés ferait diverger
// ce qui est cliqué de ce qui est filtré, et la divergence serait muette (CC-105).
import { NO_SOURCE, type SourceFilter } from '../shared/source_filter.js'
import { activeFilters, clearAllPatch } from '../shared/active_filters.js'
import { filterPayload } from '../shared/filter_selection.js'
import { addTag, normalizeTag, removeTag, TAGS_MAX } from '../shared/tags.js'
import { requiresTag, type BulkAction } from '../shared/bulk_actions.js'

/** Les quatre gestes offerts dans les deux barres, dans le même ordre des deux côtés. */
const BULK_BUTTONS = [
  { action: 'read', key: 'read' },
  { action: 'unread', key: 'unread' },
  { action: 'queue.add', key: 'queueAdd' },
  { action: 'queue.remove', key: 'queueRemove' },
  { action: 'tag.add', key: 'tagAdd' },
  { action: 'tag.remove', key: 'tagRemove' },
] as const satisfies readonly { action: BulkAction; key: string }[]

defineOptions({ layout: AppLayout })

const { t } = useI18n()

interface VeilleItem {
  id: number
  type: ItemType
  veilleSourceId: number | null
  /**
   * Nulle pour un média Immich — son lien se construit à l'affichage (voir `immichHref`) — et
   * renseignée pour une vidéo YouTube, dont l'URL canonique ne bougera pas (CC-87). C'est ce que
   * `mediaHref` prend en repli.
   */
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
  /** Dérivée au serveur elle aussi (CC-104) — source vivante, saisie à la main, ou orpheline. */
  provenance: ItemProvenance
  createdAt: string
}

interface VeilleSource {
  id: number
  title: string
  active: boolean
  /** Ce qui colore la pastille de provenance. Descend depuis toujours, déclaré depuis CC-104. */
  kind: SourceKind
}

interface Filters {
  type: string | null
  tag: string | null
  readingQueue: boolean
  unread: boolean
  search: string | null
  /** `number` = une source · `'none'` = celles qui n'en ont plus · `null` = pas de filtre. */
  sourceId: SourceFilter
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

/** Le décompte serveur est un aller-retour : sans ce verrou, deux clics posent deux dialogues. */
const deletingFiltered = ref(false)

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
  const message = confirmationMessage(selection.value, 'selected')
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
 * Supprimer **tout ce que le filtre désigne**, au-delà de la page courante (CC-108).
 *
 * ⚠️ **Le décompte vient du serveur, pas de `pagination.total`.** Une collecte tourne toutes les
 * minutes : ce qu'affichait la page a pu dériver depuis le rendu, et la confirmation doit
 * annoncer ce qui va réellement partir au moment du geste. C'est la seule raison d'être de
 * l'aller-retour supplémentaire.
 *
 * ⚠️ **La même charge utile sert au décompte et à la suppression** (`filterPayload`) : deux
 * constructions permettraient à ce qui est compté de différer de ce qui est supprimé, et
 * l'écart ne se verrait qu'après coup.
 *
 * ⚠️ **Un échec du décompte n'ouvre pas le dialogue.** Sans compte, la confirmation n'aurait
 * rien à annoncer, et cliquer « OK » sur un nombre inconnu est précisément ce que ce lot doit
 * empêcher. Le serveur refuse aussi de son côté — masquer un bouton n'est pas un droit.
 */
async function deleteFiltered(): Promise<void> {
  const payload = filterPayload(props.filters)
  deletingFiltered.value = true

  try {
    const response = await fetch(`/veille/items/filtered/count?${new URLSearchParams(payload)}`, {
      headers: { accept: 'application/json' },
    })
    if (!response.ok) return

    const summary = (await response.json()) as { total: number; media: number }
    const message = confirmationMessage(summary, 'filtered')
    if (message === null || !confirm(message)) return

    selected.value = []
    router.post('/veille/items/filtered/delete', payload, { preserveScroll: true })
  } finally {
    deletingFiltered.value = false
  }
}

/**
 * Les actions groupées (CC-109) — sur les cases cochées, ou sur tout ce que le filtre désigne.
 *
 * ⚠️ **Aucune ne touche Immich, donc aucune ne demande confirmation.** Exiger un « êtes-vous
 * sûr » pour marquer lu banaliserait le seul dialogue du module qui compte — celui de la
 * suppression, qui écrit dans un autre système.
 *
 * ⚠️ **Les deux tags passent par `prompt`, et c'est assumé** : le même geste que le `confirm` de
 * la suppression, sur un écran qui n'a pas de modale. La valeur est normalisée à l'envoi comme à
 * la capture, et le serveur refuse ce qui n'a pas la bonne forme.
 */
function runBulk(action: BulkAction, scope: 'selected' | 'filtered'): void {
  let tag: string | null = null

  if (requiresTag(action)) {
    const raw = prompt(t(`veille.index.bulk.prompt.${action === 'tag.add' ? 'add' : 'remove'}`))
    if (raw === null) return

    tag = normalizeTag(raw)
    // Un tag inexploitable n'est pas une erreur serveur : on n'envoie simplement rien.
    if (tag === null) return
  }

  const payload = { action, ...(tag === null ? {} : { tag }) }

  if (scope === 'filtered') {
    router.post(
      '/veille/items/filtered/bulk',
      { ...payload, ...filterPayload(props.filters) },
      { preserveScroll: true }
    )
    return
  }

  router.post(
    '/veille/items/bulk',
    { ...payload, ids: selected.value },
    {
      preserveScroll: true,
      // La sélection ne survit pas au geste : la liste rechargée porte de nouveaux états, et
      // ré-agir dessus doit être un choix conscient plutôt qu'un second clic.
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

const TYPE_LABELS = computed<Record<VeilleItem['type'], string>>(() => ({
  article: t('veille.index.types.article'),
  bookmark: t('veille.index.types.bookmark'),
  note: t('veille.index.types.note'),
  image: t('veille.index.types.image'),
  video: t('veille.index.types.video'),
}))

/**
 * Les enveloppes des fonctions de `shared/media_item.ts` — **une ligne chacune**, pour que le
 * template reste lisible et que la logique reste prouvable (CC-60).
 */
/**
 * La couleur de la pastille de provenance — par `kind` quand la source vit encore, par `origin`
 * sinon. Tokens `@theme` uniquement.
 *
 * ⚠️ **`warn` pour un orphelin, la même teinte que « plus dans l'album »**, et c'est voulu : les
 * deux disent une dégradation, et un même item peut porter les deux (un asset Immich dont la
 * source aurait été supprimée). Leur donner deux couleurs suggérerait deux natures d'information.
 *
 * ⚠️ **Le repli est neutre, jamais rien.** Une provenance dont le `kind` n'aurait pas de couleur
 * afficherait sa pastille sans bordure : un blanc à l'endroit exact que ce lot vient combler.
 */
const PROVENANCE_CLASSES: Record<string, string> = {
  rss: 'border-accent/40 bg-panel-2 text-accent',
  immich: 'border-aqua/40 bg-panel-2 text-aqua',
  youtube: 'border-ok/40 bg-panel-2 text-ok',
  manual: 'border-line-2 bg-panel-2 text-txt-2',
  orphan: 'border-warn/40 bg-panel-2 text-warn',
}

const provenanceClass = (p: ItemProvenance): string =>
  PROVENANCE_CLASSES[p.sourceKind ?? p.origin] ?? PROVENANCE_CLASSES.manual

/** `labelKey` nul = le texte vient de la base (un titre de source ne se traduit pas). */
const provenanceLabel = (p: ItemProvenance): string =>
  p.labelKey === null ? (p.text ?? '') : t(p.labelKey, { source: p.text ?? '' })

/**
 * **Le langage visuel d'un filtre — un seul, celui des pastilles de tag** (CC-65).
 *
 * La page en parlait cinq : pastille complète pour les tags, graisse + aqua pour « Non lus »,
 * graisse + accent pour « À lire plus tard », graisse seule pour les types et les sources,
 * graisse + warn pour « Sans source ». Sur fond sombre, un changement de graisse est le signal
 * le plus faible dont on dispose, et il ne dit ni « ceci est un filtre », ni « il est actif »,
 * ni « voilà comment l'enlever ».
 *
 * ⚠️ **Deux états de sélection, pas un.** « Tout » est *sélectionné* sans qu'aucun filtre soit
 * posé : lui donner l'accent effacerait la distinction que ce lot vient précisément établir —
 * un filtre posé se voit, et se retire. Il prend donc le neutre.
 *
 * ⚠️ **La bordure existe dès l'état inactif, en `transparent`.** Ne la poser qu'à l'actif
 * décalerait la boîte de 2 px à chaque clic, et toute la colonne sautillerait.
 */
const FILTER_ACTIVE = 'border-accent bg-accent-soft text-txt'
const FILTER_NEUTRAL = 'border-transparent bg-panel-2 text-txt'
const FILTER_IDLE = 'border-transparent text-txt-2 hover:bg-panel-2'

/** Les filtres posés, et de quoi les retirer un par un. La décision vit dans `shared/`. */
const posed = computed(() => activeFilters(props.filters, props.sources))

const isMedia = (item: VeilleItem): boolean => isMediaItem(item.type)
const thumbnail = (item: VeilleItem): string => thumbnailHref(item.id)
const duration = (item: VeilleItem): string | null => durationLabel(item.metadata)
const channel = (item: VeilleItem): string | null => channelLabel(item.metadata)
const mediaLink = (item: VeilleItem): string | null =>
  mediaHref(props.immich.webBaseUrl, item)

/** Le lien à ouvrir : le média chez lui (Immich ou YouTube), l'URL du flux sinon. */
const itemLink = (item: VeilleItem): string | null =>
  isMedia(item) ? mediaLink(item) : item.url

function formatDate(item: VeilleItem): string {
  const raw = item.publishedAt ?? item.createdAt
  return new Date(raw).toLocaleDateString('fr-FR', { day: '2-digit', month: 'short' })
}

const capture = ref({
  type: 'note' as VeilleItem['type'],
  title: '',
  url: '',
  tags: [] as string[],
})
const capturing = ref(false)

/** Ce qui est en train d'être tapé, avant validation par Entrée ou virgule. */
const tagDraft = ref('')

/**
 * Les tags déjà en base qui ne sont pas encore posés sur cette capture (CC-21).
 *
 * ⚠️ **Ils viennent de la prop `tags`, servie par le serveur** — la même que la barre latérale,
 * donc toute la base et non les items affichés. Les dériver de `props.items` rejouerait le bug de
 * CC-54 : la liste s'effondrerait au tag filtré dès le premier clic, et on ne pourrait plus
 * proposer que celui-là.
 */
const tagSuggestions = computed(() =>
  props.tags.filter((tag) => !capture.value.tags.includes(tag))
)

/**
 * Valide le tag en cours de frappe.
 *
 * ⚠️ **La normalisation est appliquée ICI, à la frappe, pas à l'envoi.** Ce qui apparaît en
 * pastille est exactement ce qui sera stocké : un `IA` transformé en `ia` en silence côté serveur
 * laisserait chercher pourquoi le filtre ne trouve rien.
 */
function commitTag(): void {
  capture.value.tags = addTag(capture.value.tags, tagDraft.value)
  tagDraft.value = ''
}

function dropTag(tag: string): void {
  capture.value.tags = removeTag(capture.value.tags, tag)
}

function submitCapture(): void {
  if (!capture.value.title.trim()) return
  // ⚠️ Un tag tapé mais non validé par Entrée serait perdu au clic sur « Ajouter » — le geste le
  // plus naturel étant justement de taper puis de soumettre.
  commitTag()

  capturing.value = true
  router.post(
    '/veille',
    {
      type: capture.value.type,
      title: capture.value.title,
      url: capture.value.url || undefined,
      tags: capture.value.tags.length > 0 ? capture.value.tags : undefined,
    },
    {
      preserveScroll: true,
      onFinish: () => {
        capturing.value = false
        capture.value = { type: 'note', title: '', url: '', tags: [] }
        tagDraft.value = ''
      },
    }
  )
}
</script>

<template>
  <Head :title="t('veille.index.title')" />

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
      :placeholder="t('veille.index.search.placeholder')"
      class="flex-1 rounded-[9px] border border-line-2 bg-panel px-3.5 py-2.5 text-[13px] text-txt placeholder:text-txt-3 outline-none focus:border-accent"
      @keyup.enter="submitSearch"
    />
    <button
      type="button"
      class="rounded-[9px] border border-line-2 bg-panel-2 px-3.5 py-2 text-[12.5px]"
      @click="submitSearch"
    >
      {{ t('veille.index.search.submit') }}
    </button>
    <Link
      href="/veille/sources"
      class="rounded-[9px] border border-line-2 bg-panel-2 px-3.5 py-2 text-[12.5px] text-txt-2 hover:text-txt"
    >
      {{ t('veille.index.sourcesLink') }}
    </Link>
  </div>

  <!-- Bande d'indicateurs -->
  <div class="mb-[18px] grid grid-cols-5 gap-3.5">
    <div class="rounded-[12px] border border-line bg-panel px-4 py-3.5">
      <div class="font-mono text-[24px] font-bold text-accent">{{ stats.total }}</div>
      <div class="text-[11px] text-txt-3">{{ t('veille.index.stats.total') }}</div>
    </div>
    <div class="rounded-[12px] border border-line bg-panel px-4 py-3.5">
      <div class="font-mono text-[24px] font-bold">{{ stats.articles }}</div>
      <div class="text-[11px] text-txt-3">{{ t('veille.index.stats.articles') }}</div>
    </div>
    <div class="rounded-[12px] border border-line bg-panel px-4 py-3.5">
      <div class="font-mono text-[24px] font-bold text-aqua">{{ stats.unread }}</div>
      <div class="text-[11px] text-txt-3">{{ t('veille.index.stats.unread') }}</div>
    </div>
    <div class="rounded-[12px] border border-line bg-panel px-4 py-3.5">
      <div class="font-mono text-[24px] font-bold">{{ stats.queue }}</div>
      <div class="text-[11px] text-txt-3">{{ t('veille.index.stats.queue') }}</div>
    </div>
    <div class="rounded-[12px] border border-line bg-panel px-4 py-3.5">
      <div class="font-mono text-[24px] font-bold">{{ stats.tags }}</div>
      <div class="text-[11px] text-txt-3">{{ t('veille.index.stats.tags') }}</div>
    </div>
  </div>

  <div
    class="grid min-h-[560px] grid-cols-[222px_1fr_286px] overflow-hidden rounded-[14px] border border-line bg-panel"
  >
    <!-- Filtres -->
    <div class="border-r border-line bg-bg-2">
      <div class="border-b border-line p-4 text-[12px] font-semibold">
        {{ t('veille.index.filters.title') }}
      </div>
      <div class="flex flex-col gap-1 p-2">
        <button
          type="button"
          class="rounded-md border px-2.5 py-2 text-left text-[13px] transition-colors"
          :class="filters.type ? FILTER_IDLE : FILTER_NEUTRAL"
          @click="applyFilters({ type: null })"
        >
          {{ t('veille.index.filters.all') }}
        </button>
        <button
          v-for="(label, type) in TYPE_LABELS"
          :key="type"
          type="button"
          class="rounded-md border px-2.5 py-2 text-left text-[13px] transition-colors"
          :class="filters.type === type ? FILTER_ACTIVE : FILTER_IDLE"
          @click="applyFilters({ type: filters.type === type ? null : type })"
        >
          {{ label }}
        </button>
      </div>

      <div class="border-t border-line p-2">
        <button
          type="button"
          class="w-full rounded-md border px-2.5 py-2 text-left text-[13px] transition-colors"
          :class="filters.unread ? FILTER_ACTIVE : FILTER_IDLE"
          @click="applyFilters({ unread: !filters.unread })"
        >
          {{ t('veille.index.filters.unreadOnly') }}
        </button>
        <button
          type="button"
          class="w-full rounded-md border px-2.5 py-2 text-left text-[13px] transition-colors"
          :class="filters.readingQueue ? FILTER_ACTIVE : FILTER_IDLE"
          @click="applyFilters({ readingQueue: !filters.readingQueue })"
        >
          {{ t('veille.index.filters.readingQueue') }}
        </button>
      </div>

      <!-- ⚠️ **Le groupe n'est PLUS conditionné à `sources.length > 0`** (CC-105). Le cas où
           « Sans source » compte le plus est précisément celui où il ne reste aucune source :
           toutes supprimées, leurs items détachés par la FK `ON DELETE SET NULL`, et plus rien à
           l'écran pour les atteindre. Sous l'ancien `v-if`, le filtre aurait disparu exactement
           quand il devenait le seul utile. Seule la LISTE des sources reste conditionnée. -->
      <div class="border-t border-line p-4 text-[12px] font-semibold">
        {{ t('veille.index.filters.sourcesTitle') }}
      </div>
      <div class="flex flex-col gap-1 p-2">
        <!-- ⚠️ **Une source désactivée reste listée, et c'est délibéré** (CC-65). Ses items déjà
             collectés existent toujours et restent légitimement filtrables : c'est l'affichage
             de l'état qui manquait, pas la ligne. `opacity-55` + le mot sont le vocabulaire de
             `/veille/sources`, et la CLÉ y est reprise telle quelle — deux clés pour le même mot
             divergeraient à la première retraduction.
             Le titre cède (`truncate`), le marqueur jamais (`shrink-0`) : dans 222 px, c'est
             l'état qu'on ne peut pas se permettre de perdre. -->
        <button
          v-for="source in sources"
          :key="source.id"
          type="button"
          class="flex items-center gap-1.5 rounded-md border px-2.5 py-1.5 text-left text-[12px] transition-colors"
          :class="[
            filters.sourceId === source.id ? FILTER_ACTIVE : FILTER_IDLE,
            source.active ? '' : 'opacity-55',
          ]"
          @click="applyFilters({ sourceId: filters.sourceId === source.id ? null : source.id })"
        >
          <span class="truncate">{{ source.title }}</span>
          <span v-if="!source.active" class="shrink-0 text-[10.5px] text-txt-3">
            {{ t('veille.sources.disabled') }}
          </span>
        </button>
        <button
          type="button"
          class="truncate rounded-md border px-2.5 py-1.5 text-left text-[12px] transition-colors"
          :class="filters.sourceId === NO_SOURCE ? FILTER_ACTIVE : FILTER_IDLE"
          @click="applyFilters({ sourceId: filters.sourceId === NO_SOURCE ? null : NO_SOURCE })"
        >
          {{ t('veille.index.filters.noSource') }}
        </button>
      </div>

      <div class="border-t border-line p-4 text-[12px] font-semibold">
        {{ t('veille.index.filters.tags') }}
      </div>
      <div class="flex flex-wrap gap-1.5 p-3">
        <!-- Les tags viennent du serveur (toute la base), pas des items affichés : dérivés de
             la liste filtrée, ils s'effondraient au tag sélectionné dès le premier clic. -->
        <button
          v-for="tag in tags"
          :key="tag"
          type="button"
          class="rounded-full border px-2.5 py-1 text-[11px] transition-colors"
          :class="filters.tag === tag ? FILTER_ACTIVE : 'border-line-2 bg-panel-2 text-txt-2'"
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
          :title="t('veille.index.feed.selectAllTitle')"
          @change="toggleEveryItem"
        />
        {{ t('veille.index.feed.title') }}
        <span
          class="rounded-full border border-line-2 bg-panel-2 px-2.5 py-0.5 text-[11px] font-normal text-txt-2"
        >
          {{ t('veille.index.feed.count', { n: pagination.total }) }}
        </span>
      </div>

      <!-- Le rappel des filtres actifs (CC-65). En descendant dans la liste on ne savait plus
           pourquoi elle était courte : le compteur « N éléments » reflète bien le filtre, mais
           ne dit pas lequel.

           ⚠️ **Il est AU-DESSUS de la barre de sélection, et l'ordre n'est pas indifférent.**
           Le rappel est stable — il suit le filtre ; la barre de sélection est éphémère, elle
           apparaît et disparaît au fil des cases cochées. L'éphémère placé au-dessus ferait
           sauter le rappel à chaque clic sur une case. Empilés dans cet ordre, ils coexistent
           sans se pousser.

           ⚠️ **Chaque ✕ passe par `applyFilters`**, jamais par une URL construite à côté : c'est
           lui qui remet la page à 1 et qui retire les inactifs de la query string. Un retrait
           qui garderait `?page=4` afficherait « Aucun résultat » sur un filtre élargi. -->
      <div
        v-if="posed.length > 0"
        class="flex flex-wrap items-center gap-1.5 border-b border-line px-4 py-2.5 text-[11.5px]"
      >
        <span class="text-txt-3">{{ t('veille.index.filters.chip.heading') }}</span>
        <button
          v-for="filter in posed"
          :key="filter.field"
          type="button"
          class="flex items-center gap-1.5 rounded-full border px-2.5 py-1 transition-colors hover:border-bad hover:text-bad"
          :class="FILTER_ACTIVE"
          :title="t('veille.index.filters.chip.remove', { label: t(filter.labelKey) })"
          @click="applyFilters(filter.patch)"
        >
          <span>
            {{ t(filter.labelKey)
            }}<template v-if="filter.valueKey || filter.valueText">
              : {{ filter.valueKey ? t(filter.valueKey) : filter.valueText }}
            </template>
          </span>
          <span aria-hidden="true">✕</span>
        </button>
        <button
          v-if="posed.length > 1"
          type="button"
          class="rounded-md px-2 py-1 text-txt-3 transition-colors hover:text-accent"
          @click="applyFilters(clearAllPatch(posed))"
        >
          {{ t('veille.index.filters.chip.clearAll') }}
        </button>
        <!-- Les actions groupées, sur tout ce que le filtre désigne (CC-109). Même ordre et même
             vocabulaire que dans la barre de sélection : c'est le même geste, sur un autre
             ensemble — et c'est la barre qui dit lequel, pas le bouton. -->
        <span class="ml-auto flex flex-wrap items-center gap-1">
          <button
            v-for="entry in BULK_BUTTONS"
            :key="entry.action"
            type="button"
            class="rounded-md border border-line-2 bg-panel px-2 py-1 text-txt-2 transition-colors hover:border-accent hover:text-accent"
            @click="runBulk(entry.action, 'filtered')"
          >
            {{ t(`veille.index.bulk.${entry.key}`) }}
          </button>
        </span>
        <!-- ⚠️ **Le geste inter-pages vit ICI, et pas dans la barre de sélection** (CC-108).
             Trois raisons qui se renforcent : il rattache l'action au filtre qui la définit ;
             les deux sélections restent distinctes **par construction** plutôt que par un effort
             de style — « 12 sélectionnés » et « les 317 du filtre » ne partagent ni barre ni
             vocabulaire ; et cette barre n'existe pas sans filtre posé, donc l'interface **ne
             peut pas** proposer « vider la veille ». Le serveur refuse quand même : une route est
             un contrat public, et un `curl` muni d'un cookie valide n'a que faire du rendu Vue. -->
        <button
          type="button"
          :class="posed.length > 1 ? '' : 'ml-auto'"
          class="rounded-md border border-bad/50 px-2 py-1 text-bad transition-colors hover:border-bad disabled:opacity-40"
          :disabled="deletingFiltered"
          @click="deleteFiltered"
        >
          {{ t('veille.index.filters.chip.deleteFiltered') }}
        </button>
      </div>

      <!-- La barre d'action, seulement quand quelque chose est coché. Elle annonce le nombre
           d'assets Immich concernés : c'est la seule chose que le bouton ne peut pas dire seul. -->
      <div
        v-if="selection.total > 0"
        class="flex items-center gap-3 border-b border-line bg-panel-2 px-4 py-2.5 text-[12px]"
      >
        <span class="font-semibold">
          {{ t('veille.index.selection.selected', selection.total) }}
        </span>
        <span v-if="selection.media > 0" class="text-txt-3">
          {{ t('veille.index.selection.media', selection.media) }}
        </span>
        <!-- Les quatre gestes de CC-109, dans le même ordre que la barre de rappel ci-dessus.
             ⚠️ Aucun ne touche Immich : ni confirmation, ni mot « corbeille ». Le seul dialogue
             de cette barre reste celui de « Supprimer », et c'est ce qui lui garde son poids. -->
        <span class="ml-auto flex flex-wrap items-center gap-1">
          <button
            v-for="entry in BULK_BUTTONS"
            :key="entry.action"
            type="button"
            class="rounded-md border border-line-2 bg-panel px-2 py-1.5 text-txt-2 transition-colors hover:border-accent hover:text-accent"
            @click="runBulk(entry.action, 'selected')"
          >
            {{ t(`veille.index.bulk.${entry.key}`) }}
          </button>
        </span>
        <button
          type="button"
          class="rounded-md border border-line-2 bg-panel px-3 py-1.5 text-txt-2 hover:text-txt"
          @click="selected = []"
        >
          {{ t('veille.index.selection.cancel') }}
        </button>
        <button
          type="button"
          class="rounded-md border border-bad/50 bg-panel px-3 py-1.5 text-bad hover:border-bad"
          @click="deleteSelected"
        >
          {{ t('veille.index.selection.delete') }}
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
          :title="t('veille.index.selectItem', { title: item.title })"
          @change="toggleItem(item)"
        />
        <button
          type="button"
          class="mt-1 shrink-0 rounded-full border transition-colors"
          :class="
            item.readAt ? 'h-2 w-2 border-line-2 bg-transparent' : 'h-2 w-2 border-aqua bg-aqua'
          "
          :title="item.readAt ? t('veille.index.markUnread') : t('veille.index.markRead')"
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
          {{ t('veille.index.media.absent') }}
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
            <!-- ⚠️ La provenance OUVRE la ligne, et sa position n'est pas un détail : c'est la
                 première question devant un item qu'on n'a pas ajouté soi-même, et seule une
                 position fixe à gauche rend la colonne scannable — posée après la date, elle
                 flotterait au gré de la longueur du nom de chaîne. Elle est aussi le premier
                 `<span>` de la ligne, ce dont `__tests__/index.spec.ts` a besoin pour continuer
                 à prouver l'absence de puce orpheline (CC-103). -->
            <span
              class="rounded-full border px-2 py-0.5 text-[10.5px]"
              :class="provenanceClass(item.provenance)"
            >
              {{ provenanceLabel(item.provenance) }}
            </span>
            <span>{{ TYPE_LABELS[item.type] }}</span>
            <!-- ⚠️ La chaîne et SON séparateur sont sous le même `v-if` : les séparer laisserait
                 une puce orpheline sur tout item qui n'a pas de chaîne — c'est-à-dire un asset
                 Immich, un article, ou toute vidéo collectée avant CC-87. `channelLabel` rend
                 `null` plutôt qu'une chaîne vide précisément pour que ce test soit binaire. -->
            <template v-if="channel(item)">
              <span>·</span>
              <span>{{ channel(item) }}</span>
            </template>
            <span>·</span>
            <span class="font-mono">{{ formatDate(item) }}</span>
            <!-- ⚠️ « plus dans l'album », pas « supprimé » : la collecte ne distingue pas un
                 asset retiré de l'album d'un asset effacé d'Immich, et ne le prétend pas. -->
            <span
              v-if="item.unavailableAt"
              class="rounded-full border border-warn/40 bg-panel-2 px-2 py-0.5 text-[10.5px] text-warn"
              :title="t('veille.index.unavailable.title')"
            >
              {{ t('veille.index.unavailable.badge') }}
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
        <!-- ⚠️ L'état « déjà dedans » prend l'accent, mais PAS `bg-accent-soft` : ce fond-là est le
             vocabulaire d'un *filtre posé* (les pastilles de tag). Un bouton d'état qui l'emprunte
             brouille la seule distinction visuelle que la page ait entre « ceci filtre la liste »
             et « ceci décrit l'item ». Le mot suffit à dire l'état, il bascule avec lui.
             Le `title` lève l'ambiguïté de « Retirer » : la ligne porte aussi une case de
             sélection dont l'action est la suppression. -->
        <button
          type="button"
          class="shrink-0 rounded-md border px-2.5 py-1 text-[11px] transition-colors"
          :class="
            item.readingQueue
              ? 'border-accent/50 bg-panel-2 text-accent hover:border-accent'
              : 'border-line-2 bg-panel-2 text-txt-2 hover:border-accent hover:text-accent'
          "
          :title="
            item.readingQueue
              ? t('veille.index.queue.removeTitle')
              : t('veille.index.queue.addTitle')
          "
          @click="toggleQueue(item)"
        >
          {{ item.readingQueue ? t('veille.index.queue.remove') : t('veille.index.queue.add') }}
        </button>
      </div>

      <div v-if="items.length === 0" class="p-6 text-center text-[13px] text-txt-2">
        {{ t('veille.index.empty') }}
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
          {{ t('veille.index.pagination.prev') }}
        </button>
        <span class="font-mono text-[11.5px] text-txt-3">
          {{ t('veille.index.pagination.status', { current: pagination.currentPage, last: pagination.lastPage }) }}
        </span>
        <button
          type="button"
          class="rounded-md border border-line-2 bg-panel-2 px-3 py-1.5 disabled:opacity-40"
          :disabled="pagination.currentPage >= pagination.lastPage"
          @click="goToPage(pagination.currentPage + 1)"
        >
          {{ t('veille.index.pagination.next') }}
        </button>
      </div>
    </div>

    <!-- À lire plus tard + capture -->
    <div class="border-l border-line bg-bg-2">
      <div class="flex items-center gap-2 border-b border-line p-4 text-[12px] font-semibold">
        {{ t('veille.index.queue.title') }}
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
        <!-- La colonne ne montre que les items mis de côté **de la page courante** : le compteur
             ci-dessus est global, celui-ci non. Le filtre « À lire plus tard » donne la liste
             complète. -->
        <button
          v-if="stats.queue > queueItems.length"
          type="button"
          class="rounded-md px-2 py-1 text-left text-[11.5px] text-txt-3 hover:text-accent"
          @click="applyFilters({ readingQueue: true })"
        >
          {{ t('veille.index.queue.seeAll', { count: stats.queue }) }}
        </button>
      </div>

      <div class="border-t border-line p-4 text-[12px] font-semibold">
        {{ t('veille.index.capture.title') }}
      </div>
      <form class="flex flex-col gap-2 p-3" @submit.prevent="submitCapture">
        <select
          v-model="capture.type"
          class="rounded-md border border-line-2 bg-panel px-2 py-1.5 text-[12px]"
        >
          <option value="note">{{ t('veille.index.types.note') }}</option>
          <option value="bookmark">{{ t('veille.index.types.bookmark') }}</option>
          <option value="article">{{ t('veille.index.types.article') }}</option>
        </select>
        <input
          v-model="capture.title"
          type="text"
          :placeholder="t('veille.index.capture.titlePlaceholder')"
          class="rounded-md border border-line-2 bg-panel px-2 py-1.5 text-[12px] placeholder:text-txt-3"
        />
        <input
          v-model="capture.url"
          type="text"
          :placeholder="t('veille.index.capture.urlPlaceholder')"
          class="rounded-md border border-line-2 bg-panel px-2 py-1.5 text-[12px] placeholder:text-txt-3"
        />
        <!-- Les tags à la capture (CC-21). ⚠️ **C'était le seul champ que l'écran affichait et
             laissait filtrer sans permettre de le saisir** : la colonne se remplissait par les
             collecteurs — quatre noms de réseaux devinés depuis des noms de fichiers — puis se
             figeait. Saisie libre, et non un choix parmi l'existant : sur une base réelle,
             « l'existant » ne contient rien que l'utilisateur ait choisi. -->
        <div v-if="capture.tags.length > 0" class="flex flex-wrap gap-1.5">
          <button
            v-for="tag in capture.tags"
            :key="tag"
            type="button"
            class="flex items-center gap-1 rounded-full border border-accent bg-accent-soft px-2 py-0.5 text-[11px] text-txt transition-colors hover:border-bad hover:text-bad"
            :title="t('veille.index.capture.removeTag', { tag })"
            @click="dropTag(tag)"
          >
            #{{ tag }}<span aria-hidden="true">✕</span>
          </button>
        </div>
        <!-- ⚠️ `keydown.enter.prevent` : sans `prevent`, Entrée soumettrait le formulaire au lieu
             de valider le tag — donc capturerait l'item dès le premier tag tapé. La virgule est
             le second séparateur, celui qu'on tape sans y penser. -->
        <input
          v-if="capture.tags.length < TAGS_MAX"
          v-model="tagDraft"
          type="text"
          :placeholder="t('veille.index.capture.tagsPlaceholder')"
          class="rounded-md border border-line-2 bg-panel px-2 py-1.5 text-[12px] placeholder:text-txt-3"
          @keydown.enter.prevent="commitTag"
          @keydown="(event: KeyboardEvent) => event.key === ',' && (event.preventDefault(), commitTag())"
        />
        <!-- Les tags déjà en base, cliquables. Ils viennent de la prop servie par le serveur —
             toute la base, jamais les items affichés (non-régression de CC-54). -->
        <div v-if="tagSuggestions.length > 0" class="flex flex-wrap items-center gap-1.5">
          <span class="text-[10.5px] text-txt-3">{{ t('veille.index.capture.tagsKnown') }}</span>
          <button
            v-for="tag in tagSuggestions"
            :key="tag"
            type="button"
            class="rounded-full border border-line-2 bg-panel-2 px-2 py-0.5 text-[11px] text-txt-2 transition-colors hover:border-accent hover:text-accent"
            @click="capture.tags = addTag(capture.tags, tag)"
          >
            #{{ tag }}
          </button>
        </div>
        <button
          type="submit"
          class="rounded-md border border-accent bg-accent px-2 py-1.5 text-[12px] text-white disabled:opacity-50"
          :disabled="capturing || !capture.title.trim()"
        >
          {{ t('veille.index.capture.submit') }}
        </button>
      </form>
    </div>
  </div>
</template>
