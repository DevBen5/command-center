<script setup lang="ts">
import { useI18n } from 'vue-i18n'

/**
 * Le contenu d'une section de cours — un contenu, deux châssis (CC-252/CC-254). Ce lot
 * pose le contenu, pour le panneau en ligne de la révision ; CC-254 (mots-clés → modale)
 * le reprendra dans `AppModal`. Calqué sur le bloc déjà rendu par `cours_show.vue`, dont
 * il reprend les clés i18n existantes — aucune clé neuve pour ce composant.
 *
 * ⚠️ `bodyHtml` vient de `renderMarkdown`, côté serveur : ne rends jamais un `body` brut
 * en `v-html` ici, même doctrine que le reste du module (CC-133).
 */
defineProps<{
  section: {
    headingPath: string[]
    bodyHtml: string
    aliases: string[] | null
  }
}>()

const { t } = useI18n()
</script>

<template>
  <div class="flex items-center gap-2 text-[11px] text-txt-3">
    <span>{{
      section.headingPath.length ? section.headingPath.join(' › ') : t('leitner.coursShow.introduction')
    }}</span>
    <span v-if="section.aliases?.length" class="rounded-md border border-line px-1.5 py-0.5">
      {{ t('leitner.coursShow.glossary') }} · {{ section.aliases.join(', ') }}
    </span>
  </div>
  <div class="markdown mt-1.5 text-[13px]" v-html="section.bodyHtml"></div>
</template>
