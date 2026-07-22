import { describe, expect, test } from 'vitest'
import { mount } from '@vue/test-utils'
import TaxonomyCombobox from '../TaxonomyCombobox.vue'

/*
| Le sélecteur catégorie/thème de la relecture des brouillons.
|
| Ce qui se teste ici est `filtering` — la raison d'être du composant. Son champ porte une
| valeur DÉJÀ choisie (le modèle l'a pré-remplie) : rouvrir la liste doit montrer TOUTE la
| taxonomie, pas seulement ce qui correspond au texte présent. C'est exactement ce qu'un
| `<datalist>` ne sait pas faire, et c'est pour ça que ce composant existe.
|
| ⚠️ Le mode d'échec est silencieux : si `openList()` cessait de remettre `filtering` à
| `false`, rien ne lèverait, rien ne changerait de type, et l'écran de relecture perdrait
| simplement la possibilité de changer de catégorie. D'où le premier test.
|
| ⚠️ On déclenche `mousedown`, jamais `click` : le composant pose `@mousedown.prevent` sur
| chaque option pour que le champ ne perde pas le focus avant que le clic n'aboutisse
| (le `@blur` fermerait la liste en premier). Un `trigger('click')` ne reproduit pas le
| geste réel et passerait à côté du câblage.
*/

const OPTIONS = ['DevOps', 'Sécurité', 'Réseau']

function open(wrapper: ReturnType<typeof mount>) {
  return wrapper.get('input').trigger('focus')
}

describe('Leitner / TaxonomyCombobox', () => {
  test('ROUVRIR la liste après avoir tapé remontre TOUTES les options', async () => {
    const wrapper = mount(TaxonomyCombobox, {
      props: { modelValue: '', options: OPTIONS },
    })

    // ⚠️ Il faut TAPER d'abord. `filtering` vaut déjà `false` au montage : ouvrir sans
    // avoir saisi ne prouve rien — le test passerait même si `openList()` cessait de le
    // remettre à zéro. C'est le geste réel qu'il faut reproduire : on tape, on ferme,
    // on rouvre pour choisir autre chose.
    const input = wrapper.get('input')
    await input.setValue('dev')
    await wrapper.setProps({ modelValue: 'DevOps' })
    expect(wrapper.findAll('button').map((b) => b.text())).not.toContain('Réseau')

    await input.trigger('blur')
    await open(wrapper)

    // L'assertion qui porte le fichier : les 3 options reviennent malgré « DevOps » dans
    // le champ. Sans la remise à zéro, on ne verrait plus que DevOps — donc plus moyen
    // d'en changer, sans la moindre erreur.
    const labels = wrapper.findAll('button').map((button) => button.text())
    expect(labels).toContain('DevOps')
    expect(labels).toContain('Sécurité')
    expect(labels).toContain('Réseau')
  })

  test('taper filtre la liste', async () => {
    const wrapper = mount(TaxonomyCombobox, {
      props: { modelValue: '', options: OPTIONS },
    })

    const input = wrapper.get('input')
    await input.setValue('rés')
    // Le composant est contrôlé : il ne stocke pas la saisie, le parent la lui rend.
    await wrapper.setProps({ modelValue: 'rés' })

    const labels = wrapper.findAll('button').map((button) => button.text())
    expect(labels).toContain('Réseau')
    expect(labels).not.toContain('DevOps')
  })

  test('un nom inconnu propose de le créer, un nom connu ne le propose pas', async () => {
    const wrapper = mount(TaxonomyCombobox, {
      props: { modelValue: 'Cloud', options: OPTIONS },
    })
    await open(wrapper)
    expect(wrapper.text()).toContain('Créer « Cloud »')

    // La comparaison ignore la casse : « devops » est déjà pris, on ne propose pas un doublon.
    await wrapper.setProps({ modelValue: 'devops' })
    expect(wrapper.text()).not.toContain('Créer')
  })

  test('choisir une option émet sa valeur et ferme la liste', async () => {
    const wrapper = mount(TaxonomyCombobox, {
      props: { modelValue: '', options: OPTIONS },
    })
    await open(wrapper)

    const option = wrapper.findAll('button').find((button) => button.text() === 'Sécurité')!
    await option.trigger('mousedown')

    expect(wrapper.emitted('update:modelValue')).toEqual([['Sécurité']])
    expect(wrapper.findAll('button').map((button) => button.text())).not.toContain('Réseau')
  })

  test('désactivé, le champ n’ouvre rien — le thème attend sa catégorie', async () => {
    const wrapper = mount(TaxonomyCombobox, {
      props: { modelValue: '', options: OPTIONS, disabled: true },
    })

    await open(wrapper)

    expect(wrapper.text()).not.toContain('DevOps')
  })
})
