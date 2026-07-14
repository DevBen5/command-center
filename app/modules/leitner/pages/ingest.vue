<script setup lang="ts">
import { computed, reactive, ref } from 'vue'
import { Head, Link, router } from '@inertiajs/vue3'
import AppLayout from '~/layouts/AppLayout.vue'

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
  ingestions: Ingestion[]
  current: Ingestion | null
  drafts: Draft[]
  categories: CategoryNode[]
  maxChars: number
  promotionReport: { cardsCreated: number; cardsSkipped: number } | null
  ingestErrors: string[] | null
}>()

const STATUS_LABELS: Record<Ingestion['status'], string> = {
  pending: 'En attente',
  running: 'En cours',
  done: 'Terminée',
  failed: 'Échec',
}

/*
| Soumission du cours — texte collé ou fichier .txt / .md.
|
| L'URL du serveur LLM n'est PAS un champ de ce formulaire, et ne le sera jamais :
| elle vient de l'environnement (config/llm.ts). Un champ « URL du serveur » ferait
| émettre au serveur des requêtes vers l'hôte du choix de qui remplit le formulaire.
*/
const text = ref('')
const file = ref<File | null>(null)
const fileInput = ref<HTMLInputElement | null>(null)
const submitting = ref(false)

function pickFile(event: Event): void {
  file.value = (event.target as HTMLInputElement).files?.[0] ?? null
}

// Le compteur ne vaut que pour le texte collé : la taille d'un fichier est vérifiée
// côté serveur, après lecture (c'est son contenu qui compte, pas son poids sur disque).
const overCap = computed(() => text.value.length > props.maxChars)
const canSubmit = computed(
  () => !submitting.value && !overCap.value && (file.value !== null || text.value.trim().length > 0)
)

// Synchrone : la requête attend le LLM, morceau par morceau. Ça peut durer.
function submitCourse(): void {
  if (!canSubmit.value) return

  submitting.value = true
  router.post(
    '/revision/ingest',
    { text: text.value, file: file.value },
    {
      onFinish: () => {
        submitting.value = false
      },
      onSuccess: () => {
        text.value = ''
        file.value = null
        if (fileInput.value) fileInput.value.value = ''
      },
    }
  )
}

/*
| Relecture des brouillons — le cœur du ticket : le LLM propose, l'humain valide.
*/

/** Copie locale éditable : le brouillon corrigé remplace ce que le modèle a proposé. */
const edited = reactive(
  Object.fromEntries(
    props.drafts.map((draft) => [
      draft.id,
      {
        front: draft.front,
        back: draft.back,
        category: draft.category ?? '',
        theme: draft.theme ?? '',
      },
    ])
  )
)

const pendingDrafts = computed(() => props.drafts.filter((draft) => draft.status === 'pending'))
const reviewedDrafts = computed(() => props.drafts.filter((draft) => draft.status !== 'pending'))

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

function saveDraft(id: number): void {
  const draft = edited[id]
  router.put(
    `/revision/ingest/drafts/${id}`,
    {
      front: draft.front,
      back: draft.back,
      category: draft.category.trim() || null,
      theme: draft.theme.trim() || null,
    },
    { preserveScroll: true }
  )
}

/** Valider = créer les cartes (boîte 1, dues aujourd'hui) via le catalogue. */
function accept(ids: number[]): void {
  if (ids.length === 0) return
  router.post('/revision/ingest/drafts/accept', { ids }, { preserveScroll: true })
  selected.value = []
}

function reject(ids: number[]): void {
  if (ids.length === 0) return
  router.post('/revision/ingest/drafts/reject', { ids }, { preserveScroll: true })
  selected.value = []
}

function destroyIngestion(id: number): void {
  if (!confirm('Supprimer cette ingestion et ses brouillons ? Les cartes validées restent.')) return
  router.delete(`/revision/ingest/${id}`)
}
</script>

