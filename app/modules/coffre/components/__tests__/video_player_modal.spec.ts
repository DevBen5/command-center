import { describe, expect, test } from 'vitest'
import { mount } from '@vue/test-utils'
import { createI18n } from 'vue-i18n'
import fr from '../../i18n/fr.json' with { type: 'json' }
import VideoPlayerModal from '../VideoPlayerModal.vue'

/*
| CC-241 : le lecteur vidéo du coffre. Deux comportements portent de la LOGIQUE et méritent donc un
| test (le reste n'est que de la disposition, que la relecture dit mieux) :
|
|   1. un `<video>` échoue en SILENCE — `@error` est le seul signal du navigateur, et c'est ce lot
|      qui existe pour supprimer les écrans noirs muets ;
|   2. l'avertissement « flux converti, curseur limité » est OBSERVÉ (`duration` non finie sur un
|      MP4 fragmenté), jamais reçu en prop : le client ne peut pas savoir à l'avance si le serveur
|      transcodera, et une prop le forcerait à prédire une décision qui ne lui appartient pas.
|
| ⚠️ jsdom ne décode aucune vidéo et ne fait aucun layout : ce fichier prouve la RÉACTION du
| composant à des événements, jamais qu'une image s'affiche. Ça, c'est un passage navigateur.
*/

function monter() {
  return mount(VideoPlayerModal, {
    props: { url: '/coffre/nas/stream?root=root&path=a.mov', title: 'a.mov' },
    global: {
      plugins: [
        createI18n({
          legacy: false,
          locale: 'fr',
          fallbackLocale: 'fr',
          messages: { fr: { coffre: fr } },
        }),
      ],
    },
  })
}

describe('Coffre / VideoPlayerModal', () => {
  test('monte un <video> sur l’URL reçue, sans message d’erreur', () => {
    const wrapper = monter()

    const video = wrapper.find('video')
    expect(video.exists()).toBe(true)
    expect(video.attributes('src')).toBe('/coffre/nas/stream?root=root&path=a.mov')
    expect(wrapper.text()).not.toContain(fr.video.playbackError)
  })

  test('⚠️ un échec de lecture est DIT, et le lecteur cède la place au message', async () => {
    // Sans cette réaction, l'écran reste noir sans un mot — l'échec muet que ce lot supprime.
    const wrapper = monter()

    await wrapper.find('video').trigger('error')

    expect(wrapper.text()).toContain(fr.video.playbackError)
    expect(wrapper.find('video').exists()).toBe(false)
    // Le téléchargement reste proposé : c'est le seul chemin qui fonctionne encore.
    expect(wrapper.find('a[download]').attributes('href')).toBe(
      '/coffre/nas/stream?root=root&path=a.mov'
    )
  })

  test('⚠️ l’avertissement de curseur n’apparaît QUE sur un flux sans durée', async () => {
    /**
     * ⚠️ **Le geste réel, dans les deux sens.** Monter puis assertir l'absence ne prouverait rien :
     * l'avertissement part déjà caché. Il faut émettre `loadedmetadata` avec une durée FINIE (le
     * cas d'un MP4 servi en octets bruts, où le curseur fonctionne) et vérifier qu'il reste caché,
     * PUIS avec `Infinity` (le MP4 fragmenté d'un transcodage) et vérifier qu'il apparaît.
     */
    const wrapper = monter()
    const video = wrapper.find('video')

    Object.defineProperty(video.element, 'duration', { value: 120, configurable: true })
    await video.trigger('loadedmetadata')
    expect(wrapper.text()).not.toContain(fr.video.transcodedHint)

    Object.defineProperty(video.element, 'duration', { value: Infinity, configurable: true })
    await video.trigger('loadedmetadata')
    expect(wrapper.text()).toContain(fr.video.transcodedHint)
  })

  test('le bouton de fermeture émet `close` — la modale est démontée par son PARENT', async () => {
    // ⚠️ C'est le démontage (`v-if` chez l'appelant) qui détruit le `<video>`, donc coupe la
    // connexion HTTP, donc fait tuer ffmpeg côté serveur. Le composant ne se ferme jamais lui-même.
    const wrapper = monter()

    await wrapper.find('button').trigger('click')

    expect(wrapper.emitted('close')).toHaveLength(1)
  })
})
