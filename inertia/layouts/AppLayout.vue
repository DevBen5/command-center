<script setup lang="ts">
import { ref, computed, watch, onMounted, onUnmounted } from 'vue'
import type { Component } from 'vue'
import { Link, router, usePage } from '@inertiajs/vue3'
import { useI18n } from 'vue-i18n'
import AppModal from '~/components/AppModal.vue'
// Icônes importées nommément : le barrel entier casserait le tree-shaking.
import {
  Bot,
  Box,
  Layers,
  LayoutDashboard,
  Rss,
  Search,
  Server,
  Settings,
  Users,
} from 'lucide-vue-next'
import { crumbKeys, isDestinationRoot } from './breadcrumb'

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

const { t, te } = useI18n()
const page = usePage()
// `nav` vaut null sur les pages non authentifiées (login, erreur) : aucune stat n'y est chargée.
const nav = computed(() => page.props.nav as NavStats | null)
const currentUser = computed(() => (page.props.user as CurrentUser | null) ?? null)
// Idem : null hors authentification, donc aucune entrée rendue.
const destinations = computed(
  () => (page.props.destinations as SharedDestination[] | null) ?? []
)

const isAdmin = computed(() => currentUser.value?.isAdmin === true)

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
 * ⚠️ **La règle de cette section, c'est qu'une entrée mène à un écran qui existe.** CC-81 avait
 * retiré « Journaux » et « Réglages » parce qu'elles pointaient toutes deux vers `/` : un refus
 * pour un non-admin sans `dashboard.view`, et l'accueil — pas ce qu'elles annonçaient — pour
 * tout le monde. « Journaux » reste donc absente ; il n'y a toujours pas d'écran derrière.
 *
 * « Réglages » revient parce que CC-114 lui en a donné un (`core/settings`). ⚠️ **Elle est
 * visible par tout le monde, contrairement à l'administration** : chacun y règle son propre
 * second facteur et sa langue, et un compte que la règle `ADMIN_2FA_REQUIRED` renvoie sur cet
 * écran doit précisément pouvoir l'atteindre. La borner à `is_admin` rejouerait le défaut de
 * CC-81 dans l'autre sens — un écran ouvert que la barre ne montre pas.
 *
 * L'administration, elle, reste réservée : elle ne s'ouvre pas par une capacité, sinon un rôle
 * pourrait donner accès à l'écran qui distribue les droits.
 */
const systemItems = computed<NavItem[]>(() => [
  { key: 'reglages', href: '/reglages', icon: Settings },
  ...(isAdmin.value ? [{ key: 'administration', href: '/admin/users', icon: Users }] : []),
])

function isActive(href: string): boolean {
  return href === '/' ? page.url === '/' : page.url.startsWith(href)
}

/** L'entrée de barre latérale qui correspond à la page ouverte — `null` hors authentification. */
const activeDestination = computed(() => navItems.value.find((i) => isActive(i.href)) ?? null)

/**
 * Le libellé de l'**écran** ouvert — `null` sur la racine d'un module, et sur tout écran dont le
 * module n'a pas posé de clé (CC-110).
 *
 * ⚠️ **Un repli sur `null`, jamais sur la clé.** Un `t()` sans clé correspondante rend son chemin en
 * texte brut : `leitner.ingestShow.crumb` s'afficherait dans la topbar. Ici l'absence ramène au
 * comportement d'avant ce lot — le fil s'arrête au module — ce qui est discret mais correct. Les
 * modules à i18n *plate* (`agents`, `services`, dont le `title` est à la racine du fichier et non
 * sous `index`) passent tous par ce chemin, et ils n'ont de toute façon qu'un seul écran.
 */
const crumbPage = computed(() => {
  const active = activeDestination.value
  if (!active || isDestinationRoot(page.url, active.href)) return null

  const key = crumbKeys(page.component).find((candidate) => te(candidate))
  return key === undefined ? null : t(key)
})

