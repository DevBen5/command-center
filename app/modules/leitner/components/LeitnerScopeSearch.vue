<script setup lang="ts">
import { computed, nextTick, ref, watch } from 'vue'
import { router } from '@inertiajs/vue3'
import { ChevronDown, Search } from 'lucide-vue-next'
import { filterScopes, type CategoryChoice, type ScopeMatch } from './leitner_scope_search'

/*
| La barre de recherche de l'écran de choix : on tape un nom de catégorie ou de
| thème, la liste s'affine ; le chevron déplie l'arbre entier ; un clic — ou Entrée
| — ouvre la session sur ce paquet.
|
| Elle **s'ajoute** à l'arbre, elle ne le remplace pas : la barre est l'accès rapide
| quand on sait ce qu'on veut, l'arbre reste la seule vue d'ensemble de ce qui est dû.
|
| ⚠️ **Ce n'est pas `TaxonomyCombobox`, et ça ne doit pas le devenir.** Les deux
| partagent une *interaction*, pas une *donnée* :
|
|   - celui-là rend une **chaîne** (`update:modelValue`) ; celui-ci une **navigation**
|     vers `?category=<id>` / `?theme=<id>` — donc des ids et des comptes dus, pas un
|     `string[]` plat ;
|   - celui-là autorise le **texte libre** (« Créer « X » ») ; ici c'est exclu :
|     `/revision` ne fait que réviser, il ne crée rien, jamais ;
|   - celui-là filtre en `toLowerCase().includes()` ; ici il faut les accents (taper
|     `securite` doit trouver « Sécurité » — voir `normalizeForSearch`).
|
| Fusionner les deux coûterait plus que ça ne rapporte. Ce qui est repris, en
| revanche, ce sont ses pièges de focus/blur déjà résolus : `mousedown.prevent` pour
| que le champ ne perde pas le focus avant que le clic n'aboutisse.
|
| Pas de `filtering` comme chez lui, en revanche : son champ porte une **valeur**
| déjà choisie (d'où le besoin de rouvrir la liste entière malgré elle), le nôtre ne
| porte qu'une **requête**. L'arbre entier s'affiche exactement quand elle est vide —
| ce qui est le cas au chargement, donc « déplier tout sans rien taper » est le
| comportement naturel du chevron.
|
| ⚠️ `components/` n'est pas `pages/` : la résolution Inertia fait un glob sur les
| .vue de tout dossier `pages/`. Un composant posé là deviendrait une page.
*/
const props = defineProps<{ categories: CategoryChoice[] }>()

const query = ref('')
const open = ref(false)
/** L'index dans `matches` du paquet sous le curseur clavier ; -1 = aucun. */
const activeIndex = ref(-1)
const input = ref<HTMLInputElement | null>(null)
const list = ref<HTMLElement | null>(null)

const matches = computed(() => filterScopes(props.categories, query.value))

/** Les seuls index où ↑↓ ont le droit de s'arrêter : un paquet à 0 ne s'ouvre pas. */
const selectableIndexes = computed(() =>
  matches.value.flatMap((match, index) => (match.selectable ? [index] : []))
)

// La saisie change : on réarme sur le premier paquet ouvrable, pour qu'Entrée ait
// toujours un sens sans avoir à passer par ↓.
watch(matches, () => {
  activeIndex.value = selectableIndexes.value[0] ?? -1
})

function openList(): void {
  open.value = true
  activeIndex.value = selectableIndexes.value[0] ?? -1
}

function toggle(): void {
  if (open.value) {
    open.value = false
    return
  }

  openList()
  void nextTick(() => input.value?.focus())
}

/**
 * ↑↓ ne parcourent que les paquets ouvrables : s'arrêter sur un paquet à 0
 * laisserait Entrée sans effet, sans que l'utilisateur sache pourquoi.
 */
function move(delta: number): void {
  const indexes = selectableIndexes.value
  if (indexes.length === 0) {
    activeIndex.value = -1
    return
  }

  open.value = true
  const current = indexes.indexOf(activeIndex.value)
  const next =
    current === -1
      ? delta > 0
        ? 0
        : indexes.length - 1
      : (current + delta + indexes.length) % indexes.length

  activeIndex.value = indexes[next]
  void scrollActiveIntoView()
}

async function scrollActiveIntoView(): Promise<void> {
  await nextTick()
  const element = list.value?.children[activeIndex.value]
  if (element instanceof HTMLElement) element.scrollIntoView({ block: 'nearest' })
}

