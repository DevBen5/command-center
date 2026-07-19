import vine from '@vinejs/vine'
import type { FieldContext } from '@vinejs/vine/types'
import { DateTime } from 'luxon'

/**
 * Création / édition d'une carte. `leitnerThemeId` est optionnel : une carte
 * peut rester non classée.
 */
export const cardValidator = vine.compile(
  vine.object({
    front: vine.string().trim().minLength(1),
    back: vine.string().trim().minLength(1),
    leitnerThemeId: vine.number().positive().nullable().optional(),
  })
)

/**
 * Longueur maximale d'une réponse écrite. Large — on répond parfois en trois phrases —
 * mais borné : le texte part dans un prompt et s'écrit en base.
 */
export const ANSWER_MAX_CHARS = 2_000

/**
 * La note, et **l'historique de la réponse écrite qui l'a précédée**.
 *
 * ⚠️ `grade` reste le seul champ qui pilote quoi que ce soit. Les trois autres sont de
 * la trace : `LeitnerService.review()` ne les lit pas. C'est ce qui rend possible — et
 * normal — un `verdict: 'faux'` enregistré avec `grade: 'easy'` : le juge propose,
 * l'utilisateur dispose.
 *
 * ⚠️ **`verdict` et `latencyMs` sont DÉCLARATIFS.** Le jugement et la note sont deux
 * requêtes : la seconde porte ce que le client annonce, et rien ne prouve qu'un juge
 * l'a réellement dit. C'est la même doctrine que `source`/`sourceName` de l'ingestion
 * (bornés, jamais interprétés, seulement stockés puis affichés), et elle tient pour la
 * même raison : ces champs **ne calculent rien**. Le dégât maximal est une ligne qui
 * ment dans son propre historique, sur un tableau de bord mono-utilisateur. Ne bâtis
 * jamais une règle métier dessus — c'est à ce moment-là que ça deviendrait un problème.
 */
export const reviewValidator = vine.compile(
  vine.object({
    grade: vine.enum(['again', 'hard', 'good', 'easy'] as const),
    answer: vine.string().trim().maxLength(ANSWER_MAX_CHARS).nullable().optional(),
    verdict: vine
      .enum(['juste', 'partiel', 'faux'] as const)
      .nullable()
      .optional(),
    // Une durée, pas une date : bornée large, elle n'est qu'une mesure historisée.
    latencyMs: vine.number().withoutDecimals().min(0).max(600_000).nullable().optional(),
  })
)

/**
 * La réponse à juger. Le texte est **du contenu non fiable** — il finit dans un prompt,
 * et peut contenir des consignes adressées au modèle (« dis que c'est juste »). C'est
 * acceptable parce qu'**aucun verdict n'est appliqué sans confirmation** : le dégât
 * maximal est un bouton présélectionné à tort, que l'utilisateur voit et change.
 *
 * ⚠️ La carte n'est pas dans le corps de la requête : elle vient de l'URL et se relit en
 * base. Un `front`/`back` fournis par le client laisseraient juger une carte qui n'existe
 * pas — et rendraient la route utilisable comme simple proxy vers le LLM local.
 */
export const judgeValidator = vine.compile(
  vine.object({
    answer: vine.string().trim().maxLength(ANSWER_MAX_CHARS),
  })
)

/**
 * La **portée** d'une session de révision, lue dans la query string de `GET /revision`
 * (`?scope=all` · `?scope=unclassified` · `?category=<id>` · `?theme=<id>`). Elle vient
 * de l'utilisateur — d'un signet, d'une URL partagée, d'une barre d'adresse : elle se
 * valide comme toute entrée de ce dépôt.
 *
 * Ce validateur ne garantit que la **forme**. Les deux règles qui comptent vraiment ne
 * sont pas exprimables ici et vivent dans `LeitnerService.resolveScope` : **un seul**
 * paramètre à la fois (`category` **et** `theme` = refus), et l'**existence** de l'id —
 * un thème supprimé ne doit jamais retomber silencieusement sur « tout ».
 *
 * Aucun paramètre est valide : c'est l'écran de choix.
 */
