<script setup lang="ts">
import { Head, Link } from '@inertiajs/vue3'
import { useI18n } from 'vue-i18n'
import AppLayout from '~/layouts/AppLayout.vue'
import CatalogGrid from '../components/CatalogGrid.vue'

defineOptions({ layout: AppLayout })

/**
 * La carte « Immich verrouillé » de l'accueil du coffre (CC-239) — une grille à plat, source
 * VERROUILLÉE (`immich_locked`), photos ET vidéos. Aucune donnée en prop Inertia : toute la donnée
 * vient de `CatalogGrid`, qui interroge `/coffre/catalog/items` par `fetch`.
 */
const { t } = useI18n()
</script>

<template>
  <Head :title="t('coffre.immich.title')" />

  <div class="mx-auto grid w-full max-w-[1100px] gap-6">
    <Link href="/coffre" class="text-[12.5px] text-txt-3 hover:text-aqua">
      {{ t('coffre.index.backToCoffre') }}
    </Link>

    <header class="grid gap-1">
      <h1 class="text-[20px] font-bold">{{ t('coffre.immich.title') }}</h1>
      <p class="text-[13px] text-txt-2">{{ t('coffre.immich.lead') }}</p>
    </header>

    <CatalogGrid locked-source="immich_locked" />
  </div>
</template>
