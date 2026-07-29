<script setup lang="ts">
import { Head, Link } from '@inertiajs/vue3'
import { Bot, Layers, Rss, Server } from 'lucide-vue-next'
import { useI18n } from 'vue-i18n'
import AppLayout from '~/layouts/AppLayout.vue'
import type { Cards } from '../shared/cards.js'

defineOptions({ layout: AppLayout })

/**
 * ⚠️ **Les quatre sections sont nullables, et ce n'est pas une précaution de style.** Le serveur
 * ne charge ni n'envoie ce que le lecteur n'a pas le droit de voir (`HomeController`) : Services
 * et Agents valent `null` pour tout non-admin. Sans le `v-if` qui accompagne chaque bloc,
 * `cards.services.down.length` lèverait — et **côté client**, donc invisible pour la suite
 * serveur. C'est la conséquence forcée du filtrage, pas une seconde protection : le droit se
 * joue au serveur, ici on évite seulement d'afficher un cadre vide.
 *
 * Le contrat lui-même vit dans `shared/cards.ts` : le spec de composant type ses jeux d'essai
 * dessus, ce qu'il ne pouvait pas faire tant qu'il était déclaré ici.
 */
defineProps<{ cards: Cards }>()

/**
 * Libellés dans `app/core/dashboard/i18n/fr.json`, sous le namespace `dashboard` (CC-94).
 *
 * ⚠️ **Chaque libellé porteur d'un nombre est un message à TROIS formes**, pas deux. La règle de
 * pluralisation par défaut de vue-i18n mappe `0` sur la forme 1 : `"arrêté | arrêtés"` rendrait
 * « 0 arrêtés », faux en français. La forme du milieu n'est donc pas une redite — c'est elle qui
 * conserve le singulier à zéro. Même choix que `services.stats.down` (CC-90).
 *
 * ⚠️ **Huit libellés ont été pluralisés, un seul l'était.** Le code ne portait que
 * `arrêté{{ n > 1 ? 's' : '' }}` ; « éléments », « captures », « cartes », « actifs » et « dues »
 * étaient figés au pluriel et mentaient à 1 (« 1 cartes à réviser »).
 */
const { t } = useI18n()
</script>

