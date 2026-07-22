import { DateTime } from 'luxon'
import { BaseModel, column, hasMany } from '@adonisjs/lucid/orm'
import type { HasMany } from '@adonisjs/lucid/types/relations'
import LeitnerDraftCard from '#modules/leitner/models/leitner_draft_card'

/**
 * Le cycle de vie d'un travail, désormais **asynchrone** : `pending` à la création
 * (la requête HTTP a déjà rendu la main), `running` dès que la tâche de fond démarre,
 * puis `done` ou `failed` — et jamais rien d'autre. Un `running` qui survit à un
 * redémarrage du serveur est un mensonge : le balayage au démarrage le passe `failed`
 * (`sweepInterruptedIngestions`).
 */
export type IngestionStatus = 'pending' | 'running' | 'done' | 'failed'

/**
 * D'où vient le texte : collé dans le formulaire, téléversé (`.txt` / `.md`), ou
 * extrait d'un PDF. La colonne est un `string(16)` : `pdf` n'a demandé aucune migration.
 *
 * ⚠️ **C'est une donnée déclarative**, depuis que la prévisualisation existe : c'est le
 * client qui extrait le texte, donc c'est lui qui annonce d'où il sort. Quelqu'un peut
 * coller du texte en le disant tiré de « cours.pdf ». Le dégât est cosmétique — un faux
 * nom dans l'historique — et acceptable **à cette condition** : `source` et `sourceName`
 * ne sont jamais interprétés, seulement affichés (voir `courseIngestionValidator`).
 */
export type IngestionSource = 'paste' | 'file' | 'pdf'

/**
 * Un travail d'ingestion : un cours découpé en morceaux, soumis à un LLM local,
 * qui produit des **brouillons** de cartes (`LeitnerDraftCard`) — jamais des cartes.
 * Rien n'entre en base sans relecture humaine.
 */
export default class LeitnerIngestion extends BaseModel {
  @column({ isPrimary: true })
  declare id: number

  @column()
  declare status: IngestionStatus

  /**
   * Le nom du travail dans l'historique : fourni à la saisie, ou **déduit** du cours
   * (`deduceTitle`), et renommable ensuite. `null` sur les seules lignes antérieures
   * à la colonne.
   *
   * ⚠️ L'origine (`source`) n'en tient pas lieu : « Texte collé » n'est pas un titre,
   * c'est une pastille à côté du titre.
   */
  @column()
  declare title: string | null

  @column()
  declare source: IngestionSource

  /**
   * Nom du fichier dont le texte a été extrait, `null` quand le cours a été collé.
   * Déclaratif, comme `source` : borné en longueur, affiché, jamais interprété — ce
   * n'est **pas** un chemin, et rien ne le rouvre.
   */
  @column()
  declare sourceName: string | null

  @column()
  declare charCount: number

  @column()
  declare chunkCount: number

  @column()
  declare chunksDone: number

  /** Nombre de brouillons produits, après fusion et déduplication entre morceaux. */
  @column()
  declare cardsProposed: number

  /** Message d'échec, affichable tel quel. `null` tant que rien n'a échoué. */
  @column()
  declare error: string | null

  @hasMany(() => LeitnerDraftCard)
  declare drafts: HasMany<typeof LeitnerDraftCard>

  @column.dateTime({ autoCreate: true })
  declare createdAt: DateTime

  @column.dateTime({ autoCreate: true, autoUpdate: true })
  declare updatedAt: DateTime
}