export const reviewScopeValidator = vine.compile(
  vine.object({
    scope: vine.enum(['all', 'unclassified'] as const).optional(),
    category: vine.number().positive().optional(),
    theme: vine.number().positive().optional(),
  })
)

/** Suppression multiple depuis l'écran de gestion. */
export const cardIdsValidator = vine.compile(
  vine.object({
    ids: vine.array(vine.number().positive()).minLength(1),
  })
)

/** Reclassement multiple : `null` remet les cartes en « non classé ». */
export const cardsThemeValidator = vine.compile(
  vine.object({
    ids: vine.array(vine.number().positive()).minLength(1),
    leitnerThemeId: vine.number().positive().nullable(),
  })
)

/**
 * Intervalles des cinq boîtes, en jours. Minimum **1** : un intervalle à 0
 * laisserait la carte due le jour de sa réussite, donc éternellement en session
 * — le comportement réservé à la note `again`.
 */
const boxInterval = () => vine.number().withoutDecimals().min(1).max(365)

export const boxIntervalsValidator = vine.compile(
  vine.object({
    box1Days: boxInterval(),
    box2Days: boxInterval(),
    box3Days: boxInterval(),
    box4Days: boxInterval(),
    box5Days: boxInterval(),
  })
)

export const categoryValidator = vine.compile(
  vine.object({
    name: vine.string().trim().minLength(1).maxLength(60),
  })
)

export const themeValidator = vine.compile(
  vine.object({
    name: vine.string().trim().minLength(1).maxLength(60),
    leitnerCategoryId: vine.number().positive(),
  })
)

/*
|------------------------------------------------------------------------------
| Import d'une sauvegarde JSON
|------------------------------------------------------------------------------
| Le fichier vient de l'utilisateur : rien n'y est fiable. Une date bidon produit
| un DateTime invalide que Lucid écrirait sans broncher — on valide donc la
| validité réelle des dates, pas seulement leur forme.
*/

/** Jour calendaire (colonne `date`). `2026-02-31` a la bonne forme et n'existe pas. */
const calendarDate = vine.createRule((value: unknown, _options: undefined, field: FieldContext) => {
  if (typeof value !== 'string') return
  if (!DateTime.fromFormat(value, 'yyyy-MM-dd').isValid) {
    field.report(
      'Le champ {{ field }} doit être une date réelle au format AAAA-MM-JJ.',
      'calendarDate',
      field
    )
  }
})

/** Horodatage ISO 8601 complet (colonnes `timestamp`). */
const timestamp = vine.createRule((value: unknown, _options: undefined, field: FieldContext) => {
  if (typeof value !== 'string') return
  if (!DateTime.fromISO(value).isValid) {
    field.report('Le champ {{ field }} doit être un horodatage ISO 8601.', 'timestamp', field)
  }
})

const taxonomyName = () => vine.string().trim().minLength(1).maxLength(60)

/**
 * Contenu du fichier importé. Seuls `front` et `back` sont obligatoires : un fichier
 * écrit à la main se réduit au recto, au verso et au thème, le reste prenant les
 * valeurs d'une carte créée depuis l'UI (boîte 1, due aujourd'hui).
 *
 * ⚠️ **`box` est bornée à 1..5, et c'est le seul rempart** : la colonne n'a aucune
 * contrainte en base. Une carte importée en boîte 12 puis notée `hard` y resterait,
 * `boxIntervals()[12]` vaudrait `undefined`, Luxon ferait `plus({ days: undefined })`
 * = +0 jour et rendrait une date valide — la carte serait éternellement due, sans
 * la moindre exception ni le moindre log.
 */
