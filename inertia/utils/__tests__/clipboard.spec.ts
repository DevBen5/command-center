import { afterEach, describe, expect, test, vi } from 'vitest'
import { CLIPBOARD_CLEAR_MS, clearClipboardIn, clipboardAvailable, copyText } from '../clipboard'

/*
| CC-179 — la copie vers le presse-papiers.
|
| ⚠️ Ce que ce fichier ne voit **pas** : le vrai presse-papiers. jsdom n'en a aucun, et
| `navigator.clipboard` y est absent par défaut — c'est d'ailleurs ce qui rend le cas
| « indisponible » facile à monter et le cas nominal impossible sans le poser à la main. Qu'un
| `Ctrl+V` rende bien la valeur, et que l'effacement à 30 s la retire vraiment, se vérifient au
| navigateur et nulle part ailleurs.
*/

/** Pose un faux presse-papiers et le contexte sécurisé qui va avec, puis rend le journal. */
function fakeClipboard(writeText: (text: string) => Promise<void>): string[] {
  const ecrits: string[] = []

  vi.stubGlobal('isSecureContext', true)
  vi.stubGlobal('navigator', {
    clipboard: {
      writeText: async (text: string) => {
        ecrits.push(text)
        return writeText(text)
      },
    },
  })

  return ecrits
}

afterEach(() => {
  vi.unstubAllGlobals()
  vi.useRealTimers()
})

describe('Presse-papiers — la disponibilité', () => {
  test('un contexte non sécurisé rend le presse-papiers indisponible', async () => {
    // Le cas réel : une installation jointe en HTTP depuis une autre machine du réseau. Le
    // navigateur n'expose alors PAS `navigator.clipboard`.
    vi.stubGlobal('isSecureContext', false)
    vi.stubGlobal('navigator', {})

    expect(clipboardAvailable()).toBe(false)
    expect(await copyText('mot-de-passe')).toBe('unavailable')
  })

  test('l’objet présent mais le contexte non sécurisé rend indisponible lui aussi', async () => {
    // ⚠️ Les deux conditions comptent séparément : sans le second test, retirer
    // `isSecureContext` de la garde laisserait la suite au vert.
    vi.stubGlobal('isSecureContext', false)
    vi.stubGlobal('navigator', { clipboard: { writeText: async () => {} } })

    expect(clipboardAvailable()).toBe(false)
    expect(await copyText('mot-de-passe')).toBe('unavailable')
  })

  test('un presse-papiers en état de marche copie et le dit', async () => {
    const ecrits = fakeClipboard(async () => {})

    expect(clipboardAvailable()).toBe(true)
    expect(await copyText('mot-de-passe')).toBe('ok')
    expect(ecrits).toEqual(['mot-de-passe'])
  })
})

describe('Presse-papiers — l’échec', () => {
  test('une promesse rejetée est rendue, jamais levée ni avalée', async () => {
    // C'est le défaut exact des deux appelants d'avant ce lot : la promesse rejetait, la ligne
    // « copié ! » ne s'exécutait pas, et rien ne s'affichait. `refused` — pas `unavailable` —
    // parce que l'appelant doit pouvoir dire « réessaie » plutôt que « pas sur cette machine ».
    fakeClipboard(async () => {
      throw new Error('Document is not focused.')
    })

    await expect(copyText('mot-de-passe')).resolves.toBe('refused')
  })
})

describe('Presse-papiers — l’effacement différé', () => {
  test('efface au bout du délai, en écrivant du vide', async () => {
    vi.useFakeTimers()
    const ecrits = fakeClipboard(async () => {})

    clearClipboardIn(CLIPBOARD_CLEAR_MS)

    expect(ecrits).toEqual([])
    await vi.advanceTimersByTimeAsync(CLIPBOARD_CLEAR_MS)
    expect(ecrits).toEqual([''])
  })

  test('⚠️ l’annulateur empêche réellement l’effacement', async () => {
    // Sans lui, quitter la page laisserait un minuteur vider le presse-papiers d'un écran
    // abandonné depuis longtemps. Le test ne prouve quelque chose que parce qu'il fait avancer
    // l'horloge APRÈS l'annulation : sans ce déroulé, il passerait au vert sans rien annuler.
    vi.useFakeTimers()
    const ecrits = fakeClipboard(async () => {})

    const annuler = clearClipboardIn(CLIPBOARD_CLEAR_MS)
    annuler()

    await vi.advanceTimersByTimeAsync(CLIPBOARD_CLEAR_MS * 2)
    expect(ecrits).toEqual([])
  })
})
