<script setup lang="ts">
import { computed, reactive, ref, watch } from 'vue'
import { Head, Link, router } from '@inertiajs/vue3'
import AppLayout from '~/layouts/AppLayout.vue'

defineOptions({ layout: AppLayout })

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
  box: number
  theme: { id: number; name: string; category: { id: number; name: string } } | null
}

interface Filters {
  search: string
  categoryId: number | null
  themeId: number | null
  box: number | null
  unclassified: boolean
}

const props = defineProps<{
  cards: Card[]
  categories: CategoryNode[]
  unclassifiedCount: number
  totalCards: number
  filters: Filters
}>()

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

function bulkDelete(): void {
  const count = selected.value.length
  if (count === 0) return
  if (!confirm(`Supprimer ${count} carte${count > 1 ? 's' : ''} ? Cette action est définitive.`)) {
    return
  }
  router.post(
    '/revision/cards/delete',
    { ids: selected.value },
    { preserveScroll: true, onSuccess: () => (selected.value = []) }
  )
}

function deleteCard(card: Card): void {
  if (!confirm(`Supprimer « ${card.front.slice(0, 60)} » ? Cette action est définitive.`)) return
  router.delete(`/revision/cards/${card.id}`, { preserveScroll: true })
}

/*
| Création / édition d'une carte — même modale, `editing` à null = création.
*/
const modalOpen = ref(false)
const editing = ref<Card | null>(null)
const cardForm = reactive({ front: '', back: '', leitnerThemeId: null as number | null })
const saving = ref(false)
const frontInput = ref<HTMLTextAreaElement | null>(null)

const hasThemes = computed(() => props.categories.some((category) => category.themes.length > 0))

function openCreate(): void {
  editing.value = null
  cardForm.front = ''
  cardForm.back = ''
  // Le thème filtré pré-remplit la carte : on saisit en général plusieurs
  // cartes de suite sur le même sujet.
  cardForm.leitnerThemeId = filters.themeId
  modalOpen.value = true
}

function openEdit(card: Card): void {
  editing.value = card
  cardForm.front = card.front
  cardForm.back = card.back
  cardForm.leitnerThemeId = card.theme?.id ?? null
  modalOpen.value = true
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
        },
      }
    )
  } else {
    router.post('/revision/cards', { ...cardForm }, options)
  }
}

/*
| Taxonomie — catégories et thèmes
*/
const newCategory = ref('')
const newTheme = reactive({ name: '', leitnerCategoryId: null as number | null })
const renamingCategory = ref<number | null>(null)
const renamingTheme = ref<number | null>(null)
const draftName = ref('')

function addCategory(): void {
  if (!newCategory.value.trim()) return
  router.post(
    '/revision/categories',
    { name: newCategory.value.trim() },
    { preserveScroll: true, onSuccess: () => (newCategory.value = '') }
  )
}

