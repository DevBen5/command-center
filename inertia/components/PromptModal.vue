<script setup lang="ts">
import { nextTick, ref } from 'vue'
import { useI18n } from 'vue-i18n'
import AppModal from './AppModal.vue'

const { t } = useI18n()

const open = ref(false)
const message = ref('')
const value = ref('')
const inputRef = ref<HTMLInputElement | null>(null)

let resolveCurrent: ((value: string | null) => void) | null = null

/**
 * Le pendant de `ConfirmModal.ask()` pour une saisie texte — sur le même patron (promesse résolue
 * au clic ou en annulation), pour les deux mêmes raisons : renommer et déplacer un fichier NAS
 * (CC-240) demandent tous deux « saisir une valeur, confirmer ou annuler », et le dépôt interdit
 * toute modale écrite à la main (voir le `CLAUDE.md` racine, « Une seule modale dans tout le
 * dépôt »). Deux consommateurs dès ce lot — ce n'est pas une abstraction prématurée.
 */
async function ask(text: string, initialValue = ''): Promise<string | null> {
  message.value = text
  value.value = initialValue
  open.value = true

  await nextTick()
  inputRef.value?.select()

  return new Promise((resolve) => {
    resolveCurrent = resolve
  })
}

function settle(result: string | null): void {
  open.value = false
  resolveCurrent?.(result)
  resolveCurrent = null
}

function submit(): void {
  const trimmed = value.value.trim()
  if (trimmed.length === 0) return
  settle(trimmed)
}

defineExpose({ ask })
</script>

<template>
  <AppModal v-if="open" v-slot="{ titleId }" @close="settle(null)">
    <form
      class="mt-16 w-[420px] max-w-[90%] rounded-[14px] border border-line-2 bg-panel shadow-2xl"
      @submit.prevent="submit"
    >
      <div :id="titleId" class="px-5 py-4 text-[13px] text-txt">{{ message }}</div>
      <div class="px-5 pb-4">
        <input
          ref="inputRef"
          v-model="value"
          type="text"
          class="w-full rounded-[7px] border border-line-2 bg-panel-2 px-3 py-2 text-[13px] text-txt"
        />
      </div>
      <div class="flex justify-end gap-2 border-t border-line px-5 py-4">
        <button
          type="button"
          class="rounded-md border border-line-2 bg-panel-2 px-3 py-2 text-[12.5px] text-txt-2 transition hover:border-accent hover:text-txt"
          @click="settle(null)"
        >
          {{ t('confirm.cancel') }}
        </button>
        <button
          type="submit"
          class="rounded-md border border-accent bg-accent px-3 py-2 text-[12.5px] font-medium text-white transition hover:opacity-90"
        >
          {{ t('confirm.confirm') }}
        </button>
      </div>
    </form>
  </AppModal>
</template>
