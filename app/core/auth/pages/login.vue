<script setup lang="ts">
import { Head, useForm } from '@inertiajs/vue3'
import { useI18n } from 'vue-i18n'

const { t } = useI18n()

const form = useForm({
  email: '',
  password: '',
})

function submit(): void {
  form.post('/login', {
    onFinish: () => form.reset('password'),
  })
}
</script>

<template>
  <Head :title="t('login.title')" />

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
      <div class="text-[11px] tracking-[.18em] text-aqua uppercase">{{ t('login.eyebrow') }}</div>
      <h2 class="mt-2 mb-1 text-[30px] font-bold text-accent">{{ t('login.title') }}</h2>
      <p class="mb-7 text-[13px] text-txt-2">{{ t('login.lead') }}</p>

      <div class="mb-[18px]">
        <label class="mb-[7px] block text-[12px] text-txt-2">{{ t('login.email') }}</label>
        <input
          v-model="form.email"
          type="email"
          autocomplete="username"
          class="w-full rounded-[7px] border border-line-2 bg-[rgba(255,255,255,.04)] px-3.5 py-[11px] text-[14px] text-txt outline-none focus:border-aqua"
          :class="form.errors.email ? 'border-bad' : ''"
        />
        <p v-if="form.errors.email" class="mt-1.5 text-[12.5px] text-bad">
          {{ form.errors.email }}
        </p>
      </div>

      <div class="mb-[18px]">
        <label class="mb-[7px] block text-[12px] text-txt-2">{{ t('login.password') }}</label>
        <input
          v-model="form.password"
          type="password"
          autocomplete="current-password"
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
        class="w-full rounded-[7px] bg-linear-to-r from-accent to-accent-deep py-[13px] text-[14px] font-semibold text-white shadow-[0_0_22px_var(--color-accent-soft)] disabled:opacity-60"
      >
        {{ t('login.submit') }}
      </button>
    </form>
  </div>
</template>
