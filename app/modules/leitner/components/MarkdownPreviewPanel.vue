<script setup lang="ts">
import { computed } from 'vue'
import { useI18n } from 'vue-i18n'
import type { MarkdownPreview } from './leitner_markdown_preview'

/**
 * Le panneau d'aperçu du rendu Markdown (CC-257) — un par champ, sous son `<textarea>`.
 *
 * ⚠️ **Il vit dans un composant, et pas recopié dans les deux pages, pour UNE raison précise** :
 * la classe `markdown`. Sans elle, le Preflight de Tailwind laisse les `ul` sans puces et ramène
 * tous les titres à la taille du texte courant — l'aperçu paraît fonctionner, il ment sur ce que
 * la révision affichera, et **les trois gates restent verts** (jsdom ne fait aucun layout). Deux
 * copies, c'est deux occasions de la perdre d'un seul côté. Ici, il n'y en a qu'une.
 *
 * ⚠️ **Le `v-html` est le cinquième du dépôt, et il consomme la MÊME sortie que les quatre
 * autres** : `renderMarkdown`, côté serveur (CC-133). Ne lui donne jamais autre chose — surtout
 * pas le Markdown source du champ voisin, qui n'est pas de confiance (ingestion LLM, import JSON,
 * cartes communales depuis CC-121).
 *
 * ## Pourquoi le panneau est SOUS le champ, et non à côté
 *
 * La modale de saisie fait 560 px : scindée en deux colonnes, elle en donne ~250 par colonne, où
 * un bloc de code se replie en confettis. Or ce que ce lot doit rendre visible — une clôture
 * ```` ``` ```` non refermée qui avale tout le reste de la carte — est une structure
 * **verticale**, qui se lit en pleine largeur. Et sous le champ, le panneau vit dans le corps
 * `overflow-y-auto` : il allonge le défilement, jamais la modale, donc le
 * `max-h-[calc(100vh_-_8rem)]` du patron CC-66 reste intact sur un écran court.
 */
const props = defineProps<{
  preview: MarkdownPreview
  side: 'front' | 'back'
}>()

const { t } = useI18n()

const html = computed(() =>
  props.side === 'front' ? props.preview.html.front : props.preview.html.back
)

const label = computed(() =>
  props.side === 'front' ? t('leitner.markdown.front') : t('leitner.markdown.back')
)
</script>

<template>
  <div
    v-if="preview.open.value"
    class="shrink-0 rounded-md border border-dashed border-line-2 bg-bg-2 px-2.5 py-2"
  >
    <div class="mb-1 text-[10.5px] tracking-[.1em] text-txt-3 uppercase">{{ label }}</div>

    <!-- ⚠️ `tooLong` et `failed` sont deux messages DISTINCTS : le premier est une limite connue
         (la carte reste enregistrable), le second une panne. Les fondre ferait prendre l'un pour
         l'autre. -->
    <p v-if="preview.state.value === 'tooLong'" class="text-[11.5px] text-warn">
      {{ t('leitner.markdown.tooLong', { max: preview.maxChars.toLocaleString('fr-FR') }) }}
    </p>
    <p v-else-if="preview.state.value === 'failed'" class="text-[11.5px] text-bad">
      {{ t('leitner.markdown.failed') }}
    </p>
    <p v-else-if="!html" class="text-[11.5px] text-txt-3 italic">
      {{
        preview.state.value === 'loading' ? t('leitner.markdown.loading') : t('leitner.markdown.empty')
      }}
    </p>
    <!-- `markdown` porte l'habillage ET le `text-align: left` — voir l'en-tête de ce fichier. -->
    <div v-else class="markdown text-[12.5px] text-txt-2" v-html="html"></div>
  </div>
</template>
