<script setup lang="ts">
import { onMounted, onUnmounted, ref } from 'vue'
import { Head, router, useForm } from '@inertiajs/vue3'
import { useI18n } from 'vue-i18n'
import AppLayout from '~/layouts/AppLayout.vue'
import { CLIPBOARD_CLEAR_MS, clearClipboardIn, clipboardAvailable, copyText } from '~/utils/clipboard'

defineOptions({ layout: AppLayout })

type CoffreEntryType = 'note' | 'url' | 'credential'

interface CoffreEntry {
  id: number
  type: CoffreEntryType
  /**
   * Déjà déchiffré côté serveur — le chiffré ne descend jamais jusqu'ici.
   *
   * ⚠️ Sur un `credential`, `title` est le **service** et `content` le **nom d'utilisateur**. Le
   * mot de passe n'est PAS dans cette charge utile, et il ne doit jamais y entrer (CC-179) : il
   * se demande une entrée à la fois par `GET /coffre/:id/secret`.
   */
  title: string
  content: string
  createdAt: string | null
}

defineProps<{ entries: CoffreEntry[] }>()

const { t } = useI18n()

/** Combien de temps un mot de passe révélé reste à l'écran avant de se re-masquer seul. */
const REVEAL_MS = 20_000

const form = useForm<{ type: CoffreEntryType; title: string; content: string; password: string }>({
  type: 'note',
  title: '',
  content: '',
  password: '',
})

/** Quelle entrée est dépliée — le contenu ne s'affiche pas de lui-même. */
const opened = ref<number | null>(null)

/**
 * L'entrée en cours d'édition — `null` sinon. On garde son type à part : il ne fait pas partie
 * du formulaire (une entrée n'en change jamais, CC-186), mais l'écran en a besoin pour choisir
 * quels champs afficher, comme pour la création.
 */
const editing = ref<{ id: number; type: CoffreEntryType } | null>(null)

const editForm = useForm<{ title: string; content: string; password: string }>({
  title: '',
  content: '',
  password: '',
})

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
  // Un mot de passe frappé mais non soumis dans le formulaire d'édition est aussi sensible que
  // le secret révélé ci-dessus : il quitte l'écran en même temps que le reste.
  editing.value = null
  editForm.reset()
  editForm.clearErrors()
}

/** Ouvre le formulaire d'édition, préremplit depuis ce que la liste porte déjà — jamais le mot
 * de passe, qui n'y est jamais chargé (CC-179). */
function startEdit(entry: CoffreEntry): void {
  oublier()

  opened.value = entry.id
  editing.value = { id: entry.id, type: entry.type }
  editForm.title = entry.title
  editForm.content = entry.content
}

