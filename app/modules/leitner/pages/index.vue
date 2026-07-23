<script setup lang="ts">
import { computed, onMounted, onUnmounted, ref, watch } from 'vue'
import { Head, Link, router } from '@inertiajs/vue3'
import AppLayout from '~/layouts/AppLayout.vue'
import LeitnerScopePicker from '../components/LeitnerScopePicker.vue'
import LeitnerTabs from '../components/LeitnerTabs.vue'
import { xsrfToken } from '../components/leitner_csrf'
import { useCan } from '../components/leitner_can'
// L'écrêtage, la mesure et les libellés d'échéance vivent hors du `.vue` : Japa n'a aucun
// compilateur Vue, et `MEASURE_MAX_MS` doit être la MÊME valeur que celle du validateur.
import {
  boxIntervalLabel as labelForBox,
  dueLabel as labelForDue,
  fluencyMeasure as measureFluency,
} from '../shared/review_page.js'

defineOptions({ layout: AppLayout })

type Grade = 'again' | 'hard' | 'good' | 'easy'
/** Ce que le juge peut dire. Il **propose** une note, il ne la choisit jamais. */
type Verdict = 'juste' | 'partiel' | 'faux'

interface LeitnerCard {
  id: number
  front: string
  back: string
  box: number
  // Note de la révision précédente : deux `hard` d'affilée ramènent en boîte 1.
  lastGrade: Grade | null
  theme: { id: number; name: string; category: { id: number; name: string } } | null
}

interface Stats {
  // Suit le paquet : c'est ce qu'on est en train de réviser.
  dueCount: number
  // Globaux — mesures d'habitude et inventaire, jamais restreints au paquet.
  reviewedToday: number
  streak: number
  totalCards: number
  retention: number | null
}

interface ScopeChoices {
  categories: Array<{
    id: number
    name: string
    dueCount: number
    themes: Array<{ id: number; name: string; dueCount: number }>
  }>
  unclassifiedDueCount: number
  totalDueCount: number
}

/**
 * Deux visages, une seule page — c'est la query string qui tranche (`view`) :
 * `/revision` propose de **choisir** un paquet, `/revision?theme=3` le révise.
 *
 * Le paquet ne vit que dans l'URL : la page n'en garde aucun état, et `dueCards` est
 * re-requêtée après chaque note. La fin d'un paquet est donc une **file vide**, jamais
 * un compteur de cartes vues — une carte notée « À revoir » reste due et y revient.
 */
const props = defineProps<{
  view: 'choice' | 'session'
  scope: { label: string; finished: boolean } | null
  choices?: ScopeChoices
  scopeError?: string | null
  dueCards?: LeitnerCard[]
  boxCounts: Record<number, number>
  // Intervalles envoyés par le serveur (BOX_INTERVAL_DAYS) : ne pas les redéclarer ici.
  boxIntervals: Record<number, number>
  stats: Stats
}>()

// Deux enveloppes : elles n'injectent que les intervalles reçus du serveur. Le libellé
// lui-même vit dans `shared/review_page.ts`, où il est prouvé.
const boxIntervalLabel = (box: number): string => labelForBox(props.boxIntervals, box)
const dueLabel = (box: number): string => labelForDue(props.boxIntervals, box)

/**
 * Noter écrit `box`, `next_review` et une ligne `leitner_reviews` — les colonnes de la
 * carte, pas d'une progression par personne (CC-72). Un invité en lecture seule n'a pas
 * `leitner.review` : il consulte la carte, la retourne, lit le verso, mais ne note pas.
 *
 * ⚠️ **Masquer n'est pas fermer.** La vraie garde est le middleware sur `POST /:id/review`
 * et `POST /:id/judge` ; ce booléen évite seulement de proposer des boutons qui
 * répondraient 403. Les deux, jamais l'un sans l'autre.
 */
const { can } = useCan()
const canReview = computed(() => can('leitner.review'))

const currentCard = computed(() => props.dueCards?.[0] ?? null)
const revealed = ref(false)

