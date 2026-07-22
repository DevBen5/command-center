<script setup lang="ts">
import { computed } from 'vue'
import { Head, router } from '@inertiajs/vue3'
import { Box, Search } from 'lucide-vue-next'
import AppLayout from '~/layouts/AppLayout.vue'

defineOptions({ layout: AppLayout })

interface Service {
  id: number
  name: string
  category: string
  url: string | null
  status: 'up' | 'down' | 'unknown'
  cpuPercent: number | null
  ramPercent: number | null
}

interface Stats {
  total: number
  up: number
  down: number
  cpuAvg: number
  ramAvg: number
}

const props = defineProps<{ services: Service[]; stats: Stats }>()

function restartAll(): void {
  for (const service of props.services.filter((s) => s.status === 'up')) {
    router.post(
      `/services/${service.id}/restart`,
      {},
      { preserveScroll: true, preserveState: true }
    )
  }
}

const categories = computed(() => {
  const groups = new Map<string, Service[]>()
  for (const service of props.services) {
    if (!groups.has(service.category)) groups.set(service.category, [])
    groups.get(service.category)?.push(service)
  }
  return [...groups.entries()]
})

const statusLabel: Record<Service['status'], string> = {
  up: 'ACTIF',
  down: 'ARRÊTÉ',
  unknown: 'INCONNU',
}

const dotClass: Record<Service['status'], string> = {
  up: 'bg-ok shadow-[0_0_8px_var(--color-ok)]',
  down: 'bg-bad shadow-[0_0_8px_var(--color-bad)]',
  unknown: 'bg-txt-3',
}

function act(service: Service, action: 'start' | 'stop' | 'restart'): void {
  router.post(`/services/${service.id}/${action}`, {}, { preserveScroll: true })
}
</script>

