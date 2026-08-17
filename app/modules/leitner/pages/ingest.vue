<script setup lang="ts">
import { computed, onUnmounted, ref, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import { Head, Link, router } from '@inertiajs/vue3'
import AppLayout from '~/layouts/AppLayout.vue'
import IngestionTitle from '../components/IngestionTitle.vue'
import LeitnerTabs from '../components/LeitnerTabs.vue'
import { xsrfToken } from '../components/leitner_csrf'

defineOptions({ layout: AppLayout })

const { t } = useI18n()

type Source = 'paste' | 'file' | 'pdf'

interface Ingestion {
  id: number
  title: string | null
  status: 'pending' | 'running' | 'done' | 'failed'
  source: Source
  sourceName: string | null
  charCount: number
  chunkCount: number
  chunksDone: number
  cardsProposed: number
  error: string | null
  createdAt: string
  /** Ce que les brouillons sont devenus : à relire · devenus cartes · écartés. */
  drafts: { pending: number; accepted: number; rejected: number }
}

const props = defineProps<{
  ingestions: Ingestion[]
  maxChars: number
  titleMaxChars: number
  ingestErrors: string[] | null
}>()

const STATUS_LABELS = computed<Record<Ingestion['status'], string>>(() => ({
  pending: t('leitner.ingest.status.pending'),
  running: t('leitner.ingest.status.running'),
  done: t('leitner.ingest.status.done'),
  failed: t('leitner.ingest.status.failed'),
}))

const STATUS_CLASSES: Record<Ingestion['status'], string> = {
  pending: 'text-txt-2',
  running: 'text-accent',
  done: 'text-ok',
  failed: 'text-bad',
}

/** D'où sort le texte. Déclaratif depuis la prévisualisation : affiché, jamais interprété. */
const SOURCE_LABELS = computed<Record<Source, string>>(() => ({
  paste: t('leitner.ingest.source.paste'),
  file: t('leitner.ingest.source.file'),
  pdf: t('leitner.ingest.source.pdf'),
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
| L'historique se met à jour tout seul
|------------------------------------------------------------------------------
| Un travail tourne en tâche de fond : sans ça, sa ligne resterait figée jusqu'à ce
| qu'on change d'onglet et revienne. Même mécanique que la page de suivi — un
| rechargement partiel d'Inertia (`only: ['ingestions']`), sans route JSON.
|
| Et les deux mêmes pièges : on n'interroge QUE tant qu'un job est `pending`/`running`
| (sinon rien ne bougera plus, la boucle s'arrête), et l'intervalle est nettoyé au
| démontage — un setInterval qui survit à une navigation Inertia émet dans le vide.
*/
const POLL_INTERVAL_MS = 1_500

const hasActive = computed(() =>
  props.ingestions.some(
    (ingestion) => ingestion.status === 'pending' || ingestion.status === 'running'
  )
)

let timer: ReturnType<typeof setInterval> | null = null
const polling = ref(false)

function stopPolling(): void {
  if (timer === null) return
  clearInterval(timer)
  timer = null
}

function startPolling(): void {
  if (timer !== null) return

  timer = setInterval(() => {
    // Une requête à la fois : un serveur lent ne doit pas se faire empiler des recharges.
    if (polling.value) return
    polling.value = true

    router.reload({
      only: ['ingestions'],
      onFinish: () => (polling.value = false),
    })
  }, POLL_INTERVAL_MS)
}

watch(hasActive, (active) => (active ? startPolling() : stopPolling()), { immediate: true })
onUnmounted(stopPolling)

/*
| Soumission du cours — du texte, et rien que du texte.
|
| Le formulaire ne se « vide » plus après coup : le POST lance le travail en tâche de
| fond et redirige vers sa page de suivi (/revision/ingest/:id). On a changé de page,
| et cette page-ci reste vierge.
|
| L'URL du serveur LLM n'est PAS un champ de ce formulaire, et ne le sera jamais :
| elle vient de l'environnement (config/llm.ts). Pour la régler, l'onglet
| « Configuration » (/revision/llm) la teste et rend le bloc à coller dans .env.
*/
const title = ref('')
const text = ref('')
const submitting = ref(false)

// « Conserver ce cours dans la base » (CC-251) — cochée par défaut : le cours est créé
// AVANT le lancement du LLM, donc une ingestion `failed` laisse le cours intact.
const saveCourse = ref(true)

/*
|------------------------------------------------------------------------------
| Le champ fichier n'est plus une soumission : c'est un chargeur de texte
|------------------------------------------------------------------------------
| Prévisualiser veut dire que le texte existe AVANT le travail. Choisir un fichier
| (.txt · .md · .pdf) appelle donc /revision/ingest/extract, qui rend son texte et
| remplit le <textarea> — c'est ce texte-là, relu et corrigé, que le POST envoie.
|
| Le texte reste MODIFIABLE : couper la page de garde, la bibliographie ou les
| remerciements est l'usage normal, pas un contournement. Et sur un PDF à deux
| colonnes, l'extraction rend du charabia entrelacé : c'est une limite connue, et
| c'est exactement pour ça que cet écran existe — on le voit, on corrige, ou on renonce.
|
| ⚠️ `source` / `sourceName` partent donc du client (c'est lui qui a extrait) : ils
| sont DÉCLARATIFS. Le serveur les borne, les stocke et les affiche — jamais plus.
*/
const source = ref<Source>('paste')
const sourceName = ref<string | null>(null)
const extracting = ref(false)
const extractError = ref<string | null>(null)
const fileInput = ref<HTMLInputElement | null>(null)

async function pickFile(event: Event): Promise<void> {
  const input = event.target as HTMLInputElement
  const chosen = input.files?.[0]
  if (!chosen) return

  extracting.value = true
  extractError.value = null

  const body = new FormData()
  body.append('file', chosen)

  try {
    const response = await fetch('/revision/ingest/extract', {
      method: 'POST',
      // `accept` : sans lui, un refus du validateur devient une redirection Inertia
      // avec erreurs flashées, au lieu d'un 422 lisible ici.
      headers: { 'accept': 'application/json', 'x-xsrf-token': xsrfToken() },
      body,
    })

    const payload = (await response.json().catch(() => null)) as {
      ok?: boolean
      text?: string
      source?: Source
      sourceName?: string
      error?: string | null
      errors?: { message: string }[]
    } | null

    if (!response.ok) {
      // 422 : le validateur a refusé le fichier (type, taille).
      throw new Error(
        payload?.errors?.[0]?.message ??
          t('leitner.ingest.errors.serverStatus', { status: response.status })
      )
    }

    // L'échec d'extraction n'est pas une panne : c'est une réponse, et son message brut
    // est l'information utile (« scan », « protégé par mot de passe », « illisible »).
    if (!payload?.ok) throw new Error(payload?.error ?? t('leitner.ingest.errors.extractFailed'))

    text.value = payload.text ?? ''
    source.value = payload.source ?? 'file'
    sourceName.value = payload.sourceName ?? chosen.name
  } catch (error) {
    extractError.value = error instanceof Error ? error.message : String(error)
    // Le formulaire reste utilisable : on peut coller du texte à la place.
    input.value = ''
  } finally {
    extracting.value = false
  }
}

/** Repartir de zéro : le texte chargé s'oublie, et son origine avec lui. */
function clearFile(): void {
  text.value = ''
  extractError.value = null
  if (fileInput.value) fileInput.value.value = ''
}

// Un texte vidé n'a plus d'origine : annoncer « cours.pdf » sur ce qui sera collé à la
// main serait un faux nom dans l'historique, cosmétique mais gratuit.
watch(text, (value) => {
  if (value !== '') return
  source.value = 'paste'
  sourceName.value = null
})

const overCap = computed(() => text.value.length > props.maxChars)
const canSubmit = computed(
  () => !submitting.value && !extracting.value && !overCap.value && text.value.trim().length > 0
)

/**
 * Toute la ligne d'historique mène à son travail, pas seulement son titre — un lien
 * large de 3 mots dans une carte de 300 pixels ne se clique pas.
 *
 * Deux exceptions : le titre est **déjà** un `<Link>` (le laisser faire, sinon la
 * navigation partirait deux fois), et les contrôles de renommage (`data-no-nav`)
 * doivent pouvoir être cliqués sans quitter la page.
 */
function openIngestion(event: MouseEvent, id: number): void {
  if ((event.target as HTMLElement).closest('a, [data-no-nav]')) return
  router.get(`/revision/ingest/${id}`)
}

function submitCourse(): void {
  if (!canSubmit.value) return

  submitting.value = true
  router.post(
    '/revision/ingest',
    {
      title: title.value.trim() || null,
      text: text.value,
      source: source.value,
      sourceName: sourceName.value,
      saveCourse: saveCourse.value,
    },
    {
      onFinish: () => {
        submitting.value = false
      },
    }
  )
}
</script>

<template>
  <Head :title="t('leitner.ingest.title')" />

  <LeitnerTabs />

  <div class="mb-4">
    <div class="text-[18px] font-bold">{{ t('leitner.ingest.title') }}</div>
    <!-- Un seul mot en gras au milieu de la phrase : `<i18n-t>` garde la phrase comme une
         unité traduisible (slot `#emphasis`), sans `v-html` et sans la découper en morceaux. -->
    <i18n-t keypath="leitner.ingest.intro" tag="div" scope="global" class="text-[12.5px] text-txt-2">
      <template #emphasis><b>{{ t('leitner.ingest.introEmphasis') }}</b></template>
    </i18n-t>
  </div>

  <div class="grid grid-cols-[1fr_360px] items-start gap-4">
    <div class="flex flex-col gap-4">
      <!-- Soumission -->
      <form
        class="flex flex-col gap-2 rounded-[14px] border border-line bg-panel p-4"
        @submit.prevent="submitCourse"
      >
        <label class="text-[11px] tracking-[.1em] text-txt-3 uppercase" for="ingest-title">
          {{ t('leitner.ingest.form.titleLabel') }}
        </label>
        <input
          id="ingest-title"
          v-model="title"
          :maxlength="titleMaxChars"
          :placeholder="t('leitner.ingest.form.titlePlaceholder')"
          class="rounded-md border border-line-2 bg-panel-2 px-2.5 py-2 text-[12.5px] outline-none focus:border-accent"
        />

        <div class="mt-2 flex items-center gap-2">
          <label class="text-[11px] tracking-[.1em] text-txt-3 uppercase" for="ingest-text">
            {{ t('leitner.ingest.form.courseLabel') }}
          </label>
          <!-- D'où vient le texte à l'écran : une pastille, pas un titre. -->
          <span
            v-if="sourceName"
            class="rounded-md border border-line px-1.5 py-0.5 text-[11px] text-txt-2"
          >
            {{ sourceName }}
          </span>
          <button
            v-if="sourceName"
            type="button"
            class="text-[11px] text-txt-3 transition hover:text-accent"
            @click="clearFile"
          >
            {{ t('leitner.ingest.form.clear') }}
          </button>
        </div>
        <textarea
          id="ingest-text"
          v-model="text"
          rows="10"
          :disabled="extracting"
          :placeholder="
            extracting ? t('leitner.ingest.form.extracting') : t('leitner.ingest.form.coursePlaceholder')
          "
          class="resize-y rounded-md border border-line-2 bg-panel-2 px-2.5 py-2 text-[12.5px] outline-none focus:border-accent disabled:opacity-60"
        />

        <div class="flex items-center gap-3">
          <span
            class="text-[11.5px]"
            :class="overCap ? 'text-bad' : text.length ? 'text-txt-2' : 'text-txt-3'"
          >
            {{ text.length.toLocaleString('fr-FR') }} /
            {{ maxChars.toLocaleString('fr-FR') }} {{ t('leitner.ingest.form.charsUnit') }}
          </span>
          <span class="ml-auto text-[11.5px] text-txt-3">
            {{ extracting ? t('leitner.ingest.form.reading') : t('leitner.ingest.form.fileHint') }}
          </span>
          <input
            ref="fileInput"
            type="file"
            accept=".txt,.md,.pdf,text/plain,text/markdown,application/pdf"
            :disabled="extracting"
            class="max-w-[220px] text-[11.5px] text-txt-2 file:mr-2 file:rounded-md file:border file:border-line-2 file:bg-panel-2 file:px-2 file:py-1 file:text-[11.5px] file:text-txt-2 disabled:opacity-50"
            @change="pickFile"
          />
        </div>

        <!-- L'échec de l'extraction, brut, là où l'utilisateur regarde. Le formulaire
             reste utilisable : on peut coller le texte à la place. -->
        <p v-if="extractError" class="text-[11.5px] text-bad">{{ extractError }}</p>

        <p v-if="overCap" class="text-[11.5px] text-bad">
          {{ t('leitner.ingest.form.overCap') }}
        </p>

        <p v-else-if="source === 'pdf'" class="text-[11.5px] text-txt-3">
          {{ t('leitner.ingest.form.pdfHint') }}
        </p>

        <label class="flex items-center gap-1.5 text-[11.5px] text-txt-2">
          <input v-model="saveCourse" type="checkbox" class="accent-accent" />
          {{ t('leitner.ingest.form.saveCourse') }}
        </label>

        <button
          type="submit"
          class="mt-1 self-start rounded-[10px] border border-accent bg-accent px-3.5 py-2 text-[12.5px] text-white transition hover:opacity-90 disabled:opacity-50"
          :disabled="!canSubmit"
        >
          {{ submitting ? t('leitner.ingest.form.submitting') : t('leitner.ingest.form.submit') }}
        </button>

        <p class="text-[11.5px] text-txt-3">
          {{ t('leitner.ingest.form.backgroundNote') }}
        </p>
      </form>

      <!-- Retours de la dernière action -->
      <ul
        v-if="ingestErrors?.length"
        class="flex flex-col gap-1 rounded-[14px] border border-bad bg-panel p-4"
      >
        <li v-for="(error, index) in ingestErrors" :key="index" class="text-[11.5px] text-bad">
          {{ error }}
        </li>
      </ul>
    </div>

    <!-- Historique : un travail, un titre, une page. -->
    <div class="rounded-[14px] border border-line bg-panel p-4">
      <div class="mb-2 text-[11px] tracking-[.1em] text-txt-3 uppercase">
        {{ t('leitner.ingest.history.title') }}
      </div>

      <p v-if="!ingestions.length" class="text-[11.5px] text-txt-3">
        {{ t('leitner.ingest.history.empty') }}
      </p>

      <div
        v-for="ingestion in ingestions"
        :key="ingestion.id"
        class="mt-1 cursor-pointer rounded-md border border-line bg-panel-2 px-2.5 py-2 transition hover:border-accent"
        @click="openIngestion($event, ingestion.id)"
      >
        <IngestionTitle
          :id="ingestion.id"
          :title="ingestion.title"
          :max-chars="titleMaxChars"
          :href="`/revision/ingest/${ingestion.id}`"
          text-class="text-[12.5px] font-medium"
        />

        <div class="mt-1 flex items-center gap-2 text-[11px]">
          <span :class="STATUS_CLASSES[ingestion.status]" class="font-semibold">
            {{ STATUS_LABELS[ingestion.status] }}
          </span>
          <!-- L'origine est une pastille à côté du titre, jamais un titre. -->
          <span
            class="rounded-md border border-line px-1.5 py-0.5 text-txt-3"
            :title="ingestion.sourceName ?? undefined"
          >
            {{ SOURCE_LABELS[ingestion.source] }}
          </span>
          <span class="text-txt-3">
            {{ t('leitner.ingest.history.proposed', { n: ingestion.cardsProposed }) }}
          </span>
          <span class="ml-auto text-txt-3">{{ formatDate(ingestion.createdAt) }}</span>
        </div>

        <!-- Le sort des brouillons : ce qui reste à relire, ce qui est devenu carte,
             ce qui a été écarté. Un travail « terminé » dont tout a été rejeté et un
             travail dont tout attend encore ne se ressemblent pas. -->
        <div v-if="ingestion.cardsProposed" class="mt-1 flex items-center gap-3 text-[11px]">
          <span v-if="ingestion.drafts.pending" class="text-warn">
            {{ t('leitner.ingest.history.pending', { n: ingestion.drafts.pending }) }}
          </span>
          <span v-if="ingestion.drafts.accepted" class="text-ok">
            ✓ {{ t('leitner.ingest.history.accepted', { n: ingestion.drafts.accepted }) }}
          </span>
          <span v-if="ingestion.drafts.rejected" class="text-txt-3">
            ✕ {{ t('leitner.ingest.history.rejected', { n: ingestion.drafts.rejected }) }}
          </span>
        </div>
      </div>

      <Link
        v-if="ingestions.length"
        href="/revision/settings"
        class="mt-3 block text-[11.5px] text-txt-3 transition hover:text-accent"
      >
        {{ t('leitner.ingest.history.seeCards') }}
      </Link>
    </div>
  </div>
</template>
