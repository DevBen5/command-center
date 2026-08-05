import { readFile } from 'node:fs/promises'
import { parseAgentsDeclarations, type AgentDeclaration } from '#config/agents'

export type AgentsFileResult =
  { ok: true; declarations: AgentDeclaration[] } | { ok: false; error: string }

/**
 * Lit et valide le fichier de déclaration des agents (CC-141).
 *
 * ⚠️ **Deux issues, pas trois.** Un fichier absent (`ENOENT`) rend `{ ok: true, declarations: [] }`
 * — « module vide », jamais une erreur : c'est l'état d'une installation qui n'a pas encore
 * monté de fichier. Toute autre défaillance (JSON invalide, forme invalide, droits refusés…)
 * rend `{ ok: false }` : c'est à l'appelant (`AgentsProvider`) de la journaliser bruyamment et
 * de renoncer à synchroniser plutôt que de deviner.
 */
export async function loadAgentsFile(path: string): Promise<AgentsFileResult> {
  let contenu: string

  try {
    contenu = await readFile(path, 'utf8')
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
      return { ok: true, declarations: [] }
    }
    return { ok: false, error: `lecture de "${path}" impossible : ${(error as Error).message}` }
  }

  let brut: unknown

  try {
    brut = JSON.parse(contenu)
  } catch (error) {
    return { ok: false, error: `"${path}" n'est pas du JSON valide : ${(error as Error).message}` }
  }

  try {
    return { ok: true, declarations: parseAgentsDeclarations(brut) }
  } catch (error) {
    return { ok: false, error: `"${path}" : ${(error as Error).message}` }
  }
}
