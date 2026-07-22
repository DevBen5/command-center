<script setup lang="ts">
import { computed, ref } from 'vue'
import { Head } from '@inertiajs/vue3'
import AppLayout from '~/layouts/AppLayout.vue'
import LeitnerTabs from '../components/LeitnerTabs.vue'
import { xsrfToken } from '../components/leitner_csrf'

defineOptions({ layout: AppLayout })

interface Candidate {
  label: string
  baseUrl: string
}

interface ProbedCandidate extends Candidate {
  ok: boolean
}

interface DraftCard {
  front: string
  back: string
  category: string | null
  theme: string | null
}

/** Gris (pas encore faite) · vert (`ok`) · rouge (`bad`). Une étape verte débloque la suivante. */
type StepState = 'idle' | 'ok' | 'bad'

const props = defineProps<{
  /** La configuration **chargée** par le serveur. Sans la clé d'API : elle ne sort jamais. */
  current: { baseUrl: string; model: string; timeoutMs: number; hasApiKey: boolean }
  candidates: Candidate[]
  sample: string
}>()

/*
| Les trois routes de diagnostic rendent du JSON nu (pas de réponse Inertia) : elles
| n'écrivent rien et ne changent aucune page. On les appelle donc en `fetch` — donc
| avec le jeton CSRF à la main (`leitner_csrf.ts`), qu'Inertia poserait seul.
*/
async function post<T>(url: string, body: Record<string, unknown>): Promise<T> {
  const response = await fetch(url, {
    method: 'POST',
    headers: {
      'accept': 'application/json',
      'content-type': 'application/json',
      'x-xsrf-token': xsrfToken(),
    },
    body: JSON.stringify(body),
  })

  const payload = await response.json().catch(() => null)

  if (!response.ok) {
    // 422 : la liste blanche a refusé l'URL. Le message du validateur est le bon.
    const errors = (payload as { errors?: { message: string }[] } | null)?.errors
    throw new Error(errors?.[0]?.message ?? `Le serveur a répondu ${response.status}.`)
  }

  return payload as T
}

/*
| Bandeau d'état : la configuration chargée marche-t-elle ? C'est ce qu'on vient
| vérifier en premier. Sans corps de requête, la route teste l'environnement — pas
| une URL saisie.
*/
const banner = ref<{ state: 'idle' | 'running' | 'ok' | 'bad'; error: string | null }>({
  state: 'idle',
  error: null,
})

async function checkCurrent(): Promise<void> {
  banner.value = { state: 'running', error: null }
  try {
    const result = await post<{ ok: boolean; error: string | null }>('/revision/llm/test', {})
    banner.value = { state: result.ok ? 'ok' : 'bad', error: result.error }
  } catch (error) {
    banner.value = { state: 'bad', error: (error as Error).message }
  }
}

/*
| Étape 1 — un serveur LLM tourne.
*/
const detection = ref<{
  state: 'idle' | 'running' | 'done'
  candidates: ProbedCandidate[]
  error: string | null
}>({ state: 'idle', candidates: [], error: null })

const manualUrl = ref(props.current.baseUrl)
const baseUrl = ref('')

async function detect(): Promise<void> {
  detection.value = { state: 'running', candidates: [], error: null }
  try {
    const result = await post<{ candidates: ProbedCandidate[] }>('/revision/llm/detect', {
      baseUrl: manualUrl.value.trim() || undefined,
    })
    detection.value = { state: 'done', candidates: result.candidates, error: null }

    // Un seul serveur répond : il n'y a rien à choisir.
    const reachable = result.candidates.filter((candidate) => candidate.ok)
    if (reachable.length === 1) selectServer(reachable[0].baseUrl)
  } catch (error) {
    detection.value = { state: 'done', candidates: [], error: (error as Error).message }
  }
}

const anyReachable = computed(() => detection.value.candidates.some((candidate) => candidate.ok))

const step1State = computed<StepState>(() => {
  if (detection.value.state !== 'done') return 'idle'
  return anyReachable.value ? 'ok' : 'bad'
})

