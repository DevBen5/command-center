import { BaseSchema } from '@adonisjs/lucid/schema'

/**
 * La borne qui tue les sessions ouvertes ailleurs (CC-176).
 *
 * Le store de session est `cookie` : le serveur ne garde aucune liste, donc rien à invalider
 * *par session*. Mais chaque session porte depuis CC-78 un tampon de connexion chiffré, relu à
 * chaque requête par `auth_middleware`. Une seule colonne suffit alors : **toute session dont le
 * tampon précède cette date est morte**. Aucune table à purger, aucune requête supplémentaire —
 * l'utilisateur est déjà chargé.
 *
 * ⚠️ **Nommée d'après l'invariant, pas d'après le geste.** `sessions_valid_from` dit ce que le
 * middleware vérifie ; `sessions_revoked_at` dirait ce qui s'est passé une fois, et se relirait
 * mal le jour où une autre règle voudra la même borne.
 *
 * ⚠️ **Nullable, et `null` veut dire « jamais révoqué »** — c'est-à-dire exactement le
 * comportement d'avant ce lot. Ça n'est pas une commodité : depuis que l'image est publiquement
 * tirable (CC-142), une migration se joue un jour sur des bases dont personne ici n'a ni la main
 * ni la sauvegarde. Additive, sans contrainte sur l'existant, sans valeur par défaut : Postgres
 * l'ajoute en métadonnée seule, sans réécrire une ligne ni tenir un verrou long. Une image plus
 * ancienne qui tournerait sur ce schéma ignore simplement la colonne.
 */
export default class extends BaseSchema {
  protected tableName = 'users'

  async up() {
    this.schema.alterTable(this.tableName, (table) => {
      table.timestamp('sessions_valid_from').nullable()
    })
  }

  async down() {
    this.schema.alterTable(this.tableName, (table) => {
      table.dropColumn('sessions_valid_from')
    })
  }
}
