<script setup lang="ts">
import AppModal from '~/components/AppModal.vue'
import { useI18n } from 'vue-i18n'

/**
 * Le dialogue à 3 issues de la dédup « même titre, texte différent » (CC-251) —
 * exclusif à `/revision/cours` : le flux d'ingestion (case « conserver ») n'a aucun
 * moyen de le montrer (asynchrone, redirection immédiate) et résout le conflit tout
 * seul (suffixe automatique).
 */
defineProps<{ existingTitle: string }>()
const emit = defineEmits<{ replace: []; createSecond: []; cancel: [] }>()

const { t } = useI18n()
</script>

<template>
  <AppModal v-slot="{ titleId }" @close="emit('cancel')">
    <div class="mt-16 w-[420px] rounded-[14px] border border-line bg-panel p-4">
      <div :id="titleId" class="text-[14px] font-semibold">
        {{ t('leitner.cours.conflict.title') }}
      </div>
      <p class="mt-2 text-[12.5px] text-txt-2">
        {{ t('leitner.cours.conflict.body', { title: existingTitle }) }}
      </p>
      <div class="mt-4 flex flex-col gap-2">
        <button
          type="button"
          class="rounded-[10px] border border-accent bg-accent px-3 py-2 text-[12.5px] text-white transition hover:opacity-90"
          @click="emit('replace')"
        >
          {{ t('leitner.cours.conflict.replace') }}
        </button>
        <button
          type="button"
          class="rounded-[10px] border border-line-2 bg-panel-2 px-3 py-2 text-[12.5px] transition hover:border-accent"
          @click="emit('createSecond')"
        >
          {{ t('leitner.cours.conflict.createSecond') }}
        </button>
        <button
          type="button"
          class="rounded-[10px] px-3 py-2 text-[12.5px] text-txt-3 transition hover:text-accent"
          @click="emit('cancel')"
        >
          {{ t('leitner.cours.conflict.cancel') }}
        </button>
      </div>
    </div>
  </AppModal>
</template>
