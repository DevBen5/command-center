import { describe, expect, test } from 'vitest'
import { mount } from '@vue/test-utils'
import { createI18n } from 'vue-i18n'
import fr from '../../i18n/fr.json' with { type: 'json' }
import CourseConflictDialog from '../CourseConflictDialog.vue'

/**
 * Le dialogue à 3 issues de la dédup « même titre, texte différent » (CC-251). Logique
 * pure du composant : chaque bouton émet l'événement attendu, et lui seul — c'est ce
 * qui distingue un dialogue qui fonctionne d'un décor qui affiche trois boutons.
 */
const i18n = createI18n({
  legacy: false,
  locale: 'fr',
  fallbackLocale: 'fr',
  messages: { fr: { leitner: fr } },
})

function monter() {
  return mount(CourseConflictDialog, {
    props: { existingTitle: 'Réseaux' },
    global: { plugins: [i18n] },
  })
}

describe('Leitner / CourseConflictDialog', () => {
  test('affiche le titre du cours existant', () => {
    expect(monter().text()).toContain('Réseaux')
  })

  test('« Remplacer le contenu » émet replace, et lui seul', async () => {
    const wrapper = monter()

    await wrapper.findAll('button')[0].trigger('click')

    expect(wrapper.emitted('replace')).toHaveLength(1)
    expect(wrapper.emitted('createSecond')).toBeUndefined()
    expect(wrapper.emitted('cancel')).toBeUndefined()
  })

  test('« Créer un second cours » émet createSecond, et lui seul', async () => {
    const wrapper = monter()

    await wrapper.findAll('button')[1].trigger('click')

    expect(wrapper.emitted('createSecond')).toHaveLength(1)
    expect(wrapper.emitted('replace')).toBeUndefined()
    expect(wrapper.emitted('cancel')).toBeUndefined()
  })

  test('« Annuler » émet cancel, et lui seul', async () => {
    const wrapper = monter()

    await wrapper.findAll('button')[2].trigger('click')

    expect(wrapper.emitted('cancel')).toHaveLength(1)
    expect(wrapper.emitted('replace')).toBeUndefined()
    expect(wrapper.emitted('createSecond')).toBeUndefined()
  })

  test('le clic hors du panneau (fermeture du chassis) émet aussi cancel', async () => {
    // Le chassis AppModal émet `close` sur Échap et le clic-extérieur : le dialogue doit
    // le traiter comme une annulation, pas un état sans issue.
    const wrapper = monter()

    await wrapper.find('[role="dialog"]').trigger('click')

    expect(wrapper.emitted('cancel')).toHaveLength(1)
  })
})
