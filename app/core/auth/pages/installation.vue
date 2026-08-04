<script setup lang="ts">
import { Head, useForm } from '@inertiajs/vue3'
import { useI18n } from 'vue-i18n'

const { t } = useI18n()

// ⚠️ Le jeton se SAISIT (recopié depuis les journaux du serveur) — il n'arrive jamais en
// prop et ne s'affiche nulle part : la page ne le connaît pas, c'est le point (CC-138).
const form = useForm({
  fullName: '',
  email: '',
  password: '',
  password_confirmation: '',
  token: '',
})

function submit(): void {
  form.post('/installation', {
    onFinish: () => form.reset('password', 'password_confirmation'),
  })
}
</script>

<template>
  <Head :title="t('installation.title')" />

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
        {{ t('installation.eyebrow') }}
      </div>
      <h2 class="mt-2 mb-1 text-[30px] font-bold text-accent">{{ t('installation.title') }}</h2>
      <p class="mb-7 text-[13px] text-txt-2">{{ t('installation.lead') }}</p>

      <div class="mb-[18px]">
        <label class="mb-[7px] block text-[12px] text-txt-2">{{ t('installation.fullName') }}</label>
        <input
          v-model="form.fullName"
          type="text"
          autocomplete="name"
          class="w-full rounded-[7px] border border-line-2 bg-[rgba(255,255,255,.04)] px-3.5 py-[11px] text-[14px] text-txt outline-none focus:border-aqua"
          :class="form.errors.fullName ? 'border-bad' : ''"
        />
        <p v-if="form.errors.fullName" class="mt-1.5 text-[12.5px] text-bad">
          {{ form.errors.fullName }}
        </p>
      </div>

      <div class="mb-[18px]">
        <label class="mb-[7px] block text-[12px] text-txt-2">{{ t('installation.email') }}</label>
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
        <label class="mb-[7px] block text-[12px] text-txt-2">
          {{ t('installation.password') }}
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

      <div class="mb-[18px]">
        <label class="mb-[7px] block text-[12px] text-txt-2">
          {{ t('installation.passwordConfirmation') }}
        </label>
        <input
          v-model="form.password_confirmation"
          type="password"
          autocomplete="new-password"
          class="w-full rounded-[7px] border border-line-2 bg-[rgba(255,255,255,.04)] px-3.5 py-[11px] text-[14px] text-txt outline-none focus:border-aqua"
        />
      </div>

      <div class="mb-[18px]">
        <label class="mb-[7px] block text-[12px] text-txt-2">{{ t('installation.token') }}</label>
        <input
          v-model="form.token"
          type="text"
          autocomplete="off"
          class="w-full rounded-[7px] border border-line-2 bg-[rgba(255,255,255,.04)] px-3.5 py-[11px] font-mono text-[13px] text-txt outline-none focus:border-aqua"
          :class="form.errors.token ? 'border-bad' : ''"
        />
        <p class="mt-1.5 text-[12px] text-txt-3">{{ t('installation.tokenHelp') }}</p>
        <p v-if="form.errors.token" class="mt-1.5 text-[12.5px] text-bad">
          {{ form.errors.token }}
        </p>
      </div>

      <button
        type="submit"
        :disabled="form.processing"
        class="w-full rounded-[7px] bg-linear-to-r from-accent to-accent-deep py-[13px] text-[14px] font-semibold text-white shadow-[0_0_22px_var(--color-accent-soft)] disabled:opacity-60"
      >
        {{ t('installation.submit') }}
      </button>
    </form>
  </div>
</template>
