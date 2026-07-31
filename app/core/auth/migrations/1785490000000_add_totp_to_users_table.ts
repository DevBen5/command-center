import { BaseSchema } from '@adonisjs/lucid/schema'

/**
 * Le second facteur TOTP, **optionnel par compte** (CC-114).
 *
 * Trois colonnes, sur `users` plutôt qu'en table dédiée : un compte a au plus un
 * authentificateur, une ligne par compte serait une relation 1-1 déguisée.
 */
export default class extends BaseSchema {
  protected tableName = 'users'

  async up() {
    this.schema.alterTable(this.tableName, (table) => {
      // ⚠️ **Chiffré avec APP_KEY**, jamais en clair : contrairement à un mot de passe, ce
      // secret doit être *relu* à chaque connexion, donc il ne peut pas être haché. Un dump
      // qui fuite ne donne alors aucun générateur de codes — pour peu qu'APP_KEY ne fuite
      // pas avec lui, ce qui est le sens même de la garder hors de la base.
      //
      // `text` et non `string(n)` : le chiffré d'AdonisJS porte la valeur, son IV et son
      // HMAC en base64 — sa longueur suit celle du secret et n'est pas un invariant à figer.
      table.text('totp_secret').nullable()

      // ⚠️ **C'est cette colonne qui active le facteur, pas `totp_secret`.** L'enrôlement
      // pose un secret AVANT que quiconque ait prouvé savoir le lire : activer là-dessus
      // verrouillerait dehors tout compte dont le QR n'a pas été scanné correctement. Le
      // facteur ne compte que confirmé par un premier code valide.
      table.timestamp('totp_confirmed_at').nullable()

      // Le dernier pas de temps consommé — l'anti-rejeu de la RFC 6238 §5.2. Un code reste
      // valable ~90 s (fenêtre ±1) : sans ça, un code intercepté resservirait dans sa
      // fenêtre. `bigint` parce qu'un pas est un horodatage / 30, pas un compteur applicatif.
      table.bigint('totp_last_step').nullable()
    })
  }

  async down() {
    this.schema.alterTable(this.tableName, (table) => {
      table.dropColumn('totp_secret')
      table.dropColumn('totp_confirmed_at')
      table.dropColumn('totp_last_step')
    })
  }
}
