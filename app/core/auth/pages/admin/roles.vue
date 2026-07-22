<script setup lang="ts">
import { ref } from 'vue'
import { Head, Link, router } from '@inertiajs/vue3'
import { Plus, Trash2 } from 'lucide-vue-next'
import AppLayout from '~/layouts/AppLayout.vue'

defineOptions({ layout: AppLayout })

interface Role {
  id: number
  name: string
  capabilities: string[]
  userCount: number
}

defineProps<{
  roles: Role[]
  catalog: Array<{ module: string; capabilities: string[] }>
}>()

// `null` = aucun formulaire ouvert ; `0` = création ; sinon l'id du rôle en cours d'édition.
const editing = ref<number | null>(null)
const draft = ref<{ name: string; capabilities: string[] }>({ name: '', capabilities: [] })

function openCreate(): void {
  editing.value = 0
  draft.value = { name: '', capabilities: [] }
}

function openEdit(role: Role): void {
  editing.value = role.id
  draft.value = { name: role.name, capabilities: [...role.capabilities] }
}

function toggle(capability: string): void {
  const capabilities = draft.value.capabilities
  draft.value = {
    ...draft.value,
    capabilities: capabilities.includes(capability)
      ? capabilities.filter((one) => one !== capability)
      : [...capabilities, capability],
  }
}

function save(): void {
  const payload = { name: draft.value.name, capabilities: draft.value.capabilities }
  const done = { onSuccess: () => (editing.value = null) }

  if (editing.value === 0) router.post('/admin/roles', payload, done)
  else router.put(`/admin/roles/${editing.value}`, payload, done)
}

function destroy(role: Role): void {
  router.delete(`/admin/roles/${role.id}`, { preserveScroll: true })
}
</script>

<template>
  <Head title="Rôles" />

  <div class="flex max-w-3xl flex-col gap-6">
    <div class="flex items-center justify-between gap-4">
      <div>
        <Link href="/admin/users" class="text-[12.5px] text-txt-3 hover:text-txt">
          ← Utilisateurs
        </Link>
        <h2 class="mt-2 text-lg font-bold tracking-tight">Rôles</h2>
        <p class="mt-1 text-[13px] text-txt-3">
          Un rôle est un préréglage : un nom posé sur un ensemble de capacités. Pas de
          hiérarchie, pas d'héritage.
        </p>
      </div>
      <button
        type="button"
        class="flex shrink-0 items-center gap-2 rounded-lg bg-accent px-3 py-2 text-[12.5px] font-medium text-white transition hover:opacity-90"
        @click="openCreate"
      >
        <Plus :size="15" :stroke-width="1.8" aria-hidden="true" />
        Nouveau rôle
      </button>
    </div>

    <form
      v-if="editing !== null"
      class="flex flex-col gap-4 rounded-xl border border-line-2 bg-panel p-4"
      @submit.prevent="save"
    >
      <input
        v-model="draft.name"
        required
        placeholder="Nom du rôle"
        class="rounded-lg border border-line-2 bg-panel-2 px-3 py-2 text-[13px] text-txt outline-none focus:border-accent"
      />

      <div v-for="group in catalog" :key="group.module" class="flex flex-col gap-1.5">
        <div class="text-[10.5px] tracking-[.12em] text-txt-3 uppercase">{{ group.module }}</div>
        <label
          v-for="capability in group.capabilities"
          :key="capability"
          class="flex items-center gap-2 font-mono text-[12.5px] text-txt-2"
        >
          <input
            type="checkbox"
            class="accent-accent"
            :checked="draft.capabilities.includes(capability)"
            @change="toggle(capability)"
          />
          {{ capability }}
        </label>
      </div>

      <p class="text-[12px] text-txt-3">
        Services et Agents n'apparaissent pas : ils sont réservés aux administrateurs et
        aucune capacité n'y donne accès.
      </p>

      <div class="flex gap-2">
        <button
          type="submit"
          class="rounded-lg bg-accent px-3 py-2 text-[12.5px] font-medium text-white transition hover:opacity-90"
        >
          Enregistrer
        </button>
        <button
          type="button"
          class="rounded-lg border border-line-2 px-3 py-2 text-[12.5px] text-txt-2 transition hover:text-txt"
          @click="editing = null"
        >
          Annuler
        </button>
      </div>
    </form>

    <div class="flex flex-col gap-2">
      <div
        v-for="role in roles"
        :key="role.id"
        class="flex items-start justify-between gap-4 rounded-xl border border-line-2 bg-panel p-4"
      >
        <div class="min-w-0">
          <button
            type="button"
            class="font-medium text-txt transition hover:text-accent"
            @click="openEdit(role)"
          >
            {{ role.name }}
          </button>
          <div class="text-[11.5px] text-txt-3">
            {{ role.userCount }} compte(s) · {{ role.capabilities.length }} capacité(s)
          </div>
          <div class="mt-2 flex flex-wrap gap-1.5">
            <span
              v-for="capability in role.capabilities"
              :key="capability"
              class="rounded border border-line bg-panel-2 px-1.5 py-0.5 font-mono text-[11px] text-txt-2"
            >
              {{ capability }}
            </span>
          </div>
        </div>
        <button
          type="button"
          class="shrink-0 rounded-lg border border-line-2 p-2 text-txt-3 transition hover:border-bad hover:text-bad"
          title="Supprimer le rôle — les comptes concernés se retrouvent sans aucun accès"
          @click="destroy(role)"
        >
          <Trash2 :size="15" :stroke-width="1.8" aria-hidden="true" />
        </button>
      </div>
    </div>
  </div>
</template>
