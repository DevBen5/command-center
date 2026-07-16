import { rm, writeFile } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
import { test } from '@japa/runner'
import { MAX_COURSE_CHARS } from '#modules/leitner/services/leitner_ingestion_service'
import LeitnerPdfService, {
  cleanExtractedText,
  isPdfBuffer,
  MAX_PDF_PAGES,
  MIN_CHARS_PER_PAGE,
  PdfExtractionError,
  type UploadedDocument,
} from '#modules/leitner/services/leitner_pdf_service'

/**
 * L'extraction d'un document, et les refus qui la rendent sûre.
 *
 * Ce qui compte ici : un refus est un refus **distinct** — pas un PDF · chiffré ·
 * corrompu · scan · trop de pages · trop long. Les fondre dans un « fichier invalide »
 * générique rendrait l'écran inutile, exactement la faute que l'écran de configuration
 * LLM a évitée en montrant l'échec brut.
 *
 * ⚠️ Les fixtures sont des **binaires versionnés** (`tests/fixtures/*.pdf`) : elles ne
 * se fabriquent pas à la volée, et **jamais** ne se téléchargent — aucun test de ce
 * dépôt ne touche le réseau.
 */
const FIXTURES = fileURLToPath(new URL('../fixtures/', import.meta.url))

/** Un fichier téléversé, tel que le validateur VineJS le rend au contrôleur. */
function upload(name: string): UploadedDocument {
  return { tmpPath: `${FIXTURES}${name}`, clientName: name, extname: name.split('.').pop() }
}

/** Le refus attendu, **et sa raison** — pas seulement « ça a levé ». */
async function refusal(promise: Promise<unknown>): Promise<PdfExtractionError> {
  try {
    await promise
  } catch (error) {
    if (error instanceof PdfExtractionError) return error
    throw error
  }
  throw new Error('Aucun refus : le document est passé.')
}

/** Un fichier jetable : ces cas-là ne sont pas des PDF, il n'y a pas de binaire à versionner. */
async function withTempFile<T>(
  name: string,
  content: string | Buffer,
  body: (file: UploadedDocument) => Promise<T>
): Promise<T> {
  const tmpPath = `${FIXTURES}${name}`
  await writeFile(tmpPath, content)

  try {
    return await body({ tmpPath, clientName: name, extname: name.split('.').pop() })
  } finally {
    await rm(tmpPath, { force: true })
  }
}

