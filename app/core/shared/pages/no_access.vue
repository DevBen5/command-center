<script setup lang="ts">
import { Head, router } from '@inertiajs/vue3'
import { useI18n } from 'vue-i18n'

/**
 * L'écran d'un compte actif à qui aucun droit n'a encore été attribué.
 *
 * ⚠️ **Distinct de la page 403, et ce n'est pas une nuance cosmétique.** Un refus dit « pas
 * celle-ci » ; ici il n'y a aucune page vers laquelle repartir. C'est l'écran d'arrivée d'un
 * collègue qui vient d'accepter son invitation et de choisir son mot de passe : lui servir un
 * refus laisserait croire à une panne, ou à un compte cassé.
 *
 * **Sans `AppLayout`, volontairement** : la barre latérale n'affiche que les destinations
 * ouvertes, elle serait donc vide par construction — un cadre autour de rien.
 */
const { t } = useI18n()

function logout(): void {
  router.post('/logout')
}
</script>

<template>
  <Head :title="t('noAccess.eyebrow')" />

  <div class="flex min-h-screen items-center justify-center bg-bg font-sans">
    <div
      class="w-[460px] max-w-[88vw] rounded-[14px] border border-line bg-panel p-9 text-center shadow-[0_24px_70px_rgba(0,0,0,.5)]"
    >
      <div class="text-[11px] tracking-[.18em] text-aqua uppercase">
        {{ t('noAccess.eyebrow') }}
      </div>
      <h2 class="mt-2 mb-3 text-[22px] font-bold tracking-tight text-txt">
        {{ t('noAccess.title') }}
      </h2>
      <p class="mb-7 text-[13.5px] leading-relaxed text-txt-2">{{ t('noAccess.lead') }}</p>

      <button
        type="button"
        class="rounded-[7px] border border-line-2 px-4 py-2.5 text-[13px] text-txt-2 transition hover:border-accent hover:text-txt"
        @click="logout"
      >
        {{ t('noAccess.logout') }}
      </button>
    </div>
  </div>
</template>
