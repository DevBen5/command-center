<script setup lang="ts">
import { computed, ref } from 'vue'
import { Head, Link, router } from '@inertiajs/vue3'
import { useI18n } from 'vue-i18n'
import { KeyRound, Link2, NotebookText, Image as ImageIcon } from 'lucide-vue-next'
import AppLayout from '~/layouts/AppLayout.vue'
import {
  sectionCardsFor,
  SECTION_SLUGS,
  type CoffreEntryType,
  type CoffreSectionKey,
} from '../shared/entry_sections.js'
import EntryFormModal from '../components/EntryFormModal.vue'

defineOptions({ layout: AppLayout })

/**
 * L'accueil du coffre (CC-208) — une carte par section, façon `app/core/dashboard/pages/home.vue`
 * (grille de deux colonnes, en-tête cliquable, aperçu des derniers éléments). La liste complète
 * avec accordéon, secret, édition et suppression a déménagé dans `pages/section.vue` — cette page
 * ne fait plus que résumer et aiguiller.
 *
 * ⚠️ **Ce fichier reçoit `entries` en entier, comme avant CC-208** : les compteurs et aperçus se
 * calculent ici, côté client, sur ce que le serveur envoie déjà déchiffré. Pas de requête de plus
 * pour les cartes — voir `CoffreController#index`, inchangé par ce lot.
 */
interface CoffreCardEntry {
  id: number
  type: CoffreEntryType
  title: string
  media: { id: number }[]
  nasFiles: { id: number; kind: 'video' | 'photo' }[]
}

const props = defineProps<{ entries: CoffreCardEntry[]; immichFolderAvailable: boolean }>()

const { t } = useI18n()

/** Combien d'entrées récentes une carte montre en aperçu, avant qu'il faille ouvrir la section. */
const PREVIEW_COUNT = 3

/**
 * Les quatre cartes, TOUJOURS les quatre — même une section sans entrée (CC-208, un renversement
 * assumé de CC-204 : voir `sectionCardsFor` pour la raison). `groupEntriesByNature` ne change pas
 * de contrat, c'est cet appel qui complète.
 */
const cards = computed(() => sectionCardsFor(props.entries))

const ICONS: Record<CoffreSectionKey, unknown> = {
  note: NotebookText,
  url: Link2,
  credential: KeyRound,
  photo: ImageIcon,
}

/** Le libellé d'une section. Clés **littérales** : une clé calculée échapperait à `keys.spec.ts`. */
function sectionLabel(key: CoffreSectionKey): string {
  if (key === 'url') return t('coffre.index.sectionUrl')
  if (key === 'credential') return t('coffre.index.sectionCredential')
  if (key === 'photo') return t('coffre.index.sectionPhoto')

  return t('coffre.index.sectionNote')
}

function sectionHref(key: CoffreSectionKey): string {
  return `/coffre/${SECTION_SLUGS[key]}`
}

/**
 * Le bouton global (CC-207) : le type se choisit librement, c'est le seul endroit où il se
 * choisit encore — chaque page de section impose le sien (`presetType`, voir `section.vue`).
 */
const modalOpen = ref(false)

function lock(): void {
  router.post('/coffre/verrouiller')
}
</script>

<template>
  <Head :title="t('coffre.index.title')" />

  <div class="mx-auto grid w-full max-w-[900px] gap-6">
    <header class="flex items-start justify-between gap-4">
      <p class="max-w-[560px] text-[13px] text-txt-2">{{ t('coffre.index.lead') }}</p>
      <div class="flex shrink-0 gap-2">
        <Link
          href="/coffre/catalog"
          class="rounded-[7px] border border-line-2 px-4 py-2.5 text-[13px] text-txt hover:border-aqua"
        >
          {{ t('coffre.index.catalogLink') }}
        </Link>
        <button
          type="button"
          class="rounded-[7px] border border-accent bg-accent px-4 py-2.5 text-[13px] font-semibold text-bg hover:opacity-90"
          @click="modalOpen = true"
        >
          {{ t('coffre.index.addTitle') }}
        </button>
        <button
          type="button"
          class="rounded-[7px] border border-line-2 px-4 py-2.5 text-[13px] text-txt hover:border-aqua"
          @click="lock"
        >
          {{ t('coffre.index.lock') }}
        </button>
      </div>
    </header>

    <div class="grid grid-cols-2 gap-5">
      <div
        v-for="card in cards"
        :key="card.key"
        class="overflow-hidden rounded-[14px] border border-line bg-panel"
      >
        <Link
          :href="sectionHref(card.key)"
          class="flex items-center gap-3 border-b border-line px-[18px] py-4 transition hover:bg-panel-2"
        >
          <div
            class="grid h-[30px] w-[30px] place-items-center rounded-lg border border-line-2 bg-accent-soft text-accent"
          >
            <component :is="ICONS[card.key]" :size="16" :stroke-width="1.5" aria-hidden="true" />
          </div>
          <h3 class="text-[15px] font-semibold">{{ sectionLabel(card.key) }}</h3>
          <span class="ml-auto font-mono text-[11.5px] text-txt-2">{{ card.entries.length }}</span>
        </Link>
        <div class="px-[18px] py-2">
          <Link
            v-for="entry in card.entries.slice(0, PREVIEW_COUNT)"
            :key="entry.id"
            :href="sectionHref(card.key)"
            class="flex items-center gap-3.5 border-b border-line py-3.5 last:border-0"
          >
            <span class="min-h-[34px] w-[3px] shrink-0 self-stretch rounded-[3px] bg-line-2"></span>
            <div class="flex-1 text-[13.5px] font-semibold">
              {{ entry.title || t('coffre.index.unreadable') }}
            </div>
          </Link>
          <div v-if="card.entries.length === 0" class="py-3.5 text-[12.5px] text-txt-2">
            {{ t('coffre.index.cardEmpty') }}
          </div>
        </div>
      </div>
    </div>

    <EntryFormModal
      v-if="modalOpen"
      :entry="null"
      :immich-folder-available="immichFolderAvailable"
      @close="modalOpen = false"
    />
  </div>
</template>
