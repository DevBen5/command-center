<script setup lang="ts">
import { ref } from 'vue'
import { Head, router, useForm } from '@inertiajs/vue3'
import { useI18n } from 'vue-i18n'
import AppLayout from '~/layouts/AppLayout.vue'

defineOptions({ layout: AppLayout })

interface CoffreEntry {
  id: number
  type: 'note' | 'url'
  /** Déjà déchiffré côté serveur — le chiffré ne descend jamais jusqu'ici. */
  title: string
  content: string
  createdAt: string | null
}

defineProps<{ entries: CoffreEntry[] }>()

const { t } = useI18n()

const form = useForm<{ type: 'note' | 'url'; title: string; content: string }>({
  type: 'note',
  title: '',
  content: '',
})

/** Quelle entrée est dépliée — le contenu ne s'affiche pas de lui-même. */
const opened = ref<number | null>(null)

function toggle(id: number): void {
  opened.value = opened.value === id ? null : id
}

function submit(): void {
  form.post('/coffre', { onSuccess: () => form.reset('title', 'content') })
}

function remove(id: number): void {
  if (!window.confirm(t('coffre.index.deleteConfirm'))) return

  router.delete(`/coffre/${id}`)
}

function lock(): void {
  router.post('/coffre/verrouiller')
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
          </select>
        </div>

        <div>
          <label class="mb-[7px] block text-[12px] text-txt-2">
            {{ t('coffre.index.entryTitle') }}
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
            {{ form.type === 'url' ? t('coffre.index.contentUrl') : t('coffre.index.content') }}
          </label>
          <textarea
            v-model="form.content"
            rows="4"
            class="w-full resize-y rounded-[7px] border border-line-2 bg-[rgba(255,255,255,.04)] px-3.5 py-[11px] text-[14px] text-txt outline-none focus:border-aqua"
            :class="form.errors.content ? 'border-bad' : ''"
          ></textarea>
          <p v-if="form.errors.content" class="mt-1.5 text-[12.5px] text-bad">
            {{ form.errors.content }}
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
              {{ entry.type === 'url' ? t('coffre.index.typeUrl') : t('coffre.index.typeNote') }}
            </span>
            <!-- Un titre vide signe un déchiffrement échoué : on le NOMME plutôt que d'afficher
                 une ligne muette, qui laisserait croire à une entrée sans titre. -->
            {{ entry.title || t('coffre.index.unreadable') }}
          </button>
          <button
            type="button"
            class="shrink-0 text-[12.5px] text-txt-3 hover:text-bad"
            @click="remove(entry.id)"
          >
            {{ t('coffre.index.delete') }}
          </button>
        </div>

        <pre
          v-if="opened === entry.id"
          class="mt-3 overflow-x-auto rounded-[8px] bg-panel-2 p-4 font-mono text-[12.5px] whitespace-pre-wrap text-txt-2"
          >{{ entry.content }}</pre
        >
      </article>
    </section>
  </div>
</template>
