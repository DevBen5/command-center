<script setup lang="ts">
import { ref, computed, onMounted, onUnmounted } from 'vue'
import type { Component } from 'vue'
import { Link, router, usePage } from '@inertiajs/vue3'
import { useI18n } from 'vue-i18n'
// Icônes importées nommément : le barrel entier casserait le tree-shaking.
import { Bot, Box, Layers, LayoutDashboard, Rss, Search, Server, Users } from 'lucide-vue-next'

interface NavStats {
  services: { total: number; down: number } | null
  agents: { total: number; failed: number } | null
  veille: { queue: number } | null
  leitner: { due: number } | null
  host: string
}

interface CurrentUser {
  fullName: string | null
  email: string
  isAdmin: boolean
  capabilities: string[]
}

/** Une destination envoyée par le serveur : le registre a déjà appliqué le filtrage. */
interface SharedDestination {
  key: string
  href: string
}

const { t } = useI18n()
const page = usePage()
// `nav` vaut null sur les pages non authentifiées (login, erreur) : aucune stat n'y est chargée.
const nav = computed(() => page.props.nav as NavStats | null)
const currentUser = computed(() => (page.props.user as CurrentUser | null) ?? null)
// Idem : null hors authentification, donc aucune entrée rendue.
const destinations = computed(
  () => (page.props.destinations as SharedDestination[] | null) ?? []
)

const isAdmin = computed(() => currentUser.value?.isAdmin === true)
const locale = computed(() => (page.props.locale as string | undefined) ?? 'fr')
const supportedLocales = computed(
  () => (page.props.supportedLocales as string[] | undefined) ?? ['fr']
)

interface NavItem {
  key: string
  href: string
  // L'icône se déclare avec l'entrée : le template n'a pas à connaître les clés.
  icon: Component
  // `undefined` = stat non chargée (pas de pastille) ; 0 = stat chargée et nulle (pastille neutre).
  badge?: number
  alert?: boolean
}

/**
 * ⚠️ **Les entrées viennent du serveur, le layout ne décide plus qui voit quoi.** Elles sortent
 * du registre de destinations (`#core/shared/navigation/registry`), qui sert aussi à calculer
 * la page d'atterrissage après connexion. Avant CC-81 cette liste vivait ici, en double de ce
 * que les routes exigeaient : deux endroits à mettre d'accord, et rien pour signaler qu'ils
 * avaient divergé.
 *
 * ⚠️ **Masquer une entrée n'est toujours pas un droit** : la route reste fermée par son
 * middleware de capacité, que la barre l'affiche ou non. Ce filtrage — désormais serveur —
 * sert à ne pas proposer des liens qui répondraient 403. Les deux, jamais l'un sans l'autre.
 *
 * Ce qui reste au client : le libellé (`nav.<key>`), l'icône, et la pastille. Une icône est un
 * composant Vue, elle n'a rien à faire dans un payload.
 */
const NAV_ICONS: Record<string, Component> = {
  accueil: LayoutDashboard,
  services: Server,
  agents: Bot,
  veille: Rss,
  revision: Layers,
}

/**
 * La pastille d'une entrée, et **la distinction qui compte** : `undefined` = stat non chargée,
 * donc aucune pastille ; `0` = stat chargée et nulle, donc pastille neutre. Un `?? 0` ajouté
 * par mégarde peuplerait la barre de zéros.
 */
function badgeFor(key: string): { badge?: number; alert?: boolean } {
  const stats = nav.value
  switch (key) {
    case 'services':
      return { badge: stats?.services?.down, alert: (stats?.services?.down ?? 0) > 0 }
    case 'agents':
      return { badge: stats?.agents?.failed, alert: (stats?.agents?.failed ?? 0) > 0 }
    case 'veille':
      return { badge: stats?.veille?.queue }
    case 'revision':
      return { badge: stats?.leitner?.due, alert: (stats?.leitner?.due ?? 0) > 0 }
    default:
      return {}
  }
}

const navItems = computed<NavItem[]>(() =>
  destinations.value.map((destination) => ({
    ...destination,
    // Une clé sans icône est un module qui a déclaré sa destination sans passer par ici :
    // une icône neutre plutôt qu'une entrée sans repère visuel.
    icon: NAV_ICONS[destination.key] ?? Box,
    ...badgeFor(destination.key),
  }))
)

