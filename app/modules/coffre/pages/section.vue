<script setup lang="ts">
import { computed, onMounted, onUnmounted, ref } from 'vue'
import { Head, Link, router } from '@inertiajs/vue3'
import { useI18n } from 'vue-i18n'
import AppLayout from '~/layouts/AppLayout.vue'
import ConfirmModal from '~/components/ConfirmModal.vue'
import { CLIPBOARD_CLEAR_MS, clearClipboardIn, clipboardAvailable, copyText } from '~/utils/clipboard'
import type { CoffreEntryType, CoffreSectionKey } from '../shared/entry_sections.js'
import EntryFormModal from '../components/EntryFormModal.vue'

defineOptions({ layout: AppLayout })

/**
 * La page d'UNE section du coffre (CC-208) — `/coffre/<section>`. Porte tout ce que l'ancien
 * `pages/index.vue` faisait sur la liste complète : accordéon, révélation/copie de mot de passe,
 * édition, suppression, aperçu des médias. L'accueil (`pages/index.vue`) n'en garde qu'un résumé.
 *
 * ⚠️ **Le serveur a déjà filtré `entries` à la section demandée** (`CoffreController#section`, via
 * `groupEntriesByNature` — jamais une requête SQL par type, voir le ticket). Cette page ne fait
 * qu'afficher ce qu'on lui donne, elle ne filtre rien elle-même.
 */
interface CoffreEntry {
  id: number
  type: CoffreEntryType
  /**
   * Déjà déchiffré côté serveur — le chiffré ne descend jamais jusqu'ici.
   *
   * ⚠️ Sur un `credential`, `title` est le **service** et `content` le **nom d'utilisateur**. Le
   * mot de passe n'est PAS dans cette charge utile (CC-179) : il se demande une entrée à la fois
   * par `GET /coffre/:id/secret`.
   */
  title: string
  content: string
  createdAt: string | null
  /** ⚠️ Seul l'`id` de la ligne voyage jusqu'ici, jamais l'UUID Immich (CC-180). */
  media: { id: number }[]
  /** ⚠️ Seuls l'`id` et le `kind` voyagent jusqu'ici, jamais le chemin sur le disque (CC-181). */
  nasFiles: { id: number; kind: 'video' | 'photo' }[]
}

const props = defineProps<{
  section: CoffreSectionKey
  entries: CoffreEntry[]
  immichFolderAvailable: boolean
}>()

const { t } = useI18n()

/** Combien de temps un mot de passe révélé reste à l'écran avant de se re-masquer seul. */
const REVEAL_MS = 20_000

/** Le titre de la section — clés **littérales**, une clé calculée échapperait à `keys.spec.ts`. */
function sectionLabel(key: CoffreSectionKey): string {
  if (key === 'url') return t('coffre.index.sectionUrl')
  if (key === 'credential') return t('coffre.index.sectionCredential')
  if (key === 'photo') return t('coffre.index.sectionPhoto')

  return t('coffre.index.sectionNote')
}

/** Le libellé du bouton d'ajout — un par section, cohérent avec « le type est déjà décidé ». */
function addLabel(key: CoffreSectionKey): string {
  if (key === 'url') return t('coffre.index.addUrl')
  if (key === 'credential') return t('coffre.index.addCredential')
  if (key === 'photo') return t('coffre.index.addPhoto')

  return t('coffre.index.addNote')
}

/**
 * Le type imposé au formulaire de création (CC-208) : identique à la section pour les trois
 * natures réelles ; `'note'` — arbitraire, jamais affiché — pour Photos, qui n'est pas un `type`
 * mais une priorité d'affichage sur la présence de médias (voir `entry_sections.ts`).
 */
const presetType = computed<CoffreEntryType>(() => (props.section === 'photo' ? 'note' : props.section))

/**
 * La modale de création/édition (CC-207) — `modalEntry` à `null` = création. Portée entière dans
 * `components/EntryFormModal.vue` : `v-if` la démonte à la fermeture, ce qui efface tout état
 * local (y compris un mot de passe frappé non soumis) sans rien à faire ici.
 */
const modalOpen = ref(false)
const modalEntry = ref<CoffreEntry | null>(null)
const confirmModal = ref<InstanceType<typeof ConfirmModal> | null>(null)

