<script setup lang="ts">
import { computed, nextTick, onMounted, ref } from 'vue'
import { useI18n } from 'vue-i18n'
import { Head, router } from '@inertiajs/vue3'
import AppLayout from '~/layouts/AppLayout.vue'
import ConfirmModal from '~/components/ConfirmModal.vue'
import LeitnerTabs from '../components/LeitnerTabs.vue'
import { useCan } from '../components/leitner_can'
import { xsrfToken } from '../components/leitner_csrf'
import { sectionAnchorId } from '../shared/course_section_link'

defineOptions({ layout: AppLayout })

const { t } = useI18n()
const { isAdmin } = useCan()

interface Course {
  id: number
  title: string
  markdown: string
  source: 'paste' | 'file' | 'ingest'
  isShared: boolean
  mine: boolean
  createdAt: string
}

interface Section {
  id: number
  slug: string
  headingPath: string[]
  bodyHtml: string
  aliases: string[] | null
  obsoleteAt: string | null
}

const props = defineProps<{ course: Course; sections: Section[] }>()

const canWrite = computed(() => props.course.mine || isAdmin.value)
const hasTombstones = computed(() => props.sections.some((section) => section.obsoleteAt !== null))

const confirmModal = ref<InstanceType<typeof ConfirmModal> | null>(null)

/*
|------------------------------------------------------------------------------
| Le remplacement — JSON nu, jamais un POST Inertia classique
|------------------------------------------------------------------------------
| Même raison que la création : le store de session est `cookie`, un échec de
| validation flasherait le markdown entier dedans. Voir le contrôleur.
*/
const editing = ref(false)
const editableMarkdown = ref(props.course.markdown)
const saving = ref(false)
const saveError = ref<string | null>(null)

function startEdit(): void {
  editableMarkdown.value = props.course.markdown
  saveError.value = null
  editing.value = true
}

async function saveReplace(): Promise<void> {
  if (!editableMarkdown.value.trim()) return

  saving.value = true
  saveError.value = null

  try {
    const response = await fetch(`/revision/cours/${props.course.id}`, {
      method: 'PUT',
      headers: {
        'content-type': 'application/json',
        'accept': 'application/json',
        'x-xsrf-token': xsrfToken(),
      },
      body: JSON.stringify({ markdown: editableMarkdown.value }),
    })
    const payload = (await response.json().catch(() => null)) as { error?: string } | null

    if (!response.ok) {
      saveError.value = payload?.error ?? t('leitner.coursShow.errors.serverStatus', { status: response.status })
      return
    }

    editing.value = false
    // Recharge la page entière : sections (retrouvées/neuves/tombées) recalculées
    // côté serveur, le remplacement n'est jamais rejoué côté client.
    router.reload()
  } finally {
    saving.value = false
  }
}

async function destroyCourse(): Promise<void> {
  const confirmed = await confirmModal.value?.ask(
    t('leitner.coursShow.confirmDelete', { title: props.course.title }),
    { danger: true }
  )
  if (!confirmed) return
  router.delete(`/revision/cours/${props.course.id}`)
}

async function purgeTombstones(): Promise<void> {
  const confirmed = await confirmModal.value?.ask(t('leitner.coursShow.confirmPurge'), { danger: true })
  if (!confirmed) return
  router.post(`/revision/cours/${props.course.id}/purge`)
}

/*
|------------------------------------------------------------------------------
| Le défilement vers l'ancre (CC-273) — jamais le hash natif du navigateur
|------------------------------------------------------------------------------
| Le conteneur défilant est le panneau `overflow-y-auto` d'`AppLayout`, pas
| `window` (même piège que CC-67) : le mécanisme natif de saut à `#ancre` ne
| ferait rien de visible ici. `nextTick()` avant de chercher l'élément : sans
| lui, on mesurerait un DOM que Vue n'a pas encore écrit (même piège que
| `scrollTopKeepingAnchor`, CC-67).
*/
onMounted(async () => {
  if (!window.location.hash) return
  await nextTick()
  document.getElementById(window.location.hash.slice(1))?.scrollIntoView({ block: 'start' })
})
</script>

