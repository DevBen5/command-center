<script setup lang="ts">
import { useI18n } from 'vue-i18n'
import { Link } from '@inertiajs/vue3'
import { courseSectionHref } from '../shared/course_section_link'

/**
 * Le contenu d'une section de cours — un contenu, deux châssis (CC-252/CC-254). Ce lot
 * pose le contenu, pour le panneau en ligne de la révision ; CC-254 (mots-clés → modale)
 * le reprendra dans `AppModal`. Calqué sur le bloc déjà rendu par `cours_show.vue`, dont
 * il reprend les clés i18n existantes — aucune clé neuve pour ce composant.
 *
 * ⚠️ `bodyHtml` vient de `renderMarkdown`, côté serveur : ne rends jamais un `body` brut
 * en `v-html` ici, même doctrine que le reste du module (CC-133).
 *
 * ⚠️ Le lien « Voir dans le cours » (CC-273) vit ICI, pas dupliqué chez les deux
 * appelants (`index.vue`, provenance et Approfondir) — un seul point de rendu pour les
 * deux panneaux, l'ancre pointant sur l'`id` de la section.
 */
defineProps<{
  section: {
    id: number
    courseId: number
    headingPath: string[]
    bodyHtml: string
    aliases: string[] | null
  }
  /** Posé par la modale de glossaire (CC-254) pour `aria-labelledby` — absent ailleurs, le
   * chassis `AppModal` ne porte aucune structure interne. */
  titleId?: string
}>()

const { t } = useI18n()
</script>

<template>
  <div class="flex items-center gap-2 text-[11px] text-txt-3">
    <span :id="titleId">{{
      section.headingPath.length ? section.headingPath.join(' › ') : t('leitner.coursShow.introduction')
    }}</span>
    <span v-if="section.aliases?.length" class="rounded-md border border-line px-1.5 py-0.5">
      {{ t('leitner.coursShow.glossary') }} · {{ section.aliases.join(', ') }}
    </span>
  </div>
  <div class="markdown mt-1.5 text-[13px]" v-html="section.bodyHtml"></div>
  <Link
    :href="courseSectionHref(section.courseId, section.id)"
    class="mt-1.5 inline-block text-[11.5px] text-accent transition hover:opacity-80"
  >
    {{ t('leitner.courseSectionView.viewInCourse') }}
  </Link>
</template>