/*
| Étape 2 — un modèle est chargé.
*/
const models = ref<{
  state: 'idle' | 'running' | 'done'
  list: string[]
  error: string | null
}>({ state: 'idle', list: [], error: null })

const model = ref('')

/** Choisir un serveur relance la liste des modèles : les deux vont ensemble. */
function selectServer(url: string): void {
  baseUrl.value = url
  manualUrl.value = url
  model.value = ''
  models.value = { state: 'idle', list: [], error: null }
  test.value = { state: 'idle', cards: [], error: null }
  void loadModels()
}

async function loadModels(): Promise<void> {
  if (!baseUrl.value) return

  models.value = { state: 'running', list: [], error: null }
  try {
    const result = await post<{ ok: boolean; models: string[]; error: string | null }>(
      '/revision/llm/models',
      { baseUrl: baseUrl.value }
    )
    models.value = { state: 'done', list: result.models, error: result.error }

    // Un serveur local ne sert souvent qu'un modèle : inutile de le faire choisir.
    if (result.models.length >= 1) {
      model.value = result.models.includes(props.current.model)
        ? props.current.model
        : result.models[0]
    }
  } catch (error) {
    models.value = { state: 'done', list: [], error: (error as Error).message }
  }
}

const step2State = computed<StepState>(() => {
  if (step1State.value !== 'ok' || models.value.state !== 'done') return 'idle'
  return models.value.list.length > 0 ? 'ok' : 'bad'
})

/*
| Étape 3 — le modèle sait produire du JSON. L'étape qui porte tout : c'est la seule
| qui répond à « ce modèle-là est-il utilisable pour fabriquer des cartes ? ».
*/
const test = ref<{
  state: 'idle' | 'running' | 'done'
  cards: DraftCard[]
  error: string | null
}>({ state: 'idle', cards: [], error: null })

async function runTest(): Promise<void> {
  test.value = { state: 'running', cards: [], error: null }
  try {
    const result = await post<{ ok: boolean; cards: DraftCard[]; error: string | null }>(
      '/revision/llm/test',
      { baseUrl: baseUrl.value, model: model.value }
    )
    test.value = { state: 'done', cards: result.cards, error: result.error }
  } catch (error) {
    test.value = { state: 'done', cards: [], error: (error as Error).message }
  }
}

const step3State = computed<StepState>(() => {
  if (step2State.value !== 'ok' || test.value.state !== 'done') return 'idle'
  return test.value.error === null ? 'ok' : 'bad'
})

/*
| Étape 4 — la configuration est enregistrée. L'assistant ne persiste rien : il produit
| le bloc à coller. AdonisJS lit l'environnement AU DÉMARRAGE (un redémarrage est de
| toute façon nécessaire), et sous Docker le fichier du conteneur n'est pas la source
| de vérité — écrire `.env` depuis une requête web serait une surface offerte pour un
| copier-coller économisé.
*/
const envBlock = computed(
  () =>
    `LLM_BASE_URL=${baseUrl.value}\n` +
    `LLM_MODEL=${model.value}\n` +
    `LLM_TIMEOUT_MS=${props.current.timeoutMs}`
)

/** Depuis un conteneur, `127.0.0.1` est le conteneur lui-même, pas la machine hôte. */
const dockerBaseUrl = computed(() =>
  baseUrl.value.replace(/\/\/(127\.0\.0\.1|localhost|\[::1\])(?=[:/]|$)/, '//host.docker.internal')
)

const dockerBlock = computed(
  () =>
    `services:\n` +
    `  app:\n` +
    `    environment:\n` +
    `      LLM_BASE_URL: ${dockerBaseUrl.value}\n` +
    `      LLM_MODEL: ${model.value}\n` +
    `      LLM_TIMEOUT_MS: '${props.current.timeoutMs}'\n` +
    `    extra_hosts:\n` +
    `      - 'host.docker.internal:host-gateway'`
)

const copied = ref<string | null>(null)

async function copy(what: 'env' | 'docker'): Promise<void> {
  await navigator.clipboard.writeText(what === 'env' ? envBlock.value : dockerBlock.value)
  copied.value = what
  setTimeout(() => (copied.value = null), 2000)
}