/*
|----------------------------------------------------------------------------
| La réponse écrite : on répond AVANT de voir, et le juge propose une note
|----------------------------------------------------------------------------
| Écrire sa réponse avant le dévoilement supprime la triche de l'auto-évaluation.
| Le dévoilement **vaut soumission** : on ne peut pas lire le verso puis écrire.
|
| ⚠️ Le verdict ne fait que **présélectionner** un bouton. Les quatre restent
| cliquables, et c'est structurel : la note dit l'effort de rappel, que le juge
| ne connaît pas — et c'est cette confirmation qui rend une injection de prompt
| dans la réponse sans effet. Ne la retire pas « pour fluidifier ».
*/

const answer = ref('')
/** Le juge tourne : le champ ET le bouton sont verrouillés (sinon deux appels). */
const judging = ref(false)
const verdict = ref<Verdict | null>(null)
/** Ce qui manquait — **la valeur pédagogique réelle**, à côté du verso. */
const missing = ref('')
/** Le juge n'a pas pu répondre : un badge discret, jamais un blocage. */
const judgeUnavailable = ref(false)
const suggestedGrade = ref<Grade | null>(null)
const latencyMs = ref<number | null>(null)

/*
|----------------------------------------------------------------------------
| Le chrono fantôme : il mesure, il n'affiche RIEN, il ne décide de rien
|----------------------------------------------------------------------------
| Le temps de réponse est un proxy réel de la force du souvenir : c'est lui qui
| récupère les trois nuances que le juge ne distingue pas (`hard`, `good` et `easy`
| sont tous « juste » pour lui).
|
| ⚠️ **Il ne s'affiche jamais, et c'est le sens du mot « fantôme ».** Un chrono
| visible change le comportement qu'il prétend mesurer — il stresse et fait bâcler
| la réponse. Ne l'expose pas « pour que l'utilisateur comprenne la suggestion ».
|
| ⚠️ **On mesure jusqu'à la PREMIÈRE FRAPPE, pas jusqu'au dévoilement.** Le temps
| total est dominé par la longueur de la réponse à taper, pas par la difficulté du
| rappel : un verso en prose coûte quarante secondes même parfaitement su. Une fois
| qu'on tape, on sait. Le total est transmis quand même, en donnée d'observation,
| et aucune règle ne le lit.
|
| ⚠️ **Cette page ne conclut rien.** Elle chronomètre et transmet ; c'est le serveur
| qui décide si la mesure est exploitable (`leitner_fluency.ts`) — y compris la
| condition qu'elle ne peut pas connaître : la carte a-t-elle déjà été notée
| aujourd'hui ?
*/

/*
 * ⚠️ **Le plafond de transport n'est plus déclaré ici** (CC-60). Il vivait en double — une
 * copie ici, l'original dans `services/leitner_fluency.ts` — parce que l'alias `#modules/*`
 * pointe vers des `.js` compilés que Vite ne résout pas. Baisser le plafond serveur sans
 * toucher cette copie faisait poster une mesure hors borne : `POST /review` en 422, et
 * l'utilisateur cliquait une note sans que rien ne se passe. Aucun test ne rougissait.
 *
 * L'écrêtage vit désormais dans `shared/review_page.ts`, atteignable par les deux côtés — et
 * `leitner_review_page.spec.ts` relit CE fichier pour rougir si le littéral y réapparaît.
 * Ne le recopie donc pas, même en commentaire : le test ne fait pas la différence.
 */

const presentedAt = ref(Date.now())
/**
 * ⚠️ **`document.hidden` est lu à l'arrivée de la carte, pas seulement écouté.**
 * `visibilitychange` ne signale qu'une **transition** : une carte présentée dans un
 * onglet déjà en arrière-plan (ctrl+clic, restauration de session, ou simplement la note
 * suivante qui arrive pendant qu'on est ailleurs) n'émettrait aucun événement. On
 * reviendrait une minute plus tard, sous le plafond de 120 s, et « Difficile » serait
 * proposé — puis historisé — sur une carte parfaitement sue.
 */
const hiddenAtPresentation = () => typeof document !== 'undefined' && document.hidden
/** `null` tant que rien n'a été tapé : c'est cette absence qui vaut « non mesurable ». */
const firstInputAt = ref<number | null>(null)
/**
 * Le dévoilement **fige** le temps total. Sans ça, la note l'inclurait aussi la lecture
 * du verso — et la colonne d'observation mesurerait deux choses à la fois, exactement le
 * reproche fait à `latency_ms`.
 */
