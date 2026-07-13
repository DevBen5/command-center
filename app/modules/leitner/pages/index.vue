<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import { Head, Link, router } from '@inertiajs/vue3'
import AppLayout from '~/layouts/AppLayout.vue'

defineOptions({ layout: AppLayout })

interface LeitnerCard {
  id: number
  front: string
  back: string
  box: number
  theme: { id: number; name: string; category: { id: number; name: string } } | null
}

interface CategoryNode {
  id: number
  name: string
  themes: { id: number; name: string }[]
}

interface Stats {
  reviewedToday: number
  streak: number
  dueCount: number
  totalCards: number
  retention: number | null
}

const props = defineProps<{
  dueCards: LeitnerCard[]
  boxCounts: Record<number, number>
  categories: CategoryNode[]
  stats: Stats
}>()

const boxIntervalLabel: Record<number, string> = {
  1: 'tous les jours',
  2: 'tous les 2 j',
  3: 'tous les 4 j',
  4: 'hebdo',
  5: 'mensuel',
}

const currentCard = computed(() => props.dueCards[0] ?? null)
const revealed = ref(false)

const hasThemes = computed(() => props.categories.some((category) => category.themes.length > 0))

watch(
  () => currentCard.value?.id,
  () => {
    revealed.value = false
  }
)

function grade(g: 'again' | 'hard' | 'good' | 'easy'): void {
  if (!currentCard.value) return
  router.post(`/revision/${currentCard.value.id}/review`, { grade: g }, { preserveScroll: true })
}

const newCard = ref({ front: '', back: '', leitnerThemeId: null as number | null })
const adding = ref(false)

function submitNewCard(): void {
  if (!newCard.value.front.trim() || !newCard.value.back.trim()) return
  adding.value = true
  router.post('/revision/cards', { ...newCard.value }, {
    preserveScroll: true,
    onFinish: () => {
      adding.value = false
      // Le thème reste sélectionné : on saisit en général plusieurs cartes de suite
      // sur le même sujet.
      newCard.value.front = ''
      newCard.value.back = ''
    },
  })
}
</script>

