import { readFile } from 'node:fs/promises'
import { parseAgentsDeclarations, type AgentDeclaration } from '#config/agents'

export type AgentsFileResult =
  { ok: true; present: boolean; declarations: AgentDeclaration[] } | { ok: false; error: string }

/**
 * Lit et valide le fichier de déclaration des agents (CC-141).
 *
 * ⚠️ **Deux issues, pas trois.** Un fichier absent (`ENOENT`) n'est pas une erreur : c'est l'état
 * d'une installation qui n'a pas encore monté de fichier. Il rend donc `{ ok: true }` — mais avec
 * **`present: false`**, et cette distinction n'est pas cosmétique : un fichier absent et un
 * fichier qui déclare `{"agents": []}` produisent tous deux zéro déclaration, alors qu'ils ne
 * veulent pas dire la même chose. Le second est un geste explicite (« je veux zéro agent ») ; le
 * premier est le plus souvent un volume non monté. Seul l'appelant peut trancher, et il a besoin
 * de les distinguer pour le faire — voir `syncAgentsFromFile`.
 *
 * Toute autre défaillance (JSON invalide, forme invalide, droits refusés…) rend `{ ok: false }` :
 * c'est à l'appelant (`AgentsProvider`) de la journaliser bruyamment et de renoncer à
 * synchroniser plutôt que de deviner.
 */
export async function loadAgentsFile(path: string): Promise<AgentsFileResult> {
  let contenu: string

  try {
    contenu = await readFile(path, 'utf8')
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
      return { ok: true, present: false, declarations: [] }
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
    return { ok: true, present: true, declarations: parseAgentsDeclarations(brut) }
  } catch (error) {
    return { ok: false, error: `"${path}" : ${(error as Error).message}` }
  }
}
