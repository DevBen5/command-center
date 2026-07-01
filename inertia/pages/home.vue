<script setup lang="ts">
import { Head } from '@inertiajs/vue3'
import AppLayout from '~/layouts/AppLayout.vue'

defineOptions({ layout: AppLayout })
</script>

<template>
  <Head title="Accueil" />

  <div class="rounded-[14px] border border-line bg-panel p-8">
    <div class="text-[20px] font-bold tracking-tight">Centre de commande</div>
    <p class="mt-2 max-w-lg text-[13px] text-txt-2">
      Le scaffolding est en place : Adonis 6, Inertia, Vue 3, TypeScript strict et Tailwind v4
      tournent ensemble. Les modules Services, Agents, Veille et Révision arrivent en phase 3.
    </p>
  </div>
</template>
