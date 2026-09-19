<script setup lang="ts">
import { computed, ref } from 'vue'
import { useI18n } from 'vue-i18n'
import { Head, router } from '@inertiajs/vue3'
import AppLayout from '~/layouts/AppLayout.vue'
import ConfirmModal from '~/components/ConfirmModal.vue'
import LeitnerTabs from '../components/LeitnerTabs.vue'
import { xsrfToken } from '../components/leitner_csrf'
import { useCan } from '../components/leitner_can'

defineOptions({ layout: AppLayout })

const { t } = useI18n()
const { can } = useCan()
const confirmModal = ref<InstanceType<typeof ConfirmModal> | null>(null)
const canWriteTaxonomy = computed(() => can('leitner.taxonomy.write'))

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

interface TaxonomyMergePreview {
  kind: 'category' | 'theme'
  sourceId: number
  targetId: number
  sourceName: string
  targetName: string
  sourceChildren: number
  collisionCount: number
  cardsToMove: number
}

const props = defineProps<{ categories: CategoryNode[] }>()

const newCategory = ref('')
const newCategoryShared = ref(false)
const newTheme = ref({ name: '', leitnerCategoryId: null as number | null })
const newThemeShared = ref(false)
const renamingCategory = ref<number | null>(null)
const renamingTheme = ref<number | null>(null)
const draftName = ref('')
const actionLoading = ref<string | null>(null)
const actionError = ref('')

const taxonomyMergeKind = ref<'category' | 'theme'>('category')
const taxonomyMergeSourceId = ref<number | null>(null)
const taxonomyMergeTargetId = ref<number | null>(null)
const taxonomyMergePreviewResult = ref<TaxonomyMergePreview | null>(null)

const mergeThemes = computed(() =>
  props.categories.flatMap((category) =>
    category.themes.map((theme) => ({ ...theme, categoryName: category.name }))
  )
)

const mergeOptions = computed(() =>
  taxonomyMergeKind.value === 'category'
    ? props.categories
    : mergeThemes.value.map((theme) => ({
        id: theme.id,
        name: `${theme.categoryName} · ${theme.name}`,
      }))
)

function clearActionError(): void {
  actionError.value = ''
}

function onActionError(): void {
  actionError.value = t('leitner.organisation.actionError')
}

function addCategory(): void {
  if (!newCategory.value.trim()) return
  actionLoading.value = 'category'
  clearActionError()
  router.post(
    '/revision/categories',
    { name: newCategory.value.trim(), isShared: newCategoryShared.value },
    {
      preserveScroll: true,
      onSuccess: () => {
        newCategory.value = ''
        newCategoryShared.value = false
      },
      onError: onActionError,
      onFinish: () => (actionLoading.value = null),
    }
  )
}

function addTheme(): void {
  if (!newTheme.value.name.trim() || !newTheme.value.leitnerCategoryId) return
  actionLoading.value = 'theme'
  clearActionError()
  router.post(
    '/revision/themes',
    {
      name: newTheme.value.name.trim(),
      leitnerCategoryId: newTheme.value.leitnerCategoryId,
      isShared: newThemeShared.value,
    },
    {
      preserveScroll: true,
      onSuccess: () => {
        newTheme.value.name = ''
        newThemeShared.value = false
      },
      onError: onActionError,
      onFinish: () => (actionLoading.value = null),
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
  actionLoading.value = `category-${category.id}`
  clearActionError()
  router.put(
    `/revision/categories/${category.id}`,
    { name: draftName.value.trim() },
    {
      preserveScroll: true,
      onSuccess: () => (renamingCategory.value = null),
      onError: onActionError,
      onFinish: () => (actionLoading.value = null),
    }
  )
}

function submitRenameTheme(theme: ThemeNode, categoryId: number): void {
  if (!draftName.value.trim()) return
  actionLoading.value = `theme-${theme.id}`
  clearActionError()
  router.put(
    `/revision/themes/${theme.id}`,
    { name: draftName.value.trim(), leitnerCategoryId: categoryId },
    {
      preserveScroll: true,
      onSuccess: () => (renamingTheme.value = null),
      onError: onActionError,
      onFinish: () => (actionLoading.value = null),
    }
  )
}

async function deleteCategory(category: CategoryNode): Promise<void> {
  const message = category.cardCount
    ? t('leitner.organisation.confirmDeleteCategory', {
        name: category.name,
        themes: category.themes.length,
        cards: category.cardCount,
      })
    : t('leitner.organisation.confirmDeleteCategoryEmpty', { name: category.name })
  if (!(await confirmModal.value?.ask(message, { danger: true }))) return
  actionLoading.value = `delete-category-${category.id}`
  clearActionError()
  router.delete(`/revision/categories/${category.id}`, {
    preserveScroll: true,
    onError: onActionError,
    onFinish: () => (actionLoading.value = null),
  })
}

async function deleteTheme(theme: ThemeNode): Promise<void> {
  const message = theme.cardCount
    ? t('leitner.organisation.confirmDeleteTheme', { name: theme.name, cards: theme.cardCount })
    : t('leitner.organisation.confirmDeleteThemeEmpty', { name: theme.name })
  if (!(await confirmModal.value?.ask(message, { danger: true }))) return
  actionLoading.value = `delete-theme-${theme.id}`
  clearActionError()
  router.delete(`/revision/themes/${theme.id}`, {
    preserveScroll: true,
    onError: onActionError,
    onFinish: () => (actionLoading.value = null),
  })
}

function resetMergePreview(): void {
  taxonomyMergePreviewResult.value = null
  clearActionError()
}

async function jsonPost<T>(url: string, body: unknown): Promise<T> {
  const response = await fetch(url, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'accept': 'application/json',
      'x-xsrf-token': xsrfToken(),
    },
    body: JSON.stringify(body),
  })
  if (!response.ok) throw new Error(`HTTP ${response.status}`)
  return response.json() as Promise<T>
}

