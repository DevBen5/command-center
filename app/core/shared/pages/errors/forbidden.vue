<script setup lang="ts">
import { Head } from '@inertiajs/vue3'
import { useI18n } from 'vue-i18n'
import AppLayout from '~/layouts/AppLayout.vue'

/**
 * Le refus, rendu — plutôt que le `{"error":"Accès refusé."}` que voyait un utilisateur.
 *
 * ⚠️ **Elle ne dit jamais quelle capacité manque.** Nommer le droit refusé décrirait le
 * découpage interne de l'application à quelqu'un qui n'y a précisément pas accès.
 *
 * Elle garde `AppLayout` : la barre latérale n'affiche que les écrans que ce compte peut
 * ouvrir, elle est donc exactement ce dont on a besoin après un refus — repartir vers ce
 * qu'on a le droit de voir. Sans layout, la seule issue serait le bouton « précédent ».
 */
defineOptions({ layout: AppLayout })

const { t } = useI18n()
</script>

<template>
  <Head :title="t('forbidden.eyebrow')" />

  <div class="grid min-h-[60vh] place-items-center">
    <div class="max-w-[520px] rounded-[14px] border border-line bg-panel p-9 text-center">
      <div class="text-[11px] tracking-[.18em] text-accent uppercase">
        {{ t('forbidden.eyebrow') }}
      </div>
      <h2 class="mt-2 mb-3 text-[22px] font-bold tracking-tight">{{ t('forbidden.title') }}</h2>
      <p class="text-[13.5px] leading-relaxed text-txt-2">{{ t('forbidden.lead') }}</p>
    </div>
  </div>
</template>
