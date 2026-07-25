<script setup lang="ts">
import { computed, ref } from 'vue'
import { useI18n } from 'vue-i18n'
import { Head } from '@inertiajs/vue3'
import AppLayout from '~/layouts/AppLayout.vue'
import LeitnerTabs from '../components/LeitnerTabs.vue'
import { xsrfToken } from '../components/leitner_csrf'

defineOptions({ layout: AppLayout })

const { t } = useI18n()

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
    throw new Error(
      errors?.[0]?.message ?? t('leitner.llm.errors.serverStatus', { status: response.status })
    )
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
  <Head :title="t('leitner.llm.title')" />

  <LeitnerTabs />

  <div class="mb-4">
    <div class="text-[18px] font-bold">{{ t('leitner.llm.title') }}</div>
    <i18n-t keypath="leitner.llm.subtitle" tag="div" scope="global" class="text-[12.5px] text-txt-2">
      <template #env><code class="text-txt">.env</code></template>
    </i18n-t>
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
        <div class="text-[11px] tracking-[.1em] text-txt-3 uppercase">
          {{ t('leitner.llm.banner.loadedConfig') }}
        </div>
        <div class="mt-1 font-mono text-[12.5px] text-txt-2">
          {{ current.baseUrl }} · {{ current.model }} ·
          {{ Math.round(current.timeoutMs / 1000) }} s
          <span :class="current.hasApiKey ? 'text-ok' : 'text-txt-3'">
            ·
            {{
              current.hasApiKey
                ? t('leitner.llm.banner.apiKeyDefined')
                : t('leitner.llm.banner.apiKeyAbsent')
            }}
          </span>
        </div>
      </div>

      <button
        type="button"
        class="ml-auto rounded-[10px] border border-line-2 bg-panel-2 px-3.5 py-2 text-[12.5px] text-txt-2 transition hover:border-accent hover:text-txt disabled:opacity-50"
        :disabled="banner.state === 'running'"
        @click="checkCurrent"
      >
        {{ banner.state === 'running' ? t('leitner.llm.working') : t('leitner.llm.banner.check') }}
      </button>
    </div>

    <p v-if="banner.state === 'ok'" class="mt-2 text-[11.5px] text-ok">
      {{ t('leitner.llm.banner.ok') }}
    </p>
    <p v-else-if="banner.state === 'bad'" class="mt-2 text-[11.5px] text-bad">
      {{ banner.error }}
    </p>
    <i18n-t
      v-else
      keypath="leitner.llm.banner.idle"
      tag="p"
      scope="global"
      class="mt-2 text-[11.5px] text-txt-3"
    >
      <template #env><code>.env</code></template>
    </i18n-t>
  </div>

  <div class="flex flex-col gap-3">
    <!-- Étape 1 — un serveur LLM tourne -->
    <section class="rounded-[14px] border bg-panel p-4" :class="STEP_CLASSES[step1State]">
      <div class="flex flex-wrap items-center gap-3">
        <span class="text-[12.5px] font-bold">{{ t('leitner.llm.step1.title') }}</span>
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
          {{ detection.state === 'running' ? t('leitner.llm.step1.probing') : t('leitner.llm.step1.detect') }}
        </button>
      </div>

      <i18n-t keypath="leitner.llm.step1.ports" tag="p" scope="global" class="mt-2 text-[11.5px] text-txt-3">
        <template #ports>
          <span class="font-mono">
            ({{ candidates.map((candidate) => candidate.label).join(' · ') }})
          </span>
        </template>
      </i18n-t>

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
            {{ candidate.ok ? t('leitner.llm.step1.responds') : t('leitner.llm.step1.noResponse') }}
          </span>
        </button>
      </div>

      <i18n-t
        v-if="step1State === 'bad'"
        keypath="leitner.llm.step1.help"
        tag="p"
        scope="global"
        class="mt-2 text-[11.5px] text-bad"
      >
        <template #developer><b>Developer</b></template>
        <template #startServer><b>Start Server</b></template>
      </i18n-t>
    </section>

    <!-- Étape 2 — un modèle est chargé -->
    <section class="rounded-[14px] border bg-panel p-4" :class="STEP_CLASSES[step2State]">
      <div class="flex flex-wrap items-center gap-3">
        <span class="text-[12.5px] font-bold">{{ t('leitner.llm.step2.title') }}</span>

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
          {{ models.state === 'running' ? t('leitner.llm.step2.reading') : t('leitner.llm.step2.reload') }}
        </button>
      </div>

      <p v-if="step1State !== 'ok'" class="mt-2 text-[11.5px] text-txt-3">
        {{ t('leitner.llm.step2.needServer') }}
      </p>
      <p v-else-if="models.error" class="mt-2 text-[11.5px] text-bad">{{ models.error }}</p>
      <i18n-t
        v-else-if="step2State === 'bad'"
        keypath="leitner.llm.step2.empty"
        tag="p"
        scope="global"
        class="mt-2 text-[11.5px] text-bad"
      >
        <template #developer><b>Developer</b></template>
      </i18n-t>
      <i18n-t
        v-else-if="step2State === 'ok'"
        keypath="leitner.llm.step2.exposed"
        tag="p"
        scope="global"
        class="mt-2 text-[11.5px] text-txt-3"
      >
        <template #count>{{ models.list.length }}</template>
        <template #url><span class="font-mono">{{ baseUrl }}</span></template>
      </i18n-t>
    </section>

    <!-- Étape 3 — le modèle sait produire du JSON -->
    <section class="rounded-[14px] border bg-panel p-4" :class="STEP_CLASSES[step3State]">
      <div class="flex flex-wrap items-center gap-3">
        <span class="text-[12.5px] font-bold">{{ t('leitner.llm.step3.title') }}</span>
        <button
          type="button"
          class="ml-auto rounded-[10px] border border-accent bg-accent px-3.5 py-2 text-[12.5px] text-white transition hover:opacity-90 disabled:opacity-50"
          :disabled="step2State !== 'ok' || !model || test.state === 'running'"
          @click="runTest"
        >
          {{ test.state === 'running' ? t('leitner.llm.working') : t('leitner.llm.step3.test') }}
        </button>
      </div>

      <i18n-t keypath="leitner.llm.step3.explain" tag="p" scope="global" class="mt-2 text-[11.5px] text-txt-3">
        <template #parsing><b>même parsing</b></template>
      </i18n-t>

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
          {{ t('leitner.llm.step3.usable') }}
        </p>
      </div>
    </section>

    <!-- Étape 4 — la configuration est enregistrée -->
    <section
      class="rounded-[14px] border bg-panel p-4"
      :class="STEP_CLASSES[step3State === 'ok' ? 'ok' : 'idle']"
    >
      <div class="text-[12.5px] font-bold">{{ t('leitner.llm.step4.title') }}</div>

      <p v-if="step3State !== 'ok'" class="mt-2 text-[11.5px] text-txt-3">
        {{ t('leitner.llm.step4.locked') }}
      </p>

      <template v-else>
        <i18n-t keypath="leitner.llm.step4.intro" tag="p" scope="global" class="mt-2 text-[11.5px] text-txt-2">
          <template #boot><b>au démarrage</b></template>
        </i18n-t>

        <div class="mt-3 flex items-center gap-2">
          <span class="text-[11px] tracking-[.1em] text-txt-3 uppercase">.env</span>
          <button
            type="button"
            class="ml-auto rounded-md border border-line-2 bg-panel-2 px-2.5 py-1 text-[11.5px] text-txt-2 transition hover:border-accent hover:text-txt"
            @click="copy('env')"
          >
            {{ copied === 'env' ? t('leitner.llm.step4.copied') : t('leitner.llm.step4.copy') }}
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
            {{ copied === 'docker' ? t('leitner.llm.step4.copied') : t('leitner.llm.step4.copy') }}
          </button>
        </div>
        <pre
          class="mt-1 overflow-x-auto rounded-md border border-line bg-panel-2 p-2.5 font-mono text-[11.5px] text-txt-2"
          >{{ dockerBlock }}</pre
        >
        <i18n-t keypath="leitner.llm.step4.dockerHint" tag="p" scope="global" class="mt-1 text-[11.5px] text-txt-3">
          <template #localhost><span class="font-mono">127.0.0.1</span></template>
          <template #dockerHost><span class="font-mono">host.docker.internal</span></template>
        </i18n-t>
      </template>
    </section>
  </div>
</template>