/**
 * Le segment **intermédiaire** : le module, devenu cliquable, et rendu seulement quand un écran le
 * suit. Sur la racine d'un module, le libellé reste dans le `<h1>` plutôt que d'être répété.
 */
const crumbSection = computed(() => (crumbPage.value === null ? null : activeDestination.value))

/**
 * ⚠️ **Le `<h1>` nomme l'écran, pas le module.** Avant CC-110 il portait le libellé de la
 * destination sur *toutes* ses sous-pages : les cinq écrans de `/revision` avaient « Révision » pour
 * unique titre de premier niveau. Ce n'était pas qu'un défaut de repérage — aucune de ces pages ne
 * rend son propre `<h1>`, donc c'était le seul de la page.
 */
const pageTitle = computed(
  () => crumbPage.value ?? t(`nav.${activeDestination.value?.key ?? 'accueil'}`)
)

/**
 * La racine du fil d'Ariane : **`destinations[0]`**, la première destination que ce compte peut
 * réellement ouvrir. `null` = aucun segment racine rendu.
 *
 * ⚠️ **Jamais un lien vers `/` en dur** (CC-83). Cette page exige `dashboard.view` : le seul
 * élément cliquable de la topbar répondrait alors 403 aux comptes qui n'ont pas cette capacité.
 * C'est exactement ce que CC-81 a retiré de la barre latérale avec « Journaux » et « Réglages ».
 * Le registre a déjà filtré cette liste côté serveur, et son premier élément est celui vers
 * lequel `landingFor()` redirige après connexion : la racine du fil d'Ariane et la page
 * d'atterrissage désignent donc le même écran par construction, sans second endroit à tenir.
 *
 * `null` couvre trois cas d'un même mécanisme, aucun n'est un cas de bord :
 *  - les pages non authentifiées (login, erreurs) où `destinations` est vide ;
 *  - **l'écran racine lui-même** — un second segment y répéterait mot pour mot le titre à sa
 *    droite (« Accueil / Accueil ») ;
 *  - **une page hors registre** (les écrans `/admin/*`) : `activeDestination` y est `null` et
 *    `pageTitle` retombe sur « Accueil », donc un crumb vers la racine réafficherait « Accueil /
 *    Accueil ». Le crumb ne remonte que depuis une sous-page d'une destination *connue*.
 */
const crumbRoot = computed(() => {
  const root = destinations.value[0]
  const active = activeDestination.value
  if (!root || !active || active.key === root.key) return null
  return root
})

const paletteOpen = ref(false)
const paletteQuery = ref('')

function openPalette(): void {
  paletteOpen.value = true
  paletteQuery.value = ''
  paletteIndex.value = 0
}

function closePalette(): void {
  paletteOpen.value = false
}

/**
 * Réduit une chaîne à sa forme comparable : sans accents, en minuscules. `NFD` décompose « é »
 * en « e » + combinante, que la classe `\u0300-\u036f` (les diacritiques combinants) retire —
 * « revision » retrouve donc « Révision ». Couvre les libellés saisis en NFC comme en NFD.
 */
function normalize(value: string): string {
  return value
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
}

/**
 * Le filtre de la palette, sur le **libellé traduit** (`t('nav.<key>')`), jamais la clé : « veille »
 * doit trouver « Veille », pas l'inverse. Requête vide → liste complète. Le fait que la forme
 * normalisée d'un libellé égale parfois sa clé (« revision » ⇄ « Révision ») est une coïncidence,
 * on ne matche pas la clé.
 */
function filterByLabel(items: NavItem[]): NavItem[] {
  const query = normalize(paletteQuery.value.trim())
  if (!query) return items
  return items.filter((item) => normalize(t(`nav.${item.key}`)).includes(query))
}

const filteredNavItems = computed(() => filterByLabel(navItems.value))
const filteredSystemItems = computed(() => filterByLabel(systemItems.value))
const paletteEmpty = computed(
  () => filteredNavItems.value.length === 0 && filteredSystemItems.value.length === 0
)

