import { describe, expect, test } from 'vitest'
import { mount } from '@vue/test-utils'
import { createI18n } from 'vue-i18n'
import fr from '../../i18n/fr.json' with { type: 'json' }
import ConfirmModal from '../ConfirmModal.vue'

/*
| CC-206 : le composant chassis qui remplace `confirm()` natif. Il monte `AppModal` (CC-207,
| durci par CC-209) sans en réimplémenter rien — overlay, Échap, clic-extérieur, focus,
| défilement de fond, pile d'instances sont déjà couverts par `app_modal.spec.ts`. Ici on ne
| prouve que CE composant ajoute : la résolution de la promesse selon le geste, et le fait
| qu'elle ne reste JAMAIS en suspens.
*/

function monter() {
  return mount(ConfirmModal, {
    attachTo: document.body,
    global: {
      plugins: [
        createI18n({
          legacy: false,
          locale: 'fr',
          fallbackLocale: 'fr',
          messages: { fr },
        }),
      ],
    },
  })
}

describe('inertia / ConfirmModal', () => {
  test('rien n’est monté avant le premier appel à ask()', () => {
    const wrapper = monter()

    expect(wrapper.find('[role="dialog"]').exists()).toBe(false)

    wrapper.unmount()
  })

  test('ask() affiche le message et résout à true sur le bouton de confirmation', async () => {
    const wrapper = monter()

    const promise = wrapper.vm.ask('Supprimer ce contenu ?')
    await wrapper.vm.$nextTick()

    expect(wrapper.text()).toContain('Supprimer ce contenu ?')

    const buttons = wrapper.findAll('button')
    await buttons[1].trigger('click')

    await expect(promise).resolves.toBe(true)
    wrapper.unmount()
  })

  test('résout à false sur le bouton d’annulation', async () => {
    const wrapper = monter()

    const promise = wrapper.vm.ask('Continuer ?')
    await wrapper.vm.$nextTick()

    const buttons = wrapper.findAll('button')
    await buttons[0].trigger('click')

    await expect(promise).resolves.toBe(false)
    wrapper.unmount()
  })

  // ⚠️ Le piège du ticket : une fermeture par Échap ou clic-extérieur ne doit JAMAIS laisser
  // la promesse en suspens — elle doit résoudre comme une annulation.
  test('résout à false sur Échap, jamais en suspens', async () => {
    const wrapper = monter()

    const promise = wrapper.vm.ask('Continuer ?')
    await wrapper.vm.$nextTick()

    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }))
    await wrapper.vm.$nextTick()

    await expect(promise).resolves.toBe(false)
    wrapper.unmount()
  })

  test('résout à false sur un clic extérieur (overlay)', async () => {
    const wrapper = monter()

    const promise = wrapper.vm.ask('Continuer ?')
    await wrapper.vm.$nextTick()

    await wrapper.find('.fixed').trigger('click')

    await expect(promise).resolves.toBe(false)
    wrapper.unmount()
  })

  test('le bouton de confirmation porte la couleur danger quand demandé', async () => {
    const wrapper = monter()

    wrapper.vm.ask('Supprimer ?', { danger: true })
    await wrapper.vm.$nextTick()

    const confirmButton = wrapper.findAll('button')[1]
    expect(confirmButton.classes()).toContain('bg-bad')
    expect(confirmButton.classes()).not.toContain('bg-accent')

    wrapper.unmount()
  })

  test('sans danger, le bouton de confirmation porte la couleur neutre', async () => {
    const wrapper = monter()

    wrapper.vm.ask('Régénérer ?')
    await wrapper.vm.$nextTick()

    const confirmButton = wrapper.findAll('button')[1]
    expect(confirmButton.classes()).toContain('bg-accent')
    expect(confirmButton.classes()).not.toContain('bg-bad')

    wrapper.unmount()
  })

  // ⚠️ Un second appel après résolution doit repartir propre : pas d'état résiduel qui
  // afficherait l'ancien message ou résoudrait deux fois le même appelant.
  test('un second ask() après résolution repart avec le nouveau message', async () => {
    const wrapper = monter()

    const first = wrapper.vm.ask('Premier message')
    await wrapper.vm.$nextTick()
    await wrapper.findAll('button')[0].trigger('click')
    await expect(first).resolves.toBe(false)

    const second = wrapper.vm.ask('Second message')
    await wrapper.vm.$nextTick()

    expect(wrapper.text()).toContain('Second message')
    expect(wrapper.text()).not.toContain('Premier message')

    await wrapper.findAll('button')[1].trigger('click')
    await expect(second).resolves.toBe(true)

    wrapper.unmount()
  })
})