<template>
  <Head title="Révision" />

  <div class="mb-4 flex items-center gap-3">
    <div>
      <div class="text-[18px] font-bold">
        {{ stats.dueCount }} carte{{ stats.dueCount > 1 ? 's' : '' }} due{{
          stats.dueCount > 1 ? 's' : ''
        }}
        aujourd'hui
      </div>
    </div>
    <div class="ml-auto flex gap-3">
      <div class="rounded-[12px] border border-line bg-panel px-4 py-2.5 text-center">
        <div class="font-mono text-[20px] font-bold">{{ stats.streak }} j</div>
        <div class="text-[10.5px] text-txt-3">série</div>
      </div>
      <div class="rounded-[12px] border border-line bg-panel px-4 py-2.5 text-center">
        <div class="font-mono text-[20px] font-bold">{{ stats.reviewedToday }}</div>
        <div class="text-[10.5px] text-txt-3">révisées auj.</div>
      </div>
      <div class="rounded-[12px] border border-line bg-panel px-4 py-2.5 text-center">
        <div class="font-mono text-[20px] font-bold">
          {{ stats.retention !== null ? `${stats.retention}%` : '—' }}
        </div>
        <div class="text-[10.5px] text-txt-3">rétention (30j)</div>
      </div>
      <div class="rounded-[12px] border border-line bg-panel px-4 py-2.5 text-center">
        <div class="font-mono text-[20px] font-bold">{{ stats.totalCards }}</div>
        <div class="text-[10.5px] text-txt-3">total cartes</div>
      </div>
      <Link
        href="/revision/settings"
        class="flex items-center rounded-[12px] border border-line-2 bg-panel px-4 text-[12.5px] text-txt-2 transition hover:border-accent hover:text-txt"
      >
        Gérer les cartes
      </Link>
    </div>
  </div>

  <div class="grid grid-cols-[1fr_320px] gap-4">
    <div>
      <div
        v-if="currentCard"
        class="flex min-h-[230px] flex-col items-center justify-center gap-4 rounded-[14px] border border-line-2 bg-panel p-9 text-center"
      >
        <div class="flex flex-wrap items-center justify-center gap-1.5">
          <span
            class="rounded-full border border-line-2 bg-panel-2 px-2.5 py-1 text-[11px] text-txt-2"
          >
            Boîte {{ currentCard.box }} · {{ dueCards.length }} restantes
          </span>
          <span
            v-if="currentCard.theme"
            class="rounded-full border border-accent bg-accent-soft px-2.5 py-1 text-[11px] text-txt-2"
          >
            {{ currentCard.theme.category.name }} · {{ currentCard.theme.name }}
          </span>
        </div>
        <div class="max-w-[420px] text-[19px] font-semibold">{{ currentCard.front }}</div>

        <button
          v-if="!revealed"
          type="button"
          class="w-3/5 rounded-[10px] border border-dashed border-line-2 bg-accent-soft py-3.5 text-[11.5px] text-txt-2"
          @click="revealed = true"
        >
          verso masqué — cliquer pour révéler
        </button>
        <div
          v-else
          class="w-3/5 rounded-[10px] border border-line bg-bg-2 p-4 text-[13px] text-txt-2"
        >
          {{ currentCard.back }}
        </div>

        <div v-if="revealed" class="flex gap-2">
          <button
            type="button"
            class="rounded-[9px] border border-line-2 bg-panel-2 px-3.5 py-2 text-[12.5px]"
            @click="grade('again')"
          >
            À revoir
          </button>
          <button
            type="button"
            class="rounded-[9px] border border-line-2 bg-panel-2 px-3.5 py-2 text-[12.5px]"
            @click="grade('hard')"
          >
            Difficile
          </button>
          <button
            type="button"
            class="rounded-[9px] border border-line-2 bg-panel-2 px-3.5 py-2 text-[12.5px]"
            @click="grade('good')"
          >
            Correct
          </button>
          <button
            type="button"
            class="rounded-[9px] border border-accent bg-accent px-3.5 py-2 text-[12.5px] text-white"
            @click="grade('easy')"
          >
            Facile
          </button>
        </div>
      </div>
      <div
        v-else
        class="flex min-h-[230px] flex-col items-center justify-center gap-2 rounded-[14px] border border-dashed border-line-2 bg-bg-2 p-9 text-center"
      >
        <template v-if="stats.totalCards">
          <div class="text-[16px] font-semibold">Tout est à jour — aucune carte due</div>
          <div class="max-w-[380px] text-[12.5px] text-txt-2">
            Ajoutez une carte pour continuer à enrichir votre base de révision.
          </div>
        </template>
        <template v-else>
          <div class="text-[16px] font-semibold">Votre base de révision est vide</div>
          <div class="max-w-[380px] text-[12.5px] text-txt-2">
            Ajoutez votre première carte avec le formulaire ci-contre, ou créez d'abord vos
            catégories et thèmes depuis la gestion des cartes.
          </div>
          <Link
            href="/revision/settings"
            class="mt-2 rounded-[10px] border border-accent bg-accent px-3.5 py-2 text-[12.5px] text-white transition hover:opacity-90"
          >
            Gérer les cartes
          </Link>
        </template>
      </div>

      <div class="mt-6 mb-3 flex items-center gap-3">
        <h2 class="text-[12px] font-bold tracking-[.12em] text-txt-2 uppercase">Boîtes Leitner</h2>
        <span class="h-px flex-1 bg-line"></span>
      </div>
      <div class="grid grid-cols-5 gap-3.5">
        <div
          v-for="box in [1, 2, 3, 4, 5]"
          :key="box"
          class="rounded-[12px] border p-4 text-center"
          :class="box <= 3 ? 'border-accent bg-accent-soft' : 'border-line bg-panel'"
        >
          <div class="text-[10px] tracking-[.1em] text-txt-3 uppercase">Boîte {{ box }}</div>
          <div
            class="my-2 font-mono text-[26px] font-bold"
            :class="box <= 3 ? 'text-accent' : 'text-txt'"
          >
            {{ boxCounts[box] ?? 0 }}
          </div>
          <div class="text-[10.5px] text-txt-2">{{ boxIntervalLabel[box] }}</div>
        </div>
      </div>
    </div>

    <div>
      <div class="mb-3 flex items-center gap-3">
        <h2 class="text-[12px] font-bold tracking-[.12em] text-txt-2 uppercase">
          Ajouter une carte
        </h2>
      </div>
      <form
        class="flex flex-col gap-2 rounded-[12px] border border-line bg-panel p-4"
        @submit.prevent="submitNewCard"
      >
        <textarea
          v-model="newCard.front"
          placeholder="Recto"
          rows="2"
          class="rounded-md border border-line-2 bg-panel-2 px-2.5 py-2 text-[12.5px] placeholder:text-txt-3"
        ></textarea>
        <textarea
          v-model="newCard.back"
          placeholder="Verso"
          rows="2"
          class="rounded-md border border-line-2 bg-panel-2 px-2.5 py-2 text-[12.5px] placeholder:text-txt-3"
        ></textarea>
        <select
          v-model="newCard.leitnerThemeId"
          class="rounded-md border border-line-2 bg-panel-2 px-2.5 py-2 text-[12.5px]"
        >
          <option :value="null">— Non classée —</option>
          <optgroup v-for="category in categories" :key="category.id" :label="category.name">
            <option v-for="theme in category.themes" :key="theme.id" :value="theme.id">
              {{ theme.name }}
            </option>
          </optgroup>
        </select>
        <p v-if="!hasThemes" class="text-[11.5px] text-txt-3 italic">
          Créez catégories et thèmes depuis
          <Link href="/revision/settings" class="text-accent underline">la gestion des cartes</Link>
          pour pouvoir classer vos cartes.
        </p>
        <button
          type="submit"
          class="rounded-md border border-accent bg-accent px-2.5 py-2 text-[12.5px] text-white disabled:opacity-50"
          :disabled="adding || !newCard.front.trim() || !newCard.back.trim()"
        >
          Ajouter
        </button>
      </form>
    </div>
  </div>
</template>
