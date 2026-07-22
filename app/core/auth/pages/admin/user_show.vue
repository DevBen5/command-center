<script setup lang="ts">
import { ref } from 'vue'
import { Head, Link, router } from '@inertiajs/vue3'
import AppLayout from '~/layouts/AppLayout.vue'

defineOptions({ layout: AppLayout })

interface Props {
  // Voir le contrôleur : PAS `user`, qui est la prop partagée du compte connecté.
  account: {
    id: number
    fullName: string | null
    email: string
    isAdmin: boolean
    isActive: boolean
    roleId: number | null
    effective: string[]
  }
  overrides: Array<{ capability: string; granted: boolean }>
  roles: Array<{ id: number; name: string }>
  catalog: Array<{ module: string; capabilities: string[] }>
  invitation: { expiresAt: string; issuedAt: string } | null
  // Vrai seulement si le compte n'a jamais servi : son invitation n'a pas été consommée,
  // donc personne n'a jamais pu s'y connecter. Tout le reste se désactive.
  deletable: boolean
}

const props = defineProps<Props>()

const identity = ref({
  fullName: props.account.fullName ?? '',
  roleId: props.account.roleId === null ? '' : String(props.account.roleId),
  isAdmin: props.account.isAdmin,
})

// Trois états par capacité : hérité du rôle (pas de surcharge), accordé, retiré.
type Override = 'inherit' | 'grant' | 'revoke'

const overrideOf = ref<Record<string, Override>>(
  Object.fromEntries(
    props.overrides.map((one) => [one.capability, one.granted ? 'grant' : 'revoke'])
  )
)

function stateOf(capability: string): Override {
  return overrideOf.value[capability] ?? 'inherit'
}

function setState(capability: string, state: Override): void {
  overrideOf.value = { ...overrideOf.value, [capability]: state }
}

function saveIdentity(): void {
  router.put(`/admin/users/${props.account.id}`, {
    fullName: identity.value.fullName,
    roleId: identity.value.roleId === '' ? null : Number(identity.value.roleId),
    isAdmin: identity.value.isAdmin,
  })
}

function saveOverrides(): void {
  const overrides = Object.entries(overrideOf.value)
    .filter(([, state]) => state !== 'inherit')
    .map(([capability, state]) => ({ capability, granted: state === 'grant' }))

  router.put(`/admin/users/${props.account.id}/capabilities`, { overrides })
}

function toggleActivation(): void {
  router.post(`/admin/users/${props.account.id}/activation`, {}, { preserveScroll: true })
}

function destroy(): void {
  const nom = props.account.fullName ?? props.account.email
  if (!confirm(`Supprimer définitivement le compte « ${nom} » ? Cette action est irréversible.`)) {
    return
  }
  router.delete(`/admin/users/${props.account.id}`)
}

// Le lien n'arrive qu'ici, dans la réponse à ce clic — jamais dans la page rendue,
// jamais dans un message flash, jamais dans les journaux.
const invitationUrl = ref<string | null>(null)

async function issueInvitation(): Promise<void> {
  const response = await fetch(`/admin/users/${props.account.id}/invitation`, {
    method: 'POST',
    headers: {
      'x-xsrf-token': decodeURIComponent(
        document.cookie.split('; ').find((c) => c.startsWith('XSRF-TOKEN='))?.split('=')[1] ?? ''
      ),
    },
  })
  if (!response.ok) return
  const body = (await response.json()) as { path: string }
  invitationUrl.value = `${window.location.origin}${body.path}`
}
</script>