function openCreate(): void {
  modalEntry.value = null
  modalOpen.value = true
}

function startEdit(entry: CoffreEntry): void {
  modalEntry.value = entry
  modalOpen.value = true
}

function closeModal(): void {
  modalOpen.value = false
  modalEntry.value = null
}

/** Quelle entrée est dépliée — le contenu ne s'affiche pas de lui-même. */
const opened = ref<number | null>(null)

/**
 * Le presse-papiers est-il utilisable ici ?
 *
 * ⚠️ **Lu au montage, jamais à la volée dans le template** : `navigator` n'existe pas à
 * l'évaluation du module côté rendu, et un test de disponibilité qui lèverait laisserait la page
 * blanche. Faux tant qu'on ne sait pas — donc l'écran propose d'emblée le chemin de secours.
 */
const copiePossible = ref(false)

/** Le mot de passe actuellement révélé, et pour quelle entrée. Jamais plus d'un à la fois. */
const revele = ref<{ id: number; secret: string } | null>(null)

/** L'entrée dont le mot de passe vient de partir au presse-papiers. */
const copie = ref<number | null>(null)

/** Un message d'échec attaché à une entrée — sa clé i18n, jamais le secret. */
const echec = ref<{ id: number; message: string } | null>(null)

let annulerEffacement: (() => void) | null = null
let masquage: ReturnType<typeof setTimeout> | null = null

onMounted(() => {
  copiePossible.value = clipboardAvailable()
})

/**
 * ⚠️ **Le secret révélé ne survit pas au démontage.** Sans ça, une navigation Inertia laisserait
 * un minuteur de re-masquage tourner pour un écran qui n'existe plus.
 *
 * ⚠️ **L'effacement du presse-papiers, lui, n'est PAS annulé — c'est délibéré.** L'annuler
 * signifierait qu'il suffit de quitter la page dans les trente secondes pour que le mot de passe
 * y reste indéfiniment, ce qui est exactement ce qu'on cherche à éviter. Le minuteur vit dans le
 * contexte JS de l'application, donc il survit à la navigation Inertia et finit son travail.
 */
onUnmounted(() => {
  masquerSecret()
})

/**
 * ⚠️ **On oublie à chaque bascule, pas seulement quand on replie la ligne courante.** Ne le faire
 * qu'au repli laisserait le secret de l'entrée A vivre en mémoire après un clic sur l'entrée B :
 * il ne serait plus **affiché** (le rendu est conditionné à `opened`), donc rien ne se verrait —
 * et c'est précisément ce qui le rendrait durable.
 */
function toggle(id: number): void {
  oublier()

  opened.value = opened.value === id ? null : id
}

/** Efface tout ce qui, à l'écran, porte encore un secret ou son souvenir. */
function oublier(): void {
  masquerSecret()
  copie.value = null
  echec.value = null
}

function masquerSecret(): void {
  revele.value = null
  if (masquage !== null) clearTimeout(masquage)
  masquage = null
}

/**
 * Va chercher le mot de passe d'une entrée. `null` si ça n'a pas abouti — l'écran le dit alors.
 *
 * ⚠️ **`fetch`, jamais `router.get`** : le client Inertia range les props de page dans
 * `history.state`, donc un secret passé par une prop serait écrit sur le disque du navigateur par
 * l'historique, et y resterait après la fermeture du coffre.
 *
 * ⚠️ **`accept: application/json`** : sans cet en-tête, un refus (élévation expirée) reviendrait
 * en page HTML 403 au lieu d'un corps exploitable — voir la négociation de `renderForbidden`.
 */
async function demanderSecret(id: number): Promise<string | null> {
  echec.value = null

  try {
    const response = await fetch(`/coffre/${id}/secret`, {
      headers: { accept: 'application/json' },
    })

    if (!response.ok) {
      echec.value = {
        id,
        message: response.status === 403 ? t('coffre.index.locked') : t('coffre.index.secretError'),
      }
      return null
    }

    return ((await response.json()) as { secret: string }).secret
  } catch {
    echec.value = { id, message: t('coffre.index.secretError') }
    return null
  }
}