async function previewTaxonomyMerge(): Promise<void> {
  if (!taxonomyMergeSourceId.value || !taxonomyMergeTargetId.value) return
  actionLoading.value = 'merge'
  resetMergePreview()
  try {
    taxonomyMergePreviewResult.value = await jsonPost<TaxonomyMergePreview>(
      '/revision/settings/taxonomy/merge/preview',
      {
        kind: taxonomyMergeKind.value,
        sourceId: taxonomyMergeSourceId.value,
        targetId: taxonomyMergeTargetId.value,
      }
    )
  } catch {
    onActionError()
  } finally {
    actionLoading.value = null
  }
}

async function mergeTaxonomy(): Promise<void> {
  const preview = taxonomyMergePreviewResult.value
  if (!preview) return
  const message = t('leitner.organisation.confirmTaxonomyMerge', {
    source: preview.sourceName,
    target: preview.targetName,
    collisions: preview.collisionCount,
  })
  if (!(await confirmModal.value?.ask(message, { danger: true }))) return

  actionLoading.value = 'merge'
  clearActionError()
  try {
    await jsonPost('/revision/settings/taxonomy/merge', {
      kind: preview.kind,
      sourceId: preview.sourceId,
      targetId: preview.targetId,
    })
    taxonomyMergePreviewResult.value = null
    taxonomyMergeSourceId.value = null
    taxonomyMergeTargetId.value = null
    await router.reload({ preserveScroll: true })
  } catch {
    onActionError()
  } finally {
    actionLoading.value = null
  }
}
</script>

