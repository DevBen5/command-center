import { test } from '@japa/runner'
import { fileURLToPath } from 'node:url'
import { join } from 'node:path'
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import {
  generateNasThumbnail,
  MAX_NAS_THUMBNAIL_SOURCE_BYTES,
  NAS_THUMBNAIL_DIMENSION,
} from '#modules/coffre/services/nas_thumbnail_generator'

/**
 * Le générateur de vignettes ImageMagick (CC-228), avec le **binaire réel** — jamais mocké,
 * exactement comme `coffre_nas_roots.spec.ts` teste contre un vrai filesystem. La mesure qui a
 * précédé ce lot est dans `app/modules/coffre/CLAUDE.md`, « Les vignettes du catalogue NAS ».
 *
 * ⚠️ **Ces tests exigent `magick` sur le PATH.** Sur ce poste, installé via `winget` (avec
 * l'accord du propriétaire) — sans lui, l'image publiée reste la seule preuve, comme le reste du
 * dépôt le fait déjà pour le build multi-arch.
 */
const FIXTURES = fileURLToPath(new URL('../fixtures/', import.meta.url))

test.group('Coffre / le générateur de vignettes NAS', (group) => {
  let dossier: string

  group.each.setup(async () => {
    dossier = await mkdtemp(join(tmpdir(), 'cc-nas-thumb-'))
    return () => rm(dossier, { recursive: true, force: true })
  })

  test('un JPEG réel rend une vignette JPEG bornée en dimensions', async ({ assert }) => {
    // Une image plus grande que la borne, pour prouver le redimensionnement — pas seulement
    // l'aller-retour.
    const source = join(dossier, 'grande.jpg')
    await synthesizeJpeg(source, 2000, 1500)

    const thumbnail = await generateNasThumbnail(source)

    assert.equal(thumbnail.contentType, 'image/jpeg')
    assert.isTrue(thumbnail.bytes.length > 0)
    // En-tête JPEG (SOI) : 0xFFD8.
    assert.equal(thumbnail.bytes[0], 0xff)
    assert.equal(thumbnail.bytes[1], 0xd8)

    const { width, height } = await identifyDimensions(thumbnail.bytes)
    assert.isAtMost(width, NAS_THUMBNAIL_DIMENSION)
    assert.isAtMost(height, NAS_THUMBNAIL_DIMENSION)
    assert.equal(Math.max(width, height), NAS_THUMBNAIL_DIMENSION)
  })

  test('un HEIC réel (fixture commitée) rend une vignette JPEG — le codepath que sharp ne couvre pas', async ({
    assert,
  }) => {
    const source = join(FIXTURES, 'coffre_nas_thumbnail.heic')

    const thumbnail = await generateNasThumbnail(source)

    assert.equal(thumbnail.contentType, 'image/jpeg')
    assert.equal(thumbnail.bytes[0], 0xff)
    assert.equal(thumbnail.bytes[1], 0xd8)
  })

  test('PNG, WEBP et GIF réels rendent tous une vignette JPEG', async ({ assert }) => {
    const png = join(dossier, 'x.png')
    await synthesizeFormat(png, 'PNG')
    const thumbPng = await generateNasThumbnail(png)
    assert.equal(thumbPng.contentType, 'image/jpeg')

    const webp = join(dossier, 'x.webp')
    await synthesizeFormat(webp, 'WEBP')
    const thumbWebp = await generateNasThumbnail(webp)
    assert.equal(thumbWebp.contentType, 'image/jpeg')

    const gif = join(dossier, 'x.gif')
    await synthesizeFormat(gif, 'GIF')
    const thumbGif = await generateNasThumbnail(gif)
    assert.equal(thumbGif.contentType, 'image/jpeg')
  })

  test('une extension hors de l’allow-list photo est rejetée sans invoquer le binaire', async ({
    assert,
  }) => {
    const source = join(dossier, 'video.mp4')
    await writeFile(source, 'peu importe le contenu')

    await assert.rejects(() => generateNasThumbnail(source), /hors de l'allow-list/)
  })

  test('un fichier dont le contenu ne correspond pas à son extension est refusé proprement (jamais exécuté)', async ({
    assert,
  }) => {
    // Un payload MVG, l'ancienne famille de faille ImageTragick — renommé `.jpg`. Le coder est
    // forcé par préfixe (voir le générateur) : ImageMagick doit refuser de le décoder comme JPEG,
    // jamais l'interpréter comme MVG.
    const source = join(dossier, 'deguise.jpg')
    await writeFile(source, 'image over 0,0 0,0 "caption:pwn"')

    await assert.rejects(() => generateNasThumbnail(source), /génération de vignette a échoué/)
  })

  test('un fichier volontairement énorme est rejeté AVANT tout appel au binaire', async ({
    assert,
  }) => {
    const source = join(dossier, 'enorme.jpg')
    // Un fichier de garbage, pas une vraie image : le rejet doit intervenir sur la SEULE taille,
    // avant même une tentative de décodage.
    await writeFile(source, Buffer.alloc(MAX_NAS_THUMBNAIL_SOURCE_BYTES + 1))

    await assert.rejects(() => generateNasThumbnail(source), /trop volumineux/)
  })

  test('un DOSSIER dont le nom porte une extension photo autorisée est rejeté, jamais une exception non catchée', async ({
    assert,
  }) => {
    const piege = join(dossier, 'album.jpg')
    await mkdir(piege, { recursive: true })

    await assert.rejects(() => generateNasThumbnail(piege), /pas un fichier régulier/)
  })

  test('un fichier disparu rend un refus, jamais une exception brute', async ({ assert }) => {
    await assert.rejects(
      () => generateNasThumbnail(join(dossier, 'disparu.jpg')),
      /introuvable|pas un fichier régulier/
    )
  })
})

/** Fabrique une image JPEG réelle de dimensions données, via le binaire `magick` lui-même. */
async function synthesizeJpeg(path: string, width: number, height: number): Promise<void> {
  await runMagick(['-size', `${width}x${height}`, 'xc:red', `JPEG:${path}`])
}

async function synthesizeFormat(path: string, format: string): Promise<void> {
  await runMagick(['-size', '64x64', 'xc:blue', `${format}:${path}`])
}

async function identifyDimensions(bytes: Buffer): Promise<{ width: number; height: number }> {
  const { execFile } = await import('node:child_process')
  const output = await new Promise<string>((resolve, reject) => {
    const child = execFile(
      'magick',
      ['identify', '-format', '%wx%h', 'JPEG:-'],
      { encoding: 'utf8' },
      (error, stdout) => (error ? reject(error) : resolve(stdout))
    )
    child.stdin?.end(bytes)
  })
  const [width, height] = output.split('x').map(Number)
  return { width, height }
}

async function runMagick(args: string[]): Promise<void> {
  const { execFile } = await import('node:child_process')
  await new Promise<void>((resolve, reject) => {
    execFile('magick', args, (error) => (error ? reject(error) : resolve()))
  })
}
