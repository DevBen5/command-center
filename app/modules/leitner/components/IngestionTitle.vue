<script setup lang="ts">
import { nextTick, ref } from 'vue'
import { Link, router } from '@inertiajs/vue3'
import { Check, Pencil, X } from 'lucide-vue-next'

/*
| Le titre d'une ingestion, renommable en ligne — depuis l'historique comme depuis la
| page de suivi. Le même geste aux deux endroits, donc le même composant.
|
| ⚠️ `components/` n'est pas `pages/` : la résolution Inertia fait un glob sur les .vue
| de tout dossier `pages/`. Un composant posé là deviendrait une page.
*/
const props = defineProps<{
  id: number
  title: string | null
  maxChars: number
  /** La taille du titre : celle d'une ligne d'historique, ou celle d'un en-tête. */
  textClass?: string
  /** Dans l'historique, le titre mène à la page du travail. Sur cette page, il n'y mène plus. */
  href?: string
}>()

const editing = ref(false)
const draft = ref('')
const input = ref<HTMLInputElement | null>(null)

async function open(): Promise<void> {
  draft.value = props.title ?? ''
  editing.value = true
  await nextTick()
  input.value?.focus()
  input.value?.select()
}

/** Un titre vide est refusé côté serveur : on n'envoie même pas la requête. */
function save(): void {
  const title = draft.value.trim()
  if (title === '' || title === props.title) {
    editing.value = false
    return
  }

  router.put(
    `/revision/ingest/${props.id}/title`,
    { title },
    { preserveScroll: true, onFinish: () => (editing.value = false) }
  )
}
</script>

<template>
  <!-- `data-no-nav` : dans l'historique, la ligne entière mène au travail — le champ de
       renommage et son crayon doivent pouvoir être cliqués sans quitter la page. Hors
       édition, le reste de la ligne reste cliquable. -->
  <div class="flex min-w-0 flex-1 items-center gap-1.5" :data-no-nav="editing ? '' : null">
    <template v-if="editing">
      <input
        ref="input"
        v-model="draft"
        :maxlength="maxChars"
        class="min-w-0 flex-1 rounded-md border border-accent bg-panel-2 px-2 py-1 text-[12.5px] outline-none"
        @keyup.enter="save"
        @keyup.esc="editing = false"
      />
      <button
        type="button"
        class="text-ok transition hover:opacity-70"
        title="Renommer"
        @click="save"
      >
        <Check :size="15" />
      </button>
      <button
        type="button"
        class="text-txt-3 transition hover:text-txt"
        title="Annuler"
        @click="editing = false"
      >
        <X :size="15" />
      </button>
    </template>

    <template v-else>
      <!-- Un titre manque seulement aux ingestions antérieures à la colonne : depuis,
           il est fourni ou déduit du cours — jamais « Texte collé ». -->
      <Link
        v-if="href"
        :href="href"
        class="truncate transition hover:text-accent"
        :class="[textClass, title ? '' : 'text-txt-3 italic']"
      >
        {{ title ?? 'Sans titre' }}
      </Link>
      <span v-else class="truncate" :class="[textClass, title ? '' : 'text-txt-3 italic']">
        {{ title ?? 'Sans titre' }}
      </span>

      <button
        type="button"
        data-no-nav
        class="shrink-0 text-txt-3 transition hover:text-accent"
        title="Renommer"
        @click.prevent="open"
      >
        <Pencil :size="13" />
      </button>
    </template>
  </div>
</template>
