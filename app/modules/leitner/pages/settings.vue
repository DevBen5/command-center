<script setup lang="ts">
import { computed, nextTick, onUnmounted, reactive, ref, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import { Head, router } from '@inertiajs/vue3'
import AppLayout from '~/layouts/AppLayout.vue'
import AppModal from '~/components/AppModal.vue'
import ConfirmModal from '~/components/ConfirmModal.vue'
import LeitnerTabs from '../components/LeitnerTabs.vue'
import MarkdownPreviewPanel from '../components/MarkdownPreviewPanel.vue'
import { useCan } from '../components/leitner_can'
import { useMarkdownPreview } from '../components/leitner_markdown_preview'
import { scrollTopKeepingAnchor, splitByMastery } from '../shared/settings_page'

defineOptions({ layout: AppLayout })

const { t, locale } = useI18n()

const confirmModal = ref<InstanceType<typeof ConfirmModal> | null>(null)

/**
 * L'écran de gestion mêle lecture (catalogue, arbre de taxonomie) et écriture. En lecture
 * seule (CC-72), un invité voit les cartes et leur classement, mais aucun contrôle d'écriture
 * ne lui est proposé : un bouton qu'il ne peut actionner (403) est une frustration.
 *
 * ⚠️ Ces booléens masquent, ils ne ferment pas. La garde est le middleware de capacité sur
 * chaque route ; le masquage évite seulement de proposer une action qui échouerait. Chaque
 * bloc suit exactement la capacité de sa route (voir `start/routes.ts`).
 */
const { can, isAdmin } = useCan()
const canWriteCards = computed(() => can('leitner.cards.write'))
const canWriteTaxonomy = computed(() => can('leitner.taxonomy.write'))
const canSettings = computed(() => can('leitner.settings'))
const canBackup = computed(() => can('leitner.backup'))

/**
 * `mine` OU admin (CC-139) : le serveur autorise déjà l'admin à éditer n'importe quel
 * contenu (`assertOwnedOrAdmin`) — masquer les boutons pour lui mentirait sur ce que la
 * route accepte. `mine` seul suffit pour tout le monde d'autre.
 */
function canEditCard(card: Card): boolean {
  return card.mine || isAdmin.value
}

interface ThemeNode {
  id: number
  name: string
  cardCount: number
}

interface CategoryNode {
  id: number
  name: string
  cardCount: number
  themes: ThemeNode[]
}

interface Card {
  id: number
  front: string
  back: string
  // ⚠️ Le catalogue est communal, cette colonne ne l'est pas (CC-119) : c'est la boîte de
  // celui qui regarde. Deux personnes voient les mêmes cartes avec des boîtes différentes,
  // et le filtre « boîte N » suit la même règle.
  box: number
  /**
   * La date d'acquisition, ou `null` pour une carte en cours (CC-262). C'est elle qui range
   * la ligne dans l'une des deux sections du tableau.
   *
   * ⚠️ **Elle MARQUE, elle ne filtre pas** : une carte maîtrisée reste listée, y compris
   * sous le filtre « boîte 5 » — qui la trouve toujours pendant que la tuile « boîte 5 »
   * de `/revision` annonce 0. Les deux écrans ne disent pas la même chose, et c'est un
   * arbitrage explicite : le catalogue est un inventaire de **contenu**, et c'est l'écran
   * qui sert à **corriger** une carte. L'y faire disparaître la rendrait inatteignable.
   */
  masteredAt: string | null
  theme: { id: number; name: string; category: { id: number; name: string } } | null
  // Privé par défaut (CC-139) : `mine` évite de comparer `ownerId` à l'id du compte connecté
  // à chaque endroit du template.
  ownerId: number | null
  isShared: boolean
  mine: boolean
  // Le lien manuel de provenance (CC-253) — `null` si aucun, ou si la capacité de
  // consulter le corpus manque (le serveur ne l'a alors pas calculé).
  manualCourseSectionId: number | null
  // Les liens `ingestion` de la même carte (CC-272) — jamais fondus avec le slot
  // manuel ci-dessus : deux origines, deux gestes distincts. `[]` si la capacité de
  // consulter le corpus manque, même raison que `manualCourseSectionId`.
  ingestionSections: Array<{
    id: number
    courseTitle: string
    headingPath: string[]
    obsoleteAt: string | null
  }>
}

/** Un cours du sélecteur manuel (CC-253) — section, jamais son contenu : c'est un choix,
 *  pas une lecture (celle-ci reste sous `leitner.courses.view`, voir `cours_show.vue`). */
interface CourseOption {
  id: number
  title: string
  sections: Array<{ id: number; headingPath: string[] }>
}

interface Filters {
  search: string
  categoryId: number | null
  themeId: number | null
  box: number | null
  unclassified: boolean
}

interface ImportReport {
  cardsCreated: number
  cardsSkipped: number
  categoriesCreated: number
  themesCreated: number
  reviewsCreated: number
  coursesCreated: number
  coursesSkipped: number
}

const props = defineProps<{
  cards: Card[]
  categories: CategoryNode[]
  unclassifiedCount: number
  totalCards: number
  boxIntervals: Record<number, number>
  filters: Filters
  importReport: ImportReport | null
  importErrors: string[] | null
  // Le corpus pour le sélecteur manuel (CC-253) — `[]` si `leitner.courses.view` manque :
  // le serveur ne l'envoie alors pas, masquer le `<select>` côté client ne fermerait rien.
  courses: CourseOption[]
}>()

const BOXES = [1, 2, 3, 4, 5]

/*
| Intervalles des boîtes — jours avant la prochaine révision, selon la boîte
| atteinte. Ne s'appliquent qu'aux révisions suivantes : les échéances déjà
| posées ne sont pas recalculées.
*/
const intervals = reactive<Record<number, number>>({ ...props.boxIntervals })
const savingIntervals = ref(false)

// Après enregistrement, Inertia renvoie la page : on resynchronise le formulaire
// sur ce que la base a réellement retenu.
watch(
  () => props.boxIntervals,
  (saved) => Object.assign(intervals, saved)
)

const intervalsDirty = computed(() =>
  BOXES.some((box) => intervals[box] !== props.boxIntervals[box])
)

function submitIntervals(): void {
  savingIntervals.value = true
  router.put(
    '/revision/settings/intervals',
    {
      box1Days: intervals[1],
      box2Days: intervals[2],
      box3Days: intervals[3],
      box4Days: intervals[4],
      box5Days: intervals[5],
    },
    { preserveScroll: true, onFinish: () => (savingIntervals.value = false) }
  )
}

/*
| Filtres — rechargent la page en conservant l'état local (Inertia partial visit).
*/
const filters = reactive<Filters>({ ...props.filters })
let searchTimer: ReturnType<typeof setTimeout> | undefined

function applyFilters(): void {
  router.get(
    '/revision/settings',
    {
      search: filters.search || undefined,
      categoryId: filters.categoryId ?? undefined,
      themeId: filters.themeId ?? undefined,
      box: filters.box ?? undefined,
      unclassified: filters.unclassified ? '1' : undefined,
    },
    { preserveState: true, preserveScroll: true, replace: true }
  )
}

watch(
  () => filters.search,
  () => {
    clearTimeout(searchTimer)
    searchTimer = setTimeout(applyFilters, 300)
  }
)

// Changer de catégorie invalide le thème sélectionné : il n'y appartient plus.
watch(
  () => filters.categoryId,
  () => {
    filters.themeId = null
    applyFilters()
  }
)

watch([() => filters.themeId, () => filters.box, () => filters.unclassified], applyFilters)

function resetFilters(): void {
  filters.search = ''
  filters.categoryId = null
  filters.themeId = null
  filters.box = null
  filters.unclassified = false
}

const themesOfFilteredCategory = computed<ThemeNode[]>(
  () => props.categories.find((category) => category.id === filters.categoryId)?.themes ?? []
)

/**
 * Le catalogue en deux sections (CC-262) — le partage vit dans `shared/settings_page.ts`,
 * pur et prouvé.
 *
 * ⚠️ **Un seul tableau, deux `<tbody>`**, et non deux tableaux : la sélection multiple, la
 * barre d'actions groupées et les cinq colonnes sont communes. Deux tableaux les auraient
 * dédoublées, et « tout sélectionner » aurait cessé de vouloir dire quelque chose.
 */
const sections = computed(() => {
  const { inProgress, mastered } = splitByMastery(props.cards)
  return [
    { key: 'inProgress', labelKey: 'leitner.settings.sectionInProgress', cards: inProgress },
    { key: 'mastered', labelKey: 'leitner.settings.sectionMastered', cards: mastered },
  ].filter((section) => section.cards.length > 0)
})

/**
 * ⚠️ **Les en-têtes de section n'apparaissent que s'il y a quelque chose à séparer.** Sur
 * une base sans aucun acquis — le cas de toute installation neuve — une bande « Cartes en
 * cours » seule au-dessus du tableau ne dirait rien que le tableau ne dit déjà.
 */
const showSectionHeaders = computed(() => sections.value.length > 1)

/** « 12 juin 2026 » — la date d'acquisition, dans la langue de l'interface. */
function masteredLabel(iso: string): string {
  return new Intl.DateTimeFormat(locale.value, { dateStyle: 'long' }).format(new Date(iso))
}

/*
| Sélection multiple
*/
const selected = ref<number[]>([])

const allSelected = computed(
  () => props.cards.length > 0 && selected.value.length === props.cards.length
)

function toggleAll(): void {
  selected.value = allSelected.value ? [] : props.cards.map((card) => card.id)
}

// Une carte supprimée ou filtrée ne doit pas rester « sélectionnée » en fantôme.
watch(
  () => props.cards,
  (cards) => {
    const ids = new Set(cards.map((card) => card.id))
    selected.value = selected.value.filter((id) => ids.has(id))
  }
)

const bulkThemeId = ref<number | null>(null)

function bulkAssign(): void {
  if (selected.value.length === 0) return
  router.post(
    '/revision/cards/theme',
    { ids: selected.value, leitnerThemeId: bulkThemeId.value },
    {
      preserveScroll: true,
      onSuccess: () => {
        selected.value = []
        bulkThemeId.value = null
      },
    }
  )
}

async function bulkDelete(): Promise<void> {
  const count = selected.value.length
  if (count === 0) return
  const message =
    count > 1
      ? t('leitner.settings.confirmBulkDeletePlural', { count })
      : t('leitner.settings.confirmBulkDeleteSingular', { count })
  if (!(await confirmModal.value?.ask(message, { danger: true }))) return
  router.post(
    '/revision/cards/delete',
    { ids: selected.value },
    { preserveScroll: true, onSuccess: () => (selected.value = []) }
  )
}

async function deleteCard(card: Card): Promise<void> {
  const message = t('leitner.settings.confirmDeleteCard', { front: card.front.slice(0, 60) })
  if (!(await confirmModal.value?.ask(message, { danger: true }))) return
  router.delete(`/revision/cards/${card.id}`, { preserveScroll: true })
}

/*
| Création / édition d'une carte — même modale, `editing` à null = création.
*/
const modalOpen = ref(false)
const editing = ref<Card | null>(null)
const cardForm = reactive({
  front: '',
  back: '',
  leitnerThemeId: null as number | null,
  isShared: false,
  // Le lien manuel de provenance (CC-253) — `null` = aucun. Conservé entre deux
  // créations en série (« Créer et enchaîner »), comme le thème : une série de cartes
  // saisies depuis le même passage du cours vient souvent de la même section.
  courseSectionId: null as number | null,
})
const saving = ref(false)
const frontInput = ref<HTMLTextAreaElement | null>(null)

const hasThemes = computed(() => props.categories.some((category) => category.themes.length > 0))

/*
| L'aperçu du rendu Markdown (CC-257)
|------------------------------------------------------------------------------
| Le contenu d'une carte est rendu en Markdown depuis CC-133, mais il se saisissait
| dans un `<textarea>` nu : rien ne disait même que le Markdown était interprété. Une
| clôture ``` non refermée bascule tout le reste de la carte dans un bloc de code —
| comportement CommonMark correct — et ça ne se découvrait qu'en révision.
|
| ⚠️ Le HTML vient du SERVEUR, de la même `renderMarkdown` que la révision. Voir
| `components/leitner_markdown_preview.ts` : rien n'est rendu ici, et rien ne doit
| l'être — ce serait un second rendu, et `markdown-it` dans le bundle.
|
| L'état vit AU NIVEAU DE LA PAGE, pas de la modale : il survit donc à « Créer et
| enchaîner » et à un aller-retour création → édition. Une fois qu'on a demandé à voir,
| on veut voir la carte suivante aussi. Il est déclaré ICI, avant les trois fonctions
| qui appellent `refresh()`, pour qu'on ne le lise pas après ses appelants.
*/
const preview = useMarkdownPreview('/revision/cards/preview', () => ({
  front: cardForm.front,
  back: cardForm.back,
}))

onUnmounted(preview.dispose)

function openCreate(): void {
  editing.value = null
  cardForm.front = ''
  cardForm.back = ''
  // Le thème filtré pré-remplit la carte : on saisit en général plusieurs
  // cartes de suite sur le même sujet.
  cardForm.leitnerThemeId = filters.themeId
  // Privée par défaut (CC-139) : jamais pré-cochée.
  cardForm.isShared = false
  // ⚠️ Remis à `null` ici, mais PAS dans le chemin « Créer et enchaîner » (qui ne
  // rappelle pas `openCreate`) : une série de cartes saisies depuis le même passage
  // du cours garde son lien, mais ouvrir un NOUVEAU formulaire ne doit jamais hériter
  // du lien d'une carte éditée juste avant.
  cardForm.courseSectionId = null
  modalOpen.value = true
  // Le formulaire vient de changer d'un bloc, sans le moindre événement de saisie : sans ça, un
  // panneau resté ouvert montrerait la carte d'avant à côté de champs vides (CC-257).
  preview.refresh()
}

function openEdit(card: Card): void {
  editing.value = card
  cardForm.front = card.front
  cardForm.back = card.back
  cardForm.leitnerThemeId = card.theme?.id ?? null
  cardForm.isShared = card.isShared
  cardForm.courseSectionId = card.manualCourseSectionId
  modalOpen.value = true
  preview.refresh()
}

/**
 * Supprimer depuis la modale d'édition (CC-206) — ouvre une confirmation PAR-DESSUS le
 * formulaire déjà en modale, le cas pour lequel CC-209 a ajouté la pile d'instances
 * d'`AppModal`. Ferme la modale d'édition une fois la suppression acceptée par le serveur.
 */
async function deleteEditingCard(): Promise<void> {
  if (!editing.value) return
  const card = editing.value
  const message = t('leitner.settings.confirmDeleteCard', { front: card.front.slice(0, 60) })
  if (!(await confirmModal.value?.ask(message, { danger: true }))) return
  router.delete(`/revision/cards/${card.id}`, {
    preserveScroll: true,
    onSuccess: () => (modalOpen.value = false),
  })
}

/**
 * Supprime UN lien `ingestion` (CC-272), sans fermer la modale — il peut en rester
 * d'autres. `editing` est un instantané pris à l'ouverture (`openEdit`) : après
 * succès, on le resynchronise depuis `props.cards`, qu'Inertia vient de recharger.
 */
function removeIngestionSection(sectionId: number): void {
  if (!editing.value) return
  const cardId = editing.value.id
  router.delete(`/revision/cards/${cardId}/sections/${sectionId}`, {
    preserveScroll: true,
    onSuccess: () => {
      const updated = props.cards.find((c) => c.id === cardId)
      if (updated) editing.value = updated
    },
  })
}

/**
 * `keepOpen` : création en série. La modale reste ouverte, le thème est conservé —
 * on saisit en général plusieurs cartes de suite sur le même sujet.
 */
function submitCard(keepOpen = false): void {
  if (!cardForm.front.trim() || !cardForm.back.trim()) return
  saving.value = true

  const options = {
    preserveScroll: true,
    onSuccess: () => (modalOpen.value = false),
    onFinish: () => (saving.value = false),
  }

  // La carte créée part en boîte 1, due immédiatement (LeitnerCatalogService).
  if (editing.value) {
    router.put(`/revision/cards/${editing.value.id}`, { ...cardForm }, options)
  } else if (keepOpen) {
    router.post(
      '/revision/cards',
      { ...cardForm },
      {
        ...options,
        onSuccess: () => {
          cardForm.front = ''
          cardForm.back = ''
          frontInput.value?.focus()
          // Les champs se vident sans événement de saisie : l'aperçu doit suivre, sinon il
          // affiche la carte qu'on vient d'enregistrer à côté d'un formulaire vierge.
          preview.refresh()
        },
      }
    )
  } else {
    router.post('/revision/cards', { ...cardForm }, options)
  }
}

/*
| Sauvegarde — import d'un fichier JSON
|
| L'export, lui, est un <a href> natif dans le template : c'est une réponse HTTP nue
| (JSON + content-disposition) qu'Inertia ne sait pas transporter.
*/
const importFile = ref<File | null>(null)
const importing = ref(false)
const fileInput = ref<HTMLInputElement | null>(null)
const backupBlock = ref<HTMLElement | null>(null)

/** Position à l'écran du bloc Sauvegarde avant la requête — `null` hors import (CC-67). */
let backupTopBefore: number | null = null

function pickFile(event: Event): void {
  importFile.value = (event.target as HTMLInputElement).files?.[0] ?? null
}

/**
 * Le conteneur qui défile n'est PAS la fenêtre : c'est le panneau `overflow-y-auto`
 * d'`AppLayout`. `window.scrollY` y vaut éternellement 0 et `window.scrollTo` n'y fait
 * rien — un correctif écrit sur la fenêtre passerait lint, typecheck et tests sans
 * jamais bouger l'écran. On remonte donc jusqu'au premier ancêtre réellement défilant,
 * plutôt que de coder en dur une classe du layout.
 *
 * ⚠️ **`scrollHeight > clientHeight` n'est pas une précaution décorative** : un ancêtre
 * qui ne porte qu'un `overflow-x: hidden` a un `overflowY` **calculé** à `auto` (la spec
 * CSS interdit `visible` face à un `hidden`). Sans ce second test, la remontée
 * s'arrêterait sur un conteneur qui ne défile pas, et la correction écrirait dans le vide.
 */
function scrollParentOf(element: HTMLElement): HTMLElement | null {
  let node = element.parentElement
  while (node) {
    const { overflowY } = getComputedStyle(node)
    if ((overflowY === 'auto' || overflowY === 'scroll') && node.scrollHeight > node.clientHeight) {
      return node
    }
    node = node.parentElement
  }
  return null
}

/**
 * Rend au bloc Sauvegarde la place qu'il occupait à l'écran (CC-67).
 *
 * Le formulaire d'import vit dans la colonne de droite, le tableau des cartes dans celle de
 * gauche : un tableau plus haut ne pousse donc rien. Ce qui déplace la vue, c'est l'ancrage
 * de défilement du navigateur — les cartes importées s'insèrent **en tête** du tableau
 * (`cards()` trie `id desc`), au-dessus de la ligne sur laquelle il s'était ancré, et il
 * remonte `scrollTop` d'autant pour la garder fixe. La colonne de droite part alors hors
 * de l'écran. Le second cas, plus discret, est un import qui crée des catégories : la
 * taxonomie grandit, elle, réellement au-dessus du bloc.
 *
 * Suivre l'élément annule les deux. Rien à annuler (import entièrement dédupliqué, import
 * refusé) donne un delta nul, donc un no-op.
 */
function restoreBackupPosition(): void {
  const element = backupBlock.value
  const topBefore = backupTopBefore
  backupTopBefore = null
  if (!element || topBefore === null) return

  const container = scrollParentOf(element)
  if (!container) return

  container.scrollTop = scrollTopKeepingAnchor({
    scrollTop: container.scrollTop,
    topBefore,
    topAfter: element.getBoundingClientRect().top,
  })
}

// L'import n'ajoute que ce qui manque : rien n'est supprimé ni écrasé, donc aucune
// confirmation à demander.
function submitImport(): void {
  if (!importFile.value) return

  backupTopBefore = backupBlock.value?.getBoundingClientRect().top ?? null

  importing.value = true
  router.post(
    '/revision/import',
    { file: importFile.value },
    {
      // ⚠️ Inertia ne restaure que `window` et les éléments `[scroll-region]` — le panneau
      // d'`AppLayout` n'est ni l'un ni l'autre, donc ce drapeau ne gouverne pas cette page.
      // Il reste : il ne coûte rien et redeviendrait porteur si un `scroll-region` apparaît.
      preserveScroll: true,
      // ⚠️ Après le `nextTick`, jamais avant : `onSuccess` se déclenche à l'échange des props,
      // quand Vue n'a pas encore écrit les nouvelles lignes. Mesurer là mesurerait l'ancien
      // tableau — le correctif paraîtrait juste sur une carte et n'annulerait rien sur un lot.
      onSuccess: async () => {
        await nextTick()
        restoreBackupPosition()
      },
      onFinish: () => {
        importing.value = false
        importFile.value = null
        if (fileInput.value) fileInput.value.value = ''
      },
    }
  )
}

/*
| Taxonomie — catégories et thèmes
*/
const newCategory = ref('')
const newCategoryShared = ref(false)
const newTheme = reactive({ name: '', leitnerCategoryId: null as number | null })
const newThemeShared = ref(false)
const renamingCategory = ref<number | null>(null)
const renamingTheme = ref<number | null>(null)
const draftName = ref('')

function addCategory(): void {
  if (!newCategory.value.trim()) return
  router.post(
    '/revision/categories',
    { name: newCategory.value.trim(), isShared: newCategoryShared.value },
    {
      preserveScroll: true,
      onSuccess: () => {
        newCategory.value = ''
        newCategoryShared.value = false
      },
    }
  )
}

function addTheme(): void {
  if (!newTheme.name.trim() || !newTheme.leitnerCategoryId) return
  router.post(
    '/revision/themes',
    {
      name: newTheme.name.trim(),
      leitnerCategoryId: newTheme.leitnerCategoryId,
      isShared: newThemeShared.value,
    },
    {
      preserveScroll: true,
      onSuccess: () => {
        newTheme.name = ''
        newThemeShared.value = false
      },
    }
  )
}

function startRenameCategory(category: CategoryNode): void {
  renamingCategory.value = category.id
  renamingTheme.value = null
  draftName.value = category.name
}

function startRenameTheme(theme: ThemeNode): void {
  renamingTheme.value = theme.id
  renamingCategory.value = null
  draftName.value = theme.name
}

function submitRenameCategory(category: CategoryNode): void {
  if (!draftName.value.trim()) return
  router.put(
    `/revision/categories/${category.id}`,
    { name: draftName.value.trim() },
    { preserveScroll: true, onSuccess: () => (renamingCategory.value = null) }
  )
}

function submitRenameTheme(theme: ThemeNode, categoryId: number): void {
  if (!draftName.value.trim()) return
  router.put(
    `/revision/themes/${theme.id}`,
    { name: draftName.value.trim(), leitnerCategoryId: categoryId },
    { preserveScroll: true, onSuccess: () => (renamingTheme.value = null) }
  )
}

async function deleteCategory(category: CategoryNode): Promise<void> {
  const message = category.cardCount
    ? t('leitner.settings.confirmDeleteCategory', {
        name: category.name,
        themes: category.themes.length,
        cards: category.cardCount,
      })
    : t('leitner.settings.confirmDeleteCategoryEmpty', { name: category.name })
  if (!(await confirmModal.value?.ask(message, { danger: true }))) return
  router.delete(`/revision/categories/${category.id}`, { preserveScroll: true })
}

async function deleteTheme(theme: ThemeNode): Promise<void> {
  const message = theme.cardCount
    ? t('leitner.settings.confirmDeleteTheme', { name: theme.name, cards: theme.cardCount })
    : t('leitner.settings.confirmDeleteThemeEmpty', { name: theme.name })
  if (!(await confirmModal.value?.ask(message, { danger: true }))) return
  router.delete(`/revision/themes/${theme.id}`, { preserveScroll: true })
}
</script>

<template>
  <Head :title="t('leitner.settings.title')" />

  <LeitnerTabs />

  <div class="mb-4 flex items-center gap-3">
    <div>
      <div class="text-[18px] font-bold">{{ t('leitner.settings.title') }}</div>
      <div class="text-[12.5px] text-txt-2">
        {{
          cards.length > 1
            ? t('leitner.settings.shownPlural', { shown: cards.length, total: totalCards })
            : t('leitner.settings.shownSingular', { shown: cards.length, total: totalCards })
        }}
        ·
        {{
          unclassifiedCount > 1
            ? t('leitner.settings.unclassifiedPlural', { n: unclassifiedCount })
            : t('leitner.settings.unclassifiedSingular', { n: unclassifiedCount })
        }}
      </div>
    </div>
    <button
      v-if="canWriteCards"
      type="button"
      class="ml-auto rounded-[10px] border border-accent bg-accent px-3.5 py-2 text-[12.5px] text-white transition hover:opacity-90"
      @click="openCreate"
    >
      {{ t('leitner.settings.newCard') }}
    </button>
  </div>

  <div class="grid grid-cols-[1fr_320px] items-start gap-4">
    <div>
      <!-- Filtres -->
      <div
        class="mb-3 flex flex-wrap items-center gap-2 rounded-[12px] border border-line bg-panel p-3"
      >
        <input
          v-model="filters.search"
          type="search"
          :placeholder="t('leitner.settings.searchPlaceholder')"
          class="min-w-[200px] flex-1 rounded-md border border-line-2 bg-panel-2 px-2.5 py-2 text-[12.5px] placeholder:text-txt-3"
        />
        <select
          v-model="filters.categoryId"
          class="rounded-md border border-line-2 bg-panel-2 px-2.5 py-2 text-[12.5px]"
        >
          <option :value="null">{{ t('leitner.settings.allCategories') }}</option>
          <option v-for="category in categories" :key="category.id" :value="category.id">
            {{ category.name }}
          </option>
        </select>
        <select
          v-model="filters.themeId"
          :disabled="!filters.categoryId"
          class="rounded-md border border-line-2 bg-panel-2 px-2.5 py-2 text-[12.5px] disabled:opacity-40"
        >
          <option :value="null">{{ t('leitner.settings.allThemes') }}</option>
          <option v-for="theme in themesOfFilteredCategory" :key="theme.id" :value="theme.id">
            {{ theme.name }}
          </option>
        </select>
        <select
          v-model="filters.box"
          class="rounded-md border border-line-2 bg-panel-2 px-2.5 py-2 text-[12.5px]"
        >
          <option :value="null">{{ t('leitner.settings.allBoxes') }}</option>
          <option v-for="box in [1, 2, 3, 4, 5]" :key="box" :value="box">{{ t('leitner.settings.boxLabel', { box }) }}</option>
        </select>
        <label class="flex items-center gap-1.5 text-[12.5px] text-txt-2">
          <input v-model="filters.unclassified" type="checkbox" class="accent-accent" />
          {{ t('leitner.settings.unclassifiedFilter') }}
        </label>
        <button
          type="button"
          class="rounded-md border border-line-2 bg-panel-2 px-2.5 py-2 text-[12.5px] text-txt-2 transition hover:text-txt"
          @click="resetFilters"
        >
          {{ t('leitner.settings.resetFilters') }}
        </button>
      </div>

      <!-- Barre d'actions groupées — écriture, donc masquée en lecture seule. La colonne
           de sélection l'est aussi (plus bas) : sans action possible, cocher ne sert à rien. -->
      <div
        v-if="canWriteCards && selected.length"
        class="mb-3 flex flex-wrap items-center gap-2 rounded-[12px] border border-accent bg-accent-soft p-3"
      >
        <span class="text-[12.5px] font-semibold">
          {{
            selected.length > 1
              ? t('leitner.settings.selectionPlural', { n: selected.length })
              : t('leitner.settings.selectionSingular', { n: selected.length })
          }}
        </span>
        <select
          v-model="bulkThemeId"
          class="ml-auto rounded-md border border-line-2 bg-panel-2 px-2.5 py-2 text-[12.5px]"
        >
          <option :value="null">{{ t('leitner.settings.unclassifiedOption') }}</option>
          <optgroup v-for="category in categories" :key="category.id" :label="category.name">
            <option v-for="theme in category.themes" :key="theme.id" :value="theme.id">
              {{ theme.name }}
            </option>
          </optgroup>
        </select>
        <button
          type="button"
          class="rounded-md border border-line-2 bg-panel px-2.5 py-2 text-[12.5px] transition hover:border-accent"
          @click="bulkAssign"
        >
          {{ t('leitner.settings.assign') }}
        </button>
        <button
          type="button"
          class="rounded-md border border-bad px-2.5 py-2 text-[12.5px] text-bad transition hover:bg-bad hover:text-white"
          @click="bulkDelete"
        >
          {{ t('leitner.settings.delete') }}
        </button>
      </div>

      <!-- Tableau -->
      <div class="overflow-hidden rounded-[12px] border border-line bg-panel">
        <table class="w-full border-collapse text-left">
          <thead>
            <tr class="border-b border-line text-[10.5px] tracking-[.1em] text-txt-3 uppercase">
              <th v-if="canWriteCards" class="w-9 py-2.5 pl-3">
                <input
                  type="checkbox"
                  class="accent-accent"
                  :checked="allSelected"
                  :disabled="!cards.length"
                  @change="toggleAll"
                />
              </th>
              <th class="py-2.5 font-medium" :class="canWriteCards ? '' : 'pl-3'">{{ t('leitner.settings.colCard') }}</th>
              <th class="w-[190px] py-2.5 font-medium">{{ t('leitner.settings.colClassification') }}</th>
              <th class="w-[70px] py-2.5 font-medium">{{ t('leitner.settings.colBox') }}</th>
              <th v-if="canWriteCards" class="w-[110px] py-2.5 pr-3 text-right font-medium">
                {{ t('leitner.settings.colActions') }}
              </th>
            </tr>
          </thead>
          <!-- Deux sections, un seul tableau (CC-262) : « Cartes en cours » puis « Cartes
               maîtrisées ». Le partage est un marquage, jamais un filtre — les deux moitiés
               gardent leurs actions, et le filtre « boîte 5 » traverse les deux. -->
          <tbody v-for="section in sections" :key="section.key">
            <tr v-if="showSectionHeaders" class="border-b border-line bg-panel-2">
              <td
                :colspan="canWriteCards ? 5 : 3"
                class="px-3 py-2 text-[10.5px] tracking-[.1em] text-txt-3 uppercase"
              >
                {{ t(section.labelKey) }}
                <span class="ml-1.5 normal-case">
                  {{
                    section.cards.length > 1
                      ? t('leitner.settings.sectionCountPlural', { n: section.cards.length })
                      : t('leitner.settings.sectionCountSingular', { n: section.cards.length })
                  }}
                </span>
              </td>
            </tr>
            <tr
              v-for="card in section.cards"
              :key="card.id"
              class="border-b border-line last:border-b-0 hover:bg-panel-2"
            >
              <td v-if="canWriteCards" class="py-2.5 pl-3 align-top">
                <input
                  v-model="selected"
                  type="checkbox"
                  class="mt-1 accent-accent"
                  :value="card.id"
                  :disabled="!canEditCard(card)"
                  :title="!canEditCard(card) ? t('leitner.settings.notMineHint') : undefined"
                />
              </td>
              <td class="py-2.5 pr-3" :class="canWriteCards ? '' : 'pl-3'">
                <div class="flex items-start gap-1.5">
                  <div class="min-w-0">
                    <div class="text-[13px] font-medium">{{ card.front }}</div>
                    <div class="mt-0.5 line-clamp-2 text-[12px] text-txt-3">{{ card.back }}</div>
                  </div>
                  <span
                    class="mt-0.5 inline-block shrink-0 rounded-full border px-1.5 py-0.5 text-[10px] whitespace-nowrap"
                    :class="
                      card.isShared
                        ? 'border-ok/40 text-ok'
                        : 'border-line-2 text-txt-3'
                    "
                  >
                    {{ card.isShared ? t('leitner.settings.visibilityShared') : t('leitner.settings.visibilityPrivate') }}
                  </span>
                </div>
              </td>
              <td class="py-2.5 pr-3 align-top">
                <span
                  v-if="card.theme"
                  class="inline-block rounded-full border border-line-2 bg-panel-2 px-2 py-0.5 text-[11px] text-txt-2"
                >
                  {{ card.theme.category.name }} · {{ card.theme.name }}
                </span>
                <span v-else class="text-[11px] text-txt-3 italic">{{ t('leitner.settings.unclassified') }}</span>
              </td>
              <td class="py-2.5 pr-3 align-top">
                <span class="font-mono text-[12.5px]">{{ card.box }}</span>
                <!-- ⚠️ La carte reste en boîte 5 : la maîtrise est un DRAPEAU à côté de la
                     boîte, pas une 6ᵉ boîte. Le module n'en a que cinq, et `again` sur un
                     acquis efface le drapeau sans toucher la boîte. -->
                <div v-if="card.masteredAt" class="mt-1 text-[10px] whitespace-nowrap text-ok">
                  {{ t('leitner.settings.masteredBadge') }}
                  <div class="text-txt-3">
                    {{ t('leitner.settings.masteredSince', { date: masteredLabel(card.masteredAt) }) }}
                  </div>
                </div>
              </td>
              <td v-if="canWriteCards" class="py-2.5 pr-3 text-right align-top whitespace-nowrap">
                <template v-if="canEditCard(card)">
                  <button
                    type="button"
                    class="rounded-md border border-line-2 bg-panel-2 px-2 py-1 text-[11.5px] text-txt-2 transition hover:border-accent hover:text-txt"
                    @click="openEdit(card)"
                  >
                    {{ t('leitner.settings.edit') }}
                  </button>
                  <button
                    type="button"
                    class="ml-1 rounded-md border border-line-2 bg-panel-2 px-2 py-1 text-[11.5px] text-txt-2 transition hover:border-bad hover:text-bad"
                    @click="deleteCard(card)"
                  >
                    {{ t('leitner.settings.deleteShort') }}
                  </button>
                </template>
                <span v-else class="text-[11px] text-txt-3 italic">{{ t('leitner.settings.notMineHint') }}</span>
              </td>
            </tr>
          </tbody>
          <!-- Le vide vit dans son propre `<tbody>` : celui des sections est vide lui-même
               quand il n'y a rien à montrer, et une ligne posée à l'intérieur de sa boucle
               ne s'afficherait jamais. -->
          <tbody v-if="!cards.length">
            <tr>
              <td :colspan="canWriteCards ? 5 : 3" class="py-8 text-center text-[12.5px] text-txt-3">
                <template v-if="totalCards">{{ t('leitner.settings.noMatch') }}</template>
                <template v-else>
                  <div class="text-[13px] font-semibold text-txt-2">{{ t('leitner.settings.emptyBase') }}</div>
                  <div v-if="canWriteCards" class="mt-1">
                    {{ t('leitner.settings.emptyBaseHint') }}
                  </div>
                  <button
                    v-if="canWriteCards"
                    type="button"
                    class="mt-3 rounded-md border border-accent bg-accent px-3 py-2 text-[12.5px] text-white transition hover:opacity-90"
                    @click="openCreate"
                  >
                    {{ t('leitner.settings.createFirst') }}
                  </button>
                </template>
              </td>
            </tr>
          </tbody>
        </table>
      </div>
    </div>

    <div class="flex flex-col gap-4">
      <!-- Taxonomie -->
      <div class="rounded-[12px] border border-line bg-panel p-4">
        <h2 class="mb-3 text-[12px] font-bold tracking-[.12em] text-txt-2 uppercase">
          {{ t('leitner.settings.taxonomyTitle') }}
        </h2>

        <div v-for="category in categories" :key="category.id" class="mb-3">
          <div class="flex items-center gap-1.5">
            <form
              v-if="renamingCategory === category.id"
              class="flex flex-1 gap-1"
              @submit.prevent="submitRenameCategory(category)"
            >
              <input
                v-model="draftName"
                autofocus
                class="min-w-0 flex-1 rounded-md border border-accent bg-panel-2 px-2 py-1 text-[12.5px]"
                @keyup.esc="renamingCategory = null"
              />
              <button type="submit" class="text-[11.5px] text-accent">{{ t('leitner.settings.ok') }}</button>
            </form>
            <template v-else>
              <span class="flex-1 truncate text-[13px] font-semibold">{{ category.name }}</span>
              <span class="font-mono text-[11px] text-txt-3">{{ category.cardCount }}</span>
              <button
                v-if="canWriteTaxonomy"
                type="button"
                class="text-[11px] text-txt-3 transition hover:text-txt"
                :title="t('leitner.settings.rename')"
                @click="startRenameCategory(category)"
              >
                ✎
              </button>
              <button
                v-if="canWriteTaxonomy"
                type="button"
                class="text-[11px] text-txt-3 transition hover:text-bad"
                :title="t('leitner.settings.delete')"
                @click="deleteCategory(category)"
              >
                ✕
              </button>
            </template>
          </div>

          <div class="mt-1 flex flex-col gap-1 border-l border-line pl-2.5">
            <div
              v-for="theme in category.themes"
              :key="theme.id"
              class="flex items-center gap-1.5 text-[12px] text-txt-2"
            >
              <form
                v-if="renamingTheme === theme.id"
                class="flex flex-1 gap-1"
                @submit.prevent="submitRenameTheme(theme, category.id)"
              >
                <input
                  v-model="draftName"
                  autofocus
                  class="min-w-0 flex-1 rounded-md border border-accent bg-panel-2 px-2 py-1 text-[12px]"
                  @keyup.esc="renamingTheme = null"
                />
                <button type="submit" class="text-[11.5px] text-accent">{{ t('leitner.settings.ok') }}</button>
              </form>
              <template v-else>
                <span class="flex-1 truncate">{{ theme.name }}</span>
                <span class="font-mono text-[11px] text-txt-3">{{ theme.cardCount }}</span>
                <button
                  v-if="canWriteTaxonomy"
                  type="button"
                  class="text-[11px] text-txt-3 transition hover:text-txt"
                  :title="t('leitner.settings.rename')"
                  @click="startRenameTheme(theme)"
                >
                  ✎
                </button>
                <button
                  v-if="canWriteTaxonomy"
                  type="button"
                  class="text-[11px] text-txt-3 transition hover:text-bad"
                  :title="t('leitner.settings.delete')"
                  @click="deleteTheme(theme)"
                >
                  ✕
                </button>
              </template>
            </div>
            <span v-if="!category.themes.length" class="text-[11.5px] text-txt-3 italic">
              {{ t('leitner.settings.noThemes') }}
            </span>
          </div>
        </div>

        <p v-if="!categories.length && canWriteTaxonomy" class="mb-3 text-[12px] text-txt-3 italic">
          {{ t('leitner.settings.noCategoriesWritable') }}
        </p>
        <p v-else-if="!categories.length" class="mb-3 text-[12px] text-txt-3 italic">
          {{ t('leitner.settings.noCategories') }}
        </p>

        <form
          v-if="canWriteTaxonomy"
          class="mt-4 flex flex-col gap-1.5 border-t border-line pt-4"
          @submit.prevent="addCategory"
        >
          <div class="flex gap-1.5">
            <input
              v-model="newCategory"
              :placeholder="t('leitner.settings.newCategoryPlaceholder')"
              class="min-w-0 flex-1 rounded-md border border-line-2 bg-panel-2 px-2.5 py-2 text-[12.5px] placeholder:text-txt-3"
            />
            <button
              type="submit"
              class="rounded-md border border-accent bg-accent px-2.5 py-2 text-[12.5px] text-white disabled:opacity-50"
              :disabled="!newCategory.trim()"
            >
              +
            </button>
          </div>
          <label class="flex items-center gap-1.5 text-[11.5px] text-txt-3">
            <input v-model="newCategoryShared" type="checkbox" class="accent-accent" />
            {{ t('leitner.settings.sharedField') }}
          </label>
        </form>

        <form v-if="canWriteTaxonomy" class="mt-2 flex flex-col gap-1.5" @submit.prevent="addTheme">
          <select
            v-model="newTheme.leitnerCategoryId"
            class="rounded-md border border-line-2 bg-panel-2 px-2.5 py-2 text-[12.5px]"
          >
            <option :value="null">{{ t('leitner.settings.themeCategoryPlaceholder') }}</option>
            <option v-for="category in categories" :key="category.id" :value="category.id">
              {{ category.name }}
            </option>
          </select>
          <div class="flex gap-1.5">
            <input
              v-model="newTheme.name"
              :placeholder="t('leitner.settings.newThemePlaceholder')"
              class="min-w-0 flex-1 rounded-md border border-line-2 bg-panel-2 px-2.5 py-2 text-[12.5px] placeholder:text-txt-3"
            />
            <button
              type="submit"
              class="rounded-md border border-line-2 bg-panel-2 px-2.5 py-2 text-[12.5px] disabled:opacity-50"
              :disabled="!newTheme.name.trim() || !newTheme.leitnerCategoryId"
            >
              +
            </button>
          </div>
          <label class="flex items-center gap-1.5 text-[11.5px] text-txt-3">
            <input v-model="newThemeShared" type="checkbox" class="accent-accent" />
            {{ t('leitner.settings.sharedField') }}
          </label>
        </form>
      </div>

      <!-- Intervalles des boîtes — réglage d'installation (`leitner.settings`), masqué en
           entier en lecture seule : un panneau d'inputs désactivés serait « grisé », pas
           « masqué ». -->
      <div v-if="canSettings" class="rounded-[12px] border border-line bg-panel p-4">
        <h2 class="text-[12px] font-bold tracking-[.12em] text-txt-2 uppercase">
          {{ t('leitner.settings.intervalsTitle') }}
        </h2>
        <p class="mt-1 mb-3 text-[11.5px] text-txt-3">
          {{ t('leitner.settings.intervalsHint') }}
        </p>

        <form class="flex flex-col gap-1.5" @submit.prevent="submitIntervals">
          <div v-for="box in BOXES" :key="box" class="flex items-center gap-2">
            <span class="flex-1 text-[12.5px] text-txt-2">{{ t('leitner.settings.boxLabel', { box }) }}</span>
            <input
              v-model.number="intervals[box]"
              type="number"
              min="1"
              max="365"
              class="w-[70px] rounded-md border border-line-2 bg-panel-2 px-2 py-1 text-right font-mono text-[12.5px]"
            />
            <span class="w-[38px] text-[11.5px] text-txt-3">
              {{ intervals[box] > 1 ? t('leitner.settings.dayPlural') : t('leitner.settings.daySingular') }}
            </span>
          </div>
          <button
            type="submit"
            class="mt-2 rounded-md border border-accent bg-accent px-2.5 py-2 text-[12.5px] text-white transition hover:opacity-90 disabled:opacity-50"
            :disabled="!intervalsDirty || savingIntervals"
          >
            {{ t('leitner.settings.saveIntervals') }}
          </button>
        </form>
      </div>

      <!-- Sauvegarde — export ET import sous `leitner.backup`, masqués en lecture seule.
           ⚠️ L'export est en lecture, mais il rend l'intégralité du contenu (réponses
           écrites comprises) en un fichier : un invité n'a pas à repartir avec la base.

           ⚠️ `ref` porté par le bloc ENTIER, donc par son bord haut : le rapport d'import
           et la liste d'erreurs apparaissent plus bas, et ne peuvent donc pas déplacer
           l'ancre qui sert à les ramener sous les yeux (CC-67). -->
      <div
        v-if="canBackup"
        ref="backupBlock"
        class="rounded-[12px] border border-line bg-panel p-4"
      >
        <h2 class="text-[12px] font-bold tracking-[.12em] text-txt-2 uppercase">{{ t('leitner.settings.backupTitle') }}</h2>
        <p class="mt-1 mb-3 text-[11.5px] text-txt-3">
          {{ t('leitner.settings.backupHint') }}
        </p>

        <!--
          Lien <a> natif, et surtout pas <Link> ni router.get : le téléchargement est une
          réponse HTTP nue (JSON + content-disposition), qu'Inertia ne sait pas interpréter.
        -->
        <a
          href="/revision/export"
          download
          class="block rounded-md border border-line-2 bg-panel-2 px-2.5 py-2 text-center text-[12.5px] text-txt-2 transition hover:border-accent hover:text-txt"
        >
          {{ t('leitner.settings.exportJson') }}
        </a>

        <form
          class="mt-4 flex flex-col gap-2 border-t border-line pt-4"
          @submit.prevent="submitImport"
        >
          <label class="text-[11px] tracking-[.1em] text-txt-3 uppercase">{{
            t('leitner.settings.importLabel')
          }}</label>
          <input
            ref="fileInput"
            type="file"
            accept="application/json,.json"
            class="text-[11.5px] text-txt-2 file:mr-2 file:rounded-md file:border file:border-line-2 file:bg-panel-2 file:px-2 file:py-1 file:text-[11.5px] file:text-txt-2"
            @change="pickFile"
          />

          <p class="text-[11.5px] text-txt-3">
            {{ t('leitner.settings.importHint') }}
          </p>

          <button
            type="submit"
            class="rounded-md border border-line-2 bg-panel-2 px-2.5 py-2 text-[12.5px] transition hover:border-accent disabled:opacity-50"
            :disabled="!importFile || importing"
          >
            {{ importing ? t('leitner.settings.importing') : t('leitner.settings.import') }}
          </button>
        </form>

        <!-- Retour du dernier import : ni le rapport ni les erreurs ne se perdent. -->
        <ul
          v-if="importErrors?.length"
          class="mt-3 flex flex-col gap-1 rounded-md border border-bad bg-panel-2 p-2.5"
        >
          <li class="text-[11.5px] font-semibold text-bad">{{ t('leitner.settings.importFailed') }}</li>
          <li v-for="(error, index) in importErrors" :key="index" class="text-[11.5px] text-txt-2">
            {{ error }}
          </li>
        </ul>

        <div
          v-else-if="importReport"
          class="mt-3 rounded-md border border-ok bg-panel-2 p-2.5 text-[11.5px] text-txt-2"
        >
          <div class="font-semibold text-ok">{{ t('leitner.settings.importDone') }}</div>
          <div class="mt-1">
            {{
              t('leitner.settings.importSummaryCards', {
                cards: importReport.cardsCreated,
                reviews: importReport.reviewsCreated,
              })
            }}
          </div>
          <div v-if="importReport.categoriesCreated || importReport.themesCreated" class="mt-0.5">
            {{
              t('leitner.settings.importSummaryTaxonomy', {
                categories: importReport.categoriesCreated,
                themes: importReport.themesCreated,
              })
            }}
          </div>
          <div v-if="importReport.cardsSkipped" class="mt-0.5 text-warn">
            {{ t('leitner.settings.importSummarySkipped', { cards: importReport.cardsSkipped }) }}
          </div>
          <div v-if="importReport.coursesCreated || importReport.coursesSkipped" class="mt-0.5">
            {{
              t('leitner.settings.importSummaryCourses', {
                courses: importReport.coursesCreated,
                skipped: importReport.coursesSkipped,
              })
            }}
          </div>
        </div>
      </div>
    </div>
  </div>

  <!-- Modale de création / édition (CC-209 : chassis partagé `AppModal`, voir le CLAUDE.md
       racine, « Une seule modale dans tout le dépôt »).
       `modalOpen` n'est armé que par les boutons masqués en lecture seule ;
       `canWriteCards` double la garde, au cas où l'état fuiterait. -->
  <AppModal v-if="modalOpen && canWriteCards" v-slot="{ titleId }" @close="modalOpen = false">
    <!--
      En-tête et pied figés, corps défilant (CC-66). Aucune des classes de structure n'est
      décorative — `max-h-[calc()]` et ses tirets bas, `min-h-0`, `shrink-0`, `overflow-hidden` :
      en retirer une rend le pied inatteignable, sans rien casser de visible. Voir le CLAUDE.md
      du module, « Sa structure est en trois bandes ». `mt-16` remplace le rembourrage vertical
      que le chassis portait avant CC-209 — l'arithmétique est expliquée dans le CLAUDE.md racine,
      « Une seule modale dans tout le dépôt » : retirer `mt-16` sans toucher au `max-h-[calc()]`
      colle la modale au bord haut, et l'inverse la colle au bord bas.
    -->
    <form
      class="mt-16 flex max-h-[calc(100vh_-_8rem)] w-[560px] max-w-[90%] flex-col overflow-hidden rounded-[14px] border border-line-2 bg-panel shadow-2xl"
      @submit.prevent="submitCard()"
    >
      <div :id="titleId" class="shrink-0 border-b border-line px-5 py-4 text-[13.5px] font-bold">
        {{ editing ? t('leitner.settings.modalEditTitle') : t('leitner.settings.modalCreateTitle') }}
      </div>
      <div class="flex min-h-0 flex-col gap-2 overflow-y-auto p-5">
        <!-- La bascule d'aperçu gouverne les DEUX panneaux, et vit donc sur la première étiquette
             plutôt qu'en double. Repliée, aucune requête ne part : voir
             `components/leitner_markdown_preview.ts`. -->
        <div class="flex items-center gap-2">
          <label class="text-[11px] tracking-[.1em] text-txt-3 uppercase">{{ t('leitner.settings.front') }}</label>
          <button
            type="button"
            class="ml-auto rounded-md border px-2 py-1 text-[11px] transition"
            :class="
              preview.open.value
                ? 'border-accent bg-accent-soft text-txt'
                : 'border-line-2 bg-panel-2 text-txt-3 hover:border-accent hover:text-txt'
            "
            @click="preview.toggle()"
          >
            {{ preview.open.value ? t('leitner.markdown.hide') : t('leitner.markdown.show') }}
          </button>
        </div>
        <textarea
          ref="frontInput"
          v-model="cardForm.front"
          rows="2"
          class="shrink-0 resize-y rounded-md border border-line-2 bg-panel-2 px-2.5 py-2 text-[12.5px]"
          @input="preview.onInput()"
        ></textarea>
        <MarkdownPreviewPanel :preview="preview" side="front" />

        <label class="mt-1 text-[11px] tracking-[.1em] text-txt-3 uppercase">{{ t('leitner.settings.back') }}</label>
        <textarea
          v-model="cardForm.back"
          rows="3"
          class="shrink-0 resize-y rounded-md border border-line-2 bg-panel-2 px-2.5 py-2 text-[12.5px]"
          @input="preview.onInput()"
        ></textarea>
        <MarkdownPreviewPanel :preview="preview" side="back" />

        <!-- Rien ne disait que le Markdown était interprété (CC-257). Cette ligne ne remplace pas
             l'aperçu : elle dit qu'il y a quelque chose à prévisualiser. -->
        <p class="text-[11px] text-txt-3">{{ t('leitner.markdown.hint') }}</p>

        <label class="mt-1 text-[11px] tracking-[.1em] text-txt-3 uppercase">{{ t('leitner.settings.theme') }}</label>
        <select
          v-model="cardForm.leitnerThemeId"
          class="rounded-md border border-line-2 bg-panel-2 px-2.5 py-2 text-[12.5px]"
        >
          <option :value="null">{{ t('leitner.settings.unclassifiedOption') }}</option>
          <optgroup v-for="category in categories" :key="category.id" :label="category.name">
            <option v-for="theme in category.themes" :key="theme.id" :value="theme.id">
              {{ theme.name }}
            </option>
          </optgroup>
        </select>
        <p v-if="!hasThemes" class="text-[11.5px] text-txt-3 italic">
          {{ t('leitner.settings.noThemesHint') }}
        </p>

        <label class="mt-2 flex items-start gap-2 text-[12.5px]">
          <input v-model="cardForm.isShared" type="checkbox" class="mt-0.5 accent-accent" />
          <span>
            <span class="font-medium">{{ t('leitner.settings.sharedField') }}</span>
            <span class="block text-[11.5px] text-txt-3">{{ t('leitner.settings.sharedHint') }}</span>
          </span>
        </label>

        <!-- Les liens `ingestion` de la même carte (CC-272) — zone DISTINCTE du sélecteur
             manuel ci-dessous : deux origines, deux gestes distincts, jamais fondus.
             Édition seulement : une carte en création n'a encore aucun lien. -->
        <template v-if="editing && editing.ingestionSections.length > 0">
          <label class="mt-1 text-[11px] tracking-[.1em] text-txt-3 uppercase">{{ t('leitner.settings.ingestionSections') }}</label>
          <p class="text-[11px] text-txt-3">{{ t('leitner.settings.ingestionSectionsHint') }}</p>
          <ul class="flex flex-col gap-1">
            <li
              v-for="section in editing.ingestionSections"
              :key="section.id"
              class="flex items-center justify-between gap-2 rounded-md border border-line-2 bg-panel-2 px-2.5 py-2 text-[12.5px]"
            >
              <span>
                {{ section.courseTitle }} ·
                {{ section.headingPath.length ? section.headingPath.join(' › ') : t('leitner.coursShow.introduction') }}
                <span v-if="section.obsoleteAt" class="ml-1 text-[10.5px] text-warn">{{ t('leitner.coursShow.obsolete') }}</span>
              </span>
              <button
                type="button"
                class="shrink-0 text-[11.5px] text-bad hover:underline"
                @click="removeIngestionSection(section.id)"
              >
                {{ t('leitner.settings.delete') }}
              </button>
            </li>
          </ul>
        </template>

        <!-- Le sélecteur manuel de provenance (CC-253) : au plus un lien `manuel` par
             carte, indépendant des liens `ingestion` posés par la promotion — voir
             `setManualSection`. Absent (courses = []) si `leitner.courses.view` manque. -->
        <template v-if="courses.length > 0">
          <label class="mt-1 text-[11px] tracking-[.1em] text-txt-3 uppercase">{{ t('leitner.settings.courseSection') }}</label>
          <select
            v-model="cardForm.courseSectionId"
            class="rounded-md border border-line-2 bg-panel-2 px-2.5 py-2 text-[12.5px]"
          >
            <option :value="null">{{ t('leitner.settings.courseSectionNone') }}</option>
            <optgroup v-for="course in courses" :key="course.id" :label="course.title">
              <option v-for="section in course.sections" :key="section.id" :value="section.id">
                {{ section.headingPath.length ? section.headingPath.join(' › ') : t('leitner.coursShow.introduction') }}
              </option>
            </optgroup>
          </select>
        </template>
      </div>
      <div class="flex shrink-0 items-center justify-end gap-2 border-t border-line px-5 py-4">
        <!-- ⚠️ Supprimer une carte depuis sa propre modale d'édition (CC-206) : c'est le cas
             pour lequel CC-209 a ajouté la pile d'instances d'`AppModal` — la confirmation
             s'ouvre par-dessus ce formulaire encore ouvert. -->
        <button
          v-if="editing"
          type="button"
          class="mr-auto rounded-md border border-bad/50 px-3 py-2 text-[12.5px] text-bad transition hover:bg-bad hover:text-white disabled:opacity-50"
          :disabled="saving"
          @click="deleteEditingCard"
        >
          {{ t('leitner.settings.delete') }}
        </button>
        <button
          type="button"
          class="rounded-md border border-line-2 bg-panel-2 px-3 py-2 text-[12.5px] text-txt-2"
          @click="modalOpen = false"
        >
          {{ t('leitner.settings.cancel') }}
        </button>
        <button
          v-if="!editing"
          type="button"
          class="rounded-md border border-line-2 bg-panel-2 px-3 py-2 text-[12.5px] text-txt-2 transition hover:border-accent hover:text-txt disabled:opacity-50"
          :disabled="saving || !cardForm.front.trim() || !cardForm.back.trim()"
          @click="submitCard(true)"
        >
          {{ t('leitner.settings.createAndContinue') }}
        </button>
        <button
          type="submit"
          class="rounded-md border border-accent bg-accent px-3 py-2 text-[12.5px] text-white disabled:opacity-50"
          :disabled="saving || !cardForm.front.trim() || !cardForm.back.trim()"
        >
          {{ editing ? t('leitner.settings.save') : t('leitner.settings.create') }}
        </button>
      </div>
    </form>
  </AppModal>

  <ConfirmModal ref="confirmModal" />
</template>
