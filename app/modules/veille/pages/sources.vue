<script setup lang="ts">
import { ref } from 'vue'
import { Head, Link, router } from '@inertiajs/vue3'
import AppLayout from '~/layouts/AppLayout.vue'

defineOptions({ layout: AppLayout })

interface VeilleSource {
  id: number
  kind: string
  url: string
  title: string
  fetchIntervalMinutes: number
  lastFetchedAt: string | null
  lastError: string | null
  lastErrorAt: string | null
  lastItemCount: number | null
  active: boolean
}

const props = defineProps<{
  sources: VeilleSource[]
  notification: { type: string; message: string } | null
  sourceErrors: Record<string, string> | null
}>()

const form = ref({ url: '', title: '', fetchIntervalMinutes: 60 })
const submitting = ref(false)
const refreshing = ref<number | null>(null)

function submit(): void {
  if (!form.value.url.trim() || !form.value.title.trim()) return
  submitting.value = true
  router.post('/veille/sources', { ...form.value }, {
    preserveScroll: true,
    onSuccess: () => {
      form.value = { url: '', title: '', fetchIntervalMinutes: 60 }
    },
    onFinish: () => {
      submitting.value = false
    },
  })
}

function toggleActive(source: VeilleSource): void {
  router.post(
    `/veille/sources/${source.id}`,
    { active: !source.active },
    { preserveScroll: true, preserveState: true }
  )
}

/** Synchrone côté serveur : le retour dit tout de suite si la source fonctionne. */
function refresh(source: VeilleSource): void {
  refreshing.value = source.id
  router.post(
    `/veille/sources/${source.id}/refresh`,
    {},
    {
      preserveScroll: true,
      onFinish: () => {
        refreshing.value = null
      },
    }
  )
}

function refreshAll(): void {
  router.post('/veille/sources/refresh', {}, { preserveScroll: true })
}

function formatDateTime(value: string | null): string {
  if (!value) return 'jamais'
  return new Date(value).toLocaleString('fr-FR', {
    day: '2-digit',
    month: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  })
}

const NOTIFICATION_CLASSES: Record<string, string> = {
  success: 'border-ok text-ok',
  error: 'border-bad text-bad',
  warning: 'border-warn text-warn',
  info: 'border-line-2 text-txt-2',
}
</script>