export const backupValidator = vine.compile(
  vine.object({
    version: vine.number().withoutDecimals().optional(),
    exportedAt: vine.string().optional(),
    categories: vine
      .array(
        vine.object({
          name: taxonomyName(),
          themes: vine.array(taxonomyName()).optional(),
        })
      )
      .optional(),
    cards: vine.array(
      vine.object({
        front: vine.string().trim().minLength(1),
        back: vine.string().trim().minLength(1),
        // Une carte non classée n'a ni l'un ni l'autre ; les deux vont ensemble
        // (un thème appartient toujours à une catégorie) — vérifié à l'import.
        category: taxonomyName().nullable().optional(),
        theme: taxonomyName().nullable().optional(),
        box: vine.number().withoutDecimals().min(1).max(5).optional(),
        nextReview: vine.string().use(calendarDate()).optional(),
        createdAt: vine.string().use(timestamp()).optional(),
        updatedAt: vine.string().use(timestamp()).optional(),
        reviews: vine
          .array(
            vine.object({
              grade: vine.enum(['again', 'hard', 'good', 'easy'] as const),
              reviewedAt: vine.string().use(timestamp()),
            })
          )
          .optional(),
      })
    ),
  })
)

/** Le fichier lui-même. Aucune contrainte d'extension : c'est le contenu qui fait foi. */
export const backupImportValidator = vine.compile(
  vine.object({
    file: vine.file({ size: '20mb' }),
  })
)

/*
|------------------------------------------------------------------------------
| Ingestion d'un cours par un LLM local
|------------------------------------------------------------------------------
| Le cours est du **contenu non fiable** : il peut contenir des instructions
| adressées au modèle. C'est acceptable — le dégât maximal est une carte absurde,
| arrêtée par la relecture humaine — parce que rien de ce que sort le modèle n'est
| jamais exécuté, interprété comme du SQL, ni utilisé comme identifiant.
|
| ⚠️ L'URL du serveur LLM **utilisée par l'ingestion** n'est PAS saisissable : elle
| vient de l'environnement (`start/env.ts` → `config/llm.ts`). Ne l'ajoute jamais à
| ce formulaire. Seules les routes de diagnostic de `/revision/llm` acceptent une URL
| — transitoire, et sous la liste blanche définie plus bas.
*/

/**
 * Longueur maximale d'un titre d'ingestion : la largeur de la colonne `title`, et la
 * borne de tous les chemins qui l'écrivent — la saisie, le renommage, et la déduction
 * (`deduceTitle`, qui tronque à cette valeur sans couper un mot).
 */
export const TITLE_MAX_CHARS = 120

/**
 * Longueur maximale d'un nom de fichier déclaré : la largeur de la colonne
 * `source_name` (`varchar(255)`).
 */
export const SOURCE_NAME_MAX_CHARS = 255

/**
 * Le cours à ingérer : **du texte, et rien que du texte**.
 *
 * ⚠️ Ce validateur n'a plus de champ fichier, et c'est le cœur du lot PDF. Depuis que
 * le texte extrait se prévisualise, le champ fichier n'est plus une voie de soumission
 * mais un **chargeur de texte** : il passe par `POST /revision/ingest/extract`, remplit
 * le `<textarea>`, et c'est le texte relu qui arrive ici. `store()` ne touche donc plus
 * aucun fichier — il ne reçoit que du texte.
 *
 * ⚠️ **`source` et `sourceName` sont par conséquent DÉCLARATIFS** : c'est le client qui
 * a fait l'extraction, donc c'est lui qui annonce l'origine. Quelqu'un peut coller du
 * texte en le disant tiré de « cours.pdf ». Le dégât est **cosmétique** — un faux nom de
 * fichier dans l'historique — et c'est acceptable **à trois conditions, qui sont le prix
 * de la prévisualisation** :
 *
 * 1. ils sont bornés en longueur (ici) ;
 * 2. ils ne sont **jamais interprétés** — `sourceName` n'est pas un chemin, rien ne le
 *    rouvre, rien ne le résout ; `source` est une valeur d'une liste fermée ;
 * 3. ils ne sont que **stockés et affichés** (une pastille à côté du titre, et le nom
 *    de fichier repris comme candidat au titre déduit).
 *
 * Le titre reste **optionnel** : vide, il se déduit du contenu (`deduceTitle`) — et un
 * nom de fichier est un bien meilleur candidat que « Texte collé ». Le plafond de
 * caractères du cours est appliqué dans le contrôleur, et déjà à l'extraction.
 */