<template>
  <Head title="Services" />

  <!-- Barre d'outils -->
  <div class="mb-[18px] flex items-center gap-3">
    <div
      class="flex w-[300px] items-center gap-2.5 rounded-[9px] border border-line-2 bg-panel px-3.5 py-2.5 text-[13px] text-txt-3"
    >
      <Search :size="15" :stroke-width="1.5" aria-hidden="true" class="shrink-0" />
      Filtrer les services…
    </div>
    <span class="rounded-full border border-line-2 bg-panel-2 px-3 py-1.5 text-[11px] text-txt-2"
      >Catégorie ▾</span
    >
    <span class="rounded-full border border-line-2 bg-panel-2 px-3 py-1.5 text-[11px] text-txt-2"
      >Statut ▾</span
    >
    <div class="flex-1"></div>
    <div class="inline-flex overflow-hidden rounded-[9px] border border-line-2 bg-panel">
      <button type="button" class="bg-accent px-3.5 py-2 text-[12.5px] text-white">Grille</button>
      <button type="button" class="border-l border-line px-3.5 py-2 text-[12.5px] text-txt-2">
        Liste
      </button>
    </div>
    <button
      type="button"
      class="flex items-center gap-2 rounded-[9px] border border-line-2 bg-panel-2 px-3.5 py-2 text-[12.5px] transition hover:border-txt-3"
      @click="restartAll"
    >
      <span class="rounded-md border border-line-2 bg-panel px-1.5 py-0.5 font-mono text-[11px]"
        >R</span
      >
      Tout redémarrer
    </button>
  </div>

  <!-- Bande d'indicateurs -->
  <div class="mb-[22px] grid grid-cols-4 gap-3.5">
    <div class="rounded-[12px] border border-line bg-panel px-4 py-3.5">
      <div class="font-mono text-[24px] font-bold text-ok">
        {{ stats.up }}<span class="text-[13px] text-txt-3"> / {{ stats.total }}</span>
      </div>
      <div class="text-[11px] text-txt-3">services actifs</div>
    </div>
    <div class="rounded-[12px] border border-line bg-panel px-4 py-3.5">
      <div class="font-mono text-[24px] font-bold text-accent">{{ stats.down }}</div>
      <div class="text-[11px] text-txt-3">arrêté{{ stats.down > 1 ? 's' : '' }}</div>
    </div>
    <div class="rounded-[12px] border border-line bg-panel px-4 py-3.5">
      <div class="font-mono text-[24px] font-bold">
        {{ stats.cpuAvg }}<span class="text-[13px]"> %</span>
      </div>
      <div class="text-[11px] text-txt-3">CPU moyen (actifs)</div>
    </div>
    <div class="rounded-[12px] border border-line bg-panel px-4 py-3.5">
      <div class="font-mono text-[24px] font-bold">
        {{ stats.ramAvg }}<span class="text-[13px]"> %</span>
      </div>
      <div class="text-[11px] text-txt-3">RAM moyenne (actifs)</div>
    </div>
  </div>

  <div v-for="[category, services] in categories" :key="category" class="mb-8">
    <div class="mb-3 flex items-center gap-3">
      <h2 class="text-[12px] font-bold tracking-[.12em] text-txt-2 uppercase">{{ category }}</h2>
      <span class="font-mono text-[11px] text-txt-3">{{ services.length }}</span>
      <span class="h-px flex-1 bg-line"></span>
    </div>

    <div class="grid grid-cols-3 gap-4">
      <div
        v-for="service in services"
        :key="service.id"
        class="flex flex-col gap-3 rounded-[13px] border p-4"
        :class="
          service.status === 'down'
            ? 'border-bad/40 bg-linear-to-b from-bad/10 to-panel'
            : 'border-line bg-panel'
        "
      >
        <div class="flex items-center gap-3">
          <div
            class="grid h-8 w-8 shrink-0 place-items-center rounded-[9px] border border-line-2 bg-panel-2 text-txt-3"
          >
            <Box :size="16" :stroke-width="1.5" aria-hidden="true" />
          </div>
          <div class="text-[14px] font-semibold">{{ service.name }}</div>
          <div class="ml-auto flex items-center gap-1.5 font-mono text-[10px] tracking-[.06em]">
            <span class="h-2 w-2 rounded-full" :class="dotClass[service.status]"></span>
            {{ statusLabel[service.status] }}
          </div>
        </div>

        <div class="flex gap-4">
          <div class="flex-1">
            <div class="text-[9.5px] tracking-[.08em] text-txt-3 uppercase">CPU</div>
            <div class="mt-1 h-1.5 rounded-full bg-panel-2">
              <div
                class="h-full rounded-full bg-linear-to-r from-aqua to-accent"
                :style="{ width: `${service.cpuPercent ?? 0}%` }"
              ></div>
            </div>
            <div class="mt-1 font-mono text-[11px] text-txt-2">
              {{ service.cpuPercent !== null ? `${service.cpuPercent} %` : '—' }}
            </div>
          </div>
          <div class="flex-1">
            <div class="text-[9.5px] tracking-[.08em] text-txt-3 uppercase">RAM</div>
            <div class="mt-1 h-1.5 rounded-full bg-panel-2">
              <div
                class="h-full rounded-full bg-linear-to-r from-aqua to-accent"
                :style="{ width: `${service.ramPercent ?? 0}%` }"
              ></div>
            </div>
            <div class="mt-1 font-mono text-[11px] text-txt-2">
              {{ service.ramPercent !== null ? `${service.ramPercent} %` : '—' }}
            </div>
          </div>
        </div>

        <div class="flex gap-1.5">
          <button
            v-if="service.status === 'down'"
            type="button"
            class="flex-1 rounded-[9px] border border-accent bg-accent px-2 py-1.5 text-center text-[11.5px] text-white"
            @click="act(service, 'start')"
          >
            Démarrer
          </button>
          <button
            v-else
            type="button"
            class="flex-1 rounded-[9px] border border-line-2 bg-panel-2 px-2 py-1.5 text-center text-[11.5px]"
            @click="act(service, 'stop')"
          >
            Arrêter
          </button>
          <button
            type="button"
            class="flex-1 rounded-[9px] border border-line-2 bg-panel-2 px-2 py-1.5 text-center text-[11.5px]"
            @click="act(service, 'restart')"
          >
            Redémarrer
          </button>
        </div>
      </div>
    </div>
  </div>
</template>