function submitEdit(): void {
  if (editing.value === null) return

  editForm.put(`/coffre/${editing.value.id}`, { onSuccess: () => oublier() })
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

function submit(): void {
  form.post('/coffre', { onSuccess: () => form.reset('title', 'content', 'password') })
}

function remove(id: number): void {
  if (!window.confirm(t('coffre.index.deleteConfirm'))) return

  // Une visite Inertia re-rend le composant sans le démonter : sans cet oubli, le secret d'une
  // entrée qu'on vient de supprimer survivrait à la ligne qui le portait.
  oublier()
  router.delete(`/coffre/${id}`)
}

function lock(): void {
  // Verrouiller efface ce qui est à l'écran avant même la réponse du serveur : le contenu ne doit
  // pas rester visible pendant l'aller-retour.
  oublier()
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
  <Head :title="t('coffre.index.title')" />

  <div class="mx-auto grid w-full max-w-[900px] gap-6">
    <header class="flex items-start justify-between gap-4">
      <p class="max-w-[560px] text-[13px] text-txt-2">{{ t('coffre.index.lead') }}</p>
      <button
        type="button"
        class="shrink-0 rounded-[7px] border border-line-2 px-4 py-2.5 text-[13px] text-txt hover:border-aqua"
        @click="lock"
      >
        {{ t('coffre.index.lock') }}
      </button>
    </header>

    <section class="rounded-[14px] border border-line bg-panel p-6">
      <h2 class="mb-4 text-[15px] font-semibold text-txt">{{ t('coffre.index.addTitle') }}</h2>

      <form novalidate class="grid gap-[14px]" @submit.prevent="submit">
        <div>
          <label class="mb-[7px] block text-[12px] text-txt-2">{{ t('coffre.index.type') }}</label>
          <select
            v-model="form.type"
            class="w-full rounded-[7px] border border-line-2 bg-panel-2 px-3.5 py-[11px] text-[14px] text-txt outline-none focus:border-aqua"
          >
            <option value="note">{{ t('coffre.index.typeNote') }}</option>
            <option value="url">{{ t('coffre.index.typeUrl') }}</option>
            <option value="credential">{{ t('coffre.index.typeCredential') }}</option>
          </select>
        </div>

        <div>
          <label class="mb-[7px] block text-[12px] text-txt-2">
            {{
              form.type === 'credential'
                ? t('coffre.index.service')
                : t('coffre.index.entryTitle')
            }}
          </label>
          <input
            v-model="form.title"
            class="w-full rounded-[7px] border border-line-2 bg-[rgba(255,255,255,.04)] px-3.5 py-[11px] text-[14px] text-txt outline-none focus:border-aqua"
            :class="form.errors.title ? 'border-bad' : ''"
          />
          <p v-if="form.errors.title" class="mt-1.5 text-[12.5px] text-bad">
            {{ form.errors.title }}
          </p>
        </div>

        <div>
          <label class="mb-[7px] block text-[12px] text-txt-2">
            {{
              form.type === 'credential'
                ? t('coffre.index.username')
                : form.type === 'url'
                  ? t('coffre.index.contentUrl')
                  : t('coffre.index.content')
            }}
          </label>
          <!-- Une seule ligne pour un nom d'utilisateur : un textarea de quatre lignes inviterait
               à y coller autre chose que ce que le champ nomme. -->
          <input
            v-if="form.type === 'credential'"
            v-model="form.content"
            autocomplete="off"
            class="w-full rounded-[7px] border border-line-2 bg-[rgba(255,255,255,.04)] px-3.5 py-[11px] text-[14px] text-txt outline-none focus:border-aqua"
            :class="form.errors.content ? 'border-bad' : ''"
          />
          <textarea
            v-else
            v-model="form.content"
            rows="4"
            class="w-full resize-y rounded-[7px] border border-line-2 bg-[rgba(255,255,255,.04)] px-3.5 py-[11px] text-[14px] text-txt outline-none focus:border-aqua"
            :class="form.errors.content ? 'border-bad' : ''"
          ></textarea>
          <p v-if="form.errors.content" class="mt-1.5 text-[12.5px] text-bad">
            {{ form.errors.content }}
          </p>
        </div>

        <!-- ⚠️ `new-password` et pas `current-password` : sans ça, le gestionnaire du navigateur
             proposerait de remplir ce champ avec le mot de passe de CETTE application. -->
        <div v-if="form.type === 'credential'">
          <label class="mb-[7px] block text-[12px] text-txt-2">
            {{ t('coffre.index.password') }}
          </label>
          <input
            v-model="form.password"
            type="password"
            autocomplete="new-password"
            class="w-full rounded-[7px] border border-line-2 bg-[rgba(255,255,255,.04)] px-3.5 py-[11px] text-[14px] text-txt outline-none focus:border-aqua"
            :class="form.errors.password ? 'border-bad' : ''"
          />
          <p v-if="form.errors.password" class="mt-1.5 text-[12.5px] text-bad">
            {{ form.errors.password }}
          </p>
        </div>

        <button
          type="submit"
          :disabled="form.processing"
          class="justify-self-start rounded-[7px] bg-accent px-5 py-2.5 text-[13px] font-semibold text-bg disabled:opacity-60"
        >
          {{ t('coffre.index.add') }}
        </button>
      </form>
    </section>

    <section class="rounded-[14px] border border-line bg-panel">
      <p v-if="entries.length === 0" class="p-6 text-[13px] text-txt-3">
        {{ t('coffre.index.empty') }}
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

        <form
          v-if="editing?.id === entry.id"
          novalidate
          class="mt-3 grid gap-[14px]"
          @submit.prevent="submitEdit"
        >
          <div>
            <label class="mb-[7px] block text-[12px] text-txt-2">
              {{
                editing.type === 'credential'
                  ? t('coffre.index.service')
                  : t('coffre.index.entryTitle')
              }}
            </label>
            <input
              v-model="editForm.title"
              class="w-full rounded-[7px] border border-line-2 bg-[rgba(255,255,255,.04)] px-3.5 py-[11px] text-[14px] text-txt outline-none focus:border-aqua"
              :class="editForm.errors.title ? 'border-bad' : ''"
            />
            <p v-if="editForm.errors.title" class="mt-1.5 text-[12.5px] text-bad">
              {{ editForm.errors.title }}
            </p>
          </div>

          <div>
            <label class="mb-[7px] block text-[12px] text-txt-2">
              {{
                editing.type === 'credential'
                  ? t('coffre.index.username')
                  : editing.type === 'url'
                    ? t('coffre.index.contentUrl')
                    : t('coffre.index.content')
              }}
            </label>
            <input
              v-if="editing.type === 'credential'"
              v-model="editForm.content"
              autocomplete="off"
              class="w-full rounded-[7px] border border-line-2 bg-[rgba(255,255,255,.04)] px-3.5 py-[11px] text-[14px] text-txt outline-none focus:border-aqua"
              :class="editForm.errors.content ? 'border-bad' : ''"
            />
            <textarea
              v-else
              v-model="editForm.content"
              rows="4"
              class="w-full resize-y rounded-[7px] border border-line-2 bg-[rgba(255,255,255,.04)] px-3.5 py-[11px] text-[14px] text-txt outline-none focus:border-aqua"
              :class="editForm.errors.content ? 'border-bad' : ''"
            ></textarea>
            <p v-if="editForm.errors.content" class="mt-1.5 text-[12.5px] text-bad">
              {{ editForm.errors.content }}
            </p>
          </div>

          <div v-if="editing.type === 'credential'">
            <label class="mb-[7px] block text-[12px] text-txt-2">
              {{ t('coffre.index.password') }}
            </label>
            <input
              v-model="editForm.password"
              type="password"
              autocomplete="new-password"
              class="w-full rounded-[7px] border border-line-2 bg-[rgba(255,255,255,.04)] px-3.5 py-[11px] text-[14px] text-txt outline-none focus:border-aqua"
              :class="editForm.errors.password ? 'border-bad' : ''"
            />
            <p class="mt-1.5 text-[12px] text-txt-3">{{ t('coffre.index.passwordEditHint') }}</p>
            <p v-if="editForm.errors.password" class="mt-1.5 text-[12.5px] text-bad">
              {{ editForm.errors.password }}
            </p>
          </div>

          <div class="flex gap-2">
            <button
              type="submit"
              :disabled="editForm.processing"
              class="justify-self-start rounded-[7px] bg-accent px-5 py-2.5 text-[13px] font-semibold text-bg disabled:opacity-60"
            >
              {{ t('coffre.index.editSave') }}
            </button>
            <button
              type="button"
              class="justify-self-start rounded-[7px] border border-line-2 px-5 py-2.5 text-[13px] text-txt hover:border-aqua"
              @click="oublier"
            >
              {{ t('coffre.index.editCancel') }}
            </button>
          </div>
        </form>

        <template v-else-if="opened === entry.id">
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
        </template>
      </article>
    </section>
  </div>
</template>
