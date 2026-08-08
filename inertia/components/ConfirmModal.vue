<script setup lang="ts">
import { ref } from 'vue'
import { useI18n } from 'vue-i18n'
import AppModal from './AppModal.vue'

const { t } = useI18n()

const open = ref(false)
const message = ref('')
const danger = ref(false)

let resolveCurrent: ((value: boolean) => void) | null = null

/**
 * Résolue au clic sur un bouton, ou en annulation sur Échap / clic-extérieur — jamais laissée
 * en suspens (les trois passent par `@close`, voir plus bas).
 */
function ask(text: string, options: { danger?: boolean } = {}): Promise<boolean> {
  message.value = text
  danger.value = options.danger ?? false
  open.value = true

  return new Promise((resolve) => {
    resolveCurrent = resolve
  })
}

function settle(value: boolean): void {
  open.value = false
  resolveCurrent?.(value)
  resolveCurrent = null
}

defineExpose({ ask })
</script>

<template>
  <AppModal v-if="open" v-slot="{ titleId }" @close="settle(false)">
    <div
      class="mt-16 w-[420px] max-w-[90%] rounded-[14px] border border-line-2 bg-panel shadow-2xl"
    >
      <div :id="titleId" class="px-5 py-4 text-[13px] text-txt">{{ message }}</div>
      <div class="flex justify-end gap-2 border-t border-line px-5 py-4">
        <button
          type="button"
          class="rounded-md border border-line-2 bg-panel-2 px-3 py-2 text-[12.5px] text-txt-2 transition hover:border-accent hover:text-txt"
          @click="settle(false)"
        >
          {{ t('confirm.cancel') }}
        </button>
        <button
          type="button"
          class="rounded-md border px-3 py-2 text-[12.5px] font-medium text-white transition hover:opacity-90"
          :class="danger ? 'border-bad bg-bad' : 'border-accent bg-accent'"
          @click="settle(true)"
        >
          {{ t('confirm.confirm') }}
        </button>
      </div>
    </div>
  </AppModal>
</template>
