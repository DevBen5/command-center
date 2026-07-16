<script setup lang="ts">
import { computed, onUnmounted, reactive, ref, watch } from 'vue'
import { Head, Link, router } from '@inertiajs/vue3'
import AppLayout from '~/layouts/AppLayout.vue'
import IngestionTitle from '../components/IngestionTitle.vue'
import LeitnerTabs from '../components/LeitnerTabs.vue'
import TaxonomyCombobox from '../components/TaxonomyCombobox.vue'

defineOptions({ layout: AppLayout })

interface ThemeNode {
  id: number
  name: string
}

interface CategoryNode {
  id: number
  name: string
  themes: ThemeNode[]
}

interface Ingestion {
  id: number
  title: string | null
  status: 'pending' | 'running' | 'done' | 'failed'
  source: 'paste' | 'file'
  sourceName: string | null
  charCount: number
  chunkCount: number
  chunksDone: number
  cardsProposed: number
  error: string | null
  createdAt: string
}

interface Draft {
  id: number
  front: string
  back: string
  category: string | null
  theme: string | null
  status: 'pending' | 'accepted' | 'rejected'
}

const props = defineProps<{
  ingestion: Ingestion
  drafts: Draft[]
  categories: CategoryNode[]
  titleMaxChars: number
  promotionReport: { cardsCreated: number; cardsSkipped: number } | null
  ingestErrors: string[] | null
}>()

/*
|------------------------------------------------------------------------------
| L'interrogation périodique
|------------------------------------------------------------------------------
| Un **rechargement partiel d'Inertia**, pas une route JSON nue : on reste dans le
| fonctionnement natif du framework, sans CSRF ni sérialisation à gérer à la main.
|
| Deux règles, et ce sont deux pièges classiques :
|
| - on n'interroge QUE si le travail tourne. `done` et `failed` sont terminaux : la
|   boucle s'arrête, définitivement ;
| - l'intervalle est nettoyé au démontage. Un setInterval qui survit à une navigation
|   Inertia continue d'émettre des requêtes pour une page qui n'existe plus.
*/
const POLL_INTERVAL_MS = 1_500

const running = computed(
  () => props.ingestion.status === 'pending' || props.ingestion.status === 'running'
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
      // `drafts` autant qu'`ingestion` : les brouillons s'écrivent au fil de l'eau, et
      // la bascule en « terminé » n'a alors plus rien à aller chercher.
      only: ['ingestion', 'drafts'],
      onFinish: () => (polling.value = false),
    })
  }, POLL_INTERVAL_MS)
}

watch(running, (isRunning) => (isRunning ? startPolling() : stopPolling()), { immediate: true })
onUnmounted(stopPolling)

const percent = computed(() => {
  const { chunkCount, chunksDone } = props.ingestion
  if (chunkCount === 0) return 0
  return Math.round((chunksDone / chunkCount) * 100)
})

const STATUS_LABELS: Record<Ingestion['status'], string> = {
  pending: 'En attente',
  running: 'Analyse en cours',
  done: 'Terminée',
  failed: 'Échec',
}

const STATUS_CLASSES: Record<Ingestion['status'], string> = {
  pending: 'text-txt-2',
  running: 'text-accent',
  done: 'text-ok',
  failed: 'text-bad',
}

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
| Relecture des brouillons — le LLM propose, l'humain valide.
|------------------------------------------------------------------------------
*/

/** Copie locale éditable : le brouillon corrigé remplace ce que le modèle a proposé. */
const edited = reactive<
  Record<number, { front: string; back: string; category: string; theme: string }>
>({})

// Les brouillons arrivent au fil de l'eau : la copie locale se complète à chaque
// recharge, sans jamais écraser une correction en cours de saisie.
watch(
  () => props.drafts,
  (drafts) => {
    for (const draft of drafts) {
      if (edited[draft.id]) continue
      edited[draft.id] = {
        front: draft.front,
        back: draft.back,
        category: draft.category ?? '',
        theme: draft.theme ?? '',
      }
    }
  },
  { immediate: true }
)

const pendingDrafts = computed(() => props.drafts.filter((draft) => draft.status === 'pending'))

// La trace de ce que le modèle a proposé, et de ce qu'on en a fait. Un brouillon relu
// ne redevient jamais « en attente » : ces deux listes ne sont plus que de la mémoire.
const acceptedDrafts = computed(() => props.drafts.filter((draft) => draft.status === 'accepted'))
const rejectedDrafts = computed(() => props.drafts.filter((draft) => draft.status === 'rejected'))

const selected = ref<number[]>([])
const allSelected = computed(
  () => pendingDrafts.value.length > 0 && selected.value.length === pendingDrafts.value.length
)

function toggleAll(): void {
  selected.value = allSelected.value ? [] : pendingDrafts.value.map((draft) => draft.id)
}