const revealedAt = ref<number | null>(null)
/** Le document a été masqué ou la fenêtre défocalisée **avant** la première frappe. */
const interrupted = ref(hiddenAtPresentation())

/** La première frappe, et elle seule : les suivantes ne disent plus rien du rappel. */
function markFirstInput(): void {
  if (firstInputAt.value === null) firstInputAt.value = Date.now()
}

/**
 * Une interruption ne compte que **pendant la réflexion**. Après la première frappe,
 * le rappel a déjà eu lieu : partir répondre au téléphone ne fausse plus rien.
 *
 * ⚠️ Ces deux écouteurs ne suffisent pas, et ce n'est pas grave : `visibilitychange`
 * ne se déclenche pas quand on bascule vers une autre application (l'onglet reste
 * visible), et *rien* ne se déclenche quand on se détourne simplement de l'écran. Le
 * vrai filet est le plafond de 120 s appliqué côté serveur ; ceci n'attrape que ce
 * qu'un navigateur sait dire.
 */
function markInterrupted(): void {
  if (firstInputAt.value === null) interrupted.value = true
}

function onVisibilityChange(): void {
  if (document.hidden) markInterrupted()
}

onMounted(() => {
  document.addEventListener('visibilitychange', onVisibilityChange)
  window.addEventListener('blur', markInterrupted)
})

// ⚠️ Sans ce retrait, les écouteurs survivent à une navigation Inertia et s'empilent
// à chaque retour sur /revision — le même piège que le `setInterval` d'`ingest_show`.
onUnmounted(() => {
  document.removeEventListener('visibilitychange', onVisibilityChange)
  window.removeEventListener('blur', markInterrupted)
})

/**
 * L'enveloppe de la mesure : elle ne fait que lire les quatre `ref` du chrono et donner
 * l'instant courant. L'écrêtage et la règle du « négatif vaut `null`, jamais `0` » vivent dans
 * `shared/review_page.ts`, où ils sont prouvés.
 *
 * ⚠️ **Les quatre valeurs partent nommées, jamais positionnelles.** C'est cette couture-là que
 * l'extraction crée : quatre timestamps dans le désordre y seraient invisibles — module vert,
 * page fausse, `easy` proposé sur la carte qu'on vient de rater.
 */
function fluencyMeasure() {
  return measureFluency(
    {
      presentedAt: presentedAt.value,
      firstInputAt: firstInputAt.value,
      revealedAt: revealedAt.value,
      interrupted: interrupted.value,
    },
    Date.now()
  )
}

/**
 * ⚠️ **Tout l'état de la carte en cours se remet à zéro à CHAQUE réponse du serveur.**
 * Deux raisons, et la seconde est un piège :
 *
 * 1. La réponse écrite pour la carte 1 ne doit jamais être historisée sur la note de
 *    la carte 2 — ce serait une donnée fausse, sans erreur ni log.
 * 2. ⚠️ **Surveiller `currentCard.id` ne suffit PAS**, et c'est contre-intuitif :
 *    `again` laisse la carte due le jour même et la remet dans la file (voir la règle
 *    métier). Sur une file d'**une seule carte** — le cas normal en fin de session,
 *    justement sur celle qu'on vient de rater — la carte qui revient porte le **même
 *    id**, le `watch` ne se déclenche pas, et le verso resterait affiché avec la
 *    réponse et le verdict de la tentative précédente. On ne pourrait plus réviser
 *    honnêtement la carte : exactement la triche que ce lot existe pour supprimer.
 *
 * D'où la source : la **référence** de `dueCards`, qu'Inertia renouvelle à chaque
 * réponse. Une note remet donc l'écran à zéro, que la carte change ou non.
 * N'ajoute jamais un `ref` de jugement sans l'ajouter ici aussi.
 *
 * ⚠️ **Le chrono est encore plus sensible que le jugement à cet oubli.** Un
 * `presentedAt` qui survivrait donnerait une durée énorme — mesure écartée, dégât nul.
 * Mais un `firstInputAt` qui survivrait donnerait une durée **quasi nulle**, donc
 * `easy` proposé sur la carte qu'on vient de rater : exactement ce que ce lot existe
 * pour empêcher. (Le serveur reste un second rempart — une carte déjà notée
 * aujourd'hui n'est jamais affinée — mais on ne s'en remet pas à lui.)
 */