<template>
  <Head :title="t('leitner.organisation.title')" />

  <LeitnerTabs />

  <div class="mb-5">
    <h1 class="text-[18px] font-bold">{{ t('leitner.organisation.title') }}</h1>
    <p class="mt-1 max-w-2xl text-[12.5px] text-txt-2">
      {{ t('leitner.organisation.intro') }}
    </p>
  </div>

  <p
    v-if="actionError"
    class="mb-4 rounded-[10px] border border-bad bg-panel p-3 text-[12px] text-bad"
  >
    {{ actionError }}
  </p>

  <div class="grid gap-4 lg:grid-cols-[minmax(0,1fr)_320px]">
    <section
      class="rounded-[12px] border border-line bg-panel p-4"
      aria-labelledby="taxonomy-tree-title"
    >
      <div class="mb-4 flex items-center gap-3">
        <h2
          id="taxonomy-tree-title"
          class="text-[12px] font-bold tracking-[.12em] text-txt-2 uppercase"
        >
          {{ t('leitner.organisation.treeTitle') }}
        </h2>
        <span class="h-px flex-1 bg-line"></span>
        <span class="font-mono text-[11px] text-txt-3">{{ categories.length }}</span>
      </div>

      <div
        v-if="!categories.length"
        class="rounded-md border border-dashed border-line-2 p-6 text-center"
      >
        <p class="text-[13px] font-semibold text-txt-2">
          {{ t('leitner.organisation.emptyTitle') }}
        </p>
        <p class="mt-1 text-[12px] text-txt-3">{{ t('leitner.organisation.emptyHint') }}</p>
      </div>

      <div v-else class="flex flex-col gap-4">
        <article
          v-for="category in categories"
          :key="category.id"
          class="rounded-lg border border-line-2 bg-panel-2 p-3"
        >
          <div class="flex items-center gap-2">
            <form
              v-if="renamingCategory === category.id"
              class="flex min-w-0 flex-1 gap-1.5"
              @submit.prevent="submitRenameCategory(category)"
            >
              <input
                v-model="draftName"
                autofocus
                class="min-w-0 flex-1 rounded-md border border-accent bg-panel px-2 py-1 text-[12.5px]"
                @keyup.esc="renamingCategory = null"
              />
              <button type="submit" class="text-[11.5px] text-accent">
                {{ t('leitner.organisation.ok') }}
              </button>
            </form>
            <template v-else>
              <h3 class="min-w-0 flex-1 truncate text-[13px] font-semibold">{{ category.name }}</h3>
              <span class="font-mono text-[11px] text-txt-3">{{ category.cardCount }}</span>
              <button
                v-if="canWriteTaxonomy"
                type="button"
                class="text-[11px] text-txt-3 hover:text-txt"
                :title="t('leitner.organisation.rename')"
                @click="startRenameCategory(category)"
              >
                ✎
              </button>
              <button
                v-if="canWriteTaxonomy"
                type="button"
                class="text-[11px] text-txt-3 hover:text-bad"
                :title="t('leitner.organisation.delete')"
                @click="deleteCategory(category)"
              >
                ✕
              </button>
            </template>
          </div>

          <div class="mt-2 flex flex-col gap-1 border-l border-line pl-3">
            <div
              v-for="theme in category.themes"
              :key="theme.id"
              class="flex items-center gap-2 text-[12px] text-txt-2"
            >
              <form
                v-if="renamingTheme === theme.id"
                class="flex min-w-0 flex-1 gap-1.5"
                @submit.prevent="submitRenameTheme(theme, category.id)"
              >
                <input
                  v-model="draftName"
                  autofocus
                  class="min-w-0 flex-1 rounded-md border border-accent bg-panel px-2 py-1 text-[12px]"
                  @keyup.esc="renamingTheme = null"
                />
                <button type="submit" class="text-[11.5px] text-accent">
                  {{ t('leitner.organisation.ok') }}
                </button>
              </form>
              <template v-else>
                <span class="min-w-0 flex-1 truncate">{{ theme.name }}</span>
                <span class="font-mono text-[11px] text-txt-3">{{ theme.cardCount }}</span>
                <button
                  v-if="canWriteTaxonomy"
                  type="button"
                  class="text-[11px] text-txt-3 hover:text-txt"
                  :title="t('leitner.organisation.rename')"
                  @click="startRenameTheme(theme)"
                >
                  ✎
                </button>
                <button
                  v-if="canWriteTaxonomy"
                  type="button"
                  class="text-[11px] text-txt-3 hover:text-bad"
                  :title="t('leitner.organisation.delete')"
                  @click="deleteTheme(theme)"
                >
                  ✕
                </button>
              </template>
            </div>
            <span v-if="!category.themes.length" class="text-[11.5px] text-txt-3 italic">{{
              t('leitner.organisation.noThemes')
            }}</span>
          </div>
        </article>
      </div>
    </section>

    <aside class="flex flex-col gap-4">
      <section v-if="canWriteTaxonomy" class="rounded-[12px] border border-line bg-panel p-4">
        <h2 class="mb-3 text-[12px] font-bold tracking-[.12em] text-txt-2 uppercase">
          {{ t('leitner.organisation.createTitle') }}
        </h2>
        <form class="flex flex-col gap-2 border-b border-line pb-4" @submit.prevent="addCategory">
          <label class="text-[11px] tracking-[.1em] text-txt-3 uppercase">{{
            t('leitner.organisation.categoryLabel')
          }}</label>
          <div class="flex gap-1.5">
            <input
              v-model="newCategory"
              :placeholder="t('leitner.organisation.newCategoryPlaceholder')"
              class="min-w-0 flex-1 rounded-md border border-line-2 bg-panel-2 px-2.5 py-2 text-[12.5px]"
            />
            <button
              type="submit"
              class="rounded-md border border-accent bg-accent px-2.5 py-2 text-[12.5px] text-white disabled:opacity-50"
              :disabled="!newCategory.trim() || actionLoading === 'category'"
            >
              {{ actionLoading === 'category' ? '…' : '+' }}
            </button>
          </div>
          <label class="flex items-center gap-1.5 text-[11.5px] text-txt-3"
            ><input v-model="newCategoryShared" type="checkbox" class="accent-accent" />{{
              t('leitner.organisation.sharedField')
            }}</label
          >
        </form>

        <form class="mt-4 flex flex-col gap-2" @submit.prevent="addTheme">
          <label class="text-[11px] tracking-[.1em] text-txt-3 uppercase">{{
            t('leitner.organisation.themeLabel')
          }}</label>
          <select
            v-model="newTheme.leitnerCategoryId"
            class="rounded-md border border-line-2 bg-panel-2 px-2.5 py-2 text-[12.5px]"
          >
            <option :value="null">{{ t('leitner.organisation.themeCategoryPlaceholder') }}</option>
            <option v-for="category in categories" :key="category.id" :value="category.id">
              {{ category.name }}
            </option>
          </select>
          <div class="flex gap-1.5">
            <input
              v-model="newTheme.name"
              :placeholder="t('leitner.organisation.newThemePlaceholder')"
              class="min-w-0 flex-1 rounded-md border border-line-2 bg-panel-2 px-2.5 py-2 text-[12.5px]"
            />
            <button
              type="submit"
              class="rounded-md border border-line-2 bg-panel-2 px-2.5 py-2 text-[12.5px] disabled:opacity-50"
              :disabled="
                !newTheme.name.trim() || !newTheme.leitnerCategoryId || actionLoading === 'theme'
              "
            >
              {{ actionLoading === 'theme' ? '…' : '+' }}
            </button>
          </div>
          <label class="flex items-center gap-1.5 text-[11.5px] text-txt-3"
            ><input v-model="newThemeShared" type="checkbox" class="accent-accent" />{{
              t('leitner.organisation.sharedField')
            }}</label
          >
        </form>
      </section>

      <section v-if="canWriteTaxonomy" class="rounded-[12px] border border-line bg-panel p-4">
        <h2 class="mb-3 text-[12px] font-bold tracking-[.12em] text-txt-2 uppercase">
          {{ t('leitner.organisation.mergeTitle') }}
        </h2>
        <select
          v-model="taxonomyMergeKind"
          class="mb-2 w-full rounded-md border border-line-2 bg-panel-2 px-2.5 py-2 text-[12.5px]"
          @change="resetMergePreview"
        >
          <option value="category">{{ t('leitner.organisation.mergeCategory') }}</option>
          <option value="theme">{{ t('leitner.organisation.mergeTheme') }}</option>
        </select>
        <div class="grid grid-cols-2 gap-1.5">
          <select
            v-model="taxonomyMergeSourceId"
            class="min-w-0 rounded-md border border-line-2 bg-panel-2 px-2 py-2 text-[12px]"
            @change="resetMergePreview"
          >
            <option :value="null">{{ t('leitner.organisation.mergeSource') }}</option>
            <option v-for="option in mergeOptions" :key="option.id" :value="option.id">
              {{ option.name }}
            </option>
          </select>
          <select
            v-model="taxonomyMergeTargetId"
            class="min-w-0 rounded-md border border-line-2 bg-panel-2 px-2 py-2 text-[12px]"
            @change="resetMergePreview"
          >
            <option :value="null">{{ t('leitner.organisation.mergeTarget') }}</option>
            <option
              v-for="option in mergeOptions"
              :key="option.id"
              :value="option.id"
              :disabled="option.id === taxonomyMergeSourceId"
            >
              {{ option.name }}
            </option>
          </select>
        </div>
        <button
          type="button"
          class="mt-2 w-full rounded-md border border-line-2 bg-panel-2 px-2.5 py-2 text-[12.5px] disabled:opacity-50"
          :disabled="!taxonomyMergeSourceId || !taxonomyMergeTargetId || actionLoading === 'merge'"
          @click="previewTaxonomyMerge"
        >
          {{
            actionLoading === 'merge'
              ? t('leitner.organisation.loading')
              : t('leitner.organisation.mergePreview')
          }}
        </button>
        <div
          v-if="taxonomyMergePreviewResult"
          class="mt-2 rounded-md border border-warn bg-panel-2 p-2.5 text-[11.5px]"
        >
          <p>
            {{
              t('leitner.organisation.mergeSummary', {
                cards: taxonomyMergePreviewResult.cardsToMove,
                collisions: taxonomyMergePreviewResult.collisionCount,
              })
            }}
          </p>
          <button
            type="button"
            class="mt-2 w-full rounded-md border border-bad px-2.5 py-2 text-[12px] text-bad disabled:opacity-50"
            :disabled="actionLoading === 'merge'"
            @click="mergeTaxonomy"
          >
            {{ t('leitner.organisation.mergeConfirm') }}
          </button>
        </div>
      </section>
    </aside>
  </div>

  <ConfirmModal ref="confirmModal" />
</template>
