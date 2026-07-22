<script setup lang="ts">
import { computed, nextTick, ref } from 'vue'
import { ChevronDown } from 'lucide-vue-next'

/*
| Un sélecteur de catégorie / thème pour la relecture des brouillons.
|
| Pourquoi pas un `<datalist>` : le champ est déjà pré-rempli par le modèle, et un
| datalist ne propose alors que ce qui correspond au texte présent — on ne peut plus
| voir la liste entière pour en choisir une autre. Ici, clic sur la flèche = TOUTE la
| liste ; ce n'est qu'en tapant qu'on filtre.
|
| Et il reste **libre** : on peut saisir un nom qui n'existe pas encore (le modèle peut
| inventer une catégorie / un thème, créé à la volée à la validation).
|
| ⚠️ `components/` n'est pas `pages/` : la résolution Inertia fait un glob sur les .vue
| de tout dossier `pages/`. Un composant posé là deviendrait une page.
*/
const props = defineProps<{
  modelValue: string
  options: string[]
  placeholder?: string
  /** Le thème attend sa catégorie : sans elle, rien à proposer. */
  disabled?: boolean
}>()

const emit = defineEmits<{ 'update:modelValue': [string] }>()

const open = ref(false)
// On ne filtre qu'une fois que l'utilisateur a tapé : ouvrir montre TOUT, même quand le
// champ est déjà rempli. C'est tout l'objet du composant.
const filtering = ref(false)
const input = ref<HTMLInputElement | null>(null)

const visible = computed(() => {
  if (!filtering.value) return props.options

  const query = props.modelValue.trim().toLowerCase()
  if (query === '') return props.options
  return props.options.filter((option) => option.toLowerCase().includes(query))
})

/** Le texte saisi ne correspond à aucune option existante : on propose de le créer. */
const canCreate = computed(() => {
  const value = props.modelValue.trim()
  if (value === '') return false
  return !props.options.some((option) => option.toLowerCase() === value.toLowerCase())
})

async function openList(): Promise<void> {
  if (props.disabled) return
  filtering.value = false
  open.value = true
  await nextTick()
  input.value?.focus()
}

function toggle(): void {
  if (open.value) open.value = false
  else void openList()
}

function onInput(event: Event): void {
  emit('update:modelValue', (event.target as HTMLInputElement).value)
  filtering.value = true
  open.value = true
}

function choose(option: string): void {
  emit('update:modelValue', option)
  open.value = false
}
</script>

<template>
  <div class="relative w-[150px]">
    <input
      ref="input"
      :value="modelValue"
      :placeholder="placeholder"
      :disabled="disabled"
      class="w-full rounded-md border border-line-2 bg-panel-2 py-1 pr-6 pl-2 text-[11.5px] outline-none focus:border-accent disabled:opacity-50"
      @input="onInput"
      @focus="openList"
      @blur="open = false"
      @keydown.esc="open = false"
    />

    <!-- La flèche : clic = liste complète. `mousedown.prevent` garde le focus sur le
         champ pour que taper filtre aussitôt. -->
    <button
      type="button"
      :disabled="disabled"
      class="absolute inset-y-0 right-0 flex items-center px-1.5 text-txt-3 transition hover:text-accent disabled:opacity-40"
      tabindex="-1"
      @mousedown.prevent="toggle"
    >
      <ChevronDown :size="14" />
    </button>

    <!-- La liste. `mousedown.prevent` sur chaque ligne empêche le champ de perdre le
         focus avant que le clic ne sélectionne. Le flou (clic ailleurs) ferme. -->
    <div
      v-if="open"
      class="absolute z-20 mt-1 max-h-52 w-full overflow-y-auto rounded-md border border-line bg-panel py-1 shadow-lg"
    >
      <button
        v-for="option in visible"
        :key="option"
        type="button"
        class="block w-full truncate px-2.5 py-1 text-left text-[11.5px] text-txt-2 transition hover:bg-panel-2 hover:text-txt"
        :class="{ 'text-accent': option.toLowerCase() === modelValue.trim().toLowerCase() }"
        @mousedown.prevent="choose(option)"
      >
        {{ option }}
      </button>

      <div
        v-if="!visible.length && !canCreate"
        class="px-2.5 py-1 text-[11px] text-txt-3 italic"
      >
        Aucune option — saisis un nom pour en créer une.
      </div>

      <button
        v-if="canCreate"
        type="button"
        class="block w-full truncate border-t border-line px-2.5 py-1 text-left text-[11.5px] text-accent transition hover:bg-panel-2"
        @mousedown.prevent="open = false"
      >
        Créer « {{ modelValue.trim() }} »
      </button>
    </div>
  </div>
</template>