watch(
  () => props.dueCards,
  () => {
    revealed.value = false
    answer.value = ''
    judging.value = false
    verdict.value = null
    missing.value = ''
    judgeUnavailable.value = false
    suggestedGrade.value = null
    latencyMs.value = null
    presentedAt.value = Date.now()
    firstInputAt.value = null
    revealedAt.value = null
    // Pas `false` : la carte peut arriver dans un onglet déjà masqué (voir plus haut).
    interrupted.value = hiddenAtPresentation()
  }
)

/**
 * Dévoiler : le verso s'affiche **tout de suite**, le juge travaille derrière.
 *
 * ⚠️ On n'attend pas le verdict pour montrer le verso, et c'est délibéré : le juge a
 * beau être borné à `JUDGE_TIMEOUT_MS`, faire fixer un écran d'attente à quelqu'un qui
 * a la carte sous les yeux, c'est la révision qui tombe parce que le LLM est lent. La
 * présélection arrive quand elle arrive ; si l'utilisateur note avant, il n'en avait
 * pas besoin.
 */
async function reveal(): Promise<void> {
  if (judging.value) return
  revealed.value = true
  // Le temps total se fige ici, avant tout appel : au-delà, on mesurerait la lecture
  // du verso. Il n'est ré-armé que par le `watch` sur `dueCards`.
  revealedAt.value ??= Date.now()

  const card = currentCard.value
  const submitted = answer.value.trim()
  // Rien d'écrit : aucun appel, aucune présélection — l'auto-évaluation nue.
  if (!card || submitted === '') return

  judging.value = true
  try {
    const response = await fetch(`/revision/${card.id}/judge`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'accept': 'application/json',
        // Shield : sans cet en-tête, le POST part en 403 (et pas `x-csrf-token`).
        'x-xsrf-token': xsrfToken(),
      },
      // Le chrono part avec la réponse : la proposition et l'historisation doivent se
      // décider sur exactement la même mesure.
      body: JSON.stringify({ answer: submitted, ...fluencyMeasure() }),
    })
    if (!response.ok) throw new Error(String(response.status))

    const judgment = (await response.json()) as {
      verdict: Verdict | null
      missing: string
      latencyMs: number | null
      suggestedGrade: Grade | null
      unavailable: boolean
    }

    // La carte a pu changer pendant l'appel (note rapide, retour arrière) : appliquer
    // un verdict à la carte suivante serait pire que de le perdre.
    if (currentCard.value?.id !== card.id) return

    verdict.value = judgment.verdict
    missing.value = judgment.missing
    latencyMs.value = judgment.latencyMs
    suggestedGrade.value = judgment.suggestedGrade
    judgeUnavailable.value = judgment.unavailable
  } catch {
    // Le repli, jusqu'au bout : une révision ne tombe pas parce que le juge est muet.
    if (currentCard.value?.id === card.id) judgeUnavailable.value = true
  } finally {
    if (currentCard.value?.id === card.id) judging.value = false
  }
}

const VERDICT_LABELS: Record<Verdict, string> = {
  juste: 'Juste',
  partiel: 'Partiellement juste',
  faux: 'Faux',
}

/**
 * Le bouton mis en avant : celui que le juge propose, **sinon `easy`**.
 *
 * ⚠️ Ce repli sur `easy` n'est pas un choix esthétique : c'est le bouton que cet écran
 * mettait en avant avant l'arrivée du juge. Sans lui, une panne de LM Studio changerait
 * l'apparence de la révision — or elle doit retomber *exactement* sur l'auto-évaluation
 * d'avant. Le mot « suggéré », lui, ne s'affiche que si un juge l'a vraiment dit.
 */
const highlightedGrade = computed<Grade>(() => suggestedGrade.value ?? 'easy')

