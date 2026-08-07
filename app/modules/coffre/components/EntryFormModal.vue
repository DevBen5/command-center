<script setup lang="ts">
import { computed, ref } from 'vue'
import { useForm } from '@inertiajs/vue3'
import { useI18n } from 'vue-i18n'
import AppModal from '~/components/AppModal.vue'
import type { CoffreEntryType } from '../shared/entry_sections.js'

/**
 * La modale de création/édition (CC-207) — même patron que
 * `app/modules/leitner/pages/settings.vue` (« même modale, `editing` à null = création »).
 *
 * ⚠️ **Un seul mode par montage.** Le parent démonte/remonte ce composant à chaque ouverture
 * (`v-if`), donc `entry` ne change jamais pendant la vie du composant — pas besoin de `watch`.
 * C'est aussi ce qui simplifie le panneau du dossier verrouillé : une seule cible possible, plus
 * la distinction `'create' | 'edit'` qu'`index.vue` portait pour partager l'état entre deux
 * formulaires coexistants.
 */

interface EntryProp {
  id: number
  type: CoffreEntryType
  title: string
  content: string
  media: { id: number }[]
  nasFiles: { id: number; kind: 'video' | 'photo' }[]
}

/**
 * ⚠️ **`presetType` n'a d'effet qu'en création** (CC-208) : en édition, le type vient toujours de
 * `entry.type`, jamais modifiable (CC-186). Une page de section le fournit pour ne pas redemander
 * un type déjà décidé par la page où l'on se trouve ; l'accueil ne le fournit pas — c'est le seul
 * endroit où le type se choisit librement.
 */
const props = defineProps<{
  entry: EntryProp | null
  immichFolderAvailable: boolean
  presetType?: CoffreEntryType
}>()
const emit = defineEmits<{ close: [] }>()

const { t } = useI18n()

const isEdit = props.entry !== null

/** Le type de l'entrée en édition — fixe, jamais éditable (CC-186 : une entrée ne change jamais
 * de nature). En création, c'est `form.type`, sélectionnable. */
const entryType = computed<CoffreEntryType>(() => (isEdit ? props.entry!.type : form.type))

/**
 * ⚠️ **`v-model` ne peut pas cibler un opérateur ternaire** — `(isEdit ? editForm.title :
 * form.title) = valeur` est un `SyntaxError` en JS (« left-hand side of an assignment »), pas
 * une astuce Vue. Ces trois `computed` avec `get`/`set` sont ce qui permet au template de
 * rester unique malgré les deux `useForm` sous-jacents.
 */
const titleModel = computed<string>({
  get: () => (isEdit ? editForm.title : form.title),
  set: (value) => {
    if (isEdit) editForm.title = value
    else form.title = value
  },
})
const contentModel = computed<string>({
  get: () => (isEdit ? editForm.content : form.content),
  set: (value) => {
    if (isEdit) editForm.content = value
    else form.content = value
  },
})
const passwordModel = computed<string>({
  get: () => (isEdit ? editForm.password : form.password),
  set: (value) => {
    if (isEdit) editForm.password = value
    else form.password = value
  },
})
const titleError = computed(() => (isEdit ? editForm.errors.title : form.errors.title))
const contentError = computed(() => (isEdit ? editForm.errors.content : form.errors.content))
const passwordError = computed(() => (isEdit ? editForm.errors.password : form.errors.password))
const processing = computed(() => (isEdit ? editForm.processing : form.processing))

/** Un UUID Immich, vérifié côté client — défense en profondeur, la vraie garde est côté serveur. */
const IMMICH_ASSET_ID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

/** Un chemin de média NAS (photo ou vidéo), vérifié côté client — même défense en profondeur,
 * même limite : la vraie garde est `NasRootsService.resolve`, côté serveur, après `realpath`
 * (CC-181). */
const NAS_PATH =
  /^(?!\/)(?![a-zA-Z]:)(?!.*\.\.)(?!.*\\)(?!.*\x00).+\.(mp4|webm|mov|mkv|avi|jpg|jpeg|png|webp|gif|heic)$/i

const form = useForm<{
  type: CoffreEntryType
  title: string
  content: string
  password: string
  media: string[]
  nasFiles: string[]
}>({
  type: props.presetType ?? 'note',
  title: '',
  content: '',
  password: '',
  media: [],
  nasFiles: [],
})

