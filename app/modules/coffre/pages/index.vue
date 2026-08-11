<script setup lang="ts">
import { computed, ref } from 'vue'
import { Head, Link, router } from '@inertiajs/vue3'
import { useI18n } from 'vue-i18n'
import { HardDrive, KeyRound, Link2, Lock, NotebookText, Image as ImageIcon } from 'lucide-vue-next'
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
 * L'accueil du coffre (CC-239) — le renversement de l'épique CC-224 : le coffre est d'abord un
 * accès aux SOURCES (Immich verrouillé, NAS), pas un carnet d'entrées. Deux grandes cartes de
 * source remplacent les quatre cartes par nature d'entrée de CC-208 ; Notes/Liens/Identifiants —
 * et « Photos », les entrées porteuses de pièces jointes manuelles — descendent en second niveau,
 * une rangée compacte sous les deux cartes. Ils RESTENT tous les quatre atteignables, rien n'est
 * supprimé du modèle de données ni de `entry_sections.ts` : c'est la hiérarchie d'affichage qui
 * bascule, pas le contenu.
 *
 * ⚠️ **`pages/catalog.vue` n'est PAS fusionnée ici, décision du ticket** : elle reste un écran de
 * recherche avancée multi-sources séparé, atteignable depuis `pages/section.vue` (« Voir le
 * catalogue »), pas depuis cet accueil.
 *
 * ⚠️ **Ce fichier reçoit `entries` en entier, comme depuis CC-208** : les compteurs de la rangée
 * second niveau se calculent ici, côté client, sur ce que le serveur envoie déjà déchiffré. Pas de
 * requête de plus — voir `CoffreController#index`, inchangé par ce lot.
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

/**
 * Les quatre cartes de second niveau, TOUJOURS les quatre (CC-208, inchangé) — seule la mise en
 * forme change : une rangée compacte plutôt qu'une grille de deux colonnes.
 */
const secondaryCards = computed(() => sectionCardsFor(props.entries))

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

    <!-- Les deux cartes de source (CC-239) — le cœur du nouvel accueil. -->
    <div class="grid grid-cols-1 gap-5 sm:grid-cols-2">
      <Link
        href="/coffre/nas"
        class="grid gap-3 rounded-[14px] border border-line bg-panel p-6 transition hover:border-aqua"
      >
        <div
          class="grid h-[42px] w-[42px] place-items-center rounded-lg border border-line-2 bg-accent-soft text-accent"
        >
          <HardDrive :size="20" :stroke-width="1.5" aria-hidden="true" />
        </div>
        <h2 class="text-[17px] font-bold">{{ t('coffre.index.sourceNasTitle') }}</h2>
        <p class="text-[12.5px] text-txt-2">{{ t('coffre.index.sourceNasLead') }}</p>
        <span class="text-[12.5px] font-semibold text-aqua">{{ t('coffre.index.browseSource') }} →</span>
      </Link>

      <Link
        href="/coffre/immich"
        class="grid gap-3 rounded-[14px] border border-line bg-panel p-6 transition hover:border-aqua"
      >
        <div
          class="grid h-[42px] w-[42px] place-items-center rounded-lg border border-line-2 bg-accent-soft text-accent"
        >
          <Lock :size="20" :stroke-width="1.5" aria-hidden="true" />
        </div>
        <h2 class="text-[17px] font-bold">{{ t('coffre.index.sourceImmichTitle') }}</h2>
        <p class="text-[12.5px] text-txt-2">{{ t('coffre.index.sourceImmichLead') }}</p>
        <span class="text-[12.5px] font-semibold text-aqua">{{ t('coffre.index.browseSource') }} →</span>
      </Link>
    </div>

    <!-- Notes, Liens, Identifiants, Photos (pièces jointes manuelles) — second niveau (CC-239). -->
    <section class="grid gap-2">
      <h3 class="text-[11px] tracking-[.12em] text-txt-3 uppercase">
        {{ t('coffre.index.secondaryNavTitle') }}
      </h3>
      <div class="grid grid-cols-2 gap-2.5 sm:grid-cols-4">
        <Link
          v-for="card in secondaryCards"
          :key="card.key"
          :href="sectionHref(card.key)"
          class="flex items-center gap-2.5 rounded-[10px] border border-line bg-panel px-3.5 py-3 transition hover:border-aqua"
        >
          <component :is="ICONS[card.key]" :size="15" :stroke-width="1.5" aria-hidden="true" />
          <span class="text-[12.5px] font-semibold">{{ sectionLabel(card.key) }}</span>
          <span class="ml-auto font-mono text-[11px] text-txt-3">{{ card.entries.length }}</span>
        </Link>
      </div>
    </section>

    <EntryFormModal
      v-if="modalOpen"
      :entry="null"
      :immich-folder-available="immichFolderAvailable"
      @close="modalOpen = false"
    />
  </div>
</template>