const STEP_CLASSES: Record<StepState, string> = {
  idle: 'border-line text-txt-3',
  ok: 'border-ok text-ok',
  bad: 'border-bad text-bad',
}
</script>

<template>
  <Head title="Configuration du LLM" />

  <LeitnerTabs />

  <div class="mb-4">
    <div class="text-[18px] font-bold">Configuration du LLM</div>
    <div class="text-[12.5px] text-txt-2">
      Le fil rouge, de bout en bout : un serveur répond, un modèle est chargé, il rend du JSON —
      et voilà le bloc à coller dans <code class="text-txt">.env</code>.
    </div>
  </div>

  <!-- Bandeau d'état : la configuration réellement chargée par le serveur. -->
  <div
    class="mb-4 rounded-[14px] border bg-panel p-4"
    :class="
      banner.state === 'ok' ? 'border-ok' : banner.state === 'bad' ? 'border-bad' : 'border-line'
    "
  >
    <div class="flex flex-wrap items-center gap-3">
      <div>
        <div class="text-[11px] tracking-[.1em] text-txt-3 uppercase">Configuration chargée</div>
        <div class="mt-1 font-mono text-[12.5px] text-txt-2">
          {{ current.baseUrl }} · {{ current.model }} ·
          {{ Math.round(current.timeoutMs / 1000) }} s
          <span :class="current.hasApiKey ? 'text-ok' : 'text-txt-3'">
            · clé d'API {{ current.hasApiKey ? 'définie' : 'absente' }}
          </span>
        </div>
      </div>

      <button
        type="button"
        class="ml-auto rounded-[10px] border border-line-2 bg-panel-2 px-3.5 py-2 text-[12.5px] text-txt-2 transition hover:border-accent hover:text-txt disabled:opacity-50"
        :disabled="banner.state === 'running'"
        @click="checkCurrent"
      >
        {{ banner.state === 'running' ? 'Le modèle travaille…' : 'Vérifier' }}
      </button>
    </div>

    <p v-if="banner.state === 'ok'" class="mt-2 text-[11.5px] text-ok">
      Le modèle chargé répond et rend des cartes : l'ingestion d'un cours est opérationnelle.
    </p>
    <p v-else-if="banner.state === 'bad'" class="mt-2 text-[11.5px] text-bad">
      {{ banner.error }}
    </p>
    <p v-else class="mt-2 text-[11.5px] text-txt-3">
      Ces valeurs viennent de l'environnement (<code>.env</code>), jamais de cet écran : rien
      d'ici n'est enregistré. « Vérifier » lance une vraie génération, sans rien écrire.
    </p>
  </div>

  <div class="flex flex-col gap-3">
    <!-- Étape 1 — un serveur LLM tourne -->
    <section class="rounded-[14px] border bg-panel p-4" :class="STEP_CLASSES[step1State]">
      <div class="flex flex-wrap items-center gap-3">
        <span class="text-[12.5px] font-bold">1 · Un serveur LLM tourne</span>
        <input
          v-model="manualUrl"
          placeholder="http://127.0.0.1:1234/v1"
          class="ml-auto w-[280px] rounded-md border border-line-2 bg-panel-2 px-2.5 py-1.5 font-mono text-[11.5px] text-txt outline-none focus:border-accent"
        />
        <button
          type="button"
          class="rounded-[10px] border border-accent bg-accent px-3.5 py-2 text-[12.5px] text-white transition hover:opacity-90 disabled:opacity-50"
          :disabled="detection.state === 'running'"
          @click="detect"
        >
          {{ detection.state === 'running' ? 'Sondage…' : 'Détecter' }}
        </button>
      </div>

      <p class="mt-2 text-[11.5px] text-txt-3">
        Les ports sondés sont fixés dans le code
        <span class="font-mono">
          ({{ candidates.map((candidate) => candidate.label).join(' · ') }})
        </span>
        ; une URL saisie ici doit viser un hôte local ou privé.
      </p>

      <p v-if="detection.error" class="mt-2 text-[11.5px] text-bad">{{ detection.error }}</p>

      <div v-if="detection.candidates.length" class="mt-3 flex flex-col gap-1">
        <button
          v-for="candidate in detection.candidates"
          :key="candidate.baseUrl"
          type="button"
          class="flex items-center gap-2 rounded-md border bg-panel-2 px-2.5 py-2 text-left transition disabled:cursor-not-allowed"
          :class="
            baseUrl === candidate.baseUrl
              ? 'border-accent'
              : candidate.ok
                ? 'border-line hover:border-accent'
                : 'border-line opacity-60'
          "
          :disabled="!candidate.ok"
          @click="selectServer(candidate.baseUrl)"
        >
          <span class="text-[11.5px] font-semibold" :class="candidate.ok ? 'text-ok' : 'text-bad'">
            {{ candidate.ok ? '●' : '○' }}
          </span>
          <span class="text-[12px] text-txt-2">{{ candidate.label }}</span>
          <span class="font-mono text-[11.5px] text-txt-3">{{ candidate.baseUrl }}</span>
          <span class="ml-auto text-[11px]" :class="candidate.ok ? 'text-ok' : 'text-txt-3'">
            {{ candidate.ok ? 'répond' : 'aucune réponse' }}
          </span>
        </button>
      </div>

      <p v-if="step1State === 'bad'" class="mt-2 text-[11.5px] text-bad">
        Aucun serveur ne répond. Dans LM Studio : onglet <b>Developer</b> → charge un modèle →
        <b>Start Server</b> (port 1234). Puis relance la détection.
      </p>
    </section>

    <!-- Étape 2 — un modèle est chargé -->
    <section class="rounded-[14px] border bg-panel p-4" :class="STEP_CLASSES[step2State]">
      <div class="flex flex-wrap items-center gap-3">
        <span class="text-[12.5px] font-bold">2 · Un modèle est chargé</span>

        <select
          v-model="model"
          class="ml-auto w-[280px] rounded-md border border-line-2 bg-panel-2 px-2.5 py-1.5 text-[11.5px] text-txt outline-none focus:border-accent disabled:opacity-50"
          :disabled="!models.list.length"
        >
          <option v-for="name in models.list" :key="name" :value="name">{{ name }}</option>
        </select>

        <button
          type="button"
          class="rounded-[10px] border border-line-2 bg-panel-2 px-3.5 py-2 text-[12.5px] text-txt-2 transition hover:border-accent hover:text-txt disabled:opacity-50"
          :disabled="step1State !== 'ok' || !baseUrl || models.state === 'running'"
          @click="loadModels"
        >
          {{ models.state === 'running' ? 'Lecture…' : 'Relire /models' }}
        </button>
      </div>

      <p v-if="step1State !== 'ok'" class="mt-2 text-[11.5px] text-txt-3">
        Détecte d'abord un serveur.
      </p>
      <p v-else-if="models.error" class="mt-2 text-[11.5px] text-bad">{{ models.error }}</p>
      <p v-else-if="step2State === 'bad'" class="mt-2 text-[11.5px] text-bad">
        Aucun modèle chargé : charge-en un dans LM Studio (onglet <b>Developer</b>), puis relance
        la détection.
      </p>
      <p v-else-if="step2State === 'ok'" class="mt-2 text-[11.5px] text-txt-3">
        {{ models.list.length }} modèle(s) exposé(s) par
        <span class="font-mono">{{ baseUrl }}</span
        >.
      </p>
    </section>

    <!-- Étape 3 — le modèle sait produire du JSON -->
    <section class="rounded-[14px] border bg-panel p-4" :class="STEP_CLASSES[step3State]">
      <div class="flex flex-wrap items-center gap-3">
        <span class="text-[12.5px] font-bold">3 · Le modèle sait produire du JSON</span>
        <button
          type="button"
          class="ml-auto rounded-[10px] border border-accent bg-accent px-3.5 py-2 text-[12.5px] text-white transition hover:opacity-90 disabled:opacity-50"
          :disabled="step2State !== 'ok' || !model || test.state === 'running'"
          @click="runTest"
        >
          {{ test.state === 'running' ? 'Le modèle travaille…' : 'Tester' }}
        </button>
      </div>

      <p class="mt-2 text-[11.5px] text-txt-3">
        Une vraie génération sur un extrait de cours en dur, suivie du <b>même parsing</b> que
        l'ingestion. C'est la seule chose qui réponde à « ce modèle-là sait-il fabriquer des
        cartes ? ». Rien n'est écrit en base.
      </p>

      <pre
        class="mt-2 overflow-x-auto rounded-md border border-line bg-panel-2 p-2.5 font-mono text-[11px] whitespace-pre-wrap text-txt-3"
        >{{ sample }}</pre
      >

      <p v-if="test.error" class="mt-2 text-[11.5px] text-bad">{{ test.error }}</p>

      <div v-if="test.cards.length" class="mt-3 flex flex-col gap-2">
        <div
          v-for="(card, index) in test.cards"
          :key="index"
          class="rounded-md border border-line bg-panel-2 px-2.5 py-2"
        >
          <div class="text-[12.5px] font-semibold">{{ card.front }}</div>
          <div class="mt-0.5 text-[12px] text-txt-2">{{ card.back }}</div>
          <div v-if="card.category" class="mt-1 text-[11px] text-txt-3">
            {{ card.category }} · {{ card.theme }}
          </div>
        </div>
        <p class="text-[11.5px] text-ok">
          Ce modèle est utilisable : ces cartes n'ont pas été enregistrées, elles prouvent
          seulement qu'il tient le format.
        </p>
      </div>
    </section>

    <!-- Étape 4 — la configuration est enregistrée -->
    <section
      class="rounded-[14px] border bg-panel p-4"
      :class="STEP_CLASSES[step3State === 'ok' ? 'ok' : 'idle']"
    >
      <div class="text-[12.5px] font-bold">4 · La configuration est enregistrée</div>

      <p v-if="step3State !== 'ok'" class="mt-2 text-[11.5px] text-txt-3">
        Le bloc à copier apparaît une fois le modèle testé.
      </p>

      <template v-else>
        <p class="mt-2 text-[11.5px] text-txt-2">
          Cet écran n'enregistre rien : la configuration vit dans l'environnement, lu
          <b>au démarrage</b>. Colle le bloc, redémarre le serveur — le bandeau du haut repassera
          au vert.
        </p>

        <div class="mt-3 flex items-center gap-2">
          <span class="text-[11px] tracking-[.1em] text-txt-3 uppercase">.env</span>
          <button
            type="button"
            class="ml-auto rounded-md border border-line-2 bg-panel-2 px-2.5 py-1 text-[11.5px] text-txt-2 transition hover:border-accent hover:text-txt"
            @click="copy('env')"
          >
            {{ copied === 'env' ? 'Copié' : 'Copier' }}
          </button>
        </div>
        <pre
          class="mt-1 overflow-x-auto rounded-md border border-line bg-panel-2 p-2.5 font-mono text-[11.5px] text-txt-2"
          >{{ envBlock }}</pre
        >

        <div class="mt-3 flex items-center gap-2">
          <span class="text-[11px] tracking-[.1em] text-txt-3 uppercase">docker-compose.yml</span>
          <button
            type="button"
            class="ml-auto rounded-md border border-line-2 bg-panel-2 px-2.5 py-1 text-[11.5px] text-txt-2 transition hover:border-accent hover:text-txt"
            @click="copy('docker')"
          >
            {{ copied === 'docker' ? 'Copié' : 'Copier' }}
          </button>
        </div>
        <pre
          class="mt-1 overflow-x-auto rounded-md border border-line bg-panel-2 p-2.5 font-mono text-[11.5px] text-txt-2"
          >{{ dockerBlock }}</pre
        >
        <p class="mt-1 text-[11.5px] text-txt-3">
          Depuis un conteneur, <span class="font-mono">127.0.0.1</span> est le conteneur lui-même :
          le serveur LLM de la machine hôte s'atteint par
          <span class="font-mono">host.docker.internal</span>.
        </p>
      </template>
    </section>
  </div>
</template>