/**
 * ⚠️ **`media`/`nasFiles` sont additifs/soustractifs, PAS un remplacement intégral** (CC-180,
 * CC-181) — contrairement à `title`/`content`. L'UUID/le chemin ne redescendent jamais vers le
 * client : l'écran ne peut donc pas réafficher, puis renvoyer, l'état complet. `add` porte ce
 * qu'on vient de coller pendant cette édition ; `remove`, les `id` déjà attachés qu'on retire.
 */
const editForm = useForm<{
  title: string
  content: string
  password: string
  media: { add: string[]; remove: number[] }
  nasFiles: { add: string[]; remove: number[] }
}>({
  title: props.entry?.title ?? '',
  content: props.entry?.content ?? '',
  password: '',
  media: { add: [], remove: [] },
  nasFiles: { add: [], remove: [] },
})

/** Les médias déjà attachés à l'entrée en édition, MOINS ceux marqués pour retrait. */
const editingRemainingMedia = ref(props.entry ? [...props.entry.media] : [])

/** Les médias NAS déjà attachés, MOINS ceux marqués pour retrait. ⚠️ Le `kind` n'est PAS gardé
 * ici : les chips n'affichent ni `<video>` ni `<img>` (doctrine anti-bande-passante du module). */
const editingRemainingNasFiles = ref(
  props.entry ? props.entry.nasFiles.map(({ id }) => ({ id })) : []
)

/** Le champ de saisie d'un UUID Immich à ajouter — création comme édition. */
const newMediaInput = ref('')
const newMediaError = ref(false)

/** Le champ de saisie d'un chemin de média NAS à ajouter — création comme édition. */
const newNasFileInput = ref('')
const newNasFileError = ref(false)

/**
 * Le parcours du dossier verrouillé Immich (CC-205) — le repli du collage manuel. Un seul
 * panneau, chargé au premier besoin, jamais deux fois — contrairement à l'ancienne version
 * inline qui en portait un par formulaire.
 */
const folderOpen = ref(false)
const folderPhotos = ref<{ assetId: string }[] | null>(null)
const folderTruncated = ref(false)
const folderLoading = ref(false)
const folderError = ref(false)

/** La cible qui reçoit un UUID collé ou sélectionné dans le dossier — `form.media` en création,
 * `editForm.media.add` en édition. */
const mediaTarget = computed<string[]>(() => (isEdit ? editForm.media.add : form.media))

async function toggleFolder(): Promise<void> {
  folderOpen.value = !folderOpen.value
  if (!folderOpen.value) return
  if (folderPhotos.value !== null || folderLoading.value) return

  folderLoading.value = true
  folderError.value = false

  try {
    const response = await fetch('/coffre/immich/dossier', {
      headers: { accept: 'application/json' },
    })
    const body = (await response.json()) as {
      available: boolean
      truncated: boolean
      photos: { assetId: string }[]
    }

    if (!response.ok || !body.available) {
      folderError.value = true
      return
    }

    folderPhotos.value = body.photos
    folderTruncated.value = body.truncated
  } catch {
    folderError.value = true
  } finally {
    folderLoading.value = false
  }
}

/** Sélectionne une photo du dossier — même effet que coller son UUID à la main. */
function selectFolderPhoto(assetId: string): void {
  if (!mediaTarget.value.includes(assetId)) mediaTarget.value.push(assetId)
}

/** Valide et ajoute un UUID au champ courant — la vraie garde reste côté serveur, ceci n'évite
 * qu'un aller-retour inutile. */
function addMedia(): void {
  const assetId = newMediaInput.value.trim()

  if (!IMMICH_ASSET_ID.test(assetId)) {
    newMediaError.value = true
    return
  }

  newMediaError.value = false
  if (!mediaTarget.value.includes(assetId)) mediaTarget.value.push(assetId)
  newMediaInput.value = ''
}

function removePendingMedia(assetId: string): void {
  if (isEdit) {
    editForm.media.add = editForm.media.add.filter((id) => id !== assetId)
  } else {
    form.media = form.media.filter((id) => id !== assetId)
  }
}

/** Marque un média déjà attaché pour retrait — l'écran le fait disparaître tout de suite, le
 * serveur n'agit qu'à la soumission (CC-180 : additif/soustractif, jamais un remplacement). */
function removeExistingMedia(id: number): void {
  editForm.media.remove.push(id)
  editingRemainingMedia.value = editingRemainingMedia.value.filter((media) => media.id !== id)
}

/** Valide et ajoute un chemin de média NAS au champ courant — même doctrine que `addMedia`
 * (CC-181), la vraie garde reste `NasRootsService.resolve`, côté serveur. */