export const courseIngestionValidator = vine.compile(
  vine.object({
    title: vine.string().trim().maxLength(TITLE_MAX_CHARS).optional(),
    text: vine.string().trim().optional(),
    source: vine.enum(['paste', 'file', 'pdf'] as const).optional(),
    sourceName: vine.string().trim().maxLength(SOURCE_NAME_MAX_CHARS).nullable().optional(),
  })
)

/**
 * Le fichier à convertir en texte : `.txt` · `.md` · `.pdf`.
 *
 * ⚠️ **L'extension ne prouve rien** : `extnames` ne regarde que le nom du fichier et un
 * type MIME que le client déclare. C'est un premier tri, pas une garantie — les octets
 * magiques (`%PDF-`) sont vérifiés par `LeitnerPdfService`, et un fichier qui ment est
 * refusé, jamais parsé au hasard.
 *
 * ⚠️ La taille est relevée à 15 Mo : les 2 Mo d'avant visaient du `.txt`, un PDF de
 * cours pèse couramment 5 à 20 Mo. Elle doit rester **sous** le `limit: '20mb'` de
 * `config/bodyparser.ts`, qui est le plafond dur global — au-dessus, l'erreur viendrait
 * du parseur (illisible) au lieu du validateur (explicite). Le nombre de **pages** est
 * borné à part : un PDF léger peut en porter des centaines.
 */
export const documentExtractValidator = vine.compile(
  vine.object({
    file: vine.file({ size: '15mb', extnames: ['txt', 'md', 'pdf'] }),
  })
)

/**
 * Renommage d'une ingestion, depuis l'historique comme depuis sa page de suivi. Un
 * titre **vide est refusé** : un travail sans nom, c'est l'historique de « Texte collé »
 * qu'on vient de quitter.
 */
export const ingestionTitleValidator = vine.compile(
  vine.object({
    title: vine.string().trim().minLength(1).maxLength(TITLE_MAX_CHARS),
  })
)

/** Édition d'un brouillon avant validation : c'est la relecture humaine qui fait foi. */
export const draftCardValidator = vine.compile(
  vine.object({
    front: vine.string().trim().minLength(1),
    back: vine.string().trim().minLength(1),
    // Un thème appartient toujours à une catégorie : les deux vont ensemble, ou aucun
    // (vérifié à la promotion, où ils atteignent la vraie taxonomie).
    category: taxonomyName().nullable().optional(),
    theme: taxonomyName().nullable().optional(),
  })
)

/** Rejet en lot : un brouillon écarté n'a pas de contenu à retenir, juste un id. */
export const draftIdsValidator = vine.compile(
  vine.object({
    ids: vine.array(vine.number().positive()).minLength(1),
  })
)

/**
 * Validation en lot — et elle **porte le contenu**, pas seulement des ids.
 *
 * ⚠️ C'est le cœur du geste : valider, c'est valider **ce qu'on a sous les yeux**. Un
 * `accept` qui ne recevrait que des ids relirait la ligne en base et créerait la carte
 * avec le texte du modèle, jetant en silence la correction en cours de saisie — et le
 * brouillon passerait quand même `accepted`, sans plus rien à rattraper.
 */
export const draftPromotionValidator = vine.compile(
  vine.object({
    drafts: vine
      .array(
        vine.object({
          id: vine.number().positive(),
          front: vine.string().trim().minLength(1),
          back: vine.string().trim().minLength(1),
          category: taxonomyName().nullable().optional(),
          theme: taxonomyName().nullable().optional(),
        })
      )
      .minLength(1),
  })
)

