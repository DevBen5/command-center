import { BaseSchema } from '@adonisjs/lucid/schema'

/**
 * La trace de la porte de service : chaque passage de `auth:reset-account` (CC-129).
 *
 * ⚠️ **Elle n'empêche rien, et ce n'est pas son rôle.** La commande exige déjà un shell sur la
 * machine — qui l'a peut lire la base directement. Ce que cette table donne, c'est la seule
 * chose qui manquait : distinguer, **après coup**, « j'ai réinitialisé ce compte le mois
 * dernier » de « quelqu'un d'autre l'a fait ». Sans elle, ces deux mondes se ressemblent
 * exactement, et un contournement du second facteur reste indistinguable d'une intrusion.
 *
 * ⚠️ **Le journal ne peut pas jouer ce rôle.** Sur le NAS, la commande tourne dans un conteneur
 * jetable (`docker compose run --rm`) : sa sortie meurt avec lui à la seconde où elle se
 * termine. Elle est vue par qui la lance, et par personne d'autre, jamais.
 *
 * ⚠️ **Limite assumée, à ne pas confondre avec une alarme** : qui a le shell peut aussi
 * supprimer une ligne d'ici. Ça attrape l'intrus négligent, pas l'intrus soigneux — et ça sert
 * d'abord au propriétaire légitime, qui est celui qui relira ce registre.
 */
export default class extends BaseSchema {
  protected tableName = 'account_reset_events'

  async up() {
    this.schema.createTable(this.tableName, (table) => {
      table.increments('id').notNullable()

      /**
       * ⚠️ **`SET NULL`, pas `CASCADE` — l'inverse de toutes les autres tables liées à un
       * compte.** Elles portent des données *du* compte, qui n'ont aucun sens sans lui. Celle-ci
       * porte le fait qu'on a touché à ce compte : la faire disparaître avec lui reviendrait à
       * offrir l'effacement de la trace en même temps que le geste qu'elle enregistre. Nullable
       * pour la même raison — la ligne doit pouvoir survivre à sa cible.
       */
      table.integer('user_id').nullable().references('id').inTable('users').onDelete('SET NULL')

      /**
       * L'email **figé au moment du geste**, et c'est ce qui rend la ligne lisible seule. La
       * clé étrangère ci-dessus peut devenir `null`, ou pointer un compte renommé depuis : dans
       * les deux cas, une trace qui ne dirait plus *quel* compte a été réinitialisé ne servirait
       * à rien. 254 caractères, comme la validation des formulaires.
       */
      table.string('user_email', 254).notNullable()

      // Quand. `index()` parce que la seule lecture qu'on en fera est « les derniers passages ».
      table.timestamp('created_at').notNullable().index()

      // ⚠️ **Pas d'`updated_at`, délibérément.** Un registre ne se corrige pas : une ligne
      // modifiable serait une ligne dont on ne peut plus rien conclure.
    })
  }

  async down() {
    this.schema.dropTable(this.tableName)
  }
}