/**
 * La liste **plate ordonnée** parcourue au clavier : navigation puis système, dans l'ordre exact
 * du rendu — sinon ↓ ne suivrait pas l'œil. Le spread copie le tableau mais **garde les références**
 * des éléments : `selectedItem` désigne donc le même objet que celui rendu par le `v-for`, ce qui
 * rend le surlignage comparable par référence, sans risque de collision de clé.
 */
const paletteItems = computed(() => [...filteredNavItems.value, ...filteredSystemItems.value])
const paletteIndex = ref(0)
const selectedItem = computed(() => paletteItems.value[paletteIndex.value] ?? null)

/**
 * La sélection **se réinitialise à chaque frappe** (CC-27) : un index retenu d'une liste plus
 * longue pointerait dans le vide dès que le filtre la rétrécit — ↵ deviendrait inerte sans erreur.
 * Remis à 0, il reste valide tant qu'il reste au moins une entrée ; `openPalette` le repose aussi,
 * car remettre `paletteQuery` à `''` alors qu'elle l'est déjà ne déclenche pas ce watch.
 */
watch(paletteQuery, () => {
  paletteIndex.value = 0
})

/** ↑/↓ avec bouclage. Sort si la liste filtrée est vide, pour ne pas calculer un modulo par zéro. */
function moveSelection(delta: number): void {
  const count = paletteItems.value.length
  if (count === 0) return
  paletteIndex.value = (paletteIndex.value + delta + count) % count
}

/**
 * ↵ emprunte le **même chemin qu'un clic** sur `<Link>` : une visite Inertia GET, précédée de la
 * fermeture. Sans entrée sélectionnée (liste vide), on ne fait rien — la palette reste ouverte.
 */
function confirmSelection(): void {
  const item = selectedItem.value
  if (!item) return
  closePalette()
  router.visit(item.href)
}