/** Le geste nominal : le mot de passe part au presse-papiers **sans jamais toucher le DOM**. */
async function copierSecret(id: number): Promise<void> {
  oublier()

  const secret = await demanderSecret(id)
  if (secret === null) return

  const outcome = await copyText(secret)

  if (outcome !== 'ok') {
    echec.value = {
      id,
      message:
        outcome === 'unavailable'
          ? t('coffre.index.copyUnavailable')
          : t('coffre.index.copyRefused'),
    }
    return
  }

  copie.value = id
  // Un seul minuteur à la fois : deux copies successives ne doivent pas laisser le premier
  // effacer le presse-papiers pendant que la seconde valeur y est encore utile.
  annulerEffacement?.()
  annulerEffacement = clearClipboardIn(CLIPBOARD_CLEAR_MS)
}

/** Le chemin de secours : afficher, faute de pouvoir copier — ou parce qu'on le demande. */
async function afficherSecret(id: number): Promise<void> {
  oublier()

  const secret = await demanderSecret(id)
  if (secret === null) return

  revele.value = { id, secret }
  masquage = setTimeout(masquerSecret, REVEAL_MS)
}

async function remove(id: number): Promise<void> {
  if (!(await confirmModal.value?.ask(t('coffre.index.deleteConfirm'), { danger: true }))) return

  // Une visite Inertia re-rend le composant sans le démonter : sans cet oubli, le secret d'une
  // entrée qu'on vient de supprimer survivrait à la ligne qui le portait.
  oublier()
  router.delete(`/coffre/${id}`)
}

function lock(): void {
  // Verrouiller efface ce qui est à l'écran avant même la réponse du serveur : le contenu ne doit
  // pas rester visible pendant l'aller-retour.
  oublier()
  closeModal()
  router.post('/coffre/verrouiller')
}

/** Le libellé d'une nature. Clés **littérales** : une clé calculée échappe à `keys.spec.ts`. */
function natureLabel(type: CoffreEntryType): string {
  if (type === 'url') return t('coffre.index.typeUrl')
  if (type === 'credential') return t('coffre.index.typeCredential')

  return t('coffre.index.typeNote')
}
</script>