<template>
  <Head title="Ingestion d'un cours" />

  <div class="mb-4 flex items-center gap-3">
    <div>
      <div class="text-[18px] font-bold">Ingestion d'un cours</div>
      <div class="text-[12.5px] text-txt-2">
        Un LLM local en extrait les grands principes. Il <b>propose</b> des cartes : rien n'entre en
        base sans ta relecture.
      </div>
    </div>
    <Link
      href="/revision/settings"
      class="ml-auto rounded-[10px] border border-line-2 bg-panel px-3.5 py-2 text-[12.5px] text-txt-2 transition hover:border-accent hover:text-txt"
    >
      ← Gestion des cartes
    </Link>
  </div>

  <div class="grid grid-cols-[1fr_320px] items-start gap-4">
    <div class="flex flex-col gap-4">
      <!-- Soumission -->
      <form
        class="flex flex-col gap-2 rounded-[14px] border border-line bg-panel p-4"
        @submit.prevent="submitCourse"
      >
        <label class="text-[11px] tracking-[.1em] text-txt-3 uppercase">Le cours</label>
        <textarea
          v-model="text"
          rows="10"
          placeholder="Colle ici le texte du cours…"
          class="resize-y rounded-md border border-line-2 bg-panel-2 px-2.5 py-2 text-[12.5px] outline-none focus:border-accent"
        />

        <div class="flex items-center gap-3">
          <span
            class="text-[11.5px]"
            :class="overCap ? 'text-bad' : text.length ? 'text-txt-2' : 'text-txt-3'"
          >
            {{ text.length.toLocaleString('fr-FR') }} /
            {{ maxChars.toLocaleString('fr-FR') }} caractères
          </span>
          <span class="ml-auto text-[11.5px] text-txt-3">ou un fichier .txt / .md</span>
          <input
            ref="fileInput"
            type="file"
            accept=".txt,.md,text/plain,text/markdown"
            class="max-w-[220px] text-[11.5px] text-txt-2 file:mr-2 file:rounded-md file:border file:border-line-2 file:bg-panel-2 file:px-2 file:py-1 file:text-[11.5px] file:text-txt-2"
            @change="pickFile"
          />
        </div>

        <p v-if="overCap" class="text-[11.5px] text-bad">
          Le plafond est celui de l'exécution synchrone : la requête attend le modèle, morceau par
          morceau. Découpe le cours, ou soumets-le en plusieurs fois.
        </p>

        <button
          type="submit"
          class="mt-1 self-start rounded-[10px] border border-accent bg-accent px-3.5 py-2 text-[12.5px] text-white transition hover:opacity-90 disabled:opacity-50"
          :disabled="!canSubmit"
        >
          {{ submitting ? 'Analyse en cours… (le modèle travaille)' : 'Analyser le cours' }}
        </button>
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

      <div
        v-if="promotionReport"
        class="rounded-[14px] border border-ok bg-panel p-4 text-[11.5px] text-txt-2"
      >
        <span class="font-semibold text-ok">
          {{ promotionReport.cardsCreated }} carte(s) créée(s)
        </span>
        — boîte 1, dues aujourd'hui.
        <span v-if="promotionReport.cardsSkipped" class="text-warn">
          {{ promotionReport.cardsSkipped }} ignorée(s) : ce recto existait déjà sous ce thème.
        </span>
      </div>

      <!-- Ingestion courante -->
      <div v-if="current" class="rounded-[14px] border border-line bg-panel p-4">
        <div class="flex items-center gap-2">
          <span
            class="rounded-md px-2 py-0.5 text-[11px] font-semibold"
            :class="{
              'bg-panel-2 text-txt-2': current.status === 'pending' || current.status === 'running',
              'bg-panel-2 text-ok': current.status === 'done',
              'bg-panel-2 text-bad': current.status === 'failed',
            }"
          >
            {{ STATUS_LABELS[current.status] }}
          </span>
          <span class="text-[12.5px] text-txt-2">
            {{ current.sourceName ?? 'Texte collé' }} ·
            {{ current.charCount.toLocaleString('fr-FR') }} caractères · {{ current.chunksDone }}/{{
              current.chunkCount
            }}
            morceau(x) · {{ current.cardsProposed }} carte(s) proposée(s)
          </span>
          <button
            type="button"
            class="ml-auto text-[11.5px] text-txt-3 transition hover:text-bad"
            @click="destroyIngestion(current.id)"
          >
            Supprimer
          </button>
        </div>

        <p v-if="current.error" class="mt-2 text-[11.5px] text-bad">{{ current.error }}</p>
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
              <input
                v-model="edited[draft.id].category"
                list="ingest-categories"
                placeholder="Catégorie"
                class="w-[150px] rounded-md border border-line-2 bg-panel-2 px-2 py-1 text-[11.5px] outline-none focus:border-accent"
              />
              <input
                v-model="edited[draft.id].theme"
                list="ingest-themes"
                placeholder="Thème"
                class="w-[150px] rounded-md border border-line-2 bg-panel-2 px-2 py-1 text-[11.5px] outline-none focus:border-accent"
              />
              <span v-if="halfClassified(draft.id)" class="text-[11px] text-warn">
                Catégorie et thème vont ensemble.
              </span>

              <button
                type="button"
                class="ml-auto rounded-md border border-line-2 bg-panel-2 px-2 py-1 text-[11.5px] text-txt-2 transition hover:border-accent hover:text-txt"
                @click="saveDraft(draft.id)"
              >
                Enregistrer
              </button>
              <button
                type="button"
                class="rounded-md border border-accent bg-accent px-2 py-1 text-[11.5px] text-white transition hover:opacity-90"
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
        v-else-if="current && current.status === 'done'"
        class="rounded-[14px] border border-line bg-panel p-4 text-[12.5px] text-txt-3"
      >
        Aucun brouillon en attente sur cette ingestion.
      </div>

      <!-- Brouillons déjà relus : la trace de ce que le modèle a proposé. -->
      <div v-if="reviewedDrafts.length" class="rounded-[14px] border border-line bg-panel p-4">
        <div class="mb-2 text-[11px] tracking-[.1em] text-txt-3 uppercase">Déjà relus</div>
        <div
          v-for="draft in reviewedDrafts"
          :key="draft.id"
          class="flex items-center gap-2 py-1 text-[11.5px]"
        >
          <span :class="draft.status === 'accepted' ? 'text-ok' : 'text-txt-3'">
            {{ draft.status === 'accepted' ? '✓' : '✕' }}
          </span>
          <span class="truncate text-txt-2">{{ draft.front }}</span>
        </div>
      </div>
    </div>

    <!-- Dernières ingestions -->
    <div class="rounded-[14px] border border-line bg-panel p-4">
      <div class="mb-2 text-[11px] tracking-[.1em] text-txt-3 uppercase">Dernières ingestions</div>

      <p v-if="!ingestions.length" class="text-[11.5px] text-txt-3">
        Aucune pour l'instant. Colle un cours pour commencer.
      </p>

      <Link
        v-for="ingestion in ingestions"
        :key="ingestion.id"
        :href="`/revision/ingest?id=${ingestion.id}`"
        class="mt-1 block rounded-md border px-2.5 py-2 transition hover:border-accent"
        :class="
          current?.id === ingestion.id ? 'border-accent bg-panel-2' : 'border-line bg-panel-2'
        "
      >
        <div class="flex items-center gap-2">
          <span
            class="text-[11px] font-semibold"
            :class="{
              'text-ok': ingestion.status === 'done',
              'text-bad': ingestion.status === 'failed',
              'text-txt-2': ingestion.status === 'pending' || ingestion.status === 'running',
            }"
          >
            {{ STATUS_LABELS[ingestion.status] }}
          </span>
          <span class="truncate text-[11.5px] text-txt-2">
            {{ ingestion.sourceName ?? 'Texte collé' }}
          </span>
          <span class="ml-auto text-[11px] text-txt-3">{{ ingestion.cardsProposed }} carte(s)</span>
        </div>
      </Link>
    </div>
  </div>

  <!-- Taxonomie existante : on propose ce qui existe, sans l'imposer (le modèle peut
       inventer un thème, il sera créé à la volée à la validation). -->
  <datalist id="ingest-categories">
    <option v-for="category in categories" :key="category.id" :value="category.name" />
  </datalist>
  <datalist id="ingest-themes">
    <option
      v-for="theme in categories.flatMap((category) => category.themes)"
      :key="theme.id"
      :value="theme.name"
    />
  </datalist>
</template>