<template>
  <Head :title="course.title" />

  <LeitnerTabs />

  <div class="mb-4 flex items-start justify-between gap-3">
    <div>
      <div class="text-[18px] font-bold">{{ course.title }}</div>
      <div v-if="!course.mine" class="text-[11.5px] text-txt-3">
        {{ t('leitner.coursShow.notMineHint') }}
      </div>
    </div>
    <div v-if="canWrite" class="flex shrink-0 items-center gap-2">
      <button
        v-if="hasTombstones"
        type="button"
        class="rounded-[10px] border border-line-2 bg-panel-2 px-3 py-1.5 text-[12px] transition hover:border-accent"
        @click="purgeTombstones"
      >
        {{ t('leitner.coursShow.purgeTombstones') }}
      </button>
      <button
        type="button"
        class="rounded-[10px] border border-line-2 bg-panel-2 px-3 py-1.5 text-[12px] transition hover:border-accent"
        @click="startEdit"
      >
        {{ t('leitner.coursShow.replace') }}
      </button>
      <button
        type="button"
        class="rounded-[10px] border border-bad px-3 py-1.5 text-[12px] text-bad transition hover:bg-bad hover:text-white"
        @click="destroyCourse"
      >
        {{ t('leitner.coursShow.delete') }}
      </button>
    </div>
  </div>

  <!-- Remplacement du contenu -->
  <div v-if="editing" class="mb-4 rounded-[14px] border border-line bg-panel p-4">
    <div class="mb-2 text-[11px] tracking-[.1em] text-txt-3 uppercase">
      {{ t('leitner.coursShow.replace') }}
    </div>
    <textarea
      v-model="editableMarkdown"
      rows="16"
      class="w-full resize-y rounded-md border border-line-2 bg-panel-2 px-2.5 py-2 text-[12.5px] outline-none focus:border-accent"
    />
    <p v-if="saveError" class="mt-2 text-[11.5px] text-bad">{{ saveError }}</p>
    <div class="mt-2 flex gap-2">
      <button
        type="button"
        class="rounded-[10px] border border-accent bg-accent px-3.5 py-2 text-[12.5px] text-white transition hover:opacity-90 disabled:opacity-50"
        :disabled="saving || !editableMarkdown.trim()"
        @click="saveReplace"
      >
        {{ saving ? t('leitner.coursShow.saving') : t('leitner.coursShow.save') }}
      </button>
      <button
        type="button"
        class="rounded-[10px] border border-line-2 bg-panel-2 px-3.5 py-2 text-[12.5px] transition hover:border-accent"
        @click="editing = false"
      >
        {{ t('leitner.coursShow.cancel') }}
      </button>
    </div>
  </div>

  <!-- Les sections -->
  <div class="flex flex-col gap-3">
    <div
      v-for="section in sections"
      :id="sectionAnchorId(section.id)"
      :key="section.id"
      class="rounded-[14px] border p-4"
      :class="section.obsoleteAt ? 'border-line bg-panel/60 opacity-60' : 'border-line bg-panel'"
    >
      <div class="mb-1 flex items-center gap-2 text-[11px] text-txt-3">
        <span>{{ section.headingPath.length ? section.headingPath.join(' › ') : t('leitner.coursShow.introduction') }}</span>
        <span v-if="section.obsoleteAt" class="rounded-md border border-line px-1.5 py-0.5 text-warn">
          {{ t('leitner.coursShow.obsolete') }}
        </span>
        <span v-if="section.aliases?.length" class="rounded-md border border-line px-1.5 py-0.5">
          {{ t('leitner.coursShow.glossary') }} · {{ section.aliases.join(', ') }}
        </span>
      </div>
      <!-- Le HTML vient de `renderMarkdown`, côté serveur — jamais construit ici. -->
      <div class="markdown text-[13px]" v-html="section.bodyHtml"></div>
    </div>

    <p v-if="!sections.length" class="text-[11.5px] text-txt-3">
      {{ t('leitner.coursShow.empty') }}
    </p>
  </div>

  <ConfirmModal ref="confirmModal" />
</template>
