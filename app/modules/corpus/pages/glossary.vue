<script setup lang="ts">
import { computed, onMounted, reactive, ref } from 'vue'
import { useI18n } from 'vue-i18n'
import { Head, Link, router } from '@inertiajs/vue3'
import AppLayout from '~/layouts/AppLayout.vue'
import AppModal from '~/components/AppModal.vue'
import { xsrfToken } from '../shared/csrf'

defineOptions({ layout: AppLayout })
interface Term {
  id: number
  term: string
  aliases: string[]
  definition: string
  definitionHtml: string
  isShared: boolean
  mine: boolean
  sectionId: number | null
}
const props = defineProps<{
  terms: Term[]
  sections: { id: number; label: string }[]
  canWrite: boolean
  prefill?: { term: string; definition: string; sectionId: number } | null
}>()
const { t } = useI18n()
const search = ref('')
const filtered = computed(() => {
  const query = search.value.trim().toLocaleLowerCase()
  return props.terms.filter((item) =>
    [item.term, ...item.aliases, item.definition].some((value) =>
      value.toLocaleLowerCase().includes(query)
    )
  )
})
const open = ref(false)
const editing = ref<number | null>(null)
const busy = ref(false)
const error = ref(false)
const success = ref(false)
const form = reactive({
  term: '',
  aliases: '',
  definition: '',
  isShared: false,
  sectionId: null as number | null,
})
onMounted(() => {
  if (props.canWrite && props.prefill) {
    Object.assign(form, props.prefill)
    open.value = true
  }
})
function edit(item?: Term) {
  editing.value = item?.id ?? null
  Object.assign(form, {
    term: item?.term ?? '',
    aliases: item?.aliases.join(', ') ?? '',
    definition: item?.definition ?? '',
    isShared: item?.isShared ?? false,
    sectionId: item?.sectionId ?? null,
  })
  error.value = false
  open.value = true
}
async function mutate(path: string, method: string, body?: unknown) {
  const response = await fetch(path, {
    method,
    headers: {
      'content-type': 'application/json',
      'accept': 'application/json',
      'x-xsrf-token': xsrfToken(),
    },
    ...(body ? { body: JSON.stringify(body) } : {}),
  })
  if (!response.ok) throw new Error(String(response.status))
}
async function save() {
  if (busy.value) return
  busy.value = true
  error.value = false
  try {
    await mutate(
      editing.value ? `/corpus/glossaire/${editing.value}` : '/corpus/glossaire',
      editing.value ? 'PUT' : 'POST',
      {
        ...form,
        aliases: form.aliases
          .split(',')
          .map((alias) => alias.trim())
          .filter(Boolean),
      }
    )
    open.value = false
    success.value = true
    router.reload()
  } catch {
    error.value = true
  } finally {
    busy.value = false
  }
}
async function remove(id: number) {
  if (busy.value) return
  busy.value = true
  error.value = false
  try {
    await mutate(`/corpus/glossaire/${id}`, 'DELETE')
    router.reload()
  } catch {
    error.value = true
  } finally {
    busy.value = false
  }
}
</script>

