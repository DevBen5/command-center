<script setup lang="ts">
import { ref, computed, onMounted, onUnmounted } from 'vue'
import { Link, router, usePage } from '@inertiajs/vue3'

interface NavStats {
  services: { total: number; down: number }
  agents: { total: number; failed: number }
  veille: { queue: number }
  leitner: { due: number }
  host: string
}

const page = usePage()
const nav = computed(() => page.props.nav as NavStats | undefined)

interface NavItem {
  label: string
  href: string
  shortcut: string
  badge?: number
  alert?: boolean
}

const navItems = computed<NavItem[]>(() => [
  { label: 'Accueil', href: '/', shortcut: 'g a' },
  {
    label: 'Services',
    href: '/services',
    shortcut: 'g s',
    badge: nav.value?.services.down || undefined,
    alert: (nav.value?.services.down ?? 0) > 0,
  },
  {
    label: 'Agents',
    href: '/agents',
    shortcut: 'g g',
    badge: nav.value?.agents.failed || undefined,
    alert: (nav.value?.agents.failed ?? 0) > 0,
  },
  {
    label: 'Veille',
    href: '/veille',
    shortcut: 'g v',
    badge: nav.value?.veille.queue || undefined,
  },
  {
    label: 'Révision',
    href: '/revision',
    shortcut: 'g r',
    badge: nav.value?.leitner.due || undefined,
    alert: (nav.value?.leitner.due ?? 0) > 0,
  },
])

const systemItems = [
  { label: 'Journaux', href: '/', shortcut: '' },
  { label: 'Réglages', href: '/', shortcut: 'g ,' },
]

function isActive(href: string): boolean {
  return href === '/' ? page.url === '/' : page.url.startsWith(href)
}

const pageTitle = computed(
  () => navItems.value.find((item) => isActive(item.href))?.label ?? 'Accueil'
)

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

function logout(): void {
  router.post('/logout')
}
</script>

<template>
  <div class="flex h-screen w-screen bg-bg text-txt font-sans">
    <aside class="flex w-[252px] shrink-0 flex-col border-r border-line bg-side">
      <div class="flex items-center gap-3 px-[22px] pt-6 pb-[18px]">
        <div
          class="grid h-8 w-8 place-items-center rounded-[9px] bg-linear-to-br from-accent to-[#8a1a8a] text-sm font-bold text-white shadow-[0_0_18px_var(--color-accent-soft)]"
        >
          C
        </div>
        <div>
          <b class="block text-sm tracking-tight">Centre de commande</b>
          <small class="block text-[11px] font-medium text-txt-3">poste de pilotage</small>
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

      <div class="px-[26px] pt-2 pb-2 text-[10px] tracking-[.14em] text-txt-3 uppercase">
        Pilotage
      </div>
      <nav class="flex flex-col gap-[3px] px-4">
        <Link
          v-for="item in navItems"
          :key="item.label"
          :href="item.href"
          class="relative flex items-center gap-3 rounded-[10px] px-[13px] py-[10px] text-[13.5px] font-medium transition"
          :class="
            isActive(item.href)
              ? 'bg-accent-soft text-txt before:absolute before:left-0 before:top-[9px] before:bottom-[9px] before:w-[3px] before:rounded-r-[3px] before:bg-accent before:shadow-[0_0_10px_var(--color-accent)]'
              : 'text-txt-2 hover:bg-panel hover:text-txt'
          "
        >
          <span
            class="h-[18px] w-[18px] rounded-[5px] border-[1.5px] border-current opacity-70"
            :class="isActive(item.href) ? 'text-accent opacity-100' : ''"
          ></span>
          {{ item.label }}
          <span
            v-if="item.badge"
            class="ml-auto grid h-[19px] min-w-[22px] place-items-center rounded-full px-1.5 font-mono text-[11px]"
            :class="item.alert ? 'bg-accent text-white' : 'bg-panel-2 text-txt-2 border border-line'"
          >
            {{ item.badge }}
          </span>
          <span v-else class="ml-auto font-mono text-[11px] text-txt-3">{{ item.shortcut }}</span>
        </Link>
      </nav>

      <div class="px-[26px] pt-[18px] pb-2 text-[10px] tracking-[.14em] text-txt-3 uppercase">
        Système
      </div>
      <nav class="flex flex-col gap-[3px] px-4">
        <Link
          v-for="item in systemItems"
          :key="item.label"
          :href="item.href"
          class="flex items-center gap-3 rounded-[10px] px-[13px] py-[10px] text-[13.5px] font-medium text-txt-2 opacity-55 transition hover:bg-panel hover:text-txt"
        >
          <span class="h-[18px] w-[18px] rounded-[5px] border-[1.5px] border-current opacity-70"></span>
          {{ item.label }}
          <span v-if="item.shortcut" class="ml-auto font-mono text-[11px] text-txt-3">{{
            item.shortcut
          }}</span>
        </Link>
      </nav>

      <div
        class="mt-auto flex items-center gap-[11px] border-t border-line px-[22px] py-[18px] text-xs text-txt-2"
      >
        <div class="h-[30px] w-[30px] shrink-0 rounded-full bg-linear-to-br from-aqua to-accent"></div>
        <div class="min-w-0">
          <div class="truncate font-semibold text-txt">Hôte : {{ nav?.host ?? '—' }}</div>
          <div class="text-[11px]">
            {{ nav?.services.total ?? 0 }} services · {{ nav?.agents.total ?? 0 }} agents
          </div>
        </div>
        <button
          type="button"
          class="ml-auto shrink-0 rounded-lg border border-line-2 px-2.5 py-[7px] text-[11px] text-txt-3 transition hover:border-accent hover:text-txt"
          title="Se déconnecter"
          @click="logout"
        >
          Quitter →
        </button>
      </div>
    </aside>

    <div class="flex min-w-0 flex-1 flex-col">
      <header class="flex h-[66px] shrink-0 items-center gap-3.5 border-b border-line px-[30px]">
        <span class="text-[13px] text-txt-3">Pilotage /</span>
        <h1 class="m-0 text-[18px] font-bold tracking-tight">{{ pageTitle }}</h1>
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
            :key="item.label"
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
