import { realpath } from 'node:fs/promises'
import { isAbsolute, resolve, sep } from 'node:path'
import coffreNasConfig from '#config/coffre_nas'

/**
 * Résout un chemin relatif contre les racines de médias NAS autorisées du coffre — le cœur de
 * CC-181. Ne connaît RIEN de la nature du fichier (photo, vidéo) : la sécurité de l'accès à un
 * chemin ne dépend pas de ce qu'il contient.
 *
 * ⚠️ **L'appartenance se vérifie sur le `realpath()` du candidat, jamais sur la chaîne brute.**
 * C'est la règle 2 du ticket, et c'est ce qui ferme les trois chemins hostiles d'un seul
 * mécanisme :
 *
 * 1. Une traversée (`../../etc/passwd`) échappe déjà à la racine dans le chemin construit,
 *    `realpath` ne fait que confirmer ce que la comparaison de chaînes voyait déjà.
 * 2. **Un lien symbolique posé DANS une racine autorisée et pointant dehors** — celui qu'une
 *    comparaison de chaînes avant résolution ne voit PAS, puisque le chemin demandé a l'air
 *    correct. `realpath` suit le lien ; la comparaison qui suit porte sur sa cible réelle.
 * 3. Un chemin absolu est rejeté avant toute construction : `path.resolve(racine, absolu)`
 *    ignorerait la racine (comportement documenté de Node), donc le chemin serait de toute façon
 *    hors racine — le refus explicite évite de compter sur cet effet de bord plutôt que de le
 *    nommer.
 *
 * Injectable, sur le patron d'`ImmichClient` : construit par défaut avec les racines de
 * l'environnement, substituable en test avec des racines de fixtures explicites — les racines par
 * défaut sont VIDES en environnement de test (`config/coffre_nas.ts`), donc aucun test ne peut
 * accidentellement toucher un vrai dossier du poste.
 */
export default class NasRootsService {
  constructor(protected roots: string[] = coffreNasConfig.roots) {}

  /**
   * Le chemin réel du fichier, ou `null` si aucune racine autorisée ne le contient réellement.
   *
   * ⚠️ **Jamais une exception** : un chemin hostile, une racine non montée ou un fichier disparu
   * du disque sont des cas normaux de ce module, pas des incidents — l'appelant les traite tous
   * uniformément en « média introuvable ».
   */
  async resolve(relativePath: string): Promise<string | null> {
    if (isAbsolute(relativePath)) return null

    for (const root of this.roots) {
      const realRoot = await realpath(root).catch(() => null)
      if (realRoot === null) continue // racine mal montée ou absente : ignorée, pas une erreur

      const candidate = resolve(realRoot, relativePath)
      const realCandidate = await realpath(candidate).catch(() => null)
      if (realCandidate === null) continue // fichier inexistant sous cette racine

      if (realCandidate === realRoot || realCandidate.startsWith(realRoot + sep)) {
        return realCandidate
      }
    }

    return null
  }
}