<template>
  <Head :title="t('dashboard.home.title')" />

  <div class="mb-[18px]">
    <div class="text-[20px] font-bold tracking-tight">{{ t('dashboard.home.heading') }}</div>
    <div class="mt-0.5 text-[13px] text-txt-2">{{ t('dashboard.home.subtitle') }}</div>
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
          <Server :size="16" :stroke-width="1.5" aria-hidden="true" />
        </div>
        <h3 class="text-[15px] font-semibold">{{ t('dashboard.home.services.title') }}</h3>
        <!-- Le séparateur `·` est de la ponctuation entre deux libellés, pas un libellé : chaque
             compteur a son propre message, puisque chacun a sa propre règle de pluriel. -->
        <span class="ml-auto font-mono text-[11.5px] text-txt-2">
          {{ t('dashboard.home.services.up', cards.services.up) }} ·
          {{ t('dashboard.home.services.down', cards.services.down.length) }}
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
              <span class="h-2 w-2 rounded-full bg-bad"></span>
              {{ t('dashboard.home.services.stopped', { name }) }}
            </div>
            <div class="mt-0.5 text-[12px] text-txt-2">
              {{ t('dashboard.home.services.stoppedHint') }}
            </div>
          </div>
          <span class="font-mono text-[11px] text-txt-3">
            {{ t('dashboard.home.services.stoppedAction') }}
          </span>
        </Link>
        <Link
          v-for="svc in cards.services.highRam"
          :key="svc.name"
          href="/services"
          class="flex items-center gap-3.5 border-b border-line py-3.5 last:border-0"
        >
          <span class="min-h-[34px] w-[3px] shrink-0 self-stretch rounded-[3px] bg-line-2"></span>
          <div class="flex-1">
            <div class="text-[13.5px] font-semibold">
              {{ t('dashboard.home.services.highRam', { name: svc.name }) }}
            </div>
            <div class="mt-0.5 text-[12px] text-txt-2">
              {{ t('dashboard.home.services.highRamHint') }}
            </div>
          </div>
          <!-- L'espace avant `%` est une règle typographique française : la valeur passe donc par
               un message, là où `en` écrira `42%`. -->
          <span class="font-mono text-[11px] text-txt-3">
            {{ t('dashboard.home.services.ramValue', { ram: svc.ram }) }}
          </span>
        </Link>
        <div
          v-if="!cards.services.down.length && !cards.services.highRam.length"
          class="py-3.5 text-[12.5px] text-txt-2"
        >
          {{ t('dashboard.home.services.empty') }}
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
          <Bot :size="16" :stroke-width="1.5" aria-hidden="true" />
        </div>
        <h3 class="text-[15px] font-semibold">{{ t('dashboard.home.agents.title') }}</h3>
        <span class="ml-auto font-mono text-[11.5px] text-txt-2">
          {{ t('dashboard.home.agents.active', cards.agents.active) }} ·
          {{ t('dashboard.home.agents.running', cards.agents.running.length) }}
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
              <span class="h-2 w-2 rounded-full bg-bad"></span>
              {{ t('dashboard.home.agents.failed', { name: agent.name }) }}
            </div>
            <div class="mt-0.5 text-[12px] text-txt-2">
              {{ t('dashboard.home.agents.failedHint') }}
            </div>
          </div>
          <span class="font-mono text-[11px] text-txt-3">
            {{ t('dashboard.home.agents.failedAction') }}
          </span>
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
              <span class="h-2 w-2 animate-pulse rounded-full bg-warn"></span>
              {{ t('dashboard.home.agents.runningRow', { name: agent.name }) }}
            </div>
            <div class="mt-0.5 text-[12px] text-txt-2">
              {{ t('dashboard.home.agents.runningHint') }}
            </div>
          </div>
          <span class="font-mono text-[11px] text-txt-3">
            {{ t('dashboard.home.agents.runningAction') }}
          </span>
        </Link>
        <div
          v-if="!cards.agents.failed.length && !cards.agents.running.length"
          class="py-3.5 text-[12.5px] text-txt-2"
        >
          {{ t('dashboard.home.agents.empty') }}
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
          <Rss :size="16" :stroke-width="1.5" aria-hidden="true" />
        </div>
        <h3 class="text-[15px] font-semibold">{{ t('dashboard.home.veille.title') }}</h3>
        <span class="ml-auto font-mono text-[11.5px] text-txt-2">
          {{ t('dashboard.home.veille.total', cards.veille.total) }} ·
          {{ t('dashboard.home.veille.queue', cards.veille.queue) }}
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
              {{ t('dashboard.home.veille.queueRow', cards.veille.queue) }}
            </div>
            <div class="mt-0.5 text-[12px] text-txt-2">
              {{ t('dashboard.home.veille.queueHint') }}
            </div>
          </div>
          <span class="font-mono text-[11px] text-txt-3">
            {{ t('dashboard.home.veille.queueAction') }}
          </span>
        </Link>
        <Link href="/veille" class="flex items-center gap-3.5 py-3.5">
          <span class="min-h-[34px] w-[3px] shrink-0 self-stretch rounded-[3px] bg-line-2"></span>
          <div class="flex-1">
            <div class="text-[13.5px] font-semibold">
              {{ t('dashboard.home.veille.untagged', cards.veille.untagged) }}
            </div>
            <div class="mt-0.5 text-[12px] text-txt-2">
              {{ t('dashboard.home.veille.untaggedHint') }}
            </div>
          </div>
          <span class="font-mono text-[11px] text-txt-3">
            {{ t('dashboard.home.veille.untaggedAction') }}
          </span>
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
          <Layers :size="16" :stroke-width="1.5" aria-hidden="true" />
        </div>
        <h3 class="text-[15px] font-semibold">{{ t('dashboard.home.leitner.title') }}</h3>
        <span class="ml-auto font-mono text-[11.5px] text-txt-2">
          {{ t('dashboard.home.leitner.due', cards.leitner.due) }} ·
          {{ t('dashboard.home.leitner.total', cards.leitner.total) }}
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
              {{ t('dashboard.home.leitner.dueRow', cards.leitner.due) }}
            </div>
            <div class="mt-0.5 text-[12px] text-txt-2">
              {{ t('dashboard.home.leitner.dueHint') }}
            </div>
          </div>
          <span class="font-mono text-[11px] text-txt-3">
            {{ t('dashboard.home.leitner.dueAction') }}
          </span>
        </Link>
        <Link href="/revision/settings" class="flex items-center gap-3.5 py-3.5">
          <span class="min-h-[34px] w-[3px] shrink-0 self-stretch rounded-[3px] bg-line-2"></span>
          <div class="flex-1">
            <div class="text-[13.5px] font-semibold">
              {{ t('dashboard.home.leitner.totalRow', cards.leitner.total) }}
            </div>
            <div class="mt-0.5 text-[12px] text-txt-2">
              {{ t('dashboard.home.leitner.totalHint') }}
            </div>
          </div>
          <span class="font-mono text-[11px] text-txt-3">
            {{ t('dashboard.home.leitner.totalAction') }}
          </span>
        </Link>
      </div>
    </div>
  </div>
</template>