/** Le thème seul n'a pas de sens : il appartient toujours à une catégorie. */
function halfClassified(id: number): boolean {
  const draft = edited[id]
  return Boolean(draft.category.trim()) !== Boolean(draft.theme.trim())
}

/**
 * Les thèmes déjà existants sous une catégorie donnée, par son nom (casse ignorée).
 *
 * C'est ce qui fait « dépendre » le thème de la catégorie : tant qu'aucune catégorie
 * connue n'est choisie, il n'y a rien à suggérer ; une catégorie inventée n'a, par
 * définition, aucun thème existant — il sera créé à la volée à la validation.
 */
function themesFor(categoryName: string): string[] {
  const name = categoryName.trim().toLowerCase()
  if (name === '') return []

  const match = props.categories.find((category) => category.name.toLowerCase() === name)
  return match ? match.themes.map((theme) => theme.name) : []
}

/** Les catégories existantes, proposées au sélecteur — sans en imposer aucune. */
const categoryNames = computed(() => props.categories.map((category) => category.name))

/** Le brouillon tel qu'il est **à l'écran** — la correction, pas ce qu'en dit la base. */
function correctionOf(id: number) {
  const draft = edited[id]
  return {
    id,
    front: draft.front,
    back: draft.back,
    category: draft.category.trim() || null,
    theme: draft.theme.trim() || null,
  }
}

/** Y a-t-il quelque chose à enregistrer ? Sinon le bouton n'a rien à faire. */
function isDirty(id: number): boolean {
  const original = props.drafts.find((draft) => draft.id === id)
  if (!original) return false

  const current = correctionOf(id)
  return (
    current.front !== original.front ||
    current.back !== original.back ||
    current.category !== original.category ||
    current.theme !== original.theme
  )
}

/** Enregistrer les modifications : le brouillon reste un brouillon. Aucune carte créée. */
function saveDraft(id: number): void {
  router.put(`/revision/ingest/drafts/${id}`, correctionOf(id), { preserveScroll: true })
}

/**
 * Valider = créer les cartes (boîte 1, dues aujourd'hui) via le catalogue.
 *
 * ⚠️ La requête **emporte la correction en cours** : valider, c'est valider ce qu'on a
 * sous les yeux. Le serveur l'enregistre avant de promouvoir, dans la même requête —
 * sans ça, la carte naîtrait avec le texte du modèle et la relecture serait perdue.
 */
function accept(ids: number[]): void {
  if (ids.length === 0) return
  router.post(
    '/revision/ingest/drafts/accept',
    { drafts: ids.map(correctionOf) },
    { preserveScroll: true }
  )
  selected.value = []
}

function reject(ids: number[]): void {
  if (ids.length === 0) return
  router.post('/revision/ingest/drafts/reject', { ids }, { preserveScroll: true })
  selected.value = []
}

function destroyIngestion(): void {
  if (!confirm('Supprimer cette ingestion et ses brouillons ? Les cartes validées restent.')) return
  router.delete(`/revision/ingest/${props.ingestion.id}`)
}
</script>

