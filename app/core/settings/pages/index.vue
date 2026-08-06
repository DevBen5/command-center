<script setup lang="ts">
import { computed, ref } from 'vue'
import { Head, router, useForm, usePage } from '@inertiajs/vue3'
import { useI18n } from 'vue-i18n'
import AppLayout from '~/layouts/AppLayout.vue'
import { copyText, type CopyOutcome } from '~/utils/clipboard'

defineOptions({ layout: AppLayout })

interface Props {
  enabled: boolean
  /** Un enrôlement commencé et pas encore confirmé — donc un QR à scanner. */
  enrollment: { secret: string; uri: string; qr: string } | null
  remainingCodes: number
  /** La règle `ADMIN_2FA_REQUIRED` s'applique à ce compte. */
  required: boolean
  /** Version de `package.json` — peut être en retard sur le code réellement construit (CC-130). */
  version: string
  /** Commit court injecté à la construction de l'image ; `null` en développement (CC-151). */
  commit: string | null
}

const props = defineProps<Props>()
const { t } = useI18n()

const code = ref('')
const error = ref<string | null>(null)
const busy = ref(false)

/**
 * Les codes de secours, tels qu'ils viennent d'être fabriqués.
 *
 * ⚠️ **Ils ne vivent que dans cette variable, le temps de cette page.** Aucun rendu serveur ne
 * les porte, aucun rechargement ne les ramène : c'est le même choix que le lien d'invitation
 * (`user_show.vue`), et pour la même raison — `SESSION_DRIVER` vaut `cookie`, donc un message
 * flash les enverrait chez le client.
 */
const recoveryCodes = ref<string[] | null>(null)
/** Ce que la dernière tentative de copie a donné — `null` tant qu'on n'a rien tenté. */
const copied = ref<CopyOutcome | null>(null)

/** Le jeton CSRF pour les appels `fetch` — Inertia le pose lui-même sur ses propres requêtes. */
function xsrfToken(): string {
  return decodeURIComponent(
    document.cookie
      .split('; ')
      .find((c) => c.startsWith('XSRF-TOKEN='))
      ?.split('=')[1] ?? ''
  )
}

async function postJson(url: string, body?: unknown): Promise<{ recoveryCodes: string[] } | null> {
  const response = await fetch(url, {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-xsrf-token': xsrfToken() },
    body: body === undefined ? undefined : JSON.stringify(body),
  })

  if (!response.ok) {
    // Le serveur nomme l'échec quand il le peut (code invalide, refus). Le repli couvre ce
    // qu'aucun message ne décrit : une réponse vide, une coupure. ⚠️ Une clé de **ce module**
    // (`app/core/settings/i18n/`) — les messages de `resources/lang` sont ceux du serveur,
    // vue-i18n ne les a pas.
    const failure = (await response.json().catch(() => ({}))) as { error?: string }
    error.value = failure.error ?? t('settings.security.failed')
    return null
  }

  return (await response.json()) as { recoveryCodes: string[] }
}

function startEnrollment(): void {
  router.post('/reglages/2fa/enrolement', {}, { preserveScroll: true })
}

async function confirmEnrollment(): Promise<void> {
  error.value = null
  busy.value = true
  const result = await postJson('/reglages/2fa/confirmation', { code: code.value })
  busy.value = false
  code.value = ''

  if (!result) return

  recoveryCodes.value = result.recoveryCodes
}

async function regenerate(): Promise<void> {
  if (!confirm(t('settings.security.regenerateConfirm'))) return

  error.value = null
  busy.value = true
  const result = await postJson('/reglages/2fa/codes')
  busy.value = false

  if (!result) return

  recoveryCodes.value = result.recoveryCodes
}

function disable(): void {
  if (!confirm(t('settings.security.disableConfirm'))) return
  router.post('/reglages/2fa/desactivation', {}, { preserveScroll: true })
}

/**
 * Le changement de mot de passe (CC-147).
 *
 * ⚠️ Les erreurs (mot de passe actuel incorrect, trop de tentatives, nouveau mot de passe trop
 * court) arrivent par `form.errors` — le serveur les flashe sous `errorsBag`, comme le fait déjà
 * le formulaire de connexion. Rien de spécifique à écrire ici pour les afficher.
 */
const passwordForm = useForm({
  currentPassword: '',
  password: '',
  password_confirmation: '',
})

function changePassword(): void {
  passwordForm.post('/reglages/mot-de-passe', {
    preserveScroll: true,
    onSuccess: () => passwordForm.reset(),
  })
}

/**
 * Ferme les sessions ouvertes ailleurs (CC-176) — la sienne survit, le serveur la re-tamponne.
 *
 * ⚠️ **La confirmation n'est pas décorative** : le geste est irréversible pour les autres
 * appareils, qui devront se reconnecter, et rien à l'écran ne dit combien ils sont — il n'existe
 * aucune liste côté serveur. Un clic accidentel n'a pas de retour en arrière.
 */
