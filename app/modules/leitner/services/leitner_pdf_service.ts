import { readFile } from 'node:fs/promises'
import { extractText, getDocumentProxy } from 'unpdf'
import { MAX_COURSE_CHARS } from '#modules/leitner/services/leitner_ingestion_service'
import type { IngestionSource } from '#modules/leitner/models/leitner_ingestion'

/*
|------------------------------------------------------------------------------
| Un document → du texte, et rien d'autre
|------------------------------------------------------------------------------
| Ce service ne crée rien, n'écrit rien, ne lance aucune analyse : il rend le texte
| d'un fichier pour que l'utilisateur le **relise avant** que le travail n'existe.
| C'est toute la raison d'être de la prévisualisation, et c'est ce qui a fait passer
| `.txt` / `.md` par ce chemin eux aussi : un PDF qu'on relit pendant qu'un `.md`
| part à l'aveugle serait une incohérence gratuite.
|
| ⚠️ **L'OCR est hors périmètre, définitivement.** Un PDF sans couche texte est
| refusé, jamais deviné.
|
| ⚠️ **Le multi-colonnes ne se résout pas, il se voit.** Sur un article ou un
| polycopié à deux colonnes, pdf.js entrelace les colonnes et rend du charabia :
| c'est une limite connue et acceptée, pas un bug à corriger ici. La prévisualisation
| existe précisément pour que l'utilisateur le voie et corrige — ou renonce.
*/

/**
 * Les cinq façons dont un document se refuse, et elles ne se confondent pas : un
 * « fichier invalide » générique rendrait l'écran inutile. Chacune a son message.
 */
export type ExtractionFailure =
  'not-a-pdf' | 'encrypted' | 'corrupt' | 'no-text' | 'too-many-pages' | 'too-long'

/** Un refus d'extraction. Le message est affichable tel quel, sans jargon. */
export class PdfExtractionError extends Error {
  constructor(
    readonly reason: ExtractionFailure,
    message: string
  ) {
    super(message)
    this.name = 'PdfExtractionError'
  }
}

/**
 * Plafond de pages, appliqué **avant** l'extraction.
 *
 * ⚠️ Ce n'est pas un doublon du plafond de caractères : un PDF de 8 Mo peut porter
 * 600 pages, donc des millions de caractères. `MAX_COURSE_CHARS` les rejetterait —
 * mais **après** une extraction longue et gourmande (pdf.js lit toutes les pages en
 * parallèle). Cent pages, c'est déjà bien au-delà des 100 000 caractères d'un cours.
 */
export const MAX_PDF_PAGES = 200

/**
 * En dessous de ce ratio caractères / page, le PDF n'a pas de couche texte.
 *
 * ⚠️ **Le seuil est un ratio, pas un total.** Un scan de 200 pages rend quand même
 * quelques centaines de caractères — numéros de page, filigranes, tampons : un seuil
 * global les laisserait passer, et le travail partirait au LLM pour ne rien produire.
 * 50 caractères par page laisse passer le plus aéré des polycopiés de diapositives
 * et arrête tous les scans, qui plafonnent à quelques caractères par page.
 */
export const MIN_CHARS_PER_PAGE = 50

/**
 * ⚠️ **L'extension ne prouve rien.** `vine.file({ extnames: ['pdf'] })` ne regarde que
 * le nom du fichier et un type MIME que le client déclare : les deux se renomment. Un
 * PDF commence par `%PDF-` — sinon c'est un refus, pas une 500 au fond du parseur.
 */
export function isPdfBuffer(buffer: Buffer): boolean {
  return buffer.subarray(0, 5).toString('latin1') === '%PDF-'
}

/**
 * Le texte brut de pdf.js n'est pas du texte : sans ce passage, le LLM travaille sur
 * du bruit.
 *
 * - **NFKC** normalise les ligatures typographiques (`ﬁ`, `ﬂ` → `fi`, `fl`) et les
 *   espaces insécables — un `ﬁ` sur deux mots casse la déduplication comme la lecture ;
 * - les **césures de fin de ligne** sont recollées (`compré-\nhension` → `compréhension`),
 *   trait d'union conditionnel compris. Revers assumé : un mot réellement composé coupé
 *   à la césure (`porte-\nmanteau`) est recollé à tort. C'est indécidable sans
 *   dictionnaire, et la relecture le rattrape ;
 * - les suites de blancs sont réduites, **sans écraser les sauts de paragraphe** : le
 *   découpage du cours s'appuie sur les titres Markdown et les lignes vides
 *   (`chunkCourse`), les aplatir lui retirerait ses repères.
 */
export function cleanExtractedText(raw: string): string {
  return (
    raw
      .normalize('NFKC')
      .replace(/\r\n?/g, '\n')
      // Les blancs d'une même ligne (le `\n` est exclu : il porte la structure).
      .replace(/[^\S\n]+/g, ' ')
      .replace(/ *\n */g, '\n')
      // La césure : une lettre, un trait d'union (ou un trait conditionnel), un saut de
      // ligne, une minuscule. Une majuscule après le saut est une phrase, pas une césure.
      .replace(/(\p{L})[-­]\n(\p{Ll})/gu, '$1$2')
      .replace(/\n{3,}/g, '\n\n')
      .trim()
  )
}

/** Le fichier téléversé, tel que le validateur VineJS le rend. */
export interface UploadedDocument {
  tmpPath?: string
  clientName: string
  extname?: string
}

export interface ExtractedDocument {
  text: string
  /** L'origine, telle qu'elle sera **déclarée** au POST d'ingestion. */
  source: Extract<IngestionSource, 'file' | 'pdf'>
  sourceName: string
}