/*
|------------------------------------------------------------------------------
| Diagnostic du serveur LLM (/revision/llm)
|------------------------------------------------------------------------------
| L'écran de configuration fait émettre au serveur des requêtes vers une URL
| **saisie par l'utilisateur** — c'est inévitable : il faut tester la valeur AVANT
| de la coller dans `.env`. Transitoire ou non, c'est une SSRF si on ne la borde pas.
|
| ⚠️ La liste blanche ci-dessous est le seul rempart, et elle s'applique à TOUTES
| les routes de diagnostic. Elle ne change rien à la frontière de confiance : ces
| routes n'écrivent rien, et la valeur qu'utilise réellement le serveur continue de
| venir de l'environnement (`config/llm.ts`), pas d'une requête HTTP.
*/

/**
 * Hôte **loopback** (`127.0.0.0/8`, `::1`, `localhost`) ou **plage privée**
 * (`10/8`, `172.16/12`, `192.168/16`). Tout le reste est refusé — en particulier
 * `169.254.169.254` (métadonnées cloud) et **tout nom de domaine**, fût-il résolu
 * vers une IP privée : seule une IP littérale (ou `localhost`) est acceptée.
 *
 * L'hôte est celui qu'a normalisé le parseur d'URL (`http://0x7f000001` devient
 * `127.0.0.1`, `http://[::1]` devient `[::1]`) : la comparaison porte sur la forme
 * canonique, jamais sur ce qui a été tapé. Un LLM « local » vit par définition dans
 * ces plages : la contrainte ne coûte rien à l'usage.
 */
function isLocalHostname(hostname: string): boolean {
  const host = hostname.toLowerCase()
  if (host === 'localhost' || host === '[::1]') return true

  const octets = host.match(/^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/)
  if (!octets) return false

  const [a, b] = octets.slice(1, 3).map(Number)

  if (a === 127) return true // 127.0.0.0/8
  if (a === 10) return true // 10.0.0.0/8
  if (a === 172 && b >= 16 && b <= 31) return true // 172.16.0.0/12
  if (a === 192 && b === 168) return true // 192.168.0.0/16

  return false
}

/** `http`/`https` sur un hôte local ou privé, sans identifiants dans l'URL. */
export function isLocalLlmUrl(value: string): boolean {
  let url: URL
  try {
    url = new URL(value.trim())
  } catch {
    return false
  }

  if (url.protocol !== 'http:' && url.protocol !== 'https:') return false
  // `http://127.0.0.1@evil.example` : l'hôte n'est pas ce qu'on croit lire.
  if (url.username !== '' || url.password !== '') return false

  return isLocalHostname(url.hostname)
}

const localLlmUrl = vine.createRule((value: unknown, _options: undefined, field: FieldContext) => {
  if (typeof value !== 'string') return
  if (!isLocalLlmUrl(value)) {
    field.report(
      'Le champ {{ field }} doit être une URL http(s) vers un hôte local ou privé ' +
        '(127.0.0.1, localhost, 10/8, 172.16/12, 192.168/16).',
      'localLlmUrl',
      field
    )
  }
})

const llmBaseUrl = () => vine.string().trim().maxLength(255).use(localLlmUrl())

/** Le nom du modèle est du texte : il n'est ni exécuté, ni interprété — juste renvoyé au serveur. */
const llmModel = () => vine.string().trim().minLength(1).maxLength(200)

/**
 * Détection : la liste des candidats sondés est **en dur dans le contrôleur**, jamais
 * fournie par le client — sinon la « détection » devient un scanner de ports téléguidé.
 * Seule une URL saisie à la main s'ajoute, et elle passe par la liste blanche.
 */
export const llmDetectValidator = vine.compile(
  vine.object({
    baseUrl: llmBaseUrl().optional(),
  })
)

/** Liste des modèles exposés par un serveur candidat. */
export const llmModelsValidator = vine.compile(
  vine.object({
    baseUrl: llmBaseUrl(),
  })
)

/**
 * Génération de contrôle. Les deux champs sont optionnels : sans eux, c'est la
 * configuration **chargée** (celle de l'environnement) qui est testée — c'est le
 * bandeau d'état, et elle ne passe par aucune liste blanche puisqu'elle ne vient
 * d'aucune requête.
 */
export const llmTestValidator = vine.compile(
  vine.object({
    baseUrl: llmBaseUrl().optional(),
    model: llmModel().optional(),
  })
)
