<script setup lang="ts">
import { Head, Link } from '@inertiajs/vue3'
import AppLayout from '~/layouts/AppLayout.vue'

defineOptions({ layout: AppLayout })

/**
 * ⚠️ **Les quatre sections sont nullables, et ce n'est pas une précaution de style.** Le serveur
 * ne charge ni n'envoie ce que le lecteur n'a pas le droit de voir (`HomeController`) : Services
 * et Agents valent `null` pour tout non-admin. Sans le `v-if` qui accompagne chaque bloc,
 * `cards.services.down.length` lèverait — et **côté client**, donc invisible pour la suite
 * serveur. C'est la conséquence forcée du filtrage, pas une seconde protection : le droit se
 * joue au serveur, ici on évite seulement d'afficher un cadre vide.
 */
interface Cards {
  services: {
    up: number
    total: number
    down: string[]
    highRam: { name: string; ram: number | null }[]
  } | null
  agents: {
    active: number
    running: { id: number; name: string }[]
    failed: { id: number; name: string }[]
  } | null
  veille: { total: number; queue: number; untagged: number } | null
  leitner: { due: number; total: number } | null
}

defineProps<{ cards: Cards }>()
</script>

<template>
  <Head title="Accueil" />

  <div class="mb-[18px]">
    <div class="text-[20px] font-bold tracking-tight">Ce qui demande votre attention</div>
    <div class="mt-0.5 text-[13px] text-txt-2">Un résumé par module, en direct de la base.</div>
  </div>

  <div class="grid grid-cols-2 gap-5">
    <!-- Services — `is_admin` uniquement : le serveur n'envoie rien aux autres -->
    <div v-if="cards.services" class="overflow-hidden rounded-[14px] border border-line bg-panel">
      <!-- En-tête cliquable → ouvre le module (CC-52). Les lignes ci-dessous restent des liens
           frères, jamais imbriqués dans celui-ci. -->
      <Link
        href="/services"
        class="flex items-center gap-3 border-b border-line px-[18px] py-4 transition hover:bg-panel-2"
      >
        <div
          class="grid h-[30px] w-[30px] place-items-center rounded-lg border border-line-2 bg-accent-soft text-accent"
        >
          ◧
        </div>
        <h3 class="text-[15px] font-semibold">Services</h3>
        <span class="ml-auto font-mono text-[11.5px] text-txt-2">
          {{ cards.services.up }} actifs · {{ cards.services.down.length }} arrêté{{
            cards.services.down.length > 1 ? 's' : ''
          }}
        </span>
      </Link>
      <div class="px-[18px] py-2">
        <Link
          v-for="name in cards.services.down"
          :key="name"
          href="/services"
          class="flex items-center gap-3.5 border-b border-line py-3.5 last:border-0"
        >
          <span
            class="min-h-[34px] w-[3px] shrink-0 self-stretch rounded-[3px] bg-accent shadow-[0_0_10px_var(--color-accent)]"
          ></span>
          <div class="flex-1">
            <div class="flex items-center gap-2 text-[13.5px] font-semibold">
              <span class="h-2 w-2 rounded-full bg-bad"></span> {{ name }} — arrêté
            </div>
            <div class="mt-0.5 text-[12px] text-txt-2">Hors ligne · à redémarrer</div>
          </div>
          <span class="font-mono text-[11px] text-txt-3">redémarrer →</span>
        </Link>
        <Link
          v-for="svc in cards.services.highRam"
          :key="svc.name"
          href="/services"
          class="flex items-center gap-3.5 border-b border-line py-3.5 last:border-0"
        >
          <span class="min-h-[34px] w-[3px] shrink-0 self-stretch rounded-[3px] bg-line-2"></span>
          <div class="flex-1">
            <div class="text-[13.5px] font-semibold">{{ svc.name }} — RAM élevée</div>
            <div class="mt-0.5 text-[12px] text-txt-2">Mémoire proche de la limite</div>
          </div>
          <span class="font-mono text-[11px] text-txt-3">{{ svc.ram }} %</span>
        </Link>
        <div
          v-if="!cards.services.down.length && !cards.services.highRam.length"
          class="py-3.5 text-[12.5px] text-txt-2"
        >
          Tous les services sont sains.
        </div>
      </div>
    </div>

    <!-- Agents — `is_admin` uniquement, même raison -->
    <div v-if="cards.agents" class="overflow-hidden rounded-[14px] border border-line bg-panel">
      <Link
        href="/agents"
        class="flex items-center gap-3 border-b border-line px-[18px] py-4 transition hover:bg-panel-2"
      >
        <div
          class="grid h-[30px] w-[30px] place-items-center rounded-lg border border-line-2 bg-accent-soft text-accent"
        >
          ⬡
        </div>
        <h3 class="text-[15px] font-semibold">Agents</h3>
        <span class="ml-auto font-mono text-[11.5px] text-txt-2">
          {{ cards.agents.active }} actifs · {{ cards.agents.running.length }} en cours
        </span>
      </Link>
      <div class="px-[18px] py-2">
        <Link
          v-for="agent in cards.agents.failed"
          :key="agent.id"
          :href="`/agents?id=${agent.id}`"
          class="flex items-center gap-3.5 border-b border-line py-3.5 last:border-0"
        >
          <span
            class="min-h-[34px] w-[3px] shrink-0 self-stretch rounded-[3px] bg-accent shadow-[0_0_10px_var(--color-accent)]"
          ></span>
          <div class="flex-1">
            <div class="flex items-center gap-2 text-[13.5px] font-semibold">
              <span class="h-2 w-2 rounded-full bg-bad"></span> {{ agent.name }} — en échec
            </div>
            <div class="mt-0.5 text-[12px] text-txt-2">Voir les logs pour diagnostiquer</div>
          </div>
          <span class="font-mono text-[11px] text-txt-3">logs →</span>
        </Link>
        <Link
          v-for="agent in cards.agents.running"
          :key="agent.id"
          :href="`/agents?id=${agent.id}`"
          class="flex items-center gap-3.5 border-b border-line py-3.5 last:border-0"
        >
          <span class="min-h-[34px] w-[3px] shrink-0 self-stretch rounded-[3px] bg-line-2"></span>
          <div class="flex-1">
            <div class="flex items-center gap-2 text-[13.5px] font-semibold">
              <span class="h-2 w-2 animate-pulse rounded-full bg-warn"></span> {{ agent.name }} — en
              cours
            </div>
            <div class="mt-0.5 text-[12px] text-txt-2">Exécution en direct</div>
          </div>
          <span class="font-mono text-[11px] text-txt-3">suivre →</span>
        </Link>
        <div
          v-if="!cards.agents.failed.length && !cards.agents.running.length"
          class="py-3.5 text-[12.5px] text-txt-2"
        >
          Aucun agent ne requiert d'attention.
        </div>
      </div>
    </div>

    <!-- Veille — sous `veille.view` -->
    <div v-if="cards.veille" class="overflow-hidden rounded-[14px] border border-line bg-panel">
      <Link
        href="/veille"
        class="flex items-center gap-3 border-b border-line px-[18px] py-4 transition hover:bg-panel-2"
      >
        <div
          class="grid h-[30px] w-[30px] place-items-center rounded-lg border border-line-2 bg-accent-soft text-accent"
        >
          ☰
        </div>
        <h3 class="text-[15px] font-semibold">Veille</h3>
        <span class="ml-auto font-mono text-[11.5px] text-txt-2">
          {{ cards.veille.total }} éléments · {{ cards.veille.queue }} à lire
        </span>
      </Link>
      <div class="px-[18px] py-2">
        <Link
          href="/veille?readingQueue=1"
          class="flex items-center gap-3.5 border-b border-line py-3.5"
        >
          <span class="min-h-[34px] w-[3px] shrink-0 self-stretch rounded-[3px] bg-line-2"></span>
          <div class="flex-1">
            <div class="text-[13.5px] font-semibold">
              File de lecture — {{ cards.veille.queue }} éléments
            </div>
            <div class="mt-0.5 text-[12px] text-txt-2">Articles mis de côté à lire</div>
          </div>
          <span class="font-mono text-[11px] text-txt-3">file →</span>
        </Link>
        <Link href="/veille" class="flex items-center gap-3.5 py-3.5">
          <span class="min-h-[34px] w-[3px] shrink-0 self-stretch rounded-[3px] bg-line-2"></span>
          <div class="flex-1">
            <div class="text-[13.5px] font-semibold">
              {{ cards.veille.untagged }} captures sans tag
            </div>
            <div class="mt-0.5 text-[12px] text-txt-2">À classer dans la base de connaissances</div>
          </div>
          <span class="font-mono text-[11px] text-txt-3">trier →</span>
        </Link>
      </div>
    </div>

    <!-- Révision — sous `leitner.view` -->
    <div v-if="cards.leitner" class="overflow-hidden rounded-[14px] border border-line bg-panel">
      <Link
        href="/revision"
        class="flex items-center gap-3 border-b border-line px-[18px] py-4 transition hover:bg-panel-2"
      >
        <div
          class="grid h-[30px] w-[30px] place-items-center rounded-lg border border-line-2 bg-accent-soft text-accent"
        >
          ▤
        </div>
        <h3 class="text-[15px] font-semibold">Révision</h3>
        <span class="ml-auto font-mono text-[11.5px] text-txt-2">
          {{ cards.leitner.due }} dues · {{ cards.leitner.total }} au total
        </span>
      </Link>
      <div class="px-[18px] py-2">
        <Link
          href="/revision?scope=all"
          class="flex items-center gap-3.5 border-b border-line py-3.5"
        >
          <span
            class="min-h-[34px] w-[3px] shrink-0 self-stretch rounded-[3px]"
            :class="
              cards.leitner.due ? 'bg-accent shadow-[0_0_10px_var(--color-accent)]' : 'bg-line-2'
            "
          ></span>
          <div class="flex-1">
            <div class="text-[13.5px] font-semibold">
              {{ cards.leitner.due }} cartes à réviser aujourd'hui
            </div>
            <div class="mt-0.5 text-[12px] text-txt-2">Répétition espacée — boîtes 1 à 5</div>
          </div>
          <span class="font-mono text-[11px] text-txt-3">démarrer →</span>
        </Link>
        <Link href="/revision/settings" class="flex items-center gap-3.5 py-3.5">
          <span class="min-h-[34px] w-[3px] shrink-0 self-stretch rounded-[3px] bg-line-2"></span>
          <div class="flex-1">
            <div class="text-[13.5px] font-semibold">
              {{ cards.leitner.total }} cartes en mémoire
            </div>
            <div class="mt-0.5 text-[12px] text-txt-2">Réparties dans les 5 boîtes Leitner</div>
          </div>
          <span class="font-mono text-[11px] text-txt-3">voir →</span>
        </Link>
      </div>
    </div>
  </div>
</template>
