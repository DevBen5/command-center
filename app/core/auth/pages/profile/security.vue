<script setup lang="ts">
import { ref } from 'vue'
import { Head, router } from '@inertiajs/vue3'
import { useI18n } from 'vue-i18n'
import AppLayout from '~/layouts/AppLayout.vue'

defineOptions({ layout: AppLayout })

interface Props {
  enabled: boolean
  /** Un enrôlement commencé et pas encore confirmé — donc un QR à scanner. */
  enrollment: { secret: string; uri: string; qr: string } | null
  remainingCodes: number
  /** La règle `ADMIN_2FA_REQUIRED` s'applique à ce compte. */
  required: boolean
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
const copied = ref(false)

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
    // qu'aucun message ne décrit : une réponse vide, une coupure. ⚠️ Une clé i18n **du
    // châssis** — les messages de `resources/lang` sont ceux du serveur, vue-i18n ne les a pas.
    const failure = (await response.json().catch(() => ({}))) as { error?: string }
    error.value = failure.error ?? t('security.failed')
    return null
  }

  return (await response.json()) as { recoveryCodes: string[] }
}

function startEnrollment(): void {
  router.post('/profil/securite/enrolement', {}, { preserveScroll: true })
}

async function confirmEnrollment(): Promise<void> {
  error.value = null
  busy.value = true
  const result = await postJson('/profil/securite/confirmation', { code: code.value })
  busy.value = false
  code.value = ''

  if (!result) return

  recoveryCodes.value = result.recoveryCodes
}

async function regenerate(): Promise<void> {
  if (!confirm(t('security.regenerateConfirm'))) return

  error.value = null
  busy.value = true
  const result = await postJson('/profil/securite/codes')
  busy.value = false

  if (!result) return

  recoveryCodes.value = result.recoveryCodes
}

function disable(): void {
  if (!confirm(t('security.disableConfirm'))) return
  router.post('/profil/securite/desactivation', {}, { preserveScroll: true })
}

/**
 * Les codes affichés disparaissent, et la page se recharge : c'est ce rechargement qui met à
 * jour l'état (« actif », le décompte des codes) que la réponse JSON n'a pas traversé.
 */
function acknowledgeCodes(): void {
  recoveryCodes.value = null
  copied.value = false
  router.reload()
}

async function copyCodes(): Promise<void> {
  if (!recoveryCodes.value) return
  await navigator.clipboard.writeText(recoveryCodes.value.join('\n'))
  copied.value = true
}
</script>

<template>
  <Head :title="t('security.title')" />

  <div class="flex max-w-2xl flex-col gap-6">
    <div>
      <h2 class="text-lg font-bold tracking-tight">{{ t('security.title') }}</h2>
      <p class="mt-1 text-[13px] text-txt-3">{{ t('security.lead') }}</p>
    </div>

    <!-- Dire *pourquoi* on est arrivé ici quand la règle a forcé le passage : sans ça, la
         redirection ressemble à une panne de navigation. -->
    <p
      v-if="props.required && !props.enabled"
      class="rounded-xl border border-warn/40 bg-warn/10 px-4 py-3 text-[12.5px] text-warn"
    >
      {{ t('security.required') }}
    </p>

    <!-- Les codes fraîchement générés : affichés une fois, et une seule. -->
    <section
      v-if="recoveryCodes"
      class="flex flex-col gap-3 rounded-xl border border-accent/40 bg-panel p-4"
    >
      <div>
        <h3 class="text-[13px] font-semibold tracking-tight">{{ t('security.codesTitle') }}</h3>
        <p class="mt-1 text-[12.5px] text-txt-3">{{ t('security.codesLead') }}</p>
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
      <div class="flex gap-2">
        <button
          type="button"
          class="rounded-lg border border-line-2 px-3 py-2 text-[12.5px] text-txt-2 transition hover:border-accent hover:text-txt"
          @click="copyCodes"
        >
          {{ copied ? t('security.copied') : t('security.copy') }}
        </button>
        <button
          type="button"
          class="rounded-lg bg-accent px-3 py-2 text-[12.5px] font-medium text-white transition hover:opacity-90"
          @click="acknowledgeCodes"
        >
          {{ t('security.codesDone') }}
        </button>
      </div>
    </section>

    <section class="flex flex-col gap-3 rounded-xl border border-line-2 bg-panel p-4">
      <div class="flex items-center gap-2">
        <span
          class="h-2 w-2 shrink-0 rounded-full"
          :class="props.enabled ? 'bg-ok' : 'bg-txt-3'"
          aria-hidden="true"
        ></span>
        <h3 class="text-[13px] font-semibold tracking-tight">
          {{ props.enabled ? t('security.statusOn') : t('security.statusOff') }}
        </h3>
      </div>

      <template v-if="props.enabled">
        <p class="text-[12.5px] text-txt-3">
          {{ t('security.remainingCodes', { count: props.remainingCodes }) }}
        </p>
        <p v-if="props.remainingCodes === 0" class="text-[12.5px] text-warn">
          {{ t('security.noCodesLeft') }}
        </p>
        <div class="flex flex-wrap gap-2">
          <button
            type="button"
            class="rounded-lg border border-line-2 px-3 py-2 text-[12.5px] text-txt-2 transition hover:border-accent hover:text-txt"
            @click="regenerate"
          >
            {{ t('security.regenerate') }}
          </button>
          <!-- ⚠️ Masqué quand la règle l'exige — et **refusé par le serveur** dans le même cas.
               Masquer un bouton n'a jamais fermé une route : les deux, jamais l'un sans l'autre. -->
          <button
            v-if="!props.required"
            type="button"
            class="rounded-lg border border-bad/50 px-3 py-2 text-[12.5px] text-bad transition hover:bg-bad/10"
            @click="disable"
          >
            {{ t('security.disable') }}
          </button>
        </div>
      </template>

      <template v-else-if="props.enrollment">
        <div>
          <h4 class="text-[12.5px] font-semibold text-txt">{{ t('security.enrollTitle') }}</h4>
          <p class="mt-1 text-[12.5px] text-txt-3">{{ t('security.enrollLead') }}</p>
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
          :alt="t('security.qrAlt')"
          class="h-44 w-44 rounded-lg bg-white p-2"
        />
        <p class="text-[12.5px] text-txt-3">{{ t('security.manualSecret') }}</p>
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
            :placeholder="t('security.confirmPlaceholder')"
            class="w-32 rounded-lg border border-line-2 bg-panel-2 px-3 py-2 text-center font-mono text-[14px] tracking-[.2em] text-txt outline-none focus:border-accent"
          />
          <button
            type="button"
            :disabled="busy"
            class="rounded-lg bg-accent px-3 py-2 text-[12.5px] font-medium text-white transition hover:opacity-90 disabled:opacity-60"
            @click="confirmEnrollment"
          >
            {{ t('security.confirm') }}
          </button>
          <button
            type="button"
            class="rounded-lg border border-line-2 px-3 py-2 text-[12.5px] text-txt-2 transition hover:border-accent hover:text-txt"
            @click="startEnrollment"
          >
            {{ t('security.restart') }}
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
            {{ t('security.start') }}
          </button>
        </div>
      </template>
    </section>
  </div>
</template>