<template>
  <Head title="Sources de veille" />

  <div class="mb-4 flex items-center gap-3">
    <Link
      href="/veille"
      class="rounded-[9px] border border-line-2 bg-panel-2 px-3.5 py-2 text-[12.5px] text-txt-2 hover:text-txt"
    >
      ← Flux
    </Link>
    <div class="text-[13px] font-semibold">Sources</div>
    <button
      type="button"
      class="ml-auto rounded-[9px] border border-line-2 bg-panel-2 px-3.5 py-2 text-[12.5px]"
      @click="refreshAll"
    >
      Tout rafraîchir
    </button>
  </div>

  <div
    v-if="props.notification"
    class="mb-4 rounded-[12px] border bg-panel px-4 py-3 text-[12.5px]"
    :class="NOTIFICATION_CLASSES[props.notification.type] ?? NOTIFICATION_CLASSES.info"
  >
    {{ props.notification.message }}
  </div>

  <div class="grid grid-cols-[1fr_320px] gap-3.5">
    <!-- Liste des sources -->
    <div class="overflow-hidden rounded-[14px] border border-line bg-panel">
      <div class="border-b border-line p-4 text-[12px] font-semibold">
        Sources suivies
        <span class="ml-1 font-normal text-txt-3">({{ props.sources.length }})</span>
      </div>

      <div
        v-for="source in props.sources"
        :key="source.id"
        class="border-b border-line px-4 py-3.5"
        :class="source.active ? '' : 'opacity-55'"
      >
        <div class="flex items-start gap-3">
          <div class="min-w-0 flex-1">
            <div class="flex items-center gap-2">
              <span class="text-[13px] font-semibold">{{ source.title }}</span>
              <span
                class="rounded-full border border-line-2 bg-panel-2 px-2 py-0.5 text-[10.5px] text-txt-3 uppercase"
              >
                {{ source.kind }}
              </span>
              <span v-if="!source.active" class="text-[11px] text-txt-3">désactivée</span>
            </div>
            <div class="mt-0.5 truncate font-mono text-[11px] text-txt-3">{{ source.url }}</div>
            <div class="mt-1 flex flex-wrap items-center gap-2 text-[11.5px] text-txt-3">
              <span>toutes les {{ source.fetchIntervalMinutes }} min</span>
              <span>·</span>
              <span>dernière collecte : {{ formatDateTime(source.lastFetchedAt) }}</span>
              <template v-if="source.lastItemCount !== null">
                <span>·</span>
                <span :class="source.lastItemCount === 0 ? 'text-warn' : ''">
                  {{ source.lastItemCount }} entrée(s)
                </span>
              </template>
            </div>
          </div>

          <div class="flex shrink-0 items-center gap-2">
            <button
              type="button"
              class="rounded-md border border-line-2 bg-panel-2 px-2.5 py-1 text-[11.5px] disabled:opacity-40"
              :disabled="refreshing === source.id"
              @click="refresh(source)"
            >
              {{ refreshing === source.id ? '…' : 'Rafraîchir' }}
            </button>
            <button
              type="button"
              class="rounded-md border border-line-2 bg-panel-2 px-2.5 py-1 text-[11.5px]"
              @click="toggleActive(source)"
            >
              {{ source.active ? 'Désactiver' : 'Activer' }}
            </button>
          </div>
        </div>

        <!-- Le message d'échec, brut, celui du serveur. Un flux mort qui échoue en silence est
             le mode de panne le plus courant d'un agrégateur : il doit se voir ici. -->
        <div v-if="source.lastError" class="mt-2 rounded-[9px] border border-bad bg-bg-2 p-2.5">
          <div class="text-[11.5px] font-semibold text-bad">
            Dernière collecte en échec — {{ formatDateTime(source.lastErrorAt) }}
          </div>
          <p class="mt-0.5 font-mono text-[11px] break-words text-txt-2">{{ source.lastError }}</p>
        </div>

        <div
          v-else-if="source.lastItemCount === 0"
          class="mt-2 rounded-[9px] border border-warn bg-bg-2 p-2.5 text-[11.5px] text-warn"
        >
          Le flux répond, mais aucune entrée n’a été reconnue — format inattendu, ou flux vidé.
        </div>
      </div>

      <div v-if="props.sources.length === 0" class="p-6 text-center text-[13px] text-txt-2">
        Aucune source. Ajoute un flux RSS ou Atom pour que la veille se remplisse toute seule.
      </div>
    </div>

    <!-- Ajout -->
    <div class="h-fit overflow-hidden rounded-[14px] border border-line bg-panel">
      <div class="border-b border-line p-4 text-[12px] font-semibold">Ajouter une source</div>
      <form class="flex flex-col gap-2 p-3" @submit.prevent="submit">
        <input
          v-model="form.url"
          type="text"
          placeholder="https://exemple.dev/feed.xml"
          class="rounded-md border border-line-2 bg-panel px-2 py-1.5 text-[12px] placeholder:text-txt-3"
        />
        <p v-if="props.sourceErrors?.url" class="text-[11px] text-bad">
          {{ props.sourceErrors.url }}
        </p>

        <input
          v-model="form.title"
          type="text"
          placeholder="Nom affiché"
          class="rounded-md border border-line-2 bg-panel px-2 py-1.5 text-[12px] placeholder:text-txt-3"
        />
        <p v-if="props.sourceErrors?.title" class="text-[11px] text-bad">
          {{ props.sourceErrors.title }}
        </p>

        <label class="mt-1 text-[11px] text-txt-3">Cadence (minutes)</label>
        <input
          v-model.number="form.fetchIntervalMinutes"
          type="number"
          min="5"
          max="10080"
          class="rounded-md border border-line-2 bg-panel px-2 py-1.5 text-[12px]"
        />
        <p v-if="props.sourceErrors?.fetchIntervalMinutes" class="text-[11px] text-bad">
          {{ props.sourceErrors.fetchIntervalMinutes }}
        </p>

        <button
          type="submit"
          class="mt-1 rounded-md border border-accent bg-accent px-2 py-1.5 text-[12px] text-white disabled:opacity-50"
          :disabled="submitting || !form.url.trim() || !form.title.trim()"
        >
          Ajouter
        </button>

        <p class="mt-1 text-[11px] leading-relaxed text-txt-3">
          RSS et Atom. Le serveur va chercher l’URL lui-même : les adresses locales et privées
          sont refusées.
        </p>
      </form>
    </div>
  </div>
</template>