function onKeydown(event: KeyboardEvent): void {
  const isMod = event.metaKey || event.ctrlKey
  if (isMod && event.key.toLowerCase() === 'k') {
    event.preventDefault()
    paletteOpen.value ? closePalette() : openPalette()
    return
  }
  // Tout le reste ne vaut que palette ouverte : sinon ↵ et les flèches seraient captées
  // globalement (le listener est sur `window`) alors que rien n'attend le focus.
  if (!paletteOpen.value) return
  if (event.key === 'Escape') {
    closePalette()
    return
  }
  if (event.key === 'ArrowDown') {
    event.preventDefault()
    moveSelection(1)
    return
  }
  if (event.key === 'ArrowUp') {
    event.preventDefault()
    moveSelection(-1)
    return
  }
  if (event.key === 'Enter') {
    event.preventDefault()
    confirmSelection()
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

      <!-- ⚠️ Le sélecteur de langue vivait ici, faute d'écran où le mettre. Il est descendu dans
           `/reglages` (CC-114) — c'est un réglage de compte, et la barre n'a pas à en porter un
           seul par manque de place. Le `mt-auto` qui poussait le bloc en bas a suivi. -->
      <div
        class="mt-auto flex items-center gap-[11px] border-t border-line px-[22px] py-[18px] text-xs text-txt-2"
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
      <header class="flex h-[66px] shrink-0 items-center gap-2.5 border-b border-line px-[30px]">
        <template v-if="crumbRoot">
          <Link
            :href="crumbRoot.href"
            class="text-[13px] text-txt-3 transition hover:text-txt"
            >{{ t(`nav.${crumbRoot.key}`) }}</Link
          >
          <span class="text-[13px] text-txt-3" aria-hidden="true">/</span>
        </template>
        <!-- Le module, cliquable, seulement quand un écran le suit (CC-110). Sur sa propre racine
             il reste dans le `<h1>` : « Révision / Révision » ne dirait rien de plus. -->
        <template v-if="crumbSection">
          <Link
            :href="crumbSection.href"
            class="text-[13px] text-txt-3 transition hover:text-txt"
            >{{ t(`nav.${crumbSection.key}`) }}</Link
          >
          <span class="text-[13px] text-txt-3" aria-hidden="true">/</span>
        </template>
        <h1 class="m-0 text-[18px] font-bold tracking-tight">{{ pageTitle }}</h1>
      </header>
      <div class="flex-1 overflow-x-hidden overflow-y-auto p-[30px]">
        <slot />
      </div>
    </div>

    <!-- Palette ⌘K (CC-209 : chassis partagé `AppModal`, voir le CLAUDE.md racine).
         `onKeydown` ci-dessus garde sa propre gestion d'Échap et de ↑↓/↵ (CC-26, CC-27) —
         redondante mais harmless avec celle du chassis, volontairement non touchée. -->
    <AppModal v-if="paletteOpen" v-slot="{ titleId }" @close="closePalette">
      <div
        class="mt-[120px] w-[640px] max-w-[90%] overflow-hidden rounded-[14px] border border-line-2 bg-panel shadow-2xl"
      >
        <h2 :id="titleId" class="sr-only">{{ t('palette.placeholder') }}</h2>
        <div class="flex items-center gap-3 border-b border-line px-[19px] py-[17px]">
          <Search :size="17" :stroke-width="1.5" aria-hidden="true" class="shrink-0 text-txt-3" />
          <!-- Pas d'`autofocus` : c'est AppModal qui pose le focus sur ce champ (premier
               élément focalisable) depuis CC-209 — un second mécanisme dessus serait redondant. -->
          <input
            v-model="paletteQuery"
            :placeholder="t('palette.placeholder')"
            class="flex-1 bg-transparent text-[15px] text-txt placeholder:text-txt-3 outline-none"
          />
        </div>
        <div class="py-2">
          <!-- Un titre de section sans résultat en dessous annoncerait une navigation qui n'existe
               pas : chaque section disparaît quand le filtre a vidé sa liste (cf. barre latérale). -->
          <template v-if="filteredNavItems.length">
            <div class="px-[19px] py-[7px] text-[10px] tracking-[.12em] text-txt-3 uppercase">
              {{ t('palette.navigation') }}
            </div>
            <Link
              v-for="item in filteredNavItems"
              :key="item.key"
              :href="item.href"
              class="flex items-center gap-3 px-[19px] py-[10px] text-[13px] text-txt hover:bg-accent-soft"
              :class="selectedItem === item ? 'bg-accent-soft' : ''"
              @click="closePalette"
            >
              {{ t('palette.goTo', { label: t(`nav.${item.key}`) }) }}
            </Link>
          </template>
          <template v-if="filteredSystemItems.length">
            <div class="px-[19px] py-[7px] text-[10px] tracking-[.12em] text-txt-3 uppercase">
              {{ t('palette.systeme') }}
            </div>
            <Link
              v-for="item in filteredSystemItems"
              :key="item.key"
              :href="item.href"
              class="flex items-center gap-3 px-[19px] py-[10px] text-[13px] text-txt hover:bg-accent-soft"
              :class="selectedItem === item ? 'bg-accent-soft' : ''"
              @click="closePalette"
            >
              {{ t('palette.goTo', { label: t(`nav.${item.key}`) }) }}
            </Link>
          </template>
          <!-- Le champ n'est plus inerte (CC-26) : quand rien ne correspond, on le dit, plutôt que
               de laisser croire qu'aucune page n'existe. -->
          <div v-if="paletteEmpty" class="px-[19px] py-[10px] text-[13px] text-txt-3">
            {{ t('palette.empty') }}
          </div>
        </div>
        <div
          class="flex gap-[18px] border-t border-line px-[19px] py-[10px] text-[11px] text-txt-3"
        >
          <span>↑↓ {{ t('palette.navigate') }}</span>
          <span>↵ {{ t('palette.open') }}</span>
          <span>esc {{ t('palette.close') }}</span>
        </div>
      </div>
    </AppModal>
  </div>
</template>
