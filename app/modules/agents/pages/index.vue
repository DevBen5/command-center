<script setup lang="ts">
import { Head, router } from '@inertiajs/vue3'
import AppLayout from '~/layouts/AppLayout.vue'

defineOptions({ layout: AppLayout })

interface Agent {
  id: number
  name: string
  framework: string
  status: 'active' | 'idle' | 'running' | 'failed'
  config: Record<string, unknown>
}

interface Stats {
  active: number
  running: number
  failed: number
  total: number
}

const props = defineProps<{
  agents: Agent[]
  selected: Agent | null
  stats: Stats
  recentLogs: string[]
}>()

const dotClass: Record<Agent['status'], string> = {
  active: 'bg-ok shadow-[0_0_8px_var(--color-ok)]',
  running: 'bg-warn shadow-[0_0_8px_var(--color-warn)] animate-pulse',
  idle: 'bg-txt-3',
  failed: 'bg-bad shadow-[0_0_8px_var(--color-bad)]',
}

const statusLabel: Record<Agent['status'], string> = {
  active: 'Actif',
  running: 'En cours',
  idle: 'Inactif',
  failed: 'En échec',
}

function select(agent: Agent): void {
  router.get('/agents', { id: agent.id }, { preserveScroll: true, preserveState: true })
}

function run(agent: Agent): void {
  router.post(`/agents/${agent.id}/run`, {}, { preserveScroll: true, preserveState: true })
}

function stop(agent: Agent): void {
  router.post(`/agents/${agent.id}/stop`, {}, { preserveScroll: true, preserveState: true })
}
</script>

<template>
  <Head title="Agents" />

  <!-- Barre d'outils -->
  <div class="mb-4 flex items-center gap-3">
    <div
      class="flex w-[280px] items-center gap-2.5 rounded-[9px] border border-line-2 bg-panel px-3.5 py-2.5 text-[13px] text-txt-3"
    >
      <span class="h-[15px] w-[15px] shrink-0 rounded-full border-[1.5px] border-current"></span>
      Filtrer les agents…
    </div>
    <div class="flex-1"></div>
    <span class="rounded-[9px] border border-line-2 bg-panel-2 px-3.5 py-2 text-[12.5px] text-txt-2"
      >Framework : Hermes ▾</span
    >
    <button
      type="button"
      class="rounded-[9px] border border-accent bg-accent px-3.5 py-2 text-[12.5px] text-white"
    >
      + Nouvel agent
    </button>
  </div>

  <!-- Bande d'indicateurs -->
  <div class="mb-[18px] grid grid-cols-4 gap-3.5">
    <div class="rounded-[12px] border border-line bg-panel px-4 py-3.5">
      <div class="font-mono text-[24px] font-bold text-ok">{{ stats.active }}</div>
      <div class="text-[11px] text-txt-3">agents actifs</div>
    </div>
    <div class="rounded-[12px] border border-line bg-panel px-4 py-3.5">
      <div class="font-mono text-[24px] font-bold text-warn">{{ stats.running }}</div>
      <div class="text-[11px] text-txt-3">en cours d'exécution</div>
    </div>
    <div class="rounded-[12px] border border-line bg-panel px-4 py-3.5">
      <div class="font-mono text-[24px] font-bold text-accent">{{ stats.failed }}</div>
      <div class="text-[11px] text-txt-3">en échec</div>
    </div>
    <div class="rounded-[12px] border border-line bg-panel px-4 py-3.5">
      <div class="font-mono text-[24px] font-bold">{{ stats.total }}</div>
      <div class="text-[11px] text-txt-3">agents au total</div>
    </div>
  </div>

  <div
    class="grid min-h-[560px] grid-cols-[minmax(280px,360px)_1fr] overflow-hidden rounded-[14px] border border-line bg-panel"
  >
    <div class="border-r border-line bg-bg-2">
      <div class="flex items-center gap-2.5 border-b border-line p-4 text-[12px] font-semibold">
        {{ agents.length }} agents
      </div>
      <button
        v-for="agent in agents"
        :key="agent.id"
        type="button"
        class="flex w-full items-center gap-3 border-b border-line px-4 py-3.5 text-left transition"
        :class="
          selected?.id === agent.id
            ? 'bg-accent-soft shadow-[inset_3px_0_0_var(--color-accent)]'
            : 'hover:bg-panel-2'
        "
        @click="select(agent)"
      >
        <div class="min-w-0 flex-1">
          <div class="flex items-center gap-2 text-[13px] font-semibold">
            <span class="h-2 w-2 rounded-full" :class="dotClass[agent.status]"></span>
            {{ agent.name }}
          </div>
          <div class="mt-0.5 text-[11.5px] text-txt-2">
            {{ statusLabel[agent.status] }} · {{ agent.framework }}
          </div>
        </div>
      </button>
    </div>

    <div v-if="selected" class="min-w-0">
      <div class="flex items-center gap-3 border-b border-line p-4">
        <span class="h-2 w-2 rounded-full" :class="dotClass[selected.status]"></span>
        <span class="font-semibold">{{ selected.name }}</span>
        <span
          class="rounded-full border border-line-2 bg-panel-2 px-2.5 py-0.5 text-[11px] text-txt-2"
        >
          {{ statusLabel[selected.status] }}
        </span>
        <div class="ml-auto flex gap-2">
          <button
            v-if="selected.status === 'running' || selected.status === 'active'"
            type="button"
            class="rounded-[9px] border border-line-2 bg-panel-2 px-3.5 py-2 text-[12.5px]"
            @click="stop(selected)"
          >
            Stopper
          </button>
          <button
            v-else
            type="button"
            class="rounded-[9px] border border-accent bg-accent px-3.5 py-2 text-[12.5px] text-white"
            @click="run(selected)"
          >
            Lancer
          </button>
        </div>
      </div>

      <div class="border-b border-line p-4 text-[13px] text-txt-2">
        <div class="text-[10px] tracking-[.06em] text-txt-3 uppercase">Config</div>
        <pre class="mt-2 font-mono text-[11.5px] whitespace-pre-wrap text-txt-2">{{
          JSON.stringify(selected.config, null, 2)
        }}</pre>
      </div>

      <div class="p-4">
        <div class="mb-2 flex items-center gap-2 text-[11px] text-txt-3">
          <span
            class="rounded-md border border-line-2 bg-panel-2 px-1.5 py-0.5 font-mono text-[10px]"
            >LOGS</span
          >
          {{ recentLogs.length }} dernières lignes
        </div>
        <div class="rounded-[10px] bg-bg-2 p-4 font-mono text-[11.5px] leading-[1.85] text-txt-2">
          <div v-for="(line, i) in recentLogs" :key="i">{{ line }}</div>
          <div v-if="recentLogs.length === 0" class="text-txt-3">Aucun log récent.</div>
        </div>
      </div>
    </div>
  </div>
</template>
