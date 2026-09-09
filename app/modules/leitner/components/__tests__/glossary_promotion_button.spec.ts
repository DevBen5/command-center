import { afterEach, expect, test, vi } from 'vitest'
import { flushPromises, mount } from '@vue/test-utils'
import { createI18n } from 'vue-i18n'
import Button from '../GlossaryPromotionButton.vue'
import fr from '../../i18n/fr.json' with { type: 'json' }

afterEach(() => vi.unstubAllGlobals())
function setup() {
  return mount(Button, {
    props: { card: { id: 12, front: 'TLS ?', back: 'Un protocole.' } },
    global: {
      plugins: [createI18n({ legacy: false, locale: 'fr', messages: { fr: { leitner: fr } } })],
      stubs: { AppModal: { template: '<div><slot title-id="promotion-title" /></div>' } },
    },
  })
}
test('préremplit, permet de corriger et confirme la promotion sans navigation Inertia', async () => {
  const fetcher = vi.fn().mockResolvedValue({ ok: true })
  vi.stubGlobal('fetch', fetcher)
  const wrapper = setup()
  await wrapper.get('button').trigger('click')
  expect(wrapper.get('input').element.value).toBe('TLS ?')
  await wrapper.get('input').setValue('TLS')
  await wrapper.get('form').trigger('submit')
  await flushPromises()
  expect(fetcher).toHaveBeenCalledWith(
    '/revision/cards/12/glossaire',
    expect.objectContaining({
      method: 'POST',
      body: JSON.stringify({ term: 'TLS', definition: 'Un protocole.' }),
    })
  )
  expect(wrapper.find('form').exists()).toBe(false)
  expect(wrapper.get('[role="status"]').text()).toContain('Terme ajouté')
  wrapper.unmount()
})
test('garde le formulaire et la saisie lorsque le serveur refuse', async () => {
  vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: false, status: 403 }))
  const wrapper = setup()
  await wrapper.get('button').trigger('click')
  await wrapper.get('form').trigger('submit')
  await flushPromises()
  expect(wrapper.get('[role="alert"]').text()).toContain('Impossible')
  expect(wrapper.get('textarea').element.value).toBe('Un protocole.')
  wrapper.unmount()
})