function revokeSessions(): void {
  if (!confirm(t('settings.security.sessions.confirm'))) return
  router.post('/reglages/sessions', {}, { preserveScroll: true })
}

/**
 * Les codes affichés disparaissent, et la page se recharge : c'est ce rechargement qui met à
 * jour l'état (« actif », le décompte des codes) que la réponse JSON n'a pas traversé.
 */
function acknowledgeCodes(): void {
  recoveryCodes.value = null
  copied.value = null
  router.reload()
}

/**
 * ⚠️ **L'échec se dit, il ne se tait pas** (CC-179). Cette fonction faisait
 * `await navigator.clipboard.writeText(…)` puis `copied = true` sans garde : hors contexte
 * sécurisé — une installation jointe en HTTP depuis une autre machine — la promesse rejetait, la
 * ligne suivante ne s'exécutait jamais, et le bouton restait muet. Ces codes ne s'affichent
 * **qu'une fois** : croire les avoir copiés sans les avoir est exactement ce qu'il ne faut pas.
 */
async function copyCodes(): Promise<void> {
  if (!recoveryCodes.value) return

  copied.value = await copyText(recoveryCodes.value.join('\n'))
}

/**
 * La langue — descendue de la barre latérale vers cet écran (CC-114).
 *
 * ⚠️ **Rien de neuf côté serveur** : `locale` et `supportedLocales` sont des props partagées
 * (`config/inertia.ts`) et le changement passe par `POST /locale`, qui existait déjà. Seuls
 * les boutons ont déménagé — la barre les portait faute d'écran où les mettre.
 */
const page = usePage()
const locale = computed(() => (page.props.locale as string | undefined) ?? 'fr')
const supportedLocales = computed(
  () => (page.props.supportedLocales as string[] | undefined) ?? ['fr']
)

function switchLocale(next: string): void {
  if (next === locale.value) return
  router.post('/locale', { locale: next }, { preserveScroll: true })
}
</script>

