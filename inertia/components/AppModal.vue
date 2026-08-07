<script lang="ts">
/*
| État de PILE, partagé entre toutes les instances d'AppModal.
|
| ⚠️ `<script setup>` s'exécute par instance (une fois par montage) : une variable qui doit
| survivre à PLUSIEURS modales ouvertes en même temps (CC-206 posera une confirmation par-dessus
| un formulaire) doit vivre ici, dans l'unique bloc de MODULE — évalué une seule fois, partagé.
*/
const openStack: symbol[] = []
let previousBodyOverflow: string | null = null
</script>

<script setup lang="ts">
import { onMounted, onUnmounted, ref, useId } from 'vue'

const emit = defineEmits<{ close: [] }>()

/**
 * Exposé au slot pour `aria-labelledby` : le chassis ne porte aucune structure interne (CC-207),
 * donc c'est au contenu de poser cet id sur ce qu'il considère être son titre.
 */
const titleId = useId()

const overlay = ref<HTMLElement | null>(null)
const instanceId = Symbol('app-modal')
let opener: HTMLElement | null = null

function focusablesIn(root: HTMLElement): HTMLElement[] {
  return Array.from(
    root.querySelectorAll<HTMLElement>(
      'a[href], button:not([disabled]), textarea:not([disabled]), input:not([disabled]), select:not([disabled]), [tabindex]:not([tabindex="-1"])'
    )
  )
}

/** Piège le Tab dans les limites de CETTE instance — sans stack-awareness nécessaire : une
 * modale au-dessus n'a pas le focus dans les limites de celle-ci, donc rien ne se déclenche.
 * ⚠️ Suppose que les instances empilées sont des FRÈRES dans le DOM (le cas des trois
 * consommateurs actuels) — une modale montée à l'intérieur du `<slot>` d'une autre verrait ses
 * propres éléments inclus dans `focusablesIn` de l'englobante, et les deux pièges pourraient se
 * marcher dessus sur les bords de la liste combinée. */
function trapTab(event: KeyboardEvent): void {
  if (event.key !== 'Tab' || !overlay.value) return
  const focusables = focusablesIn(overlay.value)
  if (focusables.length === 0) return

  const first = focusables[0]
  const last = focusables[focusables.length - 1]

  if (event.shiftKey && document.activeElement === first) {
    event.preventDefault()
    last.focus()
  } else if (!event.shiftKey && document.activeElement === last) {
    event.preventDefault()
    first.focus()
  }
}

/** ⚠️ Seule l'instance empilée EN DERNIER réagit à Échap : chaque instance pose ce même
 * listener sur `window` (patron de la palette ⌘K, CC-207) — sans ce garde, Échap fermerait
 * toutes les modales ouvertes au lieu de la seule au-dessus (CC-206). */
function onWindowKeydown(event: KeyboardEvent): void {
  trapTab(event)
  if (event.key === 'Escape' && openStack[openStack.length - 1] === instanceId) {
    emit('close')
  }
}

onMounted(() => {
  opener = document.activeElement as HTMLElement | null

  if (openStack.length === 0) {
    previousBodyOverflow = document.body.style.overflow
    document.body.style.overflow = 'hidden'
  }
  openStack.push(instanceId)

  window.addEventListener('keydown', onWindowKeydown)

  const focusables = overlay.value ? focusablesIn(overlay.value) : []
  ;(focusables[0] ?? overlay.value)?.focus()
})

onUnmounted(() => {
  window.removeEventListener('keydown', onWindowKeydown)

  const index = openStack.indexOf(instanceId)
  if (index !== -1) openStack.splice(index, 1)
  if (openStack.length === 0) {
    document.body.style.overflow = previousBodyOverflow ?? ''
  }

  // ⚠️ Rendu au démontage, PAS à l'émission de `close` : c'est ce qui couvre les trois chemins
  // de fermeture (bouton, Échap, clic-extérieur) d'un seul geste — restaurer au clic sur
  // « fermer » seul ne couvrirait ni Échap ni le clic-extérieur.
  opener?.focus()
})
</script>

<template>
  <div
    ref="overlay"
    class="fixed inset-0 z-50 flex items-start justify-center bg-[rgba(4,5,14,.6)]"
    role="dialog"
    aria-modal="true"
    :aria-labelledby="titleId"
    tabindex="-1"
    @click.self="emit('close')"
  >
    <slot :title-id="titleId" />
  </div>
</template>