<template>
  <Head :title="`${t('coffre.index.title')} — ${sectionLabel(section)}`" />

  <div class="mx-auto grid w-full max-w-[900px] gap-6">
    <Link href="/coffre" class="text-[12.5px] text-txt-3 hover:text-aqua">
      {{ t('coffre.index.backToCoffre') }}
    </Link>

    <header class="flex items-start justify-between gap-4">
      <h1 class="text-[20px] font-bold">{{ sectionLabel(section) }}</h1>
      <div class="flex shrink-0 gap-2">
        <button
          type="button"
          class="rounded-[7px] border border-accent bg-accent px-4 py-2.5 text-[13px] font-semibold text-bg hover:opacity-90"
          @click="openCreate"
        >
          {{ addLabel(section) }}
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

    <section class="rounded-[14px] border border-line bg-panel">
      <p v-if="entries.length === 0" class="p-6 text-[13px] text-txt-3">
        {{ t('coffre.index.cardEmpty') }}
      </p>

      <article
        v-for="entry in entries"
        :key="entry.id"
        class="border-b border-line px-6 py-4 last:border-b-0"
      >
        <div class="flex items-center justify-between gap-4">
          <button
            type="button"
            class="flex-1 text-left text-[14px] text-txt hover:text-aqua"
            :aria-expanded="opened === entry.id ? 'true' : 'false'"
            :aria-controls="opened === entry.id ? `coffre-entry-panel-${entry.id}` : undefined"
            @click="toggle(entry.id)"
          >
            <span class="mr-2 text-[11px] tracking-[.12em] text-txt-3 uppercase">
              {{ natureLabel(entry.type) }}
            </span>
            <!-- Un titre vide signe un déchiffrement échoué : on le NOMME plutôt que d'afficher
                 une ligne muette, qui laisserait croire à une entrée sans titre. -->
            {{ entry.title || t('coffre.index.unreadable') }}
          </button>
          <button
            type="button"
            class="shrink-0 text-[12.5px] text-txt-3 hover:text-aqua"
            @click="startEdit(entry)"
          >
            {{ t('coffre.index.edit') }}
          </button>
          <button
            type="button"
            class="shrink-0 text-[12.5px] text-txt-3 hover:text-bad"
            @click="remove(entry.id)"
          >
            {{ t('coffre.index.delete') }}
          </button>
        </div>

        <div v-if="opened === entry.id" :id="`coffre-entry-panel-${entry.id}`">
          <ul v-if="entry.media.length > 0" class="mt-3 flex flex-wrap gap-2">
            <li
              v-for="media in entry.media"
              :key="media.id"
              class="overflow-hidden rounded-[8px] border border-line-2"
            >
              <img
                :src="`/coffre/media/${media.id}/thumbnail`"
                class="block h-20 w-20 object-cover"
                alt=""
              />
            </li>
          </ul>

          <ul v-if="entry.nasFiles.length > 0" class="mt-3 flex flex-wrap gap-2">
            <li
              v-for="file in entry.nasFiles"
              :key="file.id"
              class="overflow-hidden rounded-[8px] border border-line-2"
            >
              <!-- ⚠️ `kind` choisit l'élément — le serveur ne redescend jamais le chemin, donc
                   jamais l'extension : sans ce champ, l'écran ne pourrait pas savoir quoi rendre. -->
              <video
                v-if="file.kind === 'video'"
                :src="`/coffre/nas/${file.id}/stream`"
                class="block max-h-64 max-w-full"
                controls
                preload="metadata"
              />
              <img
                v-else
                :src="`/coffre/nas/${file.id}/stream`"
                class="block max-h-64 max-w-full object-contain"
                alt=""
              />
            </li>
          </ul>

          <div v-if="entry.type === 'credential'" class="mt-3 grid gap-3">
            <div class="rounded-[8px] bg-panel-2 p-4">
              <p class="text-[11px] tracking-[.12em] text-txt-3 uppercase">
                {{ t('coffre.index.username') }}
              </p>
              <p class="mt-1 font-mono text-[13px] break-all text-txt-2">{{ entry.content }}</p>
            </div>

            <div class="flex flex-wrap items-center gap-2">
              <button
                type="button"
                :disabled="!copiePossible"
                class="rounded-[7px] border border-line-2 px-3.5 py-2 text-[12.5px] text-txt hover:border-aqua disabled:cursor-not-allowed disabled:opacity-50"
                @click="copierSecret(entry.id)"
              >
                {{
                  copie === entry.id
                    ? t('coffre.index.secretCopied')
                    : t('coffre.index.copySecret')
                }}
              </button>
              <button
                type="button"
                class="rounded-[7px] border border-line-2 px-3.5 py-2 text-[12.5px] text-txt-2 hover:border-aqua"
                @click="revele?.id === entry.id ? masquerSecret() : afficherSecret(entry.id)"
              >
                {{
                  revele?.id === entry.id
                    ? t('coffre.index.hideSecret')
                    : t('coffre.index.showSecret')
                }}
              </button>
            </div>

            <p v-if="!copiePossible" class="text-[12px] text-warn">
              {{ t('coffre.index.copyUnavailable') }}
            </p>
            <p v-if="copie === entry.id" class="text-[12px] text-txt-3">
              {{ t('coffre.index.clipboardNotice') }}
            </p>
            <p v-if="echec?.id === entry.id" class="text-[12px] text-bad">{{ echec.message }}</p>

            <!-- ⚠️ Le mot de passe n'entre dans le DOM QUE là, et seulement après un clic sur
                 « Afficher ». Il en repart au re-masquage, au repli de la ligne, au verrouillage
                 et au démontage de la page. -->
            <p
              v-if="revele?.id === entry.id"
              class="rounded-[8px] border border-aqua/40 bg-panel-2 p-4 font-mono text-[13px] break-all text-txt"
            >
              {{ revele.secret }}
            </p>
          </div>

          <pre
            v-else
            class="mt-3 overflow-x-auto rounded-[8px] bg-panel-2 p-4 font-mono text-[12.5px] whitespace-pre-wrap text-txt-2"
            >{{ entry.content }}</pre
          >
        </div>
      </article>
    </section>

    <EntryFormModal
      v-if="modalOpen"
      :entry="modalEntry"
      :immich-folder-available="immichFolderAvailable"
      :preset-type="presetType"
      @close="closeModal"
    />
  </div>

  <ConfirmModal ref="confirmModal" />
</template>
