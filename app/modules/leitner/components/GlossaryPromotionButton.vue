<script setup lang="ts">
import { ref } from 'vue'
import { useI18n } from 'vue-i18n'
import AppModal from '~/components/AppModal.vue'
import { xsrfToken } from './leitner_csrf'

const props = defineProps<{ card: { id: number; front: string; back: string } }>()
const { t } = useI18n()
const open = ref(false)
const term = ref('')
const definition = ref('')
const busy = ref(false)
const failed = ref(false)
const created = ref(false)
function begin() {
  term.value = props.card.front
  definition.value = props.card.back
  failed.value = false
  open.value = true
}
async function save() {
  if (busy.value) return
  busy.value = true
  failed.value = false
  try {
    const response = await fetch(`/revision/cards/${props.card.id}/glossaire`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'accept': 'application/json',
        'x-xsrf-token': xsrfToken(),
      },
      body: JSON.stringify({ term: term.value, definition: definition.value }),
    })
    if (!response.ok) throw new Error(String(response.status))
    created.value = true
    open.value = false
  } catch {
    failed.value = true
  } finally {
    busy.value = false
  }
}
</script>

<template>
  <button
    type="button"
    class="ml-1 rounded-md border border-line-2 px-2 py-1 text-[11.5px]"
    @click="begin"
  >
    {{ t('leitner.promotion.button') }}
  </button>
  <span v-if="created" role="status" class="ml-2 text-xs text-ok">{{
    t('leitner.promotion.success')
  }}</span>
  <AppModal v-if="open" v-slot="{ titleId }" @close="!busy && (open = false)">
    <form
      class="mt-16 grid w-[560px] max-w-[90vw] gap-4 rounded-xl border border-line bg-panel p-5"
      @submit.prevent="save"
    >
      <h2 :id="titleId">{{ t('leitner.promotion.title') }}</h2>
      <label
        >{{ t('leitner.promotion.term')
        }}<input
          v-model="term"
          required
          maxlength="200"
          class="block w-full rounded border border-line bg-panel-2 p-2"
      /></label>
      <label
        >{{ t('leitner.promotion.definition')
        }}<textarea
          v-model="definition"
          required
          rows="6"
          class="block w-full rounded border border-line bg-panel-2 p-2"
        />
      </label>
      <p class="text-sm text-txt-2">{{ t('leitner.promotion.private') }}</p>
      <p v-if="failed" role="alert" class="text-bad">{{ t('leitner.promotion.error') }}</p>
      <div class="flex gap-3">
        <button type="submit" :disabled="busy" class="rounded bg-accent p-2 text-white">
          {{ t('leitner.promotion.save') }}
        </button>
        <button type="button" :disabled="busy" @click="open = false">
          {{ t('leitner.promotion.cancel') }}
        </button>
      </div>
    </form>
  </AppModal>
</template>
