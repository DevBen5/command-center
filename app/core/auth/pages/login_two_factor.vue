<script setup lang="ts">
import { Head, useForm } from '@inertiajs/vue3'
import { useI18n } from 'vue-i18n'

defineProps<{ email: string }>()

const { t } = useI18n()

const form = useForm({
  code: '',
})

function submit(): void {
  form.post('/login/2fa', {
    // Le champ se vide à chaque tentative : un code TOTP ne resert jamais, et un code de
    // secours consommé encore moins. Le laisser inviterait à re-soumettre le même.
    onFinish: () => form.reset('code'),
  })
}
</script>

<template>
  <Head :title="t('twoFactor.title')" />

  <div
    class="flex min-h-screen items-center justify-center bg-bg font-sans"
    style="
      background:
        radial-gradient(80% 70% at 70% 20%, rgba(255, 20, 147, 0.2), transparent 55%),
        radial-gradient(70% 60% at 20% 90%, rgba(0, 224, 210, 0.14), transparent 55%), #0a0b1c;
    "
  >
    <form
      novalidate
      class="w-[380px] max-w-[88vw] rounded-[14px] border border-[rgba(255,20,147,.3)] bg-[rgba(18,19,46,.85)] p-9 shadow-[0_24px_70px_rgba(0,0,0,.5)]"
      @submit.prevent="submit"
    >
      <div class="text-[11px] tracking-[.18em] text-aqua uppercase">
        {{ t('twoFactor.eyebrow') }}
      </div>
      <h2 class="mt-2 mb-1 text-[30px] font-bold text-accent">{{ t('twoFactor.title') }}</h2>
      <p class="mb-2 text-[13px] text-txt-2">{{ t('twoFactor.lead') }}</p>
      <p class="mb-7 font-mono text-[12px] text-txt-3">{{ email }}</p>

      <div class="mb-[18px]">
        <label class="mb-[7px] block text-[12px] text-txt-2">{{ t('twoFactor.code') }}</label>
        <input
          v-model="form.code"
          type="text"
          inputmode="text"
          autocomplete="one-time-code"
          autofocus
          class="w-full rounded-[7px] border border-line-2 bg-[rgba(255,255,255,.04)] px-3.5 py-[11px] text-center font-mono text-[18px] tracking-[.25em] text-txt outline-none focus:border-aqua"
          :class="form.errors.code ? 'border-bad' : ''"
        />
        <p v-if="form.errors.code" class="mt-1.5 text-[12.5px] text-bad">
          {{ form.errors.code }}
        </p>
      </div>

      <button
        type="submit"
        :disabled="form.processing"
        class="w-full rounded-[7px] bg-linear-to-r from-accent to-accent-deep py-[13px] text-[14px] font-semibold text-white shadow-[0_0_22px_var(--color-accent-soft)] disabled:opacity-60"
      >
        {{ t('twoFactor.submit') }}
      </button>

      <!-- Une sortie explicite : sans elle, quelqu'un dont l'application ne répond plus n'a
           que le bouton « précédent » du navigateur pour reprendre au mot de passe. -->
      <a
        href="/login"
        class="mt-4 block text-center text-[12px] text-txt-3 transition hover:text-txt-2"
      >
        {{ t('twoFactor.cancel') }}
      </a>
    </form>
  </div>
</template>
