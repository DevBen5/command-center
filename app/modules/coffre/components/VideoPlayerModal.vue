<script setup lang="ts">
import { ref } from 'vue'
import { useI18n } from 'vue-i18n'
import AppModal from '~/components/AppModal.vue'

/**
 * Le lecteur vidéo du coffre (CC-241) — l'unique endroit du module qui monte un `<video>` de
 * contenu de source, partagé par la navigation NAS (`pages/nas.vue`) et la grille du catalogue
 * (`components/CatalogGrid.vue`).
 *
 * ⚠️ **Monté en `v-if`, jamais `v-show`** — même doctrine qu'`EntryFormModal.vue` : fermer démonte,
 * ce qui **détruit l'élément `<video>`**, donc coupe la connexion HTTP en cours. C'est cette
 * coupure côté client qui déclenche, côté serveur, la mort du processus ffmpeg
 * (`nas_media_response.ts`). Passer en `v-show` laisserait le flux ouvert et le transcodage
 * tourner : la garde du serveur existe, mais elle ne peut réagir qu'à une déconnexion réelle.
 *
 * ⚠️ **Le chassis vient d'`inertia/components/AppModal.vue`**, jamais réécrit ici (voir le
 * `CLAUDE.md` racine, « Une seule modale dans tout le dépôt ») : overlay, Échap, clic-extérieur,
 * ARIA, focus rendu à l'ouvrant et blocage du défilement sont à lui. Le rembourrage vertical, lui,
 * est au contenu — d'où le `mt-16`.
 */
const props = defineProps<{ url: string; title: string }>()
defineEmits<{ close: [] }>()

const { t } = useI18n()

const erreur = ref(false)
const flotGenere = ref(false)

/**
 * ⚠️ **Le client ne peut pas SAVOIR à l'avance s'il recevra un transcodage** — c'est la sonde
 * serveur qui décide, une fois le fichier ouvert. On l'observe donc plutôt que de le deviner : un
 * MP4 **fragmenté** (ce que produisent `remux` et `transcode`, voir `video_playback.ts`) n'annonce
 * pas de durée, donc `duration` vaut `Infinity`. Passer l'information en prop depuis l'appelant
 * l'obligerait à prédire une décision qui ne lui appartient pas, et le prédire faux afficherait un
 * avertissement mensonger dans un sens ou dans l'autre.
 */
function onMetadata(event: Event): void {
  flotGenere.value = !Number.isFinite((event.target as HTMLVideoElement).duration)
}

/**
 * ⚠️ **Un `<video>` échoue en SILENCE** — c'est tout le sujet du lot. `@error` est le seul signal
 * que le navigateur donne, et sans lui l'écran resterait noir sans un mot, exactement comme avant.
 * Le message ne dit pas la cause (le navigateur ne la donne pas) : il dit qu'il y a eu un échec et
 * renvoie vers le téléchargement, qui lui fonctionne toujours.
 */
function onError(): void {
  erreur.value = true
}
</script>

<template>
  <AppModal v-slot="{ titleId }" @close="$emit('close')">
    <div
      class="mt-16 grid max-h-[calc(100vh_-_8rem)] w-full max-w-[900px] gap-3 rounded-[14px] border border-line bg-panel p-4"
    >
      <header class="flex shrink-0 items-start justify-between gap-4">
        <h2 :id="titleId" class="truncate text-[14px] font-semibold text-txt" :title="props.title">
          {{ props.title }}
        </h2>
        <button
          type="button"
          class="shrink-0 text-[12.5px] text-txt-3 hover:text-aqua"
          @click="$emit('close')"
        >
          {{ t('coffre.video.close') }}
        </button>
      </header>

      <p
        v-if="erreur"
        class="rounded-[10px] border border-bad/40 bg-panel-2 p-4 text-[13px] text-bad"
      >
        {{ t('coffre.video.playbackError') }}
      </p>

      <video
        v-else
        :src="props.url"
        class="max-h-[70vh] w-full rounded-[10px] bg-black"
        controls
        autoplay
        playsinline
        @error="onError"
        @loadedmetadata="onMetadata"
      />

      <!-- ⚠️ Dit à l'écran ce que le modèle de sécurité coûte, plutôt que de laisser croire à une
           panne : sur un flux transcodé, le curseur ne se déplace que dans ce qui est déjà reçu. -->
      <p v-if="flotGenere && !erreur" class="shrink-0 text-[11.5px] text-txt-3">
        {{ t('coffre.video.transcodedHint') }}
      </p>
      <a
        :href="props.url"
        download
        class="shrink-0 justify-self-start text-[12px] text-aqua hover:underline"
      >
        {{ t('coffre.video.download') }}
      </a>
    </div>
  </AppModal>
</template>
