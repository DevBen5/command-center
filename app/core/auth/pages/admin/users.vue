<script setup lang="ts">
import { ref } from 'vue'
import { Head, Link, router } from '@inertiajs/vue3'
import { ShieldCheck, UserPlus } from 'lucide-vue-next'
import AppLayout from '~/layouts/AppLayout.vue'

defineOptions({ layout: AppLayout })

interface AdminUser {
  id: number
  fullName: string | null
  email: string
  isAdmin: boolean
  isActive: boolean
  role: { id: number; name: string } | null
  awaitingInvitation: boolean
}

defineProps<{ users: AdminUser[]; roles: Array<{ id: number; name: string }> }>()

const creating = ref(false)
const form = ref({ fullName: '', email: '', roleId: '' as string, isAdmin: false })

function create(): void {
  router.post(
    '/admin/users',
    {
      fullName: form.value.fullName,
      email: form.value.email,
      roleId: form.value.roleId === '' ? null : Number(form.value.roleId),
      isAdmin: form.value.isAdmin,
    },
    {
      onSuccess: () => {
        creating.value = false
        form.value = { fullName: '', email: '', roleId: '', isAdmin: false }
      },
    }
  )
}
</script>

<template>
  <Head title="Utilisateurs" />

  <div class="flex flex-col gap-6">
    <div class="flex items-center justify-between gap-4">
      <div>
        <h2 class="text-lg font-bold tracking-tight">Utilisateurs</h2>
        <p class="mt-1 text-[13px] text-txt-3">
          Un compte sans rôle et sans surcharge n'a accès à rien. C'est le défaut, et il est
          volontaire.
        </p>
      </div>
      <div class="flex items-center gap-2">
        <Link
          href="/admin/roles"
          class="rounded-lg border border-line-2 px-3 py-2 text-[12.5px] text-txt-2 transition hover:border-accent hover:text-txt"
        >
          Rôles
        </Link>
        <button
          type="button"
          class="flex items-center gap-2 rounded-lg bg-accent px-3 py-2 text-[12.5px] font-medium text-white transition hover:opacity-90"
          @click="creating = !creating"
        >
          <UserPlus :size="15" :stroke-width="1.8" aria-hidden="true" />
          Nouveau compte
        </button>
      </div>
    </div>

    <form
      v-if="creating"
      class="flex flex-col gap-3 rounded-xl border border-line-2 bg-panel p-4"
      @submit.prevent="create"
    >
      <p class="text-[12.5px] text-txt-3">
        Aucun mot de passe n'est saisi ici : le compte reçoit un lien d'invitation à usage
        unique, que tu lui transmets par le canal de ton choix.
      </p>
      <div class="grid gap-3 sm:grid-cols-2">
        <input
          v-model="form.fullName"
          required
          placeholder="Nom complet"
          class="rounded-lg border border-line-2 bg-panel-2 px-3 py-2 text-[13px] text-txt placeholder:text-txt-3 outline-none focus:border-accent"
        />
        <input
          v-model="form.email"
          required
          type="email"
          placeholder="Adresse e-mail"
          class="rounded-lg border border-line-2 bg-panel-2 px-3 py-2 text-[13px] text-txt placeholder:text-txt-3 outline-none focus:border-accent"
        />
        <select
          v-model="form.roleId"
          class="rounded-lg border border-line-2 bg-panel-2 px-3 py-2 text-[13px] text-txt outline-none focus:border-accent"
        >
          <option value="">Sans rôle</option>
          <option v-for="role in roles" :key="role.id" :value="String(role.id)">
            {{ role.name }}
          </option>
        </select>
        <label class="flex items-center gap-2 text-[13px] text-txt-2">
          <input v-model="form.isAdmin" type="checkbox" class="accent-accent" />
          Administrateur (accès total, Services et Agents compris)
        </label>
      </div>
      <div>
        <button
          type="submit"
          class="rounded-lg bg-accent px-3 py-2 text-[12.5px] font-medium text-white transition hover:opacity-90"
        >
          Créer
        </button>
      </div>
    </form>

    <div class="overflow-hidden rounded-xl border border-line-2">
      <table class="w-full text-[13px]">
        <thead class="bg-panel-2 text-[11px] tracking-[.1em] text-txt-3 uppercase">
          <tr>
            <th class="px-4 py-3 text-left font-medium">Nom</th>
            <th class="px-4 py-3 text-left font-medium">Rôle</th>
            <th class="px-4 py-3 text-left font-medium">État</th>
          </tr>
        </thead>
        <tbody>
          <tr v-for="user in users" :key="user.id" class="border-t border-line bg-panel">
            <td class="px-4 py-3">
              <Link :href="`/admin/users/${user.id}`" class="font-medium text-txt hover:text-accent">
                {{ user.fullName ?? user.email }}
              </Link>
              <div class="text-[11.5px] text-txt-3">{{ user.email }}</div>
            </td>
            <td class="px-4 py-3 text-txt-2">
              <span v-if="user.isAdmin" class="inline-flex items-center gap-1.5 text-accent">
                <ShieldCheck :size="14" :stroke-width="1.8" aria-hidden="true" />
                Administrateur
              </span>
              <span v-else>{{ user.role?.name ?? 'Sans rôle' }}</span>
            </td>
            <td class="px-4 py-3">
              <span v-if="!user.isActive" class="text-bad">Désactivé</span>
              <span v-else-if="user.awaitingInvitation" class="text-warn">Invitation en attente</span>
              <span v-else class="text-ok">Actif</span>
            </td>
          </tr>
        </tbody>
      </table>
    </div>
  </div>
</template>