function addTheme(): void {
  if (!newTheme.name.trim() || !newTheme.leitnerCategoryId) return
  router.post(
    '/revision/themes',
    { name: newTheme.name.trim(), leitnerCategoryId: newTheme.leitnerCategoryId },
    { preserveScroll: true, onSuccess: () => (newTheme.name = '') }
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

function deleteCategory(category: CategoryNode): void {
  const message = category.cardCount
    ? `Supprimer « ${category.name} » et ses ${category.themes.length} thème(s) ? Ses ${category.cardCount} carte(s) ne seront pas supprimées, elles deviendront « non classées ».`
    : `Supprimer la catégorie « ${category.name} » ?`
  if (!confirm(message)) return
  router.delete(`/revision/categories/${category.id}`, { preserveScroll: true })
}

function deleteTheme(theme: ThemeNode): void {
  const message = theme.cardCount
    ? `Supprimer le thème « ${theme.name} » ? Ses ${theme.cardCount} carte(s) deviendront « non classées ».`
    : `Supprimer le thème « ${theme.name} » ?`
  if (!confirm(message)) return
  router.delete(`/revision/themes/${theme.id}`, { preserveScroll: true })
}
</script>

<template>
  <Head title="Gestion des cartes" />

  <div class="mb-4 flex items-center gap-3">
    <div>
      <div class="text-[18px] font-bold">Gestion des cartes</div>
      <div class="text-[12.5px] text-txt-2">
        {{ cards.length }} affichée{{ cards.length > 1 ? 's' : '' }} sur {{ totalCards }} ·
        {{ unclassifiedCount }} non classée{{ unclassifiedCount > 1 ? 's' : '' }}
      </div>
    </div>
    <button
      type="button"
      class="ml-auto rounded-[10px] border border-accent bg-accent px-3.5 py-2 text-[12.5px] text-white transition hover:opacity-90"
      @click="openCreate"
    >
      + Nouvelle carte
    </button>
    <Link
      href="/revision"
      class="rounded-[10px] border border-line-2 bg-panel px-3.5 py-2 text-[12.5px] text-txt-2 transition hover:border-accent hover:text-txt"
    >
      ← Retour à la révision
    </Link>
  </div>

  <div class="grid grid-cols-[1fr_320px] items-start gap-4">
    <div>
      <!-- Filtres -->
      <div class="mb-3 flex flex-wrap items-center gap-2 rounded-[12px] border border-line bg-panel p-3">
        <input
          v-model="filters.search"
          type="search"
          placeholder="Rechercher recto ou verso…"
          class="min-w-[200px] flex-1 rounded-md border border-line-2 bg-panel-2 px-2.5 py-2 text-[12.5px] placeholder:text-txt-3"
        />
        <select
          v-model="filters.categoryId"
          class="rounded-md border border-line-2 bg-panel-2 px-2.5 py-2 text-[12.5px]"
        >
          <option :value="null">Toutes catégories</option>
          <option v-for="category in categories" :key="category.id" :value="category.id">
            {{ category.name }}
          </option>
        </select>
        <select
          v-model="filters.themeId"
          :disabled="!filters.categoryId"
          class="rounded-md border border-line-2 bg-panel-2 px-2.5 py-2 text-[12.5px] disabled:opacity-40"
        >
          <option :value="null">Tous thèmes</option>
          <option v-for="theme in themesOfFilteredCategory" :key="theme.id" :value="theme.id">
            {{ theme.name }}
          </option>
        </select>
        <select
          v-model="filters.box"
          class="rounded-md border border-line-2 bg-panel-2 px-2.5 py-2 text-[12.5px]"
        >
          <option :value="null">Toutes boîtes</option>
          <option v-for="box in [1, 2, 3, 4, 5]" :key="box" :value="box">Boîte {{ box }}</option>
        </select>
        <label class="flex items-center gap-1.5 text-[12.5px] text-txt-2">
          <input v-model="filters.unclassified" type="checkbox" class="accent-accent" />
          Non classées
        </label>
        <button
          type="button"
          class="rounded-md border border-line-2 bg-panel-2 px-2.5 py-2 text-[12.5px] text-txt-2 transition hover:text-txt"
          @click="resetFilters"
        >
          Réinitialiser
        </button>
      </div>

      <!-- Barre d'actions groupées -->
      <div
        v-if="selected.length"
        class="mb-3 flex flex-wrap items-center gap-2 rounded-[12px] border border-accent bg-accent-soft p-3"
      >
        <span class="text-[12.5px] font-semibold">
          {{ selected.length }} carte{{ selected.length > 1 ? 's' : '' }} sélectionnée{{
            selected.length > 1 ? 's' : ''
          }}
        </span>
        <select
          v-model="bulkThemeId"
          class="ml-auto rounded-md border border-line-2 bg-panel-2 px-2.5 py-2 text-[12.5px]"
        >
          <option :value="null">— Non classée —</option>
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
          Classer
        </button>
        <button
          type="button"
          class="rounded-md border border-bad px-2.5 py-2 text-[12.5px] text-bad transition hover:bg-bad hover:text-white"
          @click="bulkDelete"
        >
          Supprimer
        </button>
      </div>

      <!-- Tableau -->
      <div class="overflow-hidden rounded-[12px] border border-line bg-panel">
        <table class="w-full border-collapse text-left">
          <thead>
            <tr class="border-b border-line text-[10.5px] tracking-[.1em] text-txt-3 uppercase">
              <th class="w-9 py-2.5 pl-3">
                <input
                  type="checkbox"
                  class="accent-accent"
                  :checked="allSelected"
                  :disabled="!cards.length"
                  @change="toggleAll"
                />
              </th>
              <th class="py-2.5 font-medium">Carte</th>
              <th class="w-[190px] py-2.5 font-medium">Classement</th>
              <th class="w-[70px] py-2.5 font-medium">Boîte</th>
              <th class="w-[110px] py-2.5 pr-3 text-right font-medium">Actions</th>
            </tr>
          </thead>
          <tbody>
            <tr
              v-for="card in cards"
              :key="card.id"
              class="border-b border-line last:border-b-0 hover:bg-panel-2"
            >
              <td class="py-2.5 pl-3 align-top">
                <input
                  v-model="selected"
                  type="checkbox"
                  class="mt-1 accent-accent"
                  :value="card.id"
                />
              </td>
              <td class="py-2.5 pr-3">
                <div class="text-[13px] font-medium">{{ card.front }}</div>
                <div class="mt-0.5 line-clamp-2 text-[12px] text-txt-3">{{ card.back }}</div>
              </td>
              <td class="py-2.5 pr-3 align-top">
                <span
                  v-if="card.theme"
                  class="inline-block rounded-full border border-line-2 bg-panel-2 px-2 py-0.5 text-[11px] text-txt-2"
                >
                  {{ card.theme.category.name }} · {{ card.theme.name }}
                </span>
                <span v-else class="text-[11px] text-txt-3 italic">non classée</span>
              </td>
              <td class="py-2.5 pr-3 align-top">
                <span class="font-mono text-[12.5px]">{{ card.box }}</span>
              </td>
              <td class="py-2.5 pr-3 text-right align-top whitespace-nowrap">
                <button
                  type="button"
                  class="rounded-md border border-line-2 bg-panel-2 px-2 py-1 text-[11.5px] text-txt-2 transition hover:border-accent hover:text-txt"
                  @click="openEdit(card)"
                >
                  Éditer
                </button>
                <button
                  type="button"
                  class="ml-1 rounded-md border border-line-2 bg-panel-2 px-2 py-1 text-[11.5px] text-txt-2 transition hover:border-bad hover:text-bad"
                  @click="deleteCard(card)"
                >
                  Suppr.
                </button>
              </td>
            </tr>
            <tr v-if="!cards.length">
              <td colspan="5" class="py-8 text-center text-[12.5px] text-txt-3">
                <template v-if="totalCards">Aucune carte ne correspond à ces filtres.</template>
                <template v-else>
                  <div class="text-[13px] font-semibold text-txt-2">Votre base est vide</div>
                  <div class="mt-1">
                    Créez d'abord une catégorie et un thème ci-contre, puis ajoutez vos cartes.
                  </div>
                  <button
                    type="button"
                    class="mt-3 rounded-md border border-accent bg-accent px-3 py-2 text-[12.5px] text-white transition hover:opacity-90"
                    @click="openCreate"
                  >
                    + Créer ma première carte
                  </button>
                </template>
              </td>
            </tr>
          </tbody>
        </table>
      </div>
    </div>

    <!-- Taxonomie -->
    <div class="rounded-[12px] border border-line bg-panel p-4">
      <h2 class="mb-3 text-[12px] font-bold tracking-[.12em] text-txt-2 uppercase">
        Catégories & thèmes
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
            <button type="submit" class="text-[11.5px] text-accent">OK</button>
          </form>
          <template v-else>
            <span class="flex-1 truncate text-[13px] font-semibold">{{ category.name }}</span>
            <span class="font-mono text-[11px] text-txt-3">{{ category.cardCount }}</span>
            <button
              type="button"
              class="text-[11px] text-txt-3 transition hover:text-txt"
              title="Renommer"
              @click="startRenameCategory(category)"
            >
              ✎
            </button>
            <button
              type="button"
              class="text-[11px] text-txt-3 transition hover:text-bad"
              title="Supprimer"
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
              <button type="submit" class="text-[11.5px] text-accent">OK</button>
            </form>
            <template v-else>
              <span class="flex-1 truncate">{{ theme.name }}</span>
              <span class="font-mono text-[11px] text-txt-3">{{ theme.cardCount }}</span>
              <button
                type="button"
                class="text-[11px] text-txt-3 transition hover:text-txt"
                title="Renommer"
                @click="startRenameTheme(theme)"
              >
                ✎
              </button>
              <button
                type="button"
                class="text-[11px] text-txt-3 transition hover:text-bad"
                title="Supprimer"
                @click="deleteTheme(theme)"
              >
                ✕
              </button>
            </template>
          </div>
          <span v-if="!category.themes.length" class="text-[11.5px] text-txt-3 italic">
            aucun thème
          </span>
        </div>
      </div>

      <p v-if="!categories.length" class="mb-3 text-[12px] text-txt-3 italic">
        Aucune catégorie. Créez-en une pour commencer à classer vos cartes.
      </p>

      <form class="mt-4 flex gap-1.5 border-t border-line pt-4" @submit.prevent="addCategory">
        <input
          v-model="newCategory"
          placeholder="Nouvelle catégorie"
          class="min-w-0 flex-1 rounded-md border border-line-2 bg-panel-2 px-2.5 py-2 text-[12.5px] placeholder:text-txt-3"
        />
        <button
          type="submit"
          class="rounded-md border border-accent bg-accent px-2.5 py-2 text-[12.5px] text-white disabled:opacity-50"
          :disabled="!newCategory.trim()"
        >
          +
        </button>
      </form>

      <form class="mt-2 flex flex-col gap-1.5" @submit.prevent="addTheme">
        <select
          v-model="newTheme.leitnerCategoryId"
          class="rounded-md border border-line-2 bg-panel-2 px-2.5 py-2 text-[12.5px]"
        >
          <option :value="null">Catégorie du thème…</option>
          <option v-for="category in categories" :key="category.id" :value="category.id">
            {{ category.name }}
          </option>
        </select>
        <div class="flex gap-1.5">
          <input
            v-model="newTheme.name"
            placeholder="Nouveau thème"
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
      </form>
    </div>
  </div>

  <!-- Modale de création / édition -->
  <div
    v-if="modalOpen"
    class="fixed inset-0 z-50 flex items-start justify-center bg-[rgba(4,5,14,.6)] pt-[120px]"
    @click.self="modalOpen = false"
  >
    <form
      class="w-[560px] max-w-[90%] overflow-hidden rounded-[14px] border border-line-2 bg-panel shadow-2xl"
      @submit.prevent="submitCard()"
    >
      <div class="border-b border-line px-5 py-4 text-[13.5px] font-bold">
        {{ editing ? 'Éditer la carte' : 'Nouvelle carte' }}
      </div>
      <div class="flex flex-col gap-2 p-5">
        <label class="text-[11px] tracking-[.1em] text-txt-3 uppercase">Recto</label>
        <textarea
          ref="frontInput"
          v-model="cardForm.front"
          rows="2"
          autofocus
          class="rounded-md border border-line-2 bg-panel-2 px-2.5 py-2 text-[12.5px]"
        ></textarea>

        <label class="mt-1 text-[11px] tracking-[.1em] text-txt-3 uppercase">Verso</label>
        <textarea
          v-model="cardForm.back"
          rows="3"
          class="rounded-md border border-line-2 bg-panel-2 px-2.5 py-2 text-[12.5px]"
        ></textarea>

        <label class="mt-1 text-[11px] tracking-[.1em] text-txt-3 uppercase">Thème</label>
        <select
          v-model="cardForm.leitnerThemeId"
          class="rounded-md border border-line-2 bg-panel-2 px-2.5 py-2 text-[12.5px]"
        >
          <option :value="null">— Non classée —</option>
          <optgroup v-for="category in categories" :key="category.id" :label="category.name">
            <option v-for="theme in category.themes" :key="theme.id" :value="theme.id">
              {{ theme.name }}
            </option>
          </optgroup>
        </select>
        <p v-if="!hasThemes" class="text-[11.5px] text-txt-3 italic">
          Aucun thème pour l'instant : la carte sera « non classée ». Vous pourrez la classer plus
          tard depuis cet écran.
        </p>
      </div>
      <div class="flex justify-end gap-2 border-t border-line px-5 py-4">
        <button
          type="button"
          class="rounded-md border border-line-2 bg-panel-2 px-3 py-2 text-[12.5px] text-txt-2"
          @click="modalOpen = false"
        >
          Annuler
        </button>
        <button
          v-if="!editing"
          type="button"
          class="rounded-md border border-line-2 bg-panel-2 px-3 py-2 text-[12.5px] text-txt-2 transition hover:border-accent hover:text-txt disabled:opacity-50"
          :disabled="saving || !cardForm.front.trim() || !cardForm.back.trim()"
          @click="submitCard(true)"
        >
          Créer et enchaîner
        </button>
        <button
          type="submit"
          class="rounded-md border border-accent bg-accent px-3 py-2 text-[12.5px] text-white disabled:opacity-50"
          :disabled="saving || !cardForm.front.trim() || !cardForm.back.trim()"
        >
          {{ editing ? 'Enregistrer' : 'Créer la carte' }}
        </button>
      </div>
    </form>
  </div>
</template>
