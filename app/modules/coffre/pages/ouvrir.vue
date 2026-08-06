<script setup lang="ts">
import { Head, useForm } from '@inertiajs/vue3'
import { useI18n } from 'vue-i18n'
import AppLayout from '~/layouts/AppLayout.vue'

defineOptions({ layout: AppLayout })

interface Props {
  /** Ce compte a-t-il déjà posé sa passphrase ? Sinon l'écran propose de créer le coffre. */
  hasVault: boolean
  /** Sans second facteur enrôlé, la porte ne s'ouvrira pas : l'écran le dit AVANT le formulaire. */
  hasTotp: boolean
}

const props = defineProps<Props>()
const { t } = useI18n()

const form = useForm({
  code: '',
  passphrase: '',
  passphrase_confirmation: '',
})

/**
 * ⚠️ **La passphrase est vidée à chaque tentative, jamais conservée « pour la commodité ».**
 * Un champ qui la garde après un refus la laisse dans le DOM d'un onglet qu'on abandonne ;
 * et de toute façon, un code TOTP accepté puis suivi d'une passphrase fausse est consommé —
 * il faut le suivant, donc les deux champs sont à ressaisir.
 */
function submit(): void {
  const url = props.hasVault ? '/coffre/ouvrir' : '/coffre/creation'

  form.post(url, {
    onFinish: () => form.reset('passphrase', 'passphrase_confirmation', 'code'),
  })
}
</script>

<template>
  <Head :title="t('coffre.ouvrir.title')" />

  <div class="mx-auto w-full max-w-[560px]">
    <!-- Le compte n'a pas de second facteur : la porte ne peut pas s'ouvrir, on le dit ici
         plutôt que de proposer un formulaire qui sera refusé à la soumission. -->
    <section
      v-if="!hasTotp"
      class="rounded-[14px] border border-line bg-panel p-7"
    >
      <h2 class="mb-2 text-[20px] font-bold text-accent">{{ t('coffre.ouvrir.noTotpTitle') }}</h2>
      <p class="mb-6 text-[13px] text-txt-2">{{ t('coffre.ouvrir.noTotpLead') }}</p>
      <a
        href="/reglages"
        class="inline-block rounded-[7px] border border-line-2 px-4 py-2.5 text-[13px] text-txt hover:border-aqua"
      >
        {{ t('coffre.ouvrir.toSettings') }}
      </a>
    </section>

    <section v-else class="rounded-[14px] border border-line bg-panel p-7">
      <h2 class="mb-2 text-[20px] font-bold text-accent">
        {{ hasVault ? t('coffre.ouvrir.lockedTitle') : t('coffre.ouvrir.createTitle') }}
      </h2>
      <p class="mb-6 text-[13px] text-txt-2">
        {{ hasVault ? t('coffre.ouvrir.lockedLead') : t('coffre.ouvrir.createLead') }}
      </p>

      <!-- La conséquence irréversible, avant la première saisie et non après. -->
      <p
        v-if="!hasVault"
        class="mb-6 rounded-[8px] border border-warn/40 bg-warn/10 px-4 py-3 text-[12.5px] text-warn"
      >
        {{ t('coffre.ouvrir.createWarning') }}
      </p>

      <form novalidate @submit.prevent="submit">
        <div class="mb-[18px]">
          <label class="mb-[7px] block text-[12px] text-txt-2">{{ t('coffre.ouvrir.code') }}</label>
          <input
            v-model="form.code"
            inputmode="numeric"
            autocomplete="one-time-code"
            :placeholder="t('coffre.ouvrir.codePlaceholder')"
            class="w-full rounded-[7px] border border-line-2 bg-[rgba(255,255,255,.04)] px-3.5 py-[11px] text-[14px] text-txt outline-none focus:border-aqua"
            :class="form.errors.code ? 'border-bad' : ''"
          />
          <p v-if="form.errors.code" class="mt-1.5 text-[12.5px] text-bad">
            {{ form.errors.code }}
          </p>
        </div>

        <div class="mb-[18px]">
          <label class="mb-[7px] block text-[12px] text-txt-2">
            {{ t('coffre.ouvrir.passphrase') }}
          </label>
          <input
            v-model="form.passphrase"
            type="password"
            autocomplete="off"
            class="w-full rounded-[7px] border border-line-2 bg-[rgba(255,255,255,.04)] px-3.5 py-[11px] text-[14px] text-txt outline-none focus:border-aqua"
            :class="form.errors.passphrase ? 'border-bad' : ''"
          />
          <p v-if="form.errors.passphrase" class="mt-1.5 text-[12.5px] text-bad">
            {{ form.errors.passphrase }}
          </p>
        </div>

        <div v-if="!hasVault" class="mb-[18px]">
          <label class="mb-[7px] block text-[12px] text-txt-2">
            {{ t('coffre.ouvrir.passphraseConfirm') }}
          </label>
          <input
            v-model="form.passphrase_confirmation"
            type="password"
            autocomplete="off"
            class="w-full rounded-[7px] border border-line-2 bg-[rgba(255,255,255,.04)] px-3.5 py-[11px] text-[14px] text-txt outline-none focus:border-aqua"
          />
        </div>

        <button
          type="submit"
          :disabled="form.processing"
          class="w-full rounded-[7px] bg-accent px-4 py-[11px] text-[14px] font-semibold text-bg disabled:opacity-60"
        >
          {{ hasVault ? t('coffre.ouvrir.unlock') : t('coffre.ouvrir.create') }}
        </button>
      </form>
    </section>
  </div>
</template>
