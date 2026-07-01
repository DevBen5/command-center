<script setup lang="ts">
import { ref, onMounted, onUnmounted } from 'vue'
import { Link, usePage } from '@inertiajs/vue3'

const page = usePage()

const navItems = [
  { label: 'Accueil', href: '/', shortcut: 'g a' },
  { label: 'Services', href: '/services', shortcut: 'g s' },
  { label: 'Agents', href: '/agents', shortcut: 'g g' },
  { label: 'Veille', href: '/veille', shortcut: 'g v' },
  { label: 'Révision', href: '/revision', shortcut: 'g r' },
]

function isActive(href: string): boolean {
  return href === '/' ? page.url === '/' : page.url.startsWith(href)
}

const paletteOpen = ref(false)
const paletteQuery = ref('')

function openPalette(): void {
  paletteOpen.value = true
  paletteQuery.value = ''
}

function closePalette(): void {
  paletteOpen.value = false
}

function onKeydown(event: KeyboardEvent): void {
  const isMod = event.metaKey || event.ctrlKey
  if (isMod && event.key.toLowerCase() === 'k') {
    event.preventDefault()
    paletteOpen.value ? closePalette() : openPalette()
    return
  }
  if (event.key === 'Escape') {
    closePalette()
  }
}

onMounted(() => window.addEventListener('keydown', onKeydown))
onUnmounted(() => window.removeEventListener('keydown', onKeydown))
</script>

<template>
  <div class="flex h-screen w-screen bg-bg text-txt font-sans">
    <aside class="w-[252px] shrink-0 bg-side border-r border-line flex flex-col">
      <div class="flex items-center gap-3 px-[22px] pt-6 pb-[18px]">
        <div
          class="w-8 h-8 rounded-[9px] bg-linear-to-br from-accent to-[#8a1a8a] grid place-items-center text-white font-bold text-sm"
        >
          C
        </div>
        <div>
          <b class="block text-sm tracking-tight">Centre de commande</b>
          <small class="block text-[11px] text-txt-3 font-medium">poste de pilotage</small>
        </div>
      </div>

      <button
        type="button"
        class="mx-[18px] mb-4 flex items-center justify-between gap-2 rounded-[10px] border border-line-2 bg-panel px-[13px] py-[11px] text-[12.5px] text-txt-3 transition hover:border-accent hover:text-txt-2"
        @click="openPalette"
      >
        <span>Rechercher / commande…</span>
        <span class="rounded-md border border-line-2 bg-panel-2 px-1.5 py-0.5 font-mono text-[11px]"
          >⌘K</span
        >
      </button>

      <div class="px-[26px] pb-2 text-[10px] tracking-[.14em] text-txt-3 uppercase">Pilotage</div>
      <nav class="flex flex-col gap-[3px] px-4">
        <Link
          v-for="item in navItems"
          :key="item.href"
          :href="item.href"
          class="relative flex items-center gap-3 rounded-[10px] px-[13px] py-[10px] text-[13.5px] font-medium transition"
          :class="
            isActive(item.href)
              ? 'bg-accent-soft text-txt'
              : 'text-txt-2 hover:bg-panel hover:text-txt'
          "
        >
          <span
            class="h-[18px] w-[18px] rounded-[5px] border-[1.5px] border-current opacity-70"
          ></span>
          {{ item.label }}
          <span class="ml-auto font-mono text-[11px] text-txt-3">{{ item.shortcut }}</span>
        </Link>
      </nav>

      <div
        class="mt-auto flex items-center gap-[11px] border-t border-line px-[22px] py-[18px] text-xs text-txt-2"
      >
        <div
          class="h-[30px] w-[30px] shrink-0 rounded-full bg-linear-to-br from-aqua to-accent"
        ></div>
        <div>
          <div class="font-semibold text-txt">Hôte : —</div>
          <div class="text-[11px]">Services · Agents</div>
        </div>
      </div>
    </aside>

    <div class="flex min-w-0 flex-1 flex-col">
      <header class="flex h-[66px] shrink-0 items-center gap-3.5 border-b border-line px-[30px]">
        <span class="text-[13px] text-txt-3">Pilotage /</span>
        <h1 class="m-0 text-[18px] font-bold tracking-tight"><slot name="title">Accueil</slot></h1>
      </header>
      <div class="flex-1 overflow-x-hidden overflow-y-auto p-[30px]">
        <slot />
      </div>
    </div>

    <div
      v-if="paletteOpen"
      class="fixed inset-0 z-50 flex items-start justify-center bg-[rgba(4,5,14,.6)] pt-[120px]"
      @click.self="closePalette"
    >
      <div
        class="w-[640px] max-w-[90%] overflow-hidden rounded-[14px] border border-line-2 bg-panel shadow-2xl"
      >
        <div class="flex items-center gap-3 border-b border-line px-[19px] py-[17px]">
          <span class="h-[17px] w-[17px] rounded-full border-[1.5px] border-txt-3"></span>
          <input
            v-model="paletteQuery"
            autofocus
            placeholder="Tapez une commande, un service, un agent…"
            class="flex-1 bg-transparent text-[15px] text-txt placeholder:text-txt-3 outline-none"
          />
        </div>
        <div class="py-2">
          <div class="px-[19px] py-[7px] text-[10px] tracking-[.12em] text-txt-3 uppercase">
            Navigation
          </div>
          <Link
            v-for="item in navItems"
            :key="item.href"
            :href="item.href"
            class="flex items-center gap-3 px-[19px] py-[10px] text-[13px] text-txt hover:bg-accent-soft"
            @click="closePalette"
          >
            Aller à — {{ item.label }}
          </Link>
        </div>
        <div
          class="flex gap-[18px] border-t border-line px-[19px] py-[10px] text-[11px] text-txt-3"
        >
          <span>↑↓ naviguer</span>
          <span>↵ ouvrir</span>
          <span>esc fermer</span>
        </div>
      </div>
    </div>
  </div>
</template>
