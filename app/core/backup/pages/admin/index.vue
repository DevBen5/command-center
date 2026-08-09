<script setup lang="ts">
import { ref, watch } from 'vue'
import { Head, Link, router } from '@inertiajs/vue3'
import { RefreshCw } from 'lucide-vue-next'
import AppLayout from '~/layouts/AppLayout.vue'

defineOptions({ layout: AppLayout })

interface Dump {
  name: string
  sizeBytes: number
  ageDays: number
}

const props = defineProps<{
  keep: number
  dailyEnabled: boolean
  directoryReady: boolean
  mirrorConfigured: boolean
  encryptionConfigured: boolean
  dumps: Dump[]
  notice: string | null
  error: string | null
}>()

const keep = ref(props.keep)
const dailyEnabled = ref(props.dailyEnabled)
const triggering = ref(false)

// La ligne suit les props après chaque aller-retour (redirect().back()) — le formulaire ne doit
// pas garder une valeur périmée après un enregistrement réussi ailleurs.
watch(
  () => [props.keep, props.dailyEnabled],
  () => {
    keep.value = props.keep
    dailyEnabled.value = props.dailyEnabled
  }
)

function saveSettings(): void {
  router.put('/admin/sauvegarde', { keep: keep.value, dailyEnabled: dailyEnabled.value })
}

function triggerBackup(): void {
  triggering.value = true
  router.post(
    '/admin/sauvegarde',
    {},
    { onFinish: () => (triggering.value = false), preserveScroll: true }
  )
}

function formatSize(bytes: number): string {
  return `${Math.round(bytes / 1024)} Ko`
}
</script>

<template>
  <Head title="Sauvegarde" />

  <div class="flex max-w-3xl flex-col gap-6">
    <div>
      <Link href="/admin/users" class="text-[12.5px] text-txt-3 hover:text-txt">
        ← Utilisateurs
      </Link>
      <h2 class="mt-2 text-lg font-bold tracking-tight">Sauvegarde</h2>
      <p class="mt-1 text-[13px] text-txt-3">
        <template v-if="encryptionConfigured">
          Les dumps sont chiffrés avant de quitter le clair (clé publique age) — la clé privée
          n'est jamais sur cette machine.
        </template>
        <template v-else>
          Les dumps partent en clair : le dossier monté et le miroir doivent être des supports de
          confiance.
        </template>
      </p>
    </div>

    <p
      v-if="notice"
      class="rounded-lg border border-ok/30 bg-ok/10 px-3 py-2 text-[12.5px] text-ok"
    >
      {{ notice }}
    </p>
    <p
      v-if="error"
      class="rounded-lg border border-bad/30 bg-bad/10 px-3 py-2 text-[12.5px] text-bad"
    >
      {{ error }}
    </p>

    <div class="flex flex-col gap-3 rounded-xl border border-line-2 bg-panel p-4">
      <div class="flex items-center justify-between gap-4">
        <div class="text-[12.5px] text-txt-2">
          Dossier de sauvegarde
          <span :class="directoryReady ? 'text-ok' : 'text-bad'">
            {{ directoryReady ? '· monté' : '· introuvable' }}
          </span>
        </div>
        <div class="text-[12.5px] text-txt-2">
          Miroir hors-disque
          <span :class="mirrorConfigured ? 'text-ok' : 'text-txt-3'">
            {{ mirrorConfigured ? '· monté' : '· non configuré' }}
          </span>
        </div>
        <div class="text-[12.5px] text-txt-2">
          Chiffrement
          <span :class="encryptionConfigured ? 'text-ok' : 'text-txt-3'">
            {{ encryptionConfigured ? '· activé' : '· non configuré' }}
          </span>
        </div>
      </div>
      <p v-if="!directoryReady" class="text-[12px] text-bad">
        Aucune sauvegarde n'est possible : le volume n'est pas monté sur ce déploiement. Voir
        <code class="font-mono">BACKUP_DIR_PATH</code> dans <code class="font-mono">.env.production</code>.
      </p>

      <button
        type="button"
        :disabled="!directoryReady || triggering"
        class="flex w-fit items-center gap-2 rounded-lg bg-accent px-3 py-2 text-[12.5px] font-medium text-white transition hover:opacity-90 disabled:opacity-50"
        @click="triggerBackup"
      >
        <RefreshCw :size="14" :stroke-width="1.8" aria-hidden="true" />
        {{ triggering ? 'Sauvegarde en cours…' : 'Sauvegarder maintenant' }}
      </button>
    </div>

    <form
      class="flex flex-col gap-4 rounded-xl border border-line-2 bg-panel p-4"
      @submit.prevent="saveSettings"
    >
      <label class="flex flex-col gap-1.5 text-[12.5px] text-txt-2">
        Rétention (nombre de dumps locaux conservés)
        <input
          v-model.number="keep"
          type="number"
          min="0"
          max="1000"
          class="w-32 rounded-lg border border-line-2 bg-panel-2 px-3 py-2 text-[13px] text-txt outline-none focus:border-accent"
        />
      </label>

      <label class="flex items-center gap-2 text-[12.5px] text-txt-2">
        <input v-model="dailyEnabled" type="checkbox" class="accent-accent" />
        Sauvegarde automatique quotidienne
      </label>

      <button
        type="submit"
        class="w-fit rounded-lg bg-accent px-3 py-2 text-[12.5px] font-medium text-white transition hover:opacity-90"
      >
        Enregistrer
      </button>
    </form>

    <div class="flex flex-col gap-2">
      <div class="text-[10.5px] tracking-[.12em] text-txt-3 uppercase">
        Dumps ({{ dumps.length }})
      </div>
      <p v-if="dumps.length === 0" class="text-[12.5px] text-txt-3">Aucune sauvegarde pour l'instant.</p>
      <div
        v-for="dump in dumps"
        :key="dump.name"
        class="flex items-center justify-between gap-4 rounded-xl border border-line-2 bg-panel px-4 py-2.5"
      >
        <span class="truncate font-mono text-[12px] text-txt">{{ dump.name }}</span>
        <span class="shrink-0 text-[11.5px] text-txt-3">
          {{ formatSize(dump.sizeBytes) }} · {{ dump.ageDays === 0 ? "aujourd'hui" : `${dump.ageDays} j` }}
        </span>
      </div>
    </div>
  </div>
</template>