export default class LeitnerPdfService {
  /**
   * Un fichier téléversé → son texte. Les trois formats passent par ici : `.txt` et
   * `.md` sont lus tels quels, `.pdf` est extrait puis nettoyé.
   */
  async extractDocument(file: UploadedDocument): Promise<ExtractedDocument> {
    const buffer = await readFile(file.tmpPath!)
    const isPdf = file.extname?.toLowerCase() === 'pdf'

    const text = isPdf
      ? await this.extractPdf(buffer)
      : // Le contenu d'un `.md` est déjà du texte : le nettoyage du PDF le mutilerait
        // (ses tirets de fin de ligne et ses blancs sont voulus).
        buffer.toString('utf-8').trim()

    // ⚠️ Le plafond s'applique **dès l'extraction**, pas à la soumission : rendre
    // 480 000 caractères dans un `<textarea>` fige le navigateur. Et on ne tronque
    // pas en silence — un cours amputé de sa seconde moitié partirait à l'analyse
    // sans que personne ne le sache.
    if (text.length > MAX_COURSE_CHARS) {
      throw new PdfExtractionError(
        'too-long',
        `Ce document fait ${text.length.toLocaleString('fr-FR')} caractères, au-delà du plafond ` +
          `de ${MAX_COURSE_CHARS.toLocaleString('fr-FR')}. Découpe-le par chapitre.`
      )
    }

    return { text, source: isPdf ? 'pdf' : 'file', sourceName: file.clientName }
  }

  /**
   * Le texte d'un PDF : octets magiques, ouverture, plafond de pages, extraction,
   * détection du scan, nettoyage — dans cet ordre, et l'ordre compte.
   *
   * ⚠️ **On parse ici du binaire hostile, dans le processus.** pdf.js a connu une
   * exécution de code arbitraire par une police piégée (CVE-2024-4367) quand `eval`
   * est autorisé. D'où `isEvalSupported: false` — passé explicitement, même si `unpdf`
   * le pose par défaut : c'est la garantie, elle ne se lit pas dans un `node_modules`.
   * Le reste va dans le même sens : aucune police du système n'est chargée, aucune
   * ressource n'est allée chercher au dehors.
   *
   * ⚠️ **Ne remplace pas `unpdf` par `pdf-parse`** : il embarque un pdf.js 1.x, sans
   * aucun de ces correctifs. `unpdf` est retenu pour son pdf.js récent, et pour être
   * le seul build à ne pas demander qu'on câble un worker en Node ESM.
   */
  private async extractPdf(buffer: Buffer): Promise<string> {
    if (!isPdfBuffer(buffer)) {
      throw new PdfExtractionError(
        'not-a-pdf',
        "Ce fichier n'est pas un PDF, quel que soit son nom : il n'en a pas l'en-tête."
      )
    }

    const pdf = await this.openPdf(buffer)

    try {
      if (pdf.numPages > MAX_PDF_PAGES) {
        throw new PdfExtractionError(
          'too-many-pages',
          `Ce PDF fait ${pdf.numPages} pages, au-delà du plafond de ${MAX_PDF_PAGES}. ` +
            `Un cours de cette taille se soumet chapitre par chapitre.`
        )
      }

      const { text: pages } = await extractText(pdf, { mergePages: false })
      const extracted = pages.join('\n\n')

      // Le ratio, jamais le total : voir `MIN_CHARS_PER_PAGE`.
      if (extracted.length / pdf.numPages < MIN_CHARS_PER_PAGE) {
        throw new PdfExtractionError(
          'no-text',
          "Ce PDF ne contient pas de texte — c'est probablement un scan. " +
            'Passe-le par un OCR, puis reviens.'
        )
      }

      return cleanExtractedText(extracted)
    } finally {
      // Le proxy tient un worker et le tampon du document : sans ça, ils vivent aussi
      // longtemps que le processus, à chaque extraction.
      await pdf.destroy()
    }
  }

  /**
   * L'ouverture, et ses deux échecs — qui ne se confondent pas : un PDF protégé par
   * mot de passe se déverrouille, un PDF corrompu se remplace. Les fondre dans un
   * « fichier invalide » générique, c'est exactement la faute que l'écran de
   * configuration LLM a évitée en montrant l'échec brut.
   */
  private async openPdf(buffer: Buffer) {
    try {
      return await getDocumentProxy(new Uint8Array(buffer), {
        // La ligne qui compte : aucun JavaScript embarqué n'est évalué.
        isEvalSupported: false,
        // Rien du système, rien du dehors : une police ne sert qu'à DESSINER un glyphe,
        // et on ne dessine rien — le texte vient du flux de contenu, pas de la police.
        disableFontFace: true,
        useSystemFonts: false,
        useWorkerFetch: false,
        // Les seuls avertissements que pdf.js sait produire ici portent sur des
        // ressources de rendu qu'on lui refuse exprès (« standardFontDataUrl »…) : ils
        // sonnent à chaque extraction et n'apprennent rien du document. Un avertissement
        // qui se déclenche toujours, c'est un log qu'on cesse de lire. Les **erreurs**,
        // elles, passent toujours — et les échecs qui comptent sont des exceptions.
        verbosity: 0,
      })
    } catch (error) {
      // pdf.js lève une exception dédiée au mot de passe. On la reconnaît par son `name` :
      // sa classe vit dans les entrailles du build, son nom est stable.
      if (error instanceof Error && error.name === 'PasswordException') {
        throw new PdfExtractionError(
          'encrypted',
          'Ce PDF est protégé par un mot de passe : il ne peut pas être lu. ' +
            'Enlève la protection, puis téléverse-le à nouveau.'
        )
      }

      throw new PdfExtractionError(
        'corrupt',
        `Ce PDF est illisible : ${error instanceof Error ? error.message : String(error)}`
      )
    }
  }
}