// Chaque bouton annonce la boîte atteinte et l'échéance : quatre notes, quatre effets.
const gradeActions = computed(() => {
  const card = currentCard.value
  if (!card) return []

  const good = Math.min(5, card.box + 1)
  const easy = Math.min(5, card.box + 2)
  const hardDemotes = card.lastGrade === 'hard'

  return [
    {
      grade: 'again' as Grade,
      label: 'À revoir',
      hint: `reste boîte ${card.box} · revient dans la session`,
    },
    {
      grade: 'hard' as Grade,
      label: 'Difficile',
      hint: hardDemotes
        ? `2ᵉ d'affilée · boîte 1 · ${dueLabel(1)}`
        : `reste boîte ${card.box} · ${dueLabel(card.box)}`,
    },
    { grade: 'good' as Grade, label: 'Correct', hint: `boîte ${good} · ${dueLabel(good)}` },
    { grade: 'easy' as Grade, label: 'Facile', hint: `boîte ${easy} · ${dueLabel(easy)}` },
  ]
})

/**
 * La note — **celle de l'utilisateur, toujours**. Le verdict l'accompagne comme trace,
 * il ne la corrige pas : noter « Facile » sur une réponse jugée fausse enregistre bien
 * `easy`, et la carte monte de deux boîtes.
 */
function grade(g: Grade): void {
  if (!currentCard.value) return
  router.post(
    `/revision/${currentCard.value.id}/review`,
    {
      grade: g,
      // La réponse écrite est conservée même quand le juge n'a rien pu dire :
      // `verdict: null` se relit comme « jamais jugé », pas comme « jugé faux ».
      answer: answer.value.trim() || null,
      verdict: verdict.value,
      latencyMs: latencyMs.value,
      // La même mesure que celle envoyée au juge — le serveur décide seul si elle est
      // exploitable, et donc si elle rejoint l'historique.
      ...fluencyMeasure(),
    },
    { preserveScroll: true }
  )
}
</script>

