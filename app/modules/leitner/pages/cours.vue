<script setup lang="ts">
import { computed, ref } from 'vue'
import { useI18n } from 'vue-i18n'
import { Head, Link, router } from '@inertiajs/vue3'
import AppLayout from '~/layouts/AppLayout.vue'
import CourseConflictDialog from '../components/CourseConflictDialog.vue'
import LeitnerTabs from '../components/LeitnerTabs.vue'
import { xsrfToken } from '../components/leitner_csrf'

defineOptions({ layout: AppLayout })

const { t } = useI18n()

type Source = 'paste' | 'file' | 'ingest'

interface Course {
  id: number
  title: string
  source: Source
  isShared: boolean
  mine: boolean
  createdAt: string
}

const props = defineProps<{ courses: Course[] }>()

const SOURCE_LABELS = computed<Record<Source, string>>(() => ({
  paste: t('leitner.cours.source.paste'),
  file: t('leitner.cours.source.file'),
  ingest: t('leitner.cours.source.ingest'),
}))

function formatDate(iso: string): string {
  return new Date(iso).toLocaleDateString('fr-FR', {
    day: 'numeric',
    month: 'short',
    hour: '2-digit',
    minute: '2-digit',
  })
}

/*
|------------------------------------------------------------------------------
| Le formulaire d'ajout — markdown collé ou fichier .md lu côté client
|------------------------------------------------------------------------------
| Un fichier .md n'a besoin d'aucune extraction serveur : FileReader suffit. `source`
| reste déclarative, comme sur l'ingestion — la page dit d'où vient le texte.
*/
const title = ref('')
const markdown = ref('')
const source = ref<Source>('paste')
const fileInput = ref<HTMLInputElement | null>(null)
const submitting = ref(false)
const submitError = ref<string | null>(null)

function pickFile(event: Event): void {
  const input = event.target as HTMLInputElement
  const chosen = input.files?.[0]
  if (!chosen) return

  const reader = new FileReader()
  reader.onload = () => {
    markdown.value = String(reader.result ?? '')
    source.value = 'file'
  }
  reader.readAsText(chosen)
}

function clearFile(): void {
  source.value = 'paste'
  if (fileInput.value) fileInput.value.value = ''
}

const canSubmit = computed(() => !submitting.value && title.value.trim().length > 0 && markdown.value.trim().length > 0)

/*
|------------------------------------------------------------------------------
| Le conflit de titre — dialogue à 3 issues
|------------------------------------------------------------------------------
| Le markdown soumis reste dans `markdown`/`title` (l'utilisateur n'a rien perdu) tant
| que le dialogue n'a pas résolu — jamais renvoyé au serveur avant un choix explicite.
*/
const conflict = ref<{ existingId: number; existingTitle: string } | null>(null)

async function postJson(path: string, body: unknown): Promise<Response> {
  return fetch(path, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'accept': 'application/json',
      'x-xsrf-token': xsrfToken(),
    },
    body: JSON.stringify(body),
  })
}

async function submitCourse(): Promise<void> {
  if (!canSubmit.value) return

  submitting.value = true
  submitError.value = null

  try {
    const response = await postJson('/revision/cours', {
      title: title.value.trim(),
      markdown: markdown.value,
      source: source.value,
    })
    const payload = (await response.json().catch(() => null)) as {
      status?: string
      course?: { id: number }
      existing?: { id: number; title: string }
      error?: string
    } | null

    if (!response.ok) {
      submitError.value = payload?.error ?? t('leitner.cours.errors.serverStatus', { status: response.status })
      return
    }

    if (payload?.status === 'conflict' && payload.existing) {
      conflict.value = { existingId: payload.existing.id, existingTitle: payload.existing.title }
      return
    }

    if (payload?.course) router.visit(`/revision/cours/${payload.course.id}`)
  } finally {
    submitting.value = false
  }
}

async function resolveConflict(resolution: 'replace' | 'createSecond' | 'cancel'): Promise<void> {
  if (!conflict.value) return

  if (resolution === 'cancel') {
    conflict.value = null
    return
  }

  submitting.value = true
  try {
    const response = await postJson('/revision/cours/conflict', {
      existingId: conflict.value.existingId,
      resolution,
      title: title.value.trim(),
      markdown: markdown.value,
      source: source.value,
    })
    const payload = (await response.json().catch(() => null)) as {
      status?: string
      course?: { id: number }
      error?: string
    } | null

    if (!response.ok) {
      submitError.value = payload?.error ?? t('leitner.cours.errors.serverStatus', { status: response.status })
      return
    }

    conflict.value = null
    if (payload?.course) router.visit(`/revision/cours/${payload.course.id}`)
  } finally {
    submitting.value = false
  }
}

