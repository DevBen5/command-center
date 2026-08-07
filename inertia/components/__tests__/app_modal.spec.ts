import { describe, expect, test, vi } from 'vitest'
import { mount } from '@vue/test-utils'
import AppModal from '../AppModal.vue'

/*
| Le chassis partagé (CC-207) : overlay, clic-extérieur, Échap. Tout le reste — apparence,
| débordement sur petit écran — se vérifie au navigateur (jsdom ne fait aucun layout).
|
| ⚠️ Le listener est posé sur `window`, comme la palette ⌘K d'`AppLayout` : sans montage réel
| (pas de `attachTo`), `window.dispatchEvent` doit quand même l'atteindre.
*/

describe('inertia / AppModal', () => {
  test('Échap émet close', async () => {
    const wrapper = mount(AppModal)

    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }))
    await wrapper.vm.$nextTick()

    expect(wrapper.emitted('close')).toHaveLength(1)
    wrapper.unmount()
  })

  test('une autre touche n’émet rien', async () => {
    const wrapper = mount(AppModal)

    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter' }))
    await wrapper.vm.$nextTick()

    expect(wrapper.emitted('close')).toBeUndefined()
    wrapper.unmount()
  })

  test('un clic sur l’overlay émet close', async () => {
    const wrapper = mount(AppModal)

    await wrapper.find('.fixed').trigger('click')

    expect(wrapper.emitted('close')).toHaveLength(1)
    wrapper.unmount()
  })

  // ⚠️ Le test du lot : `@click.self` ne doit PAS se déclencher sur un clic dans le contenu.
  // Sans `.self`, tout clic à l'intérieur de la modale la refermerait — y compris un clic sur
  // un champ de formulaire.
  test('un clic sur le contenu n’émet rien', async () => {
    const wrapper = mount(AppModal, {
      slots: { default: '<button class="inner">Contenu</button>' },
    })

    await wrapper.find('.inner').trigger('click')

    expect(wrapper.emitted('close')).toBeUndefined()
    wrapper.unmount()
  })

  test('le listener posé au montage est bien celui retiré au démontage', () => {
    const add = vi.spyOn(window, 'addEventListener')
    const remove = vi.spyOn(window, 'removeEventListener')

    const wrapper = mount(AppModal)
    const posé = add.mock.calls.find(([type]) => type === 'keydown')
    wrapper.unmount()
    const retiré = remove.mock.calls.find(([type]) => type === 'keydown')

    expect(posé).toBeDefined()
    expect(retiré).toBeDefined()
    expect(retiré![1]).toBe(posé![1])

    add.mockRestore()
    remove.mockRestore()
  })
})