function addNasFile(): void {
  const path = newNasFileInput.value.trim()

  if (!NAS_PATH.test(path)) {
    newNasFileError.value = true
    return
  }

  newNasFileError.value = false
  const target = isEdit ? editForm.nasFiles.add : form.nasFiles
  if (!target.includes(path)) target.push(path)
  newNasFileInput.value = ''
}

function removePendingNasFile(path: string): void {
  if (isEdit) {
    editForm.nasFiles.add = editForm.nasFiles.add.filter((p) => p !== path)
  } else {
    form.nasFiles = form.nasFiles.filter((p) => p !== path)
  }
}

/** Marque un média NAS déjà attaché pour retrait — même doctrine que `removeExistingMedia`. */
function removeExistingNasFile(id: number): void {
  editForm.nasFiles.remove.push(id)
  editingRemainingNasFiles.value = editingRemainingNasFiles.value.filter((file) => file.id !== id)
}

function submit(): void {
  if (isEdit) {
    editForm.put(`/coffre/${props.entry!.id}`, { onSuccess: () => emit('close') })
  } else {
    form.post('/coffre', { onSuccess: () => emit('close') })
  }
}
</script>

<template>
  <AppModal @close="emit('close')" v-slot="{ titleId }">
    <!--
      En-tête et pied figés, corps défilant — même patron que `leitner/settings.vue` (CC-66) :
      « Enregistrer » et « Annuler » ne quittent jamais l'écran. Aucune classe de structure n'est
      décorative : `max-h-[calc()]` et ses tirets bas, `min-h-0`, `shrink-0`, `overflow-hidden`.
      `mt-16` remplace le rembourrage vertical qu'AppModal portait avant CC-209 : le chassis ne
      porte plus aucun rembourrage vertical, chaque consommateur porte désormais le sien.
    -->
    <form
      class="mt-16 flex max-h-[calc(100vh_-_8rem)] w-[560px] max-w-[90%] flex-col overflow-hidden rounded-[14px] border border-line-2 bg-panel shadow-2xl"
      @submit.prevent="submit"
    >
      <div :id="titleId" class="shrink-0 border-b border-line px-5 py-4 text-[13.5px] font-bold">
        {{ isEdit ? t('coffre.index.modalEditTitle') : t('coffre.index.modalCreateTitle') }}
      </div>

      <div class="flex min-h-0 flex-col gap-[14px] overflow-y-auto p-5">
        <!-- ⚠️ Masqué dès qu'une page de section impose son type (CC-208) : le type est déjà
             décidé par la page où l'on se trouve, on ne le redemande pas. -->
        <div v-if="!isEdit && !presetType">
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
            {{ entryType === 'credential' ? t('coffre.index.service') : t('coffre.index.entryTitle') }}
          </label>
          <input
            v-model="titleModel"
            class="w-full rounded-[7px] border border-line-2 bg-[rgba(255,255,255,.04)] px-3.5 py-[11px] text-[14px] text-txt outline-none focus:border-aqua"
            :class="titleError ? 'border-bad' : ''"
          />
          <p v-if="titleError" class="mt-1.5 text-[12.5px] text-bad">
            {{ titleError }}
          </p>
        </div>

        <div>
          <label class="mb-[7px] block text-[12px] text-txt-2">
            {{
              entryType === 'credential'
                ? t('coffre.index.username')
                : entryType === 'url'
                  ? t('coffre.index.contentUrl')
                  : t('coffre.index.content')
            }}
          </label>
          <!-- Une seule ligne pour un nom d'utilisateur : un textarea de quatre lignes inviterait
               à y coller autre chose que ce que le champ nomme. -->
          <input
            v-if="entryType === 'credential'"
            v-model="contentModel"
            autocomplete="off"
            class="w-full rounded-[7px] border border-line-2 bg-[rgba(255,255,255,.04)] px-3.5 py-[11px] text-[14px] text-txt outline-none focus:border-aqua"
            :class="contentError ? 'border-bad' : ''"
          />
          <textarea
            v-else
            v-model="contentModel"
            rows="4"
            class="w-full resize-y rounded-[7px] border border-line-2 bg-[rgba(255,255,255,.04)] px-3.5 py-[11px] text-[14px] text-txt outline-none focus:border-aqua"
            :class="contentError ? 'border-bad' : ''"
          ></textarea>
          <p v-if="contentError" class="mt-1.5 text-[12.5px] text-bad">
            {{ contentError }}
          </p>
        </div>

        <!-- ⚠️ `new-password` et pas `current-password` : sans ça, le gestionnaire du navigateur
             proposerait de remplir ce champ avec le mot de passe de CETTE application. -->
        <div v-if="entryType === 'credential'">
          <label class="mb-[7px] block text-[12px] text-txt-2">{{ t('coffre.index.password') }}</label>
          <input
            v-model="passwordModel"
            type="password"
            autocomplete="new-password"
            class="w-full rounded-[7px] border border-line-2 bg-[rgba(255,255,255,.04)] px-3.5 py-[11px] text-[14px] text-txt outline-none focus:border-aqua"
            :class="passwordError ? 'border-bad' : ''"
          />
          <p v-if="isEdit" class="mt-1.5 text-[12px] text-txt-3">
            {{ t('coffre.index.passwordEditHint') }}
          </p>
          <p v-if="passwordError" class="mt-1.5 text-[12.5px] text-bad">
            {{ passwordError }}
          </p>
        </div>

        <div>
          <label class="mb-[7px] block text-[12px] text-txt-2">{{ t('coffre.index.media') }}</label>
          <p class="mb-2 text-[12px] text-txt-3">{{ t('coffre.index.mediaHint') }}</p>

          <ul v-if="isEdit && editingRemainingMedia.length > 0" class="mb-2 flex flex-wrap gap-2">
            <li
              v-for="media in editingRemainingMedia"
              :key="media.id"
              class="overflow-hidden rounded-[8px] border border-line-2"
            >
              <img
                :src="`/coffre/media/${media.id}/thumbnail`"
                class="block h-16 w-16 object-cover"
                alt=""
              />
              <button
                type="button"
                class="w-full bg-panel-2 py-1 text-[11px] text-txt-3 hover:text-bad"
                @click="removeExistingMedia(media.id)"
              >
                {{ t('coffre.index.mediaRemove') }}
              </button>
            </li>
          </ul>

          <div class="flex gap-2">
            <input
              v-model="newMediaInput"
              :placeholder="t('coffre.index.mediaPlaceholder')"
              class="w-full rounded-[7px] border border-line-2 bg-[rgba(255,255,255,.04)] px-3.5 py-[11px] text-[13px] text-txt outline-none focus:border-aqua"
              :class="newMediaError ? 'border-bad' : ''"
              @keydown.enter.prevent="addMedia"
            />
            <button
              type="button"
              class="shrink-0 rounded-[7px] border border-line-2 px-3.5 py-2 text-[12.5px] text-txt hover:border-aqua"
              @click="addMedia"
            >
              {{ t('coffre.index.mediaAddButton') }}
            </button>
          </div>
          <p v-if="newMediaError" class="mt-1.5 text-[12.5px] text-bad">
            {{ t('coffre.index.mediaInvalid') }}
          </p>

          <ul v-if="mediaTarget.length > 0" class="mt-2 flex flex-wrap gap-2">
            <li
              v-for="assetId in mediaTarget"
              :key="assetId"
              class="flex items-center gap-2 rounded-[7px] border border-line-2 px-2.5 py-1.5 text-[11px] text-txt-2"
            >
              <span class="font-mono">{{ assetId }}</span>
              <span v-if="isEdit" class="text-txt-3">({{ t('coffre.index.mediaPending') }})</span>
              <button type="button" class="text-txt-3 hover:text-bad" @click="removePendingMedia(assetId)">
                {{ t('coffre.index.mediaRemove') }}
              </button>
            </li>
          </ul>

          <button
            v-if="immichFolderAvailable"
            type="button"
            class="mt-2 rounded-[7px] border border-line-2 px-3.5 py-2 text-[12.5px] text-txt-2 hover:border-aqua"
            @click="toggleFolder"
          >
            {{ folderOpen ? t('coffre.index.folderClose') : t('coffre.index.folderBrowse') }}
          </button>

          <div v-if="folderOpen" class="mt-2 rounded-[8px] border border-line-2 p-3">
            <p v-if="folderLoading" class="text-[12px] text-txt-3">{{ t('coffre.index.folderLoading') }}</p>
            <p v-else-if="folderError" class="text-[12px] text-bad">{{ t('coffre.index.folderError') }}</p>
            <p v-else-if="folderPhotos?.length === 0" class="text-[12px] text-txt-3">
              {{ t('coffre.index.folderEmpty') }}
            </p>
            <template v-else-if="folderPhotos">
              <p v-if="folderTruncated" class="mb-2 text-[11px] text-txt-3">
                {{ t('coffre.index.folderTruncated') }}
              </p>
              <ul class="flex flex-wrap gap-2">
                <li v-for="photo in folderPhotos" :key="photo.assetId">
                  <button
                    type="button"
                    class="block overflow-hidden rounded-[8px] border border-line-2 hover:border-aqua"
                    :class="mediaTarget.includes(photo.assetId) ? 'opacity-40' : ''"
                    @click="selectFolderPhoto(photo.assetId)"
                  >
                    <img
                      :src="`/coffre/immich/dossier/${photo.assetId}/thumbnail`"
                      class="block h-16 w-16 object-cover"
                      alt=""
                    />
                  </button>
                </li>
              </ul>
            </template>
          </div>
        </div>

        <div>
          <label class="mb-[7px] block text-[12px] text-txt-2">{{ t('coffre.index.nasFile') }}</label>
          <p class="mb-2 text-[12px] text-txt-3">{{ t('coffre.index.nasFileHint') }}</p>

          <!-- ⚠️ Pas d'aperçu `<video>`/`<img>` ici, contrairement aux vignettes Immich : sans
               redimensionnement côté serveur, plusieurs chips chargeraient chacune le fichier
               complet — le piège de bande passante nommé par le ticket CC-181. -->
          <ul
            v-if="isEdit && editingRemainingNasFiles.length > 0"
            class="mb-2 flex flex-wrap gap-2"
          >
            <li
              v-for="file in editingRemainingNasFiles"
              :key="file.id"
              class="flex items-center gap-2 rounded-[7px] border border-line-2 px-2.5 py-1.5 text-[11px] text-txt-2"
            >
              <span class="font-mono">#{{ file.id }}</span>
              <button
                type="button"
                class="text-txt-3 hover:text-bad"
                @click="removeExistingNasFile(file.id)"
              >
                {{ t('coffre.index.nasFileRemove') }}
              </button>
            </li>
          </ul>

          <div class="flex gap-2">
            <input
              v-model="newNasFileInput"
              :placeholder="t('coffre.index.nasFilePlaceholder')"
              class="w-full rounded-[7px] border border-line-2 bg-[rgba(255,255,255,.04)] px-3.5 py-[11px] text-[13px] text-txt outline-none focus:border-aqua"
              :class="newNasFileError ? 'border-bad' : ''"
              @keydown.enter.prevent="addNasFile"
            />
            <button
              type="button"
              class="shrink-0 rounded-[7px] border border-line-2 px-3.5 py-2 text-[12.5px] text-txt hover:border-aqua"
              @click="addNasFile"
            >
              {{ t('coffre.index.nasFileAddButton') }}
            </button>
          </div>
          <p v-if="newNasFileError" class="mt-1.5 text-[12.5px] text-bad">
            {{ t('coffre.index.nasFileInvalid') }}
          </p>

          <ul
            v-if="(isEdit ? editForm.nasFiles.add : form.nasFiles).length > 0"
            class="mt-2 flex flex-wrap gap-2"
          >
            <li
              v-for="path in isEdit ? editForm.nasFiles.add : form.nasFiles"
              :key="path"
              class="flex items-center gap-2 rounded-[7px] border border-line-2 px-2.5 py-1.5 text-[11px] text-txt-2"
            >
              <span class="font-mono">{{ path }}</span>
              <span v-if="isEdit" class="text-txt-3">({{ t('coffre.index.nasFilePending') }})</span>
              <button type="button" class="text-txt-3 hover:text-bad" @click="removePendingNasFile(path)">
                {{ t('coffre.index.nasFileRemove') }}
              </button>
            </li>
          </ul>
        </div>
      </div>

      <div class="flex shrink-0 justify-end gap-2 border-t border-line px-5 py-4">
        <button
          type="button"
          class="rounded-[7px] border border-line-2 px-3 py-2 text-[13px] text-txt-2"
          @click="emit('close')"
        >
          {{ t('coffre.index.cancel') }}
        </button>
        <button
          type="submit"
          :disabled="processing"
          class="rounded-[7px] bg-accent px-5 py-2.5 text-[13px] font-semibold text-bg disabled:opacity-60"
        >
          {{ isEdit ? t('coffre.index.editSave') : t('coffre.index.add') }}
        </button>
      </div>
    </form>
  </AppModal>
</template>