<template>
  <Head title="Révision" />

  <LeitnerTabs />

  <!-- Lecture seule (CC-72) : l'invité voit la carte, la retourne, lit le verso — il ne
       note pas, et l'écran ne prétend pas que la session progresse. Le bandeau le dit
       plutôt que de laisser un décompte « X cartes dues » sans action possible. -->
  <div
    v-if="!canReview"
    class="mb-4 rounded-[10px] border border-line bg-panel-2 px-3.5 py-2.5 text-[11.5px] text-txt-2"
  >
    Consultation seule — vous pouvez lire les cartes et leur verso ; votre progression n'est
    pas enregistrée.
  </div>

  <div class="mb-4 flex items-center gap-3">
    <div>
      <div v-if="canReview" class="text-[18px] font-bold">
        {{ stats.dueCount }} carte{{ stats.dueCount > 1 ? 's' : '' }} due{{
          stats.dueCount > 1 ? 's' : ''
        }}
        aujourd'hui
      </div>
      <div v-else class="text-[18px] font-bold">Consultation des cartes</div>
      <div v-if="scope" class="mt-0.5 flex items-center gap-2 text-[11.5px] text-txt-3">
        <span>Paquet : {{ scope.label }}</span>
        <Link href="/revision" class="text-accent transition hover:opacity-80">changer</Link>
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
    </div>
  </div>

  <div class="mx-auto max-w-[880px]">
    <!-- Paquet refusé (thème supprimé, combinaison impossible) : on ne révise SURTOUT
         pas « tout » à la place — on le dit, ici, sur l'écran de choix. -->
    <div
      v-if="scopeError"
      class="mb-4 rounded-md border border-bad bg-panel-2 p-2.5 text-[11.5px] font-semibold text-bad"
    >
      {{ scopeError }}
    </div>

    <!-- Aucune carte nulle part : ni paquet à choisir, ni session à mener. -->
    <div
      v-if="stats.totalCards === 0"
      class="flex min-h-[230px] flex-col items-center justify-center gap-2 rounded-[14px] border border-dashed border-line-2 bg-bg-2 p-9 text-center"
    >
      <div class="text-[16px] font-semibold">Votre base de révision est vide</div>
      <div class="max-w-[380px] text-[12.5px] text-txt-2">
        Créez vos catégories, vos thèmes et vos cartes depuis la gestion des cartes : elles
        apparaîtront ici dès la prochaine session.
      </div>
      <Link
        href="/revision/settings"
        class="mt-2 rounded-[10px] border border-accent bg-accent px-3.5 py-2 text-[12.5px] text-white transition hover:opacity-90"
      >
        Gérer les cartes
      </Link>
    </div>

    <!-- Écran de choix : que réviser ce soir ? -->
    <template v-else-if="view === 'choice'">
      <LeitnerScopePicker
        v-if="choices && choices.totalDueCount > 0"
        :categories="choices.categories"
        :unclassified-due-count="choices.unclassifiedDueCount"
        :total-due-count="choices.totalDueCount"
      />
      <div
        v-else
        class="flex min-h-[230px] flex-col items-center justify-center gap-2 rounded-[14px] border border-dashed border-line-2 bg-bg-2 p-9 text-center"
      >
        <div class="text-[16px] font-semibold">Tout est à jour — aucune carte due</div>
        <div class="max-w-[380px] text-[12.5px] text-txt-2">
          Revenez demain, ou enrichissez votre base depuis la gestion des cartes.
        </div>
        <Link
          href="/revision/settings"
          class="mt-2 rounded-[10px] border border-accent bg-accent px-3.5 py-2 text-[12.5px] text-white transition hover:opacity-90"
        >
          Gérer les cartes
        </Link>
      </div>
    </template>

    <div
      v-else-if="currentCard"
      class="flex min-h-[230px] flex-col items-center justify-center gap-4 rounded-[14px] border border-line-2 bg-panel p-9 text-center"
    >
      <div class="flex flex-wrap items-center justify-center gap-1.5">
        <span class="rounded-full border border-line-2 bg-panel-2 px-2.5 py-1 text-[11px] text-txt-2">
          Boîte {{ currentCard.box }}<template v-if="canReview"> · {{ stats.dueCount }} restantes</template>
        </span>
        <span
          v-if="currentCard.theme"
          class="rounded-full border border-accent bg-accent-soft px-2.5 py-1 text-[11px] text-txt-2"
        >
          {{ currentCard.theme.category.name }} · {{ currentCard.theme.name }}
        </span>
      </div>
      <div class="max-w-[420px] text-[19px] font-semibold">{{ currentCard.front }}</div>

      <!-- On répond AVANT de voir : le dévoilement vaut soumission. Le champ se
           verrouille dès qu'on a révélé — on ne peut pas lire puis écrire.
           ⚠️ Masqué en lecture seule : le juge (`POST /:id/judge`) exige `leitner.review`,
           un invité y prendrait un 403. Il retourne la carte et lit le verso, sans saisie. -->
      <div v-if="canReview" class="w-3/5">
        <textarea
          v-model="answer"
          :disabled="revealed"
          rows="3"
          placeholder="Votre réponse — écrivez-la avant de révéler le verso"
          class="w-full resize-y rounded-[10px] border border-line-2 bg-bg-2 p-3 text-[13px] text-txt placeholder:text-txt-3 focus:border-accent focus:outline-none disabled:opacity-60"
          @input="markFirstInput()"
          @keydown.ctrl.enter.prevent="reveal()"
        ></textarea>
      </div>

      <button
        v-if="!revealed"
        type="button"
        class="w-3/5 rounded-[10px] border border-dashed border-line-2 bg-accent-soft py-3.5 text-[11.5px] text-txt-2 transition hover:border-accent"
        @click="reveal()"
      >
        verso masqué — cliquer pour révéler
      </button>
      <div v-else class="w-3/5 rounded-[10px] border border-line bg-bg-2 p-4 text-[13px] text-txt-2">
        {{ currentCard.back }}
      </div>

      <!-- Le verdict et, surtout, CE QUI MANQUAIT : c'est là qu'est la valeur
           pédagogique du lot, pas dans l'étiquette « juste / partiel / faux ». -->
      <div v-if="revealed && (judging || verdict || judgeUnavailable)" class="w-3/5 text-left">
        <div v-if="judging" class="text-[11.5px] text-txt-3">Évaluation en cours…</div>

        <div v-else-if="verdict" class="flex flex-col gap-1.5">
          <span
            class="self-start rounded-full border px-2.5 py-1 text-[11px] font-semibold"
            :class="
              verdict === 'juste'
                ? 'border-ok text-ok'
                : verdict === 'partiel'
                  ? 'border-warn text-warn'
                  : 'border-bad text-bad'
            "
          >
            {{ VERDICT_LABELS[verdict] }}
          </span>
          <p v-if="missing" class="text-[12px] text-txt-2">{{ missing }}</p>
        </div>

        <!-- Repli : discret, non bloquant. Sans ce mot, l'absence de présélection
             se lirait comme un bug — alors que la révision fonctionne, à l'identique
             de ce qu'elle était avant le juge. -->
        <div v-else class="text-[11.5px] text-txt-3">
          Juge indisponible — évaluez vous-même.
        </div>
      </div>

      <!-- Boutons de note : masqués en lecture seule (`grade()` poste sur `POST /:id/review`,
           qui exige `leitner.review`). Un bouton mort qu'on ne peut actionner est une
           frustration, pas une information. -->
      <div v-if="revealed && canReview" class="flex flex-wrap justify-center gap-2">
        <!-- ⚠️ La présélection n'est qu'un SURLIGNAGE : les quatre boutons restent
             cliquables, et cliquer ailleurs applique bien l'autre note. Le juge sait
             si c'est juste, pas si ça a coûté — c'est ça que la note dit. -->
        <button
          v-for="action in gradeActions"
          :key="action.grade"
          type="button"
          class="min-w-[140px] rounded-[9px] border px-3.5 py-2 transition"
          :class="
            action.grade === highlightedGrade
              ? 'border-accent bg-accent text-white hover:opacity-90'
              : 'border-line-2 bg-panel-2 hover:border-accent'
          "
          @click="grade(action.grade)"
        >
          <span class="block text-[12.5px] font-semibold">
            {{ action.label }}
            <span v-if="action.grade === suggestedGrade" class="text-[10px] opacity-75">
              · suggéré
            </span>
          </span>
          <span
            class="mt-0.5 block text-[10.5px]"
            :class="action.grade === highlightedGrade ? 'text-white opacity-75' : 'text-txt-3'"
          >
            {{ action.hint }}
          </span>
        </button>
      </div>
    </div>
    <!-- Paquet épuisé. Deux gestes, et AUCUNE redirection automatique : l'utilisateur
         doit *voir* qu'il a fini — un retour auto à l'écran de choix se lirait comme un
         bug. « Terminé » et « rien à réviser ici » sont la même file vide : seul le
         travail déjà fait aujourd'hui dans le paquet les distingue (`scope.finished`) ;
         annoncer « bravo » à qui n'a rien fait serait faux. -->
    <div
      v-else
      class="flex min-h-[230px] flex-col items-center justify-center gap-2 rounded-[14px] border border-dashed border-line-2 bg-bg-2 p-9 text-center"
    >
      <template v-if="scope?.finished">
        <div class="text-[16px] font-semibold text-ok">Paquet terminé — {{ scope.label }}</div>
        <div class="max-w-[380px] text-[12.5px] text-txt-2">
          Plus aucune carte due ici, y compris celles que vous avez revues à l'instant.
        </div>
      </template>
      <template v-else>
        <div class="text-[16px] font-semibold">Rien à réviser dans ce paquet</div>
        <div class="max-w-[380px] text-[12.5px] text-txt-2">
          {{ scope?.label }} n'a aucune carte due aujourd'hui. Choisissez un autre paquet, ou
          revenez demain.
        </div>
      </template>

      <div class="mt-2 flex flex-wrap justify-center gap-2">
        <Link
          href="/revision"
          class="rounded-[10px] border border-accent bg-accent px-3.5 py-2 text-[12.5px] text-white transition hover:opacity-90"
        >
          Choisir un autre paquet
        </Link>
        <Link
          href="/"
          class="rounded-[10px] border border-line-2 bg-panel-2 px-3.5 py-2 text-[12.5px] text-txt-2 transition hover:border-accent"
        >
          Arrêter
        </Link>
      </div>
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
        <div class="text-[10.5px] text-txt-2">{{ boxIntervalLabel(box) }}</div>
      </div>
    </div>
  </div>
</template>