/**
 * ⚠️ **« Journaux » et « Réglages » ont été retirées** : elles pointaient toutes deux vers `/`,
 * une page qui exige `dashboard.view` — donc deux liens vers un refus pour un non-admin, et
 * vers l'accueil (pas vers ce qu'elles annoncent) pour tout le monde. Ces écrans n'existent
 * pas ; les afficher les promettait.
 *
 * L'administration reste : elle a une vraie page, et elle ne s'ouvre pas par une capacité —
 * sinon un rôle pourrait donner accès à l'écran qui distribue les droits.
 */
const systemItems = computed<NavItem[]>(() =>
  isAdmin.value ? [{ key: 'administration', href: '/admin/users', icon: Users }] : []
)

function isActive(href: string): boolean {
  return href === '/' ? page.url === '/' : page.url.startsWith(href)
}

const pageTitle = computed(() => {
  const item = navItems.value.find((i) => isActive(i.href))
  return t(`nav.${item?.key ?? 'accueil'}`)
})

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

function switchLocale(next: string): void {
  if (next === locale.value) return
  router.post('/locale', { locale: next }, { preserveScroll: true })
}
</script>

<template>
  <div class="flex h-screen w-screen bg-bg text-txt font-sans">
    <aside class="flex w-[252px] shrink-0 flex-col border-r border-line bg-side">
      <div class="flex items-center gap-3 px-[22px] pt-6 pb-[18px]">
        <div
          class="grid h-8 w-8 place-items-center rounded-[9px] bg-linear-to-br from-accent to-accent-deep text-sm font-bold text-white shadow-[0_0_18px_var(--color-accent-soft)]"
        >
          C
        </div>
        <div>
          <b class="block text-sm tracking-tight">{{ t('brand.title') }}</b>
          <small class="block text-[11px] font-medium text-txt-3">{{ t('brand.subtitle') }}</small>
        </div>
      </div>

      <button
        type="button"
        class="mx-[18px] mb-4 flex items-center justify-between gap-2 rounded-[10px] border border-line-2 bg-panel px-[13px] py-[11px] text-[12.5px] text-txt-3 transition hover:border-accent hover:text-txt-2"
        @click="openPalette"
      >
        <span>{{ t('search.placeholder') }}</span>
        <span class="rounded-md border border-line-2 bg-panel-2 px-1.5 py-0.5 font-mono text-[11px]"
          >⌘K</span
        >
      </button>

      <!-- Un titre de section sans entrée en dessous annoncerait une navigation qui n'existe
           pas : les deux sections disparaissent avec leur contenu. -->
      <div
        v-if="navItems.length"
        class="px-[26px] pt-2 pb-2 text-[10px] tracking-[.14em] text-txt-3 uppercase"
      >
        {{ t('nav.sectionPilotage') }}
      </div>
      <nav class="flex flex-col gap-[3px] px-4">
        <Link
          v-for="item in navItems"
          :key="item.key"
          :href="item.href"
          class="relative flex items-center gap-3 rounded-[10px] px-[13px] py-[10px] text-[13.5px] font-medium transition"
          :class="
            isActive(item.href)
              ? 'bg-accent-soft text-txt before:absolute before:top-[9px] before:bottom-[9px] before:left-0 before:w-[3px] before:rounded-r-[3px] before:bg-accent before:shadow-[0_0_10px_var(--color-accent)]'
              : 'text-txt-2 hover:bg-panel hover:text-txt'
          "
        >
          <component
            :is="item.icon"
            :size="18"
            :stroke-width="1.5"
            aria-hidden="true"
            class="shrink-0 opacity-70"
            :class="isActive(item.href) ? 'text-accent opacity-100' : ''"
          />
          {{ t(`nav.${item.key}`) }}
          <span
            v-if="item.badge !== undefined"
            class="ml-auto grid h-[19px] min-w-[22px] place-items-center rounded-full px-1.5 font-mono text-[11px]"
            :class="
              item.alert ? 'bg-accent text-white' : 'border border-line bg-panel-2 text-txt-2'
            "
          >
            {{ item.badge }}
          </span>
        </Link>
      </nav>

      <div
        v-if="systemItems.length"
        class="px-[26px] pt-[18px] pb-2 text-[10px] tracking-[.14em] text-txt-3 uppercase"
      >
        {{ t('nav.sectionSysteme') }}
      </div>
      <nav class="flex flex-col gap-[3px] px-4">
        <Link
          v-for="item in systemItems"
          :key="item.key"
          :href="item.href"
          class="flex items-center gap-3 rounded-[10px] px-[13px] py-[10px] text-[13.5px] font-medium text-txt-2 opacity-55 transition hover:bg-panel hover:text-txt"
        >
          <component
            :is="item.icon"
            :size="18"
            :stroke-width="1.5"
            aria-hidden="true"
            class="shrink-0 opacity-70"
          />
          {{ t(`nav.${item.key}`) }}
        </Link>
      </nav>

      <!-- Sélecteur de langue -->
      <div class="mt-auto px-4 pt-4">
        <div class="mb-1.5 px-2 text-[10px] tracking-[.14em] text-txt-3 uppercase">
          {{ t('sidebar.language') }}
        </div>
        <div class="inline-flex overflow-hidden rounded-lg border border-line-2">
          <button
            v-for="lng in supportedLocales"
            :key="lng"
            type="button"
            class="px-3 py-1.5 text-[11px] font-medium uppercase transition"
            :class="lng === locale ? 'bg-accent text-white' : 'bg-panel text-txt-2 hover:text-txt'"
            @click="switchLocale(lng)"
          >
            {{ lng }}
          </button>
        </div>
      </div>

      <div
        class="mt-3 flex items-center gap-[11px] border-t border-line px-[22px] py-[18px] text-xs text-txt-2"
      >
        <div
          class="h-[30px] w-[30px] shrink-0 rounded-full bg-linear-to-br from-aqua to-accent"
        ></div>
        <div class="min-w-0">
          <div class="truncate font-semibold text-txt">
            {{ t('sidebar.host', { host: nav?.host ?? '—' }) }}
          </div>
          <div class="text-[11px]">
            {{
              t('sidebar.counts', {
                services: nav?.services?.total ?? 0,
                agents: nav?.agents?.total ?? 0,
              })
            }}
          </div>
        </div>
        <button
          type="button"
          class="ml-auto shrink-0 rounded-lg border border-line-2 px-2.5 py-[7px] text-[11px] text-txt-3 transition hover:border-accent hover:text-txt"
          :title="t('sidebar.logoutTitle')"
          @click="logout"
        >
          {{ t('sidebar.logout') }}
        </button>
      </div>
    </aside>

    <div class="flex min-w-0 flex-1 flex-col">
      <header class="flex h-[66px] shrink-0 items-center gap-3.5 border-b border-line px-[30px]">
        <span class="text-[13px] text-txt-3">{{ t('topbar.crumb') }}</span>
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
          <Search :size="17" :stroke-width="1.5" aria-hidden="true" class="shrink-0 text-txt-3" />
          <input
            v-model="paletteQuery"
            autofocus
            :placeholder="t('palette.placeholder')"
            class="flex-1 bg-transparent text-[15px] text-txt placeholder:text-txt-3 outline-none"
          />
        </div>
        <div class="py-2">
          <div class="px-[19px] py-[7px] text-[10px] tracking-[.12em] text-txt-3 uppercase">
            {{ t('palette.navigation') }}
          </div>
          <Link
            v-for="item in navItems"
            :key="item.key"
            :href="item.href"
            class="flex items-center gap-3 px-[19px] py-[10px] text-[13px] text-txt hover:bg-accent-soft"
            @click="closePalette"
          >
            {{ t('palette.goTo', { label: t(`nav.${item.key}`) }) }}
          </Link>
        </div>
        <div
          class="flex gap-[18px] border-t border-line px-[19px] py-[10px] text-[11px] text-txt-3"
        >
          <span>↑↓ {{ t('palette.navigate') }}</span>
          <span>↵ {{ t('palette.open') }}</span>
          <span>esc {{ t('palette.close') }}</span>
        </div>
      </div>
    </div>
  </div>
</template>
