/** Une plage d'octets satisfaisable, bornes incluses. */
export interface ByteRange {
  start: number
  end: number
}

/**
 * Parse un en-tête HTTP `Range` pour une ressource de `size` octets — **pur**, aucune dépendance
 * au filesystem ni à la requête (CC-181).
 *
 * ⚠️ **Une seule plage, jamais un multi-range.** `bytes=0-10,20-30` répondrait normalement en
 * `multipart/byteranges` — aucun lecteur vidéo n'en a besoin, et l'implémenter ajouterait de la
 * surface sans usage réel. Rejeté comme non satisfaisable, même verdict qu'une syntaxe invalide.
 *
 * ⚠️ **`null` couvre indistinctement « pas de `Range` valide »** — c'est à l'appelant de décider
 * entre servir le corps entier (en-tête absent) et répondre 416 (en-tête présent mais invalide ou
 * hors bornes). Cette fonction ne fait que la lecture, jamais la réponse HTTP.
 */
export function parseByteRange(header: string, size: number): ByteRange | null {
  if (size <= 0) return null

  const match = /^bytes=(\d*)-(\d*)$/.exec(header.trim())
  if (match === null) return null

  const [, startRaw, endRaw] = match
  if (startRaw === '' && endRaw === '') return null

  let start: number
  let end: number

  if (startRaw === '') {
    // Suffixe : les N derniers octets. `bytes=-0` n'a pas de sens (aucun octet demandé).
    const suffix = Number(endRaw)
    if (!Number.isInteger(suffix) || suffix <= 0) return null

    start = Math.max(0, size - suffix)
    end = size - 1
  } else {
    start = Number(startRaw)
    if (!Number.isInteger(start) || start < 0 || start >= size) return null

    end = endRaw === '' ? size - 1 : Number(endRaw)
    if (!Number.isInteger(end) || end < start) return null

    end = Math.min(end, size - 1)
  }

  return { start, end }
}
