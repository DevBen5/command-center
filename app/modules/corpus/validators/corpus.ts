import vine from '@vinejs/vine'

/**
 * Le titre d'un cours (CC-251) — largeur de la colonne `leitner_courses.title`
 * (`varchar(200)`). Déclarée ici plutôt que chez chaque validateur qui la consomme :
 * `leitner/validators/leitner.ts` (`backupValidator`, l'export/import v5) l'importe aussi,
 * même raison que `PREVIEW_MAX_CHARS`/`MEASURE_MAX_MS` côté Leitner — une seule déclaration,
 * jamais recopiée (CC-275, déplacée avec le corpus depuis `leitner/validators/leitner.ts`).
 */
import { COURSE_TITLE_MAX_CHARS } from '#core/shared/constants/course'
export { COURSE_TITLE_MAX_CHARS }

/**
 * Ajout d'un cours : du markdown, et rien d'autre. ⚠️ **Un fichier `.md` n'est PAS
 * téléversé au serveur** — contrairement au PDF de l'ingestion Leitner, un `.md` n'a besoin
 * d'aucune extraction : la page le lit avec `FileReader` et remplit le même champ que
 * le collage. `source` reste déclarative (`paste`/`file`), jamais interprétée.
 */
export const courseCreateValidator = vine.compile(
  vine.object({
    title: vine.string().trim().minLength(1).maxLength(COURSE_TITLE_MAX_CHARS),
    markdown: vine.string().trim().minLength(1),
    source: vine.enum(['paste', 'file'] as const).optional(),
  })
)

/**
 * Résolution du dialogue à 3 issues, sur un conflit de titre (« Remplacer le contenu » ·
 * « Créer un second cours » · « Annuler »). `markdown` répète le contenu déjà soumis :
 * le formulaire de conflit renvoie ce que l'utilisateur avait collé, il ne le relit pas
 * en base. Absent quand `resolution` vaut `cancel`, qui n'écrit rien.
 */
export const courseConflictValidator = vine.compile(
  vine.object({
    existingId: vine.number().positive(),
    resolution: vine.enum(['replace', 'createSecond', 'cancel'] as const),
    title: vine.string().trim().minLength(1).maxLength(COURSE_TITLE_MAX_CHARS).optional(),
    markdown: vine.string().trim().minLength(1).optional(),
    source: vine.enum(['paste', 'file'] as const).optional(),
  })
)

/** Remplacement du contenu d'un cours existant. */
export const courseReplaceValidator = vine.compile(
  vine.object({
    markdown: vine.string().trim().minLength(1),
  })
)

export const glossaryTermCreateValidator = vine.compile(
  vine.object({
    term: vine.string().trim().minLength(1).maxLength(200),
    aliases: vine.array(vine.string().trim().minLength(1).maxLength(200)).optional(),
    definition: vine.string().trim().minLength(1),
    sectionId: vine.number().withoutDecimals().positive().nullable().optional(),
    isShared: vine.boolean().optional(),
  })
)

export const glossaryTermUpdateValidator = glossaryTermCreateValidator