<template>
  <Head :title="t('corpus.glossary.title')" />
  <nav class="mb-6 flex gap-4 border-b border-line pb-3" :aria-label="t('corpus.index.crumb')">
    <Link href="/corpus">{{ t('corpus.index.title') }}</Link>
    <Link href="/corpus/glossaire" aria-current="page" class="text-accent">{{
      t('corpus.glossary.title')
    }}</Link>
  </nav>
  <div class="mb-6 flex items-start justify-between gap-4">
    <div>
      <h1 class="text-xl font-semibold">{{ t('corpus.glossary.title') }}</h1>
      <p class="mt-1 text-sm text-txt-2">{{ t('corpus.glossary.description') }}</p>
    </div>
    <button v-if="canWrite" class="rounded-lg bg-accent px-4 py-2 text-white" @click="edit()">
      {{ t('corpus.glossary.add') }}
    </button>
  </div>
  <label class="mb-4 block"
    >{{ t('corpus.glossary.search') }}
    <input
      v-model="search"
      type="search"
      class="mt-1 block w-full rounded-lg border border-line bg-panel p-3"
    />
  </label>
  <p v-if="error && !open" role="alert" class="mb-4 text-bad">{{ t('corpus.glossary.error') }}</p>
  <p v-if="success" role="status" class="mb-4 text-ok">{{ t('corpus.glossary.saved') }}</p>
  <p v-if="!filtered.length" class="py-8 text-center text-txt-2">
    {{ t('corpus.glossary.empty') }}
  </p>
  <div class="grid gap-3">
    <article
      v-for="item in filtered"
      :key="item.id"
      class="rounded-xl border border-line bg-panel p-5"
    >
      <div class="flex flex-wrap items-center justify-between gap-3">
        <h2 class="text-lg font-semibold">{{ item.term }}</h2>
        <div v-if="canWrite && item.mine" class="flex gap-3">
          <button @click="edit(item)">{{ t('corpus.glossary.edit') }}</button>
          <button class="text-bad" :disabled="busy" @click="remove(item.id)">
            {{ t('corpus.glossary.delete') }}
          </button>
        </div>
      </div>
      <p v-if="item.aliases.length" class="mt-1 text-sm text-txt-2">
        {{ item.aliases.join(', ') }}
      </p>
      <!-- HTML rendu et assaini par le serveur. -->
      <div class="markdown mt-3" v-html="item.definitionHtml"></div>
      <span class="mt-3 inline-block text-xs text-txt-2">{{
        t(item.isShared ? 'corpus.glossary.shared' : 'corpus.glossary.private')
      }}</span>
    </article>
  </div>
  <AppModal v-if="open" v-slot="{ titleId }" @close="!busy && (open = false)">
    <form
      class="mt-16 grid max-h-[80vh] w-[600px] max-w-[90vw] gap-4 overflow-y-auto rounded-xl border border-line bg-panel p-5"
      @submit.prevent="save"
    >
      <h2 :id="titleId" class="text-lg font-semibold">
        {{ t(editing ? 'corpus.glossary.edit' : 'corpus.glossary.add') }}
      </h2>
      <label
        >{{ t('corpus.glossary.term')
        }}<input
          v-model="form.term"
          required
          maxlength="200"
          class="mt-1 block w-full rounded border border-line bg-panel-2 p-2"
      /></label>
      <label
        >{{ t('corpus.glossary.aliases')
        }}<input
          v-model="form.aliases"
          class="mt-1 block w-full rounded border border-line bg-panel-2 p-2"
      /></label>
      <label
        >{{ t('corpus.glossary.definition')
        }}<textarea
          v-model="form.definition"
          required
          rows="6"
          class="mt-1 block w-full rounded border border-line bg-panel-2 p-2"
        />
      </label>
      <label
        >{{ t('corpus.glossary.section') }}
        <select
          v-model="form.sectionId"
          class="mt-1 block w-full rounded border border-line bg-panel-2 p-2"
        >
          <option :value="null">{{ t('corpus.glossary.noSection') }}</option>
          <option v-for="section in sections" :key="section.id" :value="section.id">
            {{ section.label }}
          </option>
        </select>
      </label>
      <label
        ><input v-model="form.isShared" type="checkbox" /> {{ t('corpus.glossary.share') }}</label
      >
      <p v-if="error" role="alert" class="text-bad">{{ t('corpus.glossary.error') }}</p>
      <div class="flex gap-4">
        <button :disabled="busy" class="rounded bg-accent px-4 py-2 text-white">
          {{ t('corpus.glossary.save') }}
        </button>
        <button type="button" :disabled="busy" @click="open = false">
          {{ t('corpus.glossary.cancel') }}
        </button>
      </div>
    </form>
  </AppModal>
</template>