/** Le seul chemin d'ouverture : le clic et Entrée y passent tous les deux. */
function choose(match: ScopeMatch): void {
  // Un paquet à 0 se montre mais ne s'ouvre pas — ni au clic, ni à l'Entrée.
  if (!match.selectable) return
  open.value = false
  router.visit(match.href)
}

function enter(): void {
  // Liste fermée (Échap), champ encore focalisé : Entrée ne ressuscite pas un choix
  // que l'utilisateur ne voit plus.
  if (!open.value) return

  const match = matches.value[activeIndex.value]
  if (match) choose(match)
}

function dueLabel(count: number): string {
  return count > 1 ? `${count} dues` : `${count} due`
}
</script>

<template>
  <div class="relative">
    <div
      class="flex items-center gap-2.5 rounded-[11px] border bg-panel px-3.5 py-2.5 transition"
      :class="open ? 'border-accent' : 'border-line-2'"
    >
      <Search :size="15" :stroke-width="1.5" aria-hidden="true" class="shrink-0 text-txt-3" />

      <input
        ref="input"
        v-model="query"
        type="text"
        placeholder="Chercher une catégorie ou un thème…"
        aria-label="Chercher une catégorie ou un thème"
        class="flex-1 bg-transparent text-[13px] outline-none placeholder:text-txt-3"
        @focus="openList"
        @blur="open = false"
        @input="open = true"
        @keydown.down.prevent="move(1)"
        @keydown.up.prevent="move(-1)"
        @keydown.enter.prevent="enter"
        @keydown.esc="open = false"
      />

      <!-- Le chevron : déplie l'arbre entier, sans rien taper. `mousedown.prevent`
           garde le focus sur le champ pour que taper filtre aussitôt. -->
      <button
        type="button"
        tabindex="-1"
        :aria-label="open ? 'Replier la liste' : 'Déplier tous les paquets'"
        class="shrink-0 text-txt-3 transition hover:text-accent"
        @mousedown.prevent="toggle"
      >
        <ChevronDown
          :size="15"
          :stroke-width="1.5"
          aria-hidden="true"
          class="transition"
          :class="open ? 'rotate-180' : ''"
        />
      </button>
    </div>

    <!-- La liste. `mousedown.prevent` sur chaque ligne empêche le champ de perdre le
         focus avant que le clic n'ouvre. Le flou (clic ailleurs) ferme. -->
    <div
      v-if="open"
      ref="list"
      class="absolute z-20 mt-1.5 max-h-70 w-full overflow-y-auto rounded-[11px] border border-line bg-panel py-1.5 shadow-lg"
    >
      <button
        v-for="(match, index) in matches"
        :key="match.key"
        type="button"
        :disabled="!match.selectable"
        class="flex w-full items-center gap-3 px-3.5 py-2 text-left transition"
        :class="[match.selectable ? '' : 'text-txt-3', index === activeIndex ? 'bg-panel-2' : '']"
        @mousedown.prevent="choose(match)"
        @mouseenter="activeIndex = index"
      >
        <!-- Le chemin, toujours complet : « Linux » est à la fois une catégorie et un
             thème de DevOps — un thème affiché seul ne désignerait rien. -->
        <span class="flex-1 truncate text-[12.5px]">
          <span :class="match.themeName ? 'text-txt-3' : 'font-semibold'">
            {{ match.categoryName }}
          </span>
          <template v-if="match.themeName">
            <span class="text-txt-3"> · </span>
            <span>{{ match.themeName }}</span>
          </template>
        </span>

        <span
          class="shrink-0 font-mono text-[11.5px]"
          :class="match.selectable ? 'text-accent' : 'text-txt-3'"
        >
          {{ dueLabel(match.dueCount) }}
        </span>
      </button>

      <!-- Sans résultat, on le dit — et c'est tout : `/revision` ne crée rien. -->
      <div v-if="matches.length === 0" class="px-3.5 py-2 text-[12px] text-txt-3 italic">
        Aucune catégorie ni thème à ce nom.
      </div>

      <!-- L'aide clavier n'est affichée que parce que ↑↓, Entrée et Échap sont
           réellement implémentés au-dessus. Ne l'affiche jamais sans eux. -->
      <div
        v-else
        class="mt-1.5 border-t border-line px-3.5 pt-2 pb-0.5 font-mono text-[10.5px] text-txt-3"
      >
        ↑↓ naviguer · ↵ ouvrir · Échap fermer
      </div>
    </div>
  </div>
</template>
