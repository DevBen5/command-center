<script setup lang="ts">
import { Head, useForm, usePage } from '@inertiajs/vue3'
import { computed } from 'vue'

const props = defineProps<{ valid: boolean; fullName: string | null }>()

const page = usePage()
const errors = computed(() => (page.props.errors ?? {}) as Record<string, string>)

// ⚠️ Définir le mot de passe **connecte** sur le compte invité, donc déconnecte celui qui
// était en session. C'est cohérent (on vient d'ouvrir un compte, on y entre), mais surprenant
// pour l'administrateur qui ouvre le lien seulement pour le vérifier : il faut le lui dire
// avant qu'il ne clique, pas après.
const connectedAs = computed(() => (page.props.user as { email: string } | null)?.email ?? null)

const form = useForm({ password: '', password_confirmation: '' })

function submit(): void {
  form.post(window.location.pathname, { preserveScroll: true })
}
</script>

<template>
  <Head title="Invitation" />

  <div class="grid min-h-screen place-items-center bg-bg px-4 text-txt">
    <div class="w-full max-w-sm rounded-2xl border border-line-2 bg-panel p-7">
      <div
        class="mb-5 grid h-9 w-9 place-items-center rounded-[10px] bg-linear-to-br from-accent to-accent-deep text-sm font-bold text-white"
      >
        C
      </div>

      <template v-if="!props.valid">
        <h1 class="text-base font-bold tracking-tight">Lien inutilisable</h1>
        <p class="mt-2 text-[13px] text-txt-3">
          Ce lien a déjà servi, a expiré, ou n'a jamais existé. Demande-en un nouveau à
          l'administrateur.
        </p>
      </template>

      <template v-else>
        <h1 class="text-base font-bold tracking-tight">
          Bienvenue{{ props.fullName ? `, ${props.fullName}` : '' }}
        </h1>
        <p class="mt-2 text-[13px] text-txt-3">
          Choisis ton mot de passe. Ce lien ne fonctionnera plus ensuite.
        </p>
        <p v-if="connectedAs" class="mt-2 mb-5 text-[12.5px] text-warn">
          Tu es actuellement connecté en tant que {{ connectedAs }}. Définir ce mot de passe te
          connectera sur ce compte-ci et fermera ta session actuelle.
        </p>
        <div v-else class="mb-5"></div>

        <form class="flex flex-col gap-3" @submit.prevent="submit">
          <input
            v-model="form.password"
            type="password"
            required
            autocomplete="new-password"
            placeholder="Mot de passe (12 caractères minimum)"
            class="rounded-lg border border-line-2 bg-panel-2 px-3 py-2.5 text-[13px] text-txt placeholder:text-txt-3 outline-none focus:border-accent"
          />
          <input
            v-model="form.password_confirmation"
            type="password"
            required
            autocomplete="new-password"
            placeholder="Confirmation"
            class="rounded-lg border border-line-2 bg-panel-2 px-3 py-2.5 text-[13px] text-txt placeholder:text-txt-3 outline-none focus:border-accent"
          />

          <p v-if="errors.password" class="text-[12.5px] text-bad">{{ errors.password }}</p>

          <button
            type="submit"
            :disabled="form.processing"
            class="rounded-lg bg-accent px-3 py-2.5 text-[13px] font-medium text-white transition hover:opacity-90 disabled:opacity-50"
          >
            Définir le mot de passe
          </button>
        </form>
      </template>
    </div>
  </div>
</template>