<template>
  <Head :title="account.fullName ?? account.email" />

  <div class="flex max-w-3xl flex-col gap-6">
    <div>
      <Link href="/admin/users" class="text-[12.5px] text-txt-3 hover:text-txt">← Utilisateurs</Link>
      <h2 class="mt-2 text-lg font-bold tracking-tight">{{ account.fullName ?? account.email }}</h2>
      <p class="text-[13px] text-txt-3">{{ account.email }}</p>
    </div>

    <section class="flex flex-col gap-3 rounded-xl border border-line-2 bg-panel p-4">
      <h3 class="text-[13px] font-semibold tracking-tight">Identité et rôle</h3>
      <div class="grid gap-3 sm:grid-cols-2">
        <input
          v-model="identity.fullName"
          placeholder="Nom complet"
          class="rounded-lg border border-line-2 bg-panel-2 px-3 py-2 text-[13px] text-txt outline-none focus:border-accent"
        />
        <select
          v-model="identity.roleId"
          class="rounded-lg border border-line-2 bg-panel-2 px-3 py-2 text-[13px] text-txt outline-none focus:border-accent"
        >
          <option value="">Sans rôle</option>
          <option v-for="role in roles" :key="role.id" :value="String(role.id)">
            {{ role.name }}
          </option>
        </select>
      </div>
      <label class="flex items-center gap-2 text-[13px] text-txt-2">
        <input v-model="identity.isAdmin" type="checkbox" class="accent-accent" />
        Administrateur — passe outre toute capacité, seul accès à Services et Agents
      </label>
      <div>
        <button
          type="button"
          class="rounded-lg bg-accent px-3 py-2 text-[12.5px] font-medium text-white transition hover:opacity-90"
          @click="saveIdentity"
        >
          Enregistrer
        </button>
      </div>
    </section>

    <section class="flex flex-col gap-3 rounded-xl border border-line-2 bg-panel p-4">
      <div>
        <h3 class="text-[13px] font-semibold tracking-tight">Capacités</h3>
        <p class="mt-1 text-[12.5px] text-txt-3">
          Par défaut, une capacité suit le rôle. Une surcharge l'accorde ou la retire pour cette
          personne seulement.
          <span v-if="account.isAdmin" class="text-warn">
            Ce compte est administrateur : ces réglages ne changent rien tant qu'il l'est.
          </span>
        </p>
      </div>

      <div v-for="group in catalog" :key="group.module" class="flex flex-col gap-2">
        <div class="text-[10.5px] tracking-[.12em] text-txt-3 uppercase">{{ group.module }}</div>
        <div
          v-for="capability in group.capabilities"
          :key="capability"
          class="flex items-center justify-between gap-3 rounded-lg border border-line bg-panel-2 px-3 py-2"
        >
          <div class="min-w-0">
            <div class="font-mono text-[12.5px] text-txt">{{ capability }}</div>
            <div class="text-[11.5px] text-txt-3">
              {{
                account.effective.includes(capability)
                  ? 'Actuellement accordée'
                  : 'Actuellement refusée'
              }}
            </div>
          </div>
          <div class="flex shrink-0 overflow-hidden rounded-lg border border-line-2">
            <button
              v-for="option in (['inherit', 'grant', 'revoke'] as const)"
              :key="option"
              type="button"
              class="px-2.5 py-1.5 text-[11px] font-medium transition"
              :class="
                stateOf(capability) === option
                  ? 'bg-accent text-white'
                  : 'bg-panel text-txt-2 hover:text-txt'
              "
              @click="setState(capability, option)"
            >
              {{ option === 'inherit' ? 'Rôle' : option === 'grant' ? 'Accorder' : 'Retirer' }}
            </button>
          </div>
        </div>
      </div>

      <div>
        <button
          type="button"
          class="rounded-lg bg-accent px-3 py-2 text-[12.5px] font-medium text-white transition hover:opacity-90"
          @click="saveOverrides"
        >
          Enregistrer les surcharges
        </button>
      </div>
    </section>

    <section class="flex flex-col gap-3 rounded-xl border border-line-2 bg-panel p-4">
      <h3 class="text-[13px] font-semibold tracking-tight">Accès au compte</h3>

      <p v-if="invitation" class="text-[12.5px] text-txt-2">
        Invitation en attente, émise le
        {{ new Date(invitation.issuedAt).toLocaleString('fr-FR') }}, valable jusqu'au
        {{ new Date(invitation.expiresAt).toLocaleString('fr-FR') }}.
      </p>

      <p class="text-[12.5px] text-txt-3">
        Obtenir un lien révoque le précédent. Il ne s'affiche qu'une fois, ici : il n'est écrit
        ni en base, ni dans les journaux.
        <span v-if="!invitation" class="text-warn">
          Ce compte a déjà un mot de passe : émettre un lien lui permettra d'en choisir un
          nouveau.
        </span>
      </p>

      <div class="flex flex-wrap items-center gap-2">
        <button
          type="button"
          class="rounded-lg border border-line-2 px-3 py-2 text-[12.5px] text-txt-2 transition hover:border-accent hover:text-txt"
          @click="issueInvitation"
        >
          Obtenir un lien d'invitation
        </button>
        <button
          type="button"
          class="rounded-lg border px-3 py-2 text-[12.5px] transition"
          :class="
            account.isActive
              ? 'border-bad/40 text-bad hover:border-bad'
              : 'border-ok/40 text-ok hover:border-ok'
          "
          @click="toggleActivation"
        >
          {{ account.isActive ? 'Désactiver le compte' : 'Réactiver le compte' }}
        </button>
      </div>

      <div v-if="invitationUrl" class="rounded-lg border border-line bg-panel-2 p-3">
        <div class="mb-1 text-[11px] tracking-[.1em] text-txt-3 uppercase">
          Lien à transmettre — visible une seule fois
        </div>
        <code class="block break-all font-mono text-[12px] text-aqua">{{ invitationUrl }}</code>
      </div>
    </section>

    <section
      v-if="deletable"
      class="flex flex-col gap-3 rounded-xl border border-bad/40 bg-panel p-4"
    >
      <h3 class="text-[13px] font-semibold tracking-tight text-bad">Supprimer ce compte</h3>
      <p class="text-[12.5px] text-txt-3">
        Ce compte n'a jamais servi : son invitation n'a pas été utilisée, personne n'a donc pu
        s'y connecter. Il peut être supprimé sans laisser de trace derrière lui.
        <strong class="text-txt-2">
          Dès qu'il aura servi, il ne se supprimera plus — il se désactivera.
        </strong>
      </p>
      <div>
        <button
          type="button"
          class="rounded-lg border border-bad/40 px-3 py-2 text-[12.5px] text-bad transition hover:border-bad"
          @click="destroy"
        >
          Supprimer définitivement
        </button>
      </div>
    </section>
  </div>
</template>