<template>
  <Head :title="ingestion.title ?? 'Ingestion'" />

  <LeitnerTabs />

  <div class="mb-4 flex items-center gap-2">
    <Link href="/revision/ingest" class="text-[12.5px] text-txt-3 transition hover:text-accent">
      ← Ingestion
    </Link>
  </div>

  <!-- En-tête du travail : son titre (renommable), son origine, son statut. -->
  <div class="mb-4 rounded-[14px] border border-line bg-panel p-4">
    <div class="flex items-center gap-2">
      <IngestionTitle
        :id="ingestion.id"
        :title="ingestion.title"
        :max-chars="titleMaxChars"
        text-class="text-[18px] font-bold"
      />

      <button
        type="button"
        class="ml-auto shrink-0 text-[11.5px] text-txt-3 transition hover:text-bad"
        @click="destroyIngestion"
      >
        Supprimer
      </button>
    </div>

    <div class="mt-2 flex items-center gap-2 text-[11.5px]">
      <span class="font-semibold" :class="STATUS_CLASSES[ingestion.status]">
        {{ STATUS_LABELS[ingestion.status] }}
      </span>
      <!-- L'origine reste une donnée utile : elle s'affiche à côté du titre, pas à sa place. -->
      <span class="rounded-md border border-line px-1.5 py-0.5 text-txt-3">
        {{ ingestion.source === 'file' ? `Fichier · ${ingestion.sourceName}` : 'Texte collé' }}
      </span>
      <span class="text-txt-3"> {{ ingestion.charCount.toLocaleString('fr-FR') }} caractères </span>
      <span class="text-txt-3">{{ ingestion.cardsProposed }} carte(s) proposée(s)</span>
      <span class="ml-auto text-txt-3">{{ formatDate(ingestion.createdAt) }}</span>
    </div>
  </div>

  <!-- Le travail tourne : la barre avance pour de vrai (chunks_done / chunk_count). -->
  <div v-if="running" class="mb-4 rounded-[14px] border border-line bg-panel p-4">
    <div class="mb-2 flex items-center gap-2 text-[12.5px]">
      <span class="text-txt-2">
        {{
          ingestion.status === 'pending'
            ? "Le travail est en file d'attente…"
            : 'Le modèle analyse le cours, morceau par morceau.'
        }}
      </span>
      <span class="ml-auto text-txt-3">
        {{ ingestion.chunksDone }} / {{ ingestion.chunkCount }} morceau(x) · {{ percent }} %
      </span>
    </div>

    <div class="h-2 w-full overflow-hidden rounded-full bg-panel-2">
      <div
        class="h-full rounded-full bg-accent transition-[width] duration-500"
        :style="{ width: `${percent}%` }"
      />
    </div>

    <p class="mt-2 text-[11.5px] text-txt-3">
      Tu peux quitter cette page : le travail continue côté serveur, et tu la retrouveras à jour.
    </p>
  </div>

  <!-- Échec : le message brut, celui du serveur. -->
  <div
    v-if="ingestion.status === 'failed'"
    class="mb-4 rounded-[14px] border border-bad bg-panel p-4"
  >
    <div class="text-[12.5px] font-semibold text-bad">L'analyse a échoué.</div>
    <p class="mt-1 font-mono text-[11.5px] break-words text-txt-2">{{ ingestion.error }}</p>

    <div v-if="ingestion.cardsProposed > 0" class="mt-2 text-[11.5px] text-warn">
      {{ ingestion.cardsProposed }} carte(s) avaient déjà été proposées avant l'échec : elles sont
      ci-dessous, relisibles telles quelles.
    </div>

    <Link
      href="/revision/ingest"
      class="mt-3 inline-block rounded-[10px] border border-accent bg-accent px-3 py-1.5 text-[12px] text-white transition hover:opacity-90"
    >
      Relancer une analyse
    </Link>
  </div>

  <!-- Terminé -->
  <div
    v-if="ingestion.status === 'done'"
    class="mb-4 rounded-[14px] border border-ok bg-panel p-4 text-[12.5px] text-txt-2"
  >
    <span class="font-semibold text-ok">
      Terminé — {{ ingestion.cardsProposed }} carte(s) proposée(s).
    </span>
    Relis-les : rien n'entre en base sans ta validation.
  </div>

  <!-- Retours de la dernière action -->
  <ul
    v-if="ingestErrors?.length"
    class="mb-4 flex flex-col gap-1 rounded-[14px] border border-bad bg-panel p-4"
  >
    <li v-for="(error, index) in ingestErrors" :key="index" class="text-[11.5px] text-bad">
      {{ error }}
    </li>
  </ul>

  <div
    v-if="promotionReport"
    class="mb-4 rounded-[14px] border border-ok bg-panel p-4 text-[11.5px] text-txt-2"
  >
    <span class="font-semibold text-ok">{{ promotionReport.cardsCreated }} carte(s) créée(s)</span>
    — boîte 1, dues aujourd'hui.
    <span v-if="promotionReport.cardsSkipped" class="text-warn">
      {{ promotionReport.cardsSkipped }} ignorée(s) : ce recto existait déjà sous ce thème.
    </span>
  </div>

  <!-- Brouillons à relire -->
  <div v-if="pendingDrafts.length" class="rounded-[14px] border border-line bg-panel">
    <div class="flex items-center gap-3 border-b border-line px-4 py-3">
      <label class="flex items-center gap-2 text-[12.5px] text-txt-2">
        <input type="checkbox" :checked="allSelected" @change="toggleAll" />
        {{ selected.length }} / {{ pendingDrafts.length }} sélectionnée(s)
      </label>
      <button
        type="button"
        class="ml-auto rounded-md border border-accent bg-accent px-2.5 py-1.5 text-[12px] text-white transition hover:opacity-90 disabled:opacity-40"
        :disabled="!selected.length"
        @click="accept(selected)"
      >
        Valider la sélection
      </button>
      <button
        type="button"
        class="rounded-md border border-line-2 bg-panel-2 px-2.5 py-1.5 text-[12px] text-txt-2 transition hover:border-bad hover:text-bad disabled:opacity-40"
        :disabled="!selected.length"
        @click="reject(selected)"
      >
        Rejeter
      </button>
    </div>

    <div
      v-for="draft in pendingDrafts"
      :key="draft.id"
      class="flex gap-3 border-b border-line px-4 py-3 last:border-b-0"
    >
      <input v-model="selected" type="checkbox" :value="draft.id" class="mt-1" />

      <div class="flex flex-1 flex-col gap-2">
        <textarea
          v-model="edited[draft.id].front"
          rows="2"
          class="resize-y rounded-md border border-line-2 bg-panel-2 px-2.5 py-1.5 text-[12.5px] outline-none focus:border-accent"
        />
        <textarea
          v-model="edited[draft.id].back"
          rows="2"
          class="resize-y rounded-md border border-line-2 bg-panel-2 px-2.5 py-1.5 text-[12.5px] text-txt-2 outline-none focus:border-accent"
        />

        <div class="flex items-center gap-2">
          <!-- Clic sur la flèche = toute la liste, même si le champ est déjà rempli ;
               les lettres filtrent ensuite. Les thèmes dépendent de la catégorie
               saisie ; les deux champs restent libres (création à la validation). -->
          <TaxonomyCombobox
            v-model="edited[draft.id].category"
            :options="categoryNames"
            placeholder="Catégorie"
          />
          <TaxonomyCombobox
            v-model="edited[draft.id].theme"
            :options="themesFor(edited[draft.id].category)"
            :disabled="!edited[draft.id].category.trim()"
            :placeholder="edited[draft.id].category.trim() ? 'Thème' : 'Thème — catégorie d’abord'"
          />

          <span v-if="halfClassified(draft.id)" class="text-[11px] text-warn">
            Catégorie et thème vont ensemble.
          </span>

          <!-- Enregistrer : le brouillon reste un brouillon (on y reviendra plus tard).
               Valider : il devient une carte — en emportant la correction ci-dessus. -->
          <button
            type="button"
            class="ml-auto rounded-md border border-line-2 bg-panel-2 px-2 py-1 text-[11.5px] text-txt-2 transition hover:border-accent hover:text-txt disabled:opacity-40"
            :disabled="!isDirty(draft.id)"
            title="Corriger le brouillon sans le valider"
            @click="saveDraft(draft.id)"
          >
            Enregistrer les modifications
          </button>
          <button
            type="button"
            class="rounded-md border border-accent bg-accent px-2 py-1 text-[11.5px] text-white transition hover:opacity-90"
            title="Créer la carte (boîte 1, due aujourd'hui)"
            @click="accept([draft.id])"
          >
            Valider
          </button>
          <button
            type="button"
            class="rounded-md border border-line-2 bg-panel-2 px-2 py-1 text-[11.5px] text-txt-3 transition hover:border-bad hover:text-bad"
            @click="reject([draft.id])"
          >
            Rejeter
          </button>
        </div>
      </div>
    </div>
  </div>

  <div
    v-else-if="ingestion.status === 'done'"
    class="rounded-[14px] border border-line bg-panel p-4 text-[12.5px] text-txt-3"
  >
    Aucun brouillon en attente sur cette ingestion.
  </div>

  <!-- Ce que le modèle a proposé, et ce qu'on en a fait. -->
  <div class="mt-4 grid grid-cols-2 items-start gap-4">
    <div v-if="acceptedDrafts.length" class="rounded-[14px] border border-line bg-panel p-4">
      <div class="mb-2 flex items-center gap-2">
        <span class="text-[11px] tracking-[.1em] text-ok uppercase">
          Validées ({{ acceptedDrafts.length }})
        </span>
        <Link
          href="/revision/settings"
          class="ml-auto text-[11px] text-txt-3 transition hover:text-accent"
        >
          Voir les cartes →
        </Link>
      </div>

      <div
        v-for="draft in acceptedDrafts"
        :key="draft.id"
        class="flex items-center gap-2 py-1 text-[11.5px]"
      >
        <span class="shrink-0 text-ok">✓</span>
        <span class="truncate text-txt-2">{{ draft.front }}</span>
        <span v-if="draft.theme" class="ml-auto shrink-0 text-[11px] text-txt-3">
          {{ draft.category }} · {{ draft.theme }}
        </span>
      </div>
    </div>

    <div v-if="rejectedDrafts.length" class="rounded-[14px] border border-line bg-panel p-4">
      <!-- Un brouillon rejeté reste en base : la trace de ce que le modèle a proposé,
           et il ne redevient jamais « en attente ». -->
      <div class="mb-2 text-[11px] tracking-[.1em] text-txt-3 uppercase">
        Rejetées ({{ rejectedDrafts.length }})
      </div>

      <div
        v-for="draft in rejectedDrafts"
        :key="draft.id"
        class="flex items-center gap-2 py-1 text-[11.5px]"
      >
        <span class="shrink-0 text-txt-3">✕</span>
        <span class="truncate text-txt-3 line-through">{{ draft.front }}</span>
      </div>
    </div>
  </div>

</template>