function openCourse(event: MouseEvent, id: number): void {
  if ((event.target as HTMLElement).closest('a')) return
  router.get(`/revision/cours/${id}`)
}
</script>

<template>
  <Head :title="t('leitner.cours.title')" />

  <LeitnerTabs />

  <div class="mb-4">
    <div class="text-[18px] font-bold">{{ t('leitner.cours.title') }}</div>
    <div class="text-[12.5px] text-txt-2">{{ t('leitner.cours.intro') }}</div>
  </div>

  <div class="grid grid-cols-[1fr_360px] items-start gap-4">
    <form
      class="flex flex-col gap-2 rounded-[14px] border border-line bg-panel p-4"
      @submit.prevent="submitCourse"
    >
      <label class="text-[11px] tracking-[.1em] text-txt-3 uppercase" for="course-title">
        {{ t('leitner.cours.form.titleLabel') }}
      </label>
      <input
        id="course-title"
        v-model="title"
        class="rounded-md border border-line-2 bg-panel-2 px-2.5 py-2 text-[12.5px] outline-none focus:border-accent"
      />

      <div class="mt-2 flex items-center gap-2">
        <label class="text-[11px] tracking-[.1em] text-txt-3 uppercase" for="course-markdown">
          {{ t('leitner.cours.form.markdownLabel') }}
        </label>
        <button
          v-if="source === 'file'"
          type="button"
          class="text-[11px] text-txt-3 transition hover:text-accent"
          @click="clearFile"
        >
          {{ t('leitner.cours.form.clear') }}
        </button>
      </div>
      <textarea
        id="course-markdown"
        v-model="markdown"
        rows="12"
        :placeholder="t('leitner.cours.form.markdownPlaceholder')"
        class="resize-y rounded-md border border-line-2 bg-panel-2 px-2.5 py-2 text-[12.5px] outline-none focus:border-accent"
      />

      <div class="flex items-center gap-3">
        <span class="ml-auto text-[11.5px] text-txt-3">{{ t('leitner.cours.form.fileHint') }}</span>
        <input
          ref="fileInput"
          type="file"
          accept=".md,text/markdown"
          class="max-w-[220px] text-[11.5px] text-txt-2 file:mr-2 file:rounded-md file:border file:border-line-2 file:bg-panel-2 file:px-2 file:py-1 file:text-[11.5px] file:text-txt-2"
          @change="pickFile"
        />
      </div>

      <p v-if="submitError" class="text-[11.5px] text-bad">{{ submitError }}</p>

      <button
        type="submit"
        class="mt-1 self-start rounded-[10px] border border-accent bg-accent px-3.5 py-2 text-[12.5px] text-white transition hover:opacity-90 disabled:opacity-50"
        :disabled="!canSubmit"
      >
        {{ submitting ? t('leitner.cours.form.submitting') : t('leitner.cours.form.submit') }}
      </button>
    </form>

    <div class="rounded-[14px] border border-line bg-panel p-4">
      <div class="mb-2 text-[11px] tracking-[.1em] text-txt-3 uppercase">
        {{ t('leitner.cours.list.title') }}
      </div>

      <p v-if="!props.courses.length" class="text-[11.5px] text-txt-3">
        {{ t('leitner.cours.list.empty') }}
      </p>

      <div
        v-for="course in props.courses"
        :key="course.id"
        class="mt-1 cursor-pointer rounded-md border border-line bg-panel-2 px-2.5 py-2 transition hover:border-accent"
        @click="openCourse($event, course.id)"
      >
        <Link :href="`/revision/cours/${course.id}`" class="text-[12.5px] font-medium hover:text-accent">
          {{ course.title }}
        </Link>
        <div class="mt-1 flex items-center gap-2 text-[11px] text-txt-3">
          <span class="rounded-md border border-line px-1.5 py-0.5">
            {{ SOURCE_LABELS[course.source] }}
          </span>
          <span v-if="course.isShared" class="text-ok">{{ t('leitner.cours.list.shared') }}</span>
          <span class="ml-auto">{{ formatDate(course.createdAt) }}</span>
        </div>
      </div>
    </div>
  </div>

  <CourseConflictDialog
    v-if="conflict"
    :existing-title="conflict.existingTitle"
    @replace="resolveConflict('replace')"
    @create-second="resolveConflict('createSecond')"
    @cancel="resolveConflict('cancel')"
  />
</template>