<template>
  <Head :title="t('settings.title')" />

  <div class="flex max-w-2xl flex-col gap-6">
    <div>
      <h2 class="text-lg font-bold tracking-tight">{{ t('settings.title') }}</h2>
      <p class="mt-1 text-[13px] text-txt-3">{{ t('settings.lead') }}</p>
    </div>

    <!-- Dire *pourquoi* on est arrivé ici quand la règle a forcé le passage : sans ça, la
         redirection ressemble à une panne de navigation. -->
    <p
      v-if="props.required && !props.enabled"
      class="rounded-xl border border-warn/40 bg-warn/10 px-4 py-3 text-[12.5px] text-warn"
    >
      {{ t('settings.security.required') }}
    </p>

    <!-- Les codes fraîchement générés : affichés une fois, et une seule. -->
    <section
      v-if="recoveryCodes"
      class="flex flex-col gap-3 rounded-xl border border-accent/40 bg-panel p-4"
    >
      <div>
        <h3 class="text-[13px] font-semibold tracking-tight">
          {{ t('settings.security.codesTitle') }}
        </h3>
        <p class="mt-1 text-[12.5px] text-txt-3">{{ t('settings.security.codesLead') }}</p>
      </div>
      <ul class="grid grid-cols-2 gap-2">
        <li
          v-for="one in recoveryCodes"
          :key="one"
          class="rounded-lg border border-line bg-panel-2 px-3 py-2 text-center font-mono text-[13px] tracking-[.12em] text-txt"
        >
          {{ one }}
        </li>
      </ul>
      <p v-if="copied === 'unavailable' || copied === 'refused'" class="text-[12.5px] text-bad">
        {{
          copied === 'unavailable'
            ? t('settings.security.copyUnavailable')
            : t('settings.security.copyRefused')
        }}
      </p>
      <div class="flex gap-2">
        <button
          type="button"
          class="rounded-lg border border-line-2 px-3 py-2 text-[12.5px] text-txt-2 transition hover:border-accent hover:text-txt"
          @click="copyCodes"
        >
          {{ copied === 'ok' ? t('settings.security.copied') : t('settings.security.copy') }}
        </button>
        <button
          type="button"
          class="rounded-lg bg-accent px-3 py-2 text-[12.5px] font-medium text-white transition hover:opacity-90"
          @click="acknowledgeCodes"
        >
          {{ t('settings.security.codesDone') }}
        </button>
      </div>
    </section>

    <section class="flex flex-col gap-3 rounded-xl border border-line-2 bg-panel p-4">
      <div>
        <h3 class="text-[13px] font-semibold tracking-tight">
          {{ t('settings.security.title') }}
        </h3>
        <p class="mt-1 text-[12.5px] text-txt-3">{{ t('settings.security.lead') }}</p>
      </div>

      <div class="flex items-center gap-2">
        <span
          class="h-2 w-2 shrink-0 rounded-full"
          :class="props.enabled ? 'bg-ok' : 'bg-txt-3'"
          aria-hidden="true"
        ></span>
        <span class="text-[12.5px] font-medium text-txt">
          {{ props.enabled ? t('settings.security.statusOn') : t('settings.security.statusOff') }}
        </span>
      </div>

      <template v-if="props.enabled">
        <p class="text-[12.5px] text-txt-3">
          {{ t('settings.security.remainingCodes', { count: props.remainingCodes }) }}
        </p>
        <p v-if="props.remainingCodes === 0" class="text-[12.5px] text-warn">
          {{ t('settings.security.noCodesLeft') }}
        </p>
        <div class="flex flex-wrap gap-2">
          <button
            type="button"
            class="rounded-lg border border-line-2 px-3 py-2 text-[12.5px] text-txt-2 transition hover:border-accent hover:text-txt"
            @click="regenerate"
          >
            {{ t('settings.security.regenerate') }}
          </button>
          <!-- ⚠️ Masqué quand la règle l'exige — et **refusé par le serveur** dans le même cas.
               Masquer un bouton n'a jamais fermé une route : les deux, jamais l'un sans l'autre. -->
          <button
            v-if="!props.required"
            type="button"
            class="rounded-lg border border-bad/50 px-3 py-2 text-[12.5px] text-bad transition hover:bg-bad/10"
            @click="disable"
          >
            {{ t('settings.security.disable') }}
          </button>
        </div>
      </template>

      <template v-else-if="props.enrollment">
        <div>
          <h4 class="text-[12.5px] font-semibold text-txt">
            {{ t('settings.security.enrollTitle') }}
          </h4>
          <p class="mt-1 text-[12.5px] text-txt-3">{{ t('settings.security.enrollLead') }}</p>
        </div>
        <!-- Un `<img>` en data:, jamais un SVG injecté : couvert par `img-src 'self' data:`
             sans toucher à la CSP.

             ⚠️ **`bg-white` est la seule couleur en dur du lot, et elle est fonctionnelle** :
             un QR se lit par le contraste entre ses modules sombres et son fond clair. Posé sur
             `panel`, il devient sombre sur sombre et la plupart des lecteurs de téléphone ne le
             voient plus. Ce n'est pas un choix d'apparence qu'un token `@theme` pourrait porter :
             c'est le fond que la spécification QR suppose. -->
        <img
          :src="props.enrollment.qr"
          :alt="t('settings.security.qrAlt')"
          class="h-44 w-44 rounded-lg bg-white p-2"
        />
        <p class="text-[12.5px] text-txt-3">{{ t('settings.security.manualSecret') }}</p>
        <code
          class="rounded-lg border border-line bg-panel-2 px-3 py-2 font-mono text-[12.5px] break-all text-txt"
        >
          {{ props.enrollment.secret }}
        </code>
        <div class="flex flex-wrap items-start gap-2">
          <input
            v-model="code"
            type="text"
            inputmode="numeric"
            autocomplete="one-time-code"
            :placeholder="t('settings.security.confirmPlaceholder')"
            class="w-32 rounded-lg border border-line-2 bg-panel-2 px-3 py-2 text-center font-mono text-[14px] tracking-[.2em] text-txt outline-none focus:border-accent"
          />
          <button
            type="button"
            :disabled="busy"
            class="rounded-lg bg-accent px-3 py-2 text-[12.5px] font-medium text-white transition hover:opacity-90 disabled:opacity-60"
            @click="confirmEnrollment"
          >
            {{ t('settings.security.confirm') }}
          </button>
          <button
            type="button"
            class="rounded-lg border border-line-2 px-3 py-2 text-[12.5px] text-txt-2 transition hover:border-accent hover:text-txt"
            @click="startEnrollment"
          >
            {{ t('settings.security.restart') }}
          </button>
        </div>
        <p v-if="error" class="text-[12.5px] text-bad">{{ error }}</p>
      </template>

      <template v-else>
        <div>
          <button
            type="button"
            class="rounded-lg bg-accent px-3 py-2 text-[12.5px] font-medium text-white transition hover:opacity-90"
            @click="startEnrollment"
          >
            {{ t('settings.security.start') }}
          </button>
        </div>
      </template>
    </section>

    <section class="flex flex-col gap-3 rounded-xl border border-line-2 bg-panel p-4">
      <div>
        <h3 class="text-[13px] font-semibold tracking-tight">
          {{ t('settings.security.password.title') }}
        </h3>
        <p class="mt-1 text-[12.5px] text-txt-3">{{ t('settings.security.password.lead') }}</p>
      </div>

      <form class="flex flex-col gap-3" @submit.prevent="changePassword">
        <div>
          <label class="mb-1 block text-[12px] text-txt-2">
            {{ t('settings.security.password.current') }}
          </label>
          <input
            v-model="passwordForm.currentPassword"
            type="password"
            autocomplete="current-password"
            class="w-full rounded-lg border border-line-2 bg-panel-2 px-3 py-2 text-[13px] text-txt outline-none focus:border-accent"
            :class="passwordForm.errors.currentPassword ? 'border-bad' : ''"
          />
          <p v-if="passwordForm.errors.currentPassword" class="mt-1 text-[12.5px] text-bad">
            {{ passwordForm.errors.currentPassword }}
          </p>
        </div>

        <div>
          <label class="mb-1 block text-[12px] text-txt-2">
            {{ t('settings.security.password.new') }}
          </label>
          <input
            v-model="passwordForm.password"
            type="password"
            autocomplete="new-password"
            class="w-full rounded-lg border border-line-2 bg-panel-2 px-3 py-2 text-[13px] text-txt outline-none focus:border-accent"
            :class="passwordForm.errors.password ? 'border-bad' : ''"
          />
          <p v-if="passwordForm.errors.password" class="mt-1 text-[12.5px] text-bad">
            {{ passwordForm.errors.password }}
          </p>
        </div>

        <div>
          <label class="mb-1 block text-[12px] text-txt-2">
            {{ t('settings.security.password.confirm') }}
          </label>
          <input
            v-model="passwordForm.password_confirmation"
            type="password"
            autocomplete="new-password"
            class="w-full rounded-lg border border-line-2 bg-panel-2 px-3 py-2 text-[13px] text-txt outline-none focus:border-accent"
          />
        </div>

        <button
          type="submit"
          :disabled="passwordForm.processing"
          class="w-fit rounded-lg bg-accent px-3 py-2 text-[12.5px] font-medium text-white transition hover:opacity-90 disabled:opacity-60"
        >
          {{ t('settings.security.password.submit') }}
        </button>
      </form>
    </section>

    <!-- La révocation en bloc (CC-176). Elle remplace l'avertissement qui vivait sous le
         formulaire ci-dessus : celui-ci disait ce que l'application ne savait pas faire, celle-ci
         le fait. ⚠️ Le titre parle de « sessions », jamais d'« appareils connectés » : le store
         est `cookie`, le serveur ne sait ni combien il y en a ni depuis où — promettre un
         inventaire serait promettre un écran qui n'existe pas. -->
    <section class="flex flex-col gap-3 rounded-xl border border-line-2 bg-panel p-4">
      <div>
        <h3 class="text-[13px] font-semibold tracking-tight">
          {{ t('settings.security.sessions.title') }}
        </h3>
        <p class="mt-1 text-[12.5px] text-txt-3">{{ t('settings.security.sessions.lead') }}</p>
      </div>
      <button
        type="button"
        class="w-fit rounded-lg border border-line-2 px-3 py-2 text-[12.5px] font-medium text-txt transition hover:border-bad hover:text-bad"
        @click="revokeSessions"
      >
        {{ t('settings.security.sessions.submit') }}
      </button>
    </section>

    <section class="flex flex-col gap-3 rounded-xl border border-line-2 bg-panel p-4">
      <div>
        <h3 class="text-[13px] font-semibold tracking-tight">{{ t('settings.language.title') }}</h3>
        <p class="mt-1 text-[12.5px] text-txt-3">{{ t('settings.language.lead') }}</p>
      </div>
      <div class="inline-flex w-fit overflow-hidden rounded-lg border border-line-2">
        <button
          v-for="lng in supportedLocales"
          :key="lng"
          type="button"
          class="px-3 py-1.5 text-[11px] font-medium uppercase transition"
          :class="lng === locale ? 'bg-accent text-white' : 'bg-panel text-txt-2 hover:text-txt'"
          @click="switchLocale(lng)"
        >
          {{ lng }}
        </button>
      </div>
    </section>

    <!-- « Quelle version tourne ? » (CC-151), sans shell. Sobre à dessein : ce n'est pas un
         réglage à manipuler, juste une réponse à une question de diagnostic. -->
    <section class="flex flex-col gap-1 border-t border-line-2 pt-4 text-[11.5px] text-txt-3">
      <p>{{ t('settings.about.version', { version: props.version }) }}</p>
      <p v-if="props.commit">{{ t('settings.about.commit', { commit: props.commit }) }}</p>
      <p v-else>{{ t('settings.about.dev') }}</p>
    </section>
  </div>
</template>
