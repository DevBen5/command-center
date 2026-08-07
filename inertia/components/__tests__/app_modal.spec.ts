import { describe, expect, test, vi } from 'vitest'
import { mount } from '@vue/test-utils'
import { h } from 'vue'
import AppModal from '../AppModal.vue'

/*
| Le chassis partagé (CC-207) : overlay, clic-extérieur, Échap. Durci par CC-209 : ARIA
| (`role="dialog"`, `aria-modal`, `aria-labelledby`), focus (posé, piégé, rendu à l'ouvrant),
| défilement de fond bloqué, et une pile d'instances pour supporter plusieurs modales ouvertes à
| la fois (CC-206). Le reste — apparence, débordement sur petit écran — se vérifie au navigateur
| (jsdom ne fait aucun layout).
|
| ⚠️ Le listener est posé sur `window`, comme la palette ⌘K d'`AppLayout` : sans montage réel
| (pas de `attachTo`), `window.dispatchEvent` doit quand même l'atteindre.
|
| ⚠️ Les tests de focus exigent `attachTo: document.body` : jsdom ne déplace
| `document.activeElement` que pour un arbre RÉELLEMENT connecté au document.
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

  test('porte role="dialog", aria-modal, et un aria-labelledby résolvable', () => {
    const wrapper = mount(AppModal, {
      slots: {
        default: (props: { titleId: string }) => h('h2', { id: props.titleId }, 'Titre'),
      },
    })

    expect(wrapper.attributes('role')).toBe('dialog')
    expect(wrapper.attributes('aria-modal')).toBe('true')

    const labelledBy = wrapper.attributes('aria-labelledby')
    expect(labelledBy).toBeTruthy()
    // ⚠️ Le chassis ne connaît pas le contenu de son titre (CC-207 : aucune structure interne) —
    // il expose seulement l'id via le slot. C'est au contenu de le poser sur ce qu'il nomme.
    expect(wrapper.find(`#${labelledBy}`).text()).toBe('Titre')

    wrapper.unmount()
  })

  test('le focus se pose sur le premier élément focalisable à l’ouverture', () => {
    const wrapper = mount(AppModal, {
      slots: { default: '<button class="a">A</button><button class="b">B</button>' },
      attachTo: document.body,
    })

    expect(document.activeElement).toBe(wrapper.find('.a').element)

    wrapper.unmount()
  })

  test('sans élément focalisable, le focus se pose sur l’overlay lui-même', () => {
    const wrapper = mount(AppModal, { attachTo: document.body })

    expect(document.activeElement).toBe(wrapper.find('.fixed').element)

    wrapper.unmount()
  })

  /**
   * Les TROIS chemins de fermeture (bouton, Échap, clic-extérieur) doivent tous rendre le focus
   * à l'ouvrant — piège du ticket : restaurer au clic sur « fermer » seul ne couvrirait ni Échap
   * ni le clic-extérieur. Ici la restauration vit dans `onUnmounted`, donc elle est prouvée par
   * TOUT démontage, quel que soit ce qui l'a précédé.
   */
  test('le focus est rendu à l’ouvrant après Échap', async () => {
    const opener = document.createElement('button')
    document.body.appendChild(opener)
    opener.focus()

    const wrapper = mount(AppModal, {
      slots: { default: '<button class="inner">Fermer</button>' },
      attachTo: document.body,
    })
    expect(document.activeElement).not.toBe(opener)

    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }))
    await wrapper.vm.$nextTick()
    wrapper.unmount()

    expect(document.activeElement).toBe(opener)
    opener.remove()
  })

  test('le focus est rendu à l’ouvrant après un clic sur l’overlay (extérieur)', async () => {
    const opener = document.createElement('button')
    document.body.appendChild(opener)
    opener.focus()

    const wrapper = mount(AppModal, {
      slots: { default: '<button class="inner">Fermer</button>' },
      attachTo: document.body,
    })
    expect(document.activeElement).not.toBe(opener)

    await wrapper.find('.fixed').trigger('click')
    wrapper.unmount()

    expect(document.activeElement).toBe(opener)
    opener.remove()
  })

  test('le focus est rendu à l’ouvrant après un démontage externe (bouton « fermer »)', () => {
    const opener = document.createElement('button')
    document.body.appendChild(opener)
    opener.focus()

    const wrapper = mount(AppModal, {
      slots: { default: '<button class="inner">Fermer</button>' },
      attachTo: document.body,
    })
    expect(document.activeElement).not.toBe(opener)

    // Un bouton « fermer » du contenu émet `close`, mais c'est le PARENT qui décide de démonter
    // (v-if). Ici on simule ce démontage directement : c'est lui, pas l'émission, qui restaure.
    wrapper.unmount()

    expect(document.activeElement).toBe(opener)
    opener.remove()
  })

  test('Tab piège le focus dans la modale — boucle du dernier vers le premier', async () => {
    const wrapper = mount(AppModal, {
      slots: { default: '<button class="a">A</button><button class="b">B</button>' },
      attachTo: document.body,
    })

    wrapper.find('.b').element.focus()
    expect(document.activeElement).toBe(wrapper.find('.b').element)

    const event = new KeyboardEvent('keydown', { key: 'Tab', cancelable: true })
    window.dispatchEvent(event)
    await wrapper.vm.$nextTick()

    expect(document.activeElement).toBe(wrapper.find('.a').element)

    wrapper.unmount()
  })

  test('Maj+Tab piège le focus dans la modale — boucle du premier vers le dernier', async () => {
    const wrapper = mount(AppModal, {
      slots: { default: '<button class="a">A</button><button class="b">B</button>' },
      attachTo: document.body,
    })

    expect(document.activeElement).toBe(wrapper.find('.a').element)

    const event = new KeyboardEvent('keydown', { key: 'Tab', shiftKey: true, cancelable: true })
    window.dispatchEvent(event)
    await wrapper.vm.$nextTick()

    expect(document.activeElement).toBe(wrapper.find('.b').element)

    wrapper.unmount()
  })

  test('le défilement de fond est bloqué à l’ouverture et restauré à la valeur précédente', () => {
    // Une valeur non vide AVANT le montage : la preuve doit être qu'on la RETROUVE, pas
    // seulement qu'elle redevient vide (un `''` en dur passerait même si rien n'était mémorisé).
    document.body.style.overflow = 'scroll'

    const wrapper = mount(AppModal)
    expect(document.body.style.overflow).toBe('hidden')

    wrapper.unmount()
    expect(document.body.style.overflow).toBe('scroll')

    document.body.style.overflow = ''
  })

  test('deux modales empilées : Échap ne ferme que la dernière ouverte', async () => {
    const bas = mount(AppModal)
    const haut = mount(AppModal)

    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }))
    await bas.vm.$nextTick()
    await haut.vm.$nextTick()

    expect(haut.emitted('close')).toHaveLength(1)
    expect(bas.emitted('close')).toBeUndefined()

    haut.unmount()
    bas.unmount()
  })

  test('deux modales empilées : le défilement n’est débloqué qu’à la fermeture de la dernière', () => {
    document.body.style.overflow = ''

    const bas = mount(AppModal)
    expect(document.body.style.overflow).toBe('hidden')

    const haut = mount(AppModal)
    expect(document.body.style.overflow).toBe('hidden')

    haut.unmount()
    // La première encore ouverte : le fond doit rester bloqué.
    expect(document.body.style.overflow).toBe('hidden')

    bas.unmount()
    expect(document.body.style.overflow).toBe('')
  })
})
