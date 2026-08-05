import env from '#start/env'

/**
 * Les agents ne se déclarent plus qu'à un seul endroit : un fichier monté, lu au démarrage
 * (CC-141). Avant ce lot, `config.command` — une commande shell complète, sans échappement,
 * voir `app/modules/agents/CLAUDE.md` — n'était alimentable que par un seeder ou un accès
 * direct à la base ; CC-138 a supprimé les seeders, laissant le module sans aucun moyen de
 * créer un agent sur une installation neuve.
 *
 * ⚠️ **JSON, pas YAML.** Le dépôt n'a aucun parseur YAML installé ; en ajouter un pour ce seul
 * usage serait un `chore(tooling)` séparé pour un gain nul. JSON reste un « fichier équivalent »
 * au sens du ticket.
 *
 * ⚠️ **La frontière de confiance ne bouge pas.** Écrire ce fichier suppose déjà l'accès à la
 * machine — donc le pouvoir qu'il confère, on l'avait déjà. Aucune route HTTP ne le lit ni ne
 * l'écrit.
 */
export interface AgentDeclaration {
  name: string
  framework: string
  config: Record<string, unknown>
}

/** Chemin par défaut, relatif à la racine du dépôt — celle où `npm run dev` et `node ace` s'exécutent. */
export const AGENTS_CONFIG_DEFAULT_PATH = 'agents.json'

/**
 * Fonction **pure**, séparée de la lecture d'`env` sur le modèle de `dockerDisponible` : c'est
 * ce qui la rend testable sans dépendre du `.env` de la machine qui lance les tests.
 */
export function agentsConfigPathFrom(raw: string | undefined): string {
  return raw && raw.length > 0 ? raw : AGENTS_CONFIG_DEFAULT_PATH
}

/**
 * Valide le contenu **déjà désérialisé** (`JSON.parse` a réussi) d'un fichier de déclaration.
 * Lève une erreur descriptive sur toute forme invalide — jamais un tableau vide ou une valeur
 * devinée : un fichier malformé doit se voir, pas se faire passer pour un fichier vide.
 *
 * ⚠️ **`config` reste un objet libre**, exactement comme la colonne `agents.config` (jsonb) —
 * ce lot ne fige aucune clé. `command`/`trigger` sont des conventions documentées dans
 * `app/modules/agents/CLAUDE.md`, pas des champs validés ici.
 */
export function parseAgentsDeclarations(raw: unknown): AgentDeclaration[] {
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) {
    throw new Error('le fichier doit être un objet JSON portant une clé "agents".')
  }

  const agents = (raw as Record<string, unknown>).agents

  if (!Array.isArray(agents)) {
    throw new Error('la clé "agents" doit être un tableau.')
  }

  const noms = new Set<string>()

  return agents.map((entree, index) => {
    if (typeof entree !== 'object' || entree === null || Array.isArray(entree)) {
      throw new Error(`agents[${index}] doit être un objet.`)
    }

    const { name, framework, config } = entree as Record<string, unknown>

    if (typeof name !== 'string' || name.trim().length === 0) {
      throw new Error(`agents[${index}].name doit être une chaîne non vide.`)
    }
    if (typeof framework !== 'string' || framework.trim().length === 0) {
      throw new Error(`agents[${index}].framework doit être une chaîne non vide.`)
    }
    if (
      config !== undefined &&
      (typeof config !== 'object' || config === null || Array.isArray(config))
    ) {
      throw new Error(`agents[${index}].config doit être un objet si présent.`)
    }
    if (noms.has(name)) {
      throw new Error(`nom d'agent en double : "${name}".`)
    }
    noms.add(name)

    return {
      name,
      framework,
      config: (config as Record<string, unknown> | undefined) ?? {},
    }
  })
}

const agentsConfig = {
  path: agentsConfigPathFrom(env.get('AGENTS_CONFIG_PATH')),
}

export default agentsConfig