test.group('Leitner / extraction d’un document', () => {
  test('un PDF texte rend son texte, page après page', async ({ assert }) => {
    const { text, source, sourceName } = await new LeitnerPdfService().extractDocument(
      upload('cours.pdf')
    )

    assert.include(text, 'Le handshake TLS')
    // Le fixture fait deux pages : la seconde en est bien, pas seulement la première.
    assert.include(text, 'Le resolveur DNS')

    assert.equal(source, 'pdf')
    assert.equal(sourceName, 'cours.pdf')
  })

  test('les césures de fin de ligne sont recollées', async ({ assert }) => {
    const { text } = await new LeitnerPdfService().extractDocument(upload('cours.pdf'))

    // Le fixture porte « compre-\nhension » et « chan-\ngements », comme tout PDF
    // justifié. Sans recollage, le LLM travaille sur des mots qui n'existent pas.
    assert.include(text, 'comprehension')
    assert.notInclude(text, 'compre-')
    assert.include(text, 'changements')
    assert.notInclude(text, 'chan-')
  })

  test('un PDF sans couche texte est refusé comme un scan', async ({ assert }) => {
    const error = await refusal(new LeitnerPdfService().extractDocument(upload('scan.pdf')))

    assert.equal(error.reason, 'no-text')
    // Sans jargon, et avec la marche à suivre : l'OCR est hors périmètre, pas un secret.
    assert.include(error.message, 'scan')
    assert.include(error.message, 'OCR')
  })

  test('le scan se détecte par page, jamais sur un total', async ({ assert }) => {
    // ⚠️ Le piège du seuil global : `scan.pdf` n'est PAS vide. Ses quatre pages portent
    // chacune leur numéro, comme tout scan (numéros, filigranes, tampons) — et un PDF de
    // 200 pages scannées en rendrait des centaines de caractères. Un seuil absolu les
    // laisserait passer, et le travail partirait au LLM pour ne rien produire.
    const { text } = await new LeitnerPdfService().extractDocument(upload('cours.pdf'))
    assert.isAbove(text.length / 2, MIN_CHARS_PER_PAGE, 'le fixture de contrôle doit, lui, passer')

    const error = await refusal(new LeitnerPdfService().extractDocument(upload('scan.pdf')))
    assert.equal(error.reason, 'no-text')
  })

  test('un PDF protégé par mot de passe a son propre message', async ({ assert }) => {
    const error = await refusal(new LeitnerPdfService().extractDocument(upload('protege.pdf')))

    // Trois échecs, trois messages : un PDF protégé se déverrouille, un PDF corrompu se
    // remplace, un scan passe par un OCR. Les confondre rend l'écran inutile.
    assert.equal(error.reason, 'encrypted')
    assert.include(error.message, 'mot de passe')
    assert.notInclude(error.message, 'scan')
  })

  test('un PDF corrompu est refusé, et pas avec le message du chiffrement', async ({ assert }) => {
    // L'en-tête est là, la suite n'en est pas : c'est le cas « illisible », le troisième.
    const broken = Buffer.concat([Buffer.from('%PDF-1.4\n'), Buffer.from('nawak '.repeat(40))])

    await withTempFile('corrompu.tmp.pdf', broken, async (file) => {
      const error = await refusal(new LeitnerPdfService().extractDocument(file))
      assert.equal(error.reason, 'corrupt')
      assert.notInclude(error.message, 'mot de passe')
    })
  })

  test('un fichier qui n’est pas un PDF malgré son extension est refusé', async ({ assert }) => {
    // ⚠️ L'extension ne prouve rien, et le type MIME est déclaré par le client : seuls
    // les octets magiques font foi. Un refus, pas une 500 au fond du parseur.
    await withTempFile('menteur.tmp.pdf', 'Ceci est un texte, pas un PDF.', async (file) => {
      const error = await refusal(new LeitnerPdfService().extractDocument(file))
      assert.equal(error.reason, 'not-a-pdf')
    })
  })

  test('le plafond de pages refuse avant d’extraire', async ({ assert }) => {
    // ⚠️ Les deux plafonds ne font pas double emploi : `epais.pdf` fait 250 pages de vrai
    // texte pour ~25 000 caractères — il passe donc et le seuil du scan, et celui des
    // caractères. Seul le plafond de pages peut le refuser, et il le fait AVANT une
    // extraction longue et gourmande (pdf.js lit toutes les pages en parallèle).
    assert.isBelow(MAX_PDF_PAGES, 250, 'le fixture epais.pdf doit rester au-dessus du plafond')

    const error = await refusal(new LeitnerPdfService().extractDocument(upload('epais.pdf')))
    assert.equal(error.reason, 'too-many-pages')
    assert.include(error.message, String(MAX_PDF_PAGES))
  })

  test('le plafond de caractères s’applique dès l’extraction', async ({ assert }) => {
    const long = 'x'.repeat(MAX_COURSE_CHARS + 1)

    await withTempFile('pave.tmp.txt', long, async (file) => {
      const error = await refusal(new LeitnerPdfService().extractDocument(file))

      // Le compte réel, et le conseil utile : rendre 480 000 caractères dans un
      // <textarea> fige le navigateur, et tronquer en silence est pire.
      assert.equal(error.reason, 'too-long')
      assert.include(error.message, (MAX_COURSE_CHARS + 1).toLocaleString('fr-FR'))
      assert.include(error.message, 'chapitre')
    })
  })

  test('un .md est lu tel quel, sans le nettoyage du PDF', async ({ assert }) => {
    // Les tirets et les blancs d'un Markdown sont voulus : les « nettoyer » le mutilerait.
    const markdown = '# Réseau\n\nUne liste :\n\n- premier point\n- second point'

    await withTempFile('cours.tmp.md', markdown, async (file) => {
      const { text, source, sourceName } = await new LeitnerPdfService().extractDocument(file)

      assert.equal(text, markdown)
      assert.equal(source, 'file')
      assert.equal(sourceName, 'cours.tmp.md')
    })
  })

  test('les octets magiques sont le seul juge', ({ assert }) => {
    assert.isTrue(isPdfBuffer(Buffer.from('%PDF-1.7\nsuite')))
    assert.isFalse(isPdfBuffer(Buffer.from('PK')))
    // L'en-tête est à l'octet 0 : un PDF ne commence pas « presque » par %PDF-.
    assert.isFalse(isPdfBuffer(Buffer.from('   %PDF-1.4')))
    assert.isFalse(isPdfBuffer(Buffer.alloc(0)))
  })
})

/*
| Le nettoyage — du code pur, donc le test qui compte de ce lot
|------------------------------------------------------------------------------
| Sans lui, le LLM travaille sur du bruit : des mots coupés en deux, des ligatures
| qui cassent la déduplication, des pages de blancs.
*/
test.group('Leitner / nettoyage du texte extrait', () => {
  test('les ligatures sont normalisées', ({ assert }) => {
    // NFKC : « ﬁ » est UN caractère dans un PDF, et deux lettres dans un mot. Sans lui,
    // « configuration » et « conﬁguration » sont deux rectos différents.
    assert.equal(cleanExtractedText('le ﬁchier de conﬁguration'), 'le fichier de configuration')
    assert.equal(cleanExtractedText('un ﬂux'), 'un flux')
    // Et l'espace insécable redevient une espace.
    assert.equal(cleanExtractedText('deux mots'), 'deux mots')
  })

  test('les mots coupés en fin de ligne sont recollés', ({ assert }) => {
    assert.equal(cleanExtractedText('la compré-\nhension'), 'la compréhension')
    // Le trait d'union conditionnel, invisible, coupe tout aussi bien.
    assert.equal(cleanExtractedText('la compré­\nhension'), 'la compréhension')
  })

  test('une majuscule après le saut de ligne n’est pas une césure', ({ assert }) => {
    // « Nord-\nSud » est un mot composé en fin de ligne, pas une coupure typographique.
    assert.equal(cleanExtractedText('axe Nord-\nSud'), 'axe Nord-\nSud')
  })

  test('les blancs sont réduits sans écraser les paragraphes', ({ assert }) => {
    // ⚠️ Les lignes vides portent la structure : `chunkCourse` découpe par titres et par
    // paragraphes. Tout aplatir lui retirerait ses repères.
    assert.equal(
      cleanExtractedText('# Titre\n\n\n\nUn   paragraphe. \n  Sa suite.\n\n\nUn autre.'),
      '# Titre\n\nUn paragraphe.\nSa suite.\n\nUn autre.'
    )
  })
})
