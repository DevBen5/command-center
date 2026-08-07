import { DateTime } from 'luxon'

interface OpenSession {
  accessToken: string
  expiresAt: DateTime
}

/**
 * L'état de la session Immich élevée du dossier verrouillé (CC-205) — EN MÉMOIRE du process,
 * sur le patron de `vault_keyring.ts`.
 *
 * ⚠️ **Contrairement au trousseau du coffre, il n'y a qu'UNE session, jamais une par compte** : les
 * identifiants Immich sont ceux du `.env`, un seul compte Immich pour toute l'installation — pas un
 * par utilisateur Command Center. Fermer une session coffre (verrouillage, révocation) ne touche
 * jamais cette session-ci, et réciproquement.
 *
 * ⚠️ **`authorize` sérialise l'établissement d'une session.** La grille de vignettes du dossier
 * rend plusieurs `<img>` à la fois : sans coordination, chacune verrait « pas de session » au même
 * instant et déclencherait son propre login, empilant des sessions dans la liste d'appareils
 * autorisés d'Immich — exactement ce que le ticket demande d'éviter. La coordination est sûre sans
 * verrou explicite : entre la lecture de `#session`/`#inFlight` et l'écriture, aucun `await` n'a
 * lieu — la portion critique s'exécute donc d'un bloc, comme tout code JS synchrone.
 */
class ImmichSessionState {
  #session: OpenSession | null = null
  #inFlight: Promise<string> | null = null

  /** Le jeton utilisable maintenant, ou `null` si aucun ou expiré — ne mute rien. */
  current(now: DateTime = DateTime.now()): string | null {
    if (this.#session === null) return null
    if (this.#session.expiresAt <= now) return null

    return this.#session.accessToken
  }

  /** Vide l'état et rend le jeton qu'il portait, pour que l'appelant puisse le fermer côté Immich. */
  clear(): string | null {
    const token = this.#session?.accessToken ?? null
    this.#session = null

    return token
  }

  /**
   * Rend le jeton courant, ou en établit un nouveau si nécessaire — une seule fois, quel que soit
   * le nombre d'appelants concurrents.
   *
   * `establish` reçoit le jeton précédent (potentiellement périmé, potentiellement `null`) pour que
   * l'appelant puisse le fermer côté Immich avant d'en ouvrir un autre — « ferme ce que tu ouvres ».
   */
  async authorize(
    now: DateTime,
    establish: (stale: string | null) => Promise<{ accessToken: string; expiresAt: DateTime }>
  ): Promise<string> {
    const existing = this.current(now)
    if (existing !== null) return existing

    return this.#coordinate(establish)
  }

  /**
   * Force un nouvel établissement, même si l'état courant semble encore valide selon NOTRE
   * échéance interne — le cas d'un 401 reçu alors que `SESSION_REUSE_MINUTES` n'est pas encore
   * écoulé : le jeton ou l'élévation PIN a expiré côté Immich avant notre propre fenêtre.
   *
   * ⚠️ **N'appelle jamais `clear()` avant cette méthode.** Le jeton encore marqué courant DOIT
   * rester en place jusqu'à ce que `#coordinate` le récupère lui-même pour le fermer côté Immich —
   * un `clear()` fait par l'appelant avant coup perdrait cette référence, et « ferme ce que tu
   * ouvres » ne fermerait plus rien.
   */
  async reauthorize(
    establish: (stale: string | null) => Promise<{ accessToken: string; expiresAt: DateTime }>
  ): Promise<string> {
    return this.#coordinate(establish)
  }

  async #coordinate(
    establish: (stale: string | null) => Promise<{ accessToken: string; expiresAt: DateTime }>
  ): Promise<string> {
    if (this.#inFlight === null) {
      const stale = this.clear()

      this.#inFlight = establish(stale)
        .then(({ accessToken, expiresAt }) => {
          this.#session = { accessToken, expiresAt }
          return accessToken
        })
        .finally(() => {
          this.#inFlight = null
        })
    }

    return this.#inFlight
  }
}

export default new ImmichSessionState()
export { ImmichSessionState }
