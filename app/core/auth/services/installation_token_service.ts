import { createHash, randomBytes, timingSafeEqual } from 'node:crypto'

/**
 * Le jeton d'installation (CC-138, décision reprise de CC-128) — modèle Jenkins.
 *
 * « Aucun compte en base » ne suffit pas comme unique verrou : sur une application joignable
 * depuis Internet, « le premier qui se connecte » est le premier scanner qui passe, et ce que
 * la fenêtre donne est le compte administrateur. Le jeton couvre cette fenêtre : imprimé dans
 * les journaux au démarrage tant que la base ne porte aucun compte, exigé par le formulaire.
 *
 * ⚠️ **En mémoire seulement, et c'est un choix** : persisté en base, ce serait un secret de
 * plus à faire vivre. Il meurt avec le processus — un redémarrage en cours d'installation en
 * change la valeur, et c'est bien : les journaux portent toujours la valeur courante.
 * Hypothèse assumée : un seul processus Node (le déploiement NAS l'est) ; plusieurs workers
 * auraient chacun leur jeton.
 *
 * ⚠️ **Le jeton n'est pas une authentification.** Il autorise UNE création de compte sur une
 * base vide, rien d'autre — le contrôle « aucun compte » (`InstallationService`) reste le
 * verrou principal. Et il n'apparaît jamais dans une réponse HTTP, erreurs comprises : seul
 * le journal du serveur le porte.
 */
export class InstallationTokenService {
  #token: string | null = null

  /** Le jeton du processus, généré au premier accès — 32 octets, 64 hexadécimaux. */
  current(): string {
    if (this.#token === null) {
      this.#token = randomBytes(32).toString('hex')
    }
    return this.#token
  }

  /**
   * Comparaison à temps constant (le ticket l'exige : sans elle, un jeton se force en ligne
   * octet par octet). `timingSafeEqual` refuse deux tampons de longueurs différentes — d'où
   * la comparaison des SHA-256 des deux valeurs, de longueur égale par construction, plutôt
   * que des chaînes elles-mêmes.
   */
  matches(candidate: string): boolean {
    const attendu = createHash('sha256').update(this.current()).digest()
    const recu = createHash('sha256').update(candidate).digest()
    return timingSafeEqual(attendu, recu)
  }
}

export default new InstallationTokenService()
