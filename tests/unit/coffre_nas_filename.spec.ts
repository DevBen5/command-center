import { test } from '@japa/runner'
import { isValidNasFileName } from '#modules/coffre/services/nas_filename'

/**
 * La validation de nom de fichier pour l'écriture NAS (CC-240), **pure**. C'est le point dur du
 * ticket : contrairement à `NasRootsService`, ce nom n'existe pas encore et ne peut donc pas être
 * vérifié par `realpath` — cette fonction est toute la garde avant d'approcher le disque.
 */
test.group('Coffre / le nom de fichier NAS', () => {
  test('un nom ordinaire est accepté', ({ assert }) => {
    assert.isTrue(isValidNasFileName('photo-vacances.jpg'))
  })

  test('⚠️ un nom vide est refusé', ({ assert }) => {
    assert.isFalse(isValidNasFileName(''))
  })

  test('⚠️ un séparateur `/` est refusé', ({ assert }) => {
    assert.isFalse(isValidNasFileName('dossier/photo.jpg'))
  })

  test('⚠️ un séparateur `\\` est refusé', ({ assert }) => {
    assert.isFalse(isValidNasFileName('dossier\\photo.jpg'))
  })

  test('⚠️ une traversée `..` est refusée, même noyée dans un nom par ailleurs valide', ({
    assert,
  }) => {
    assert.isFalse(isValidNasFileName('..'))
    assert.isFalse(isValidNasFileName('photo..jpg'))
  })

  test('⚠️ un octet nul est refusé', ({ assert }) => {
    assert.isFalse(isValidNasFileName('photo\0.jpg'))
  })

  test('⚠️ un nom réservé Windows est refusé, casse et extension comprises', ({ assert }) => {
    assert.isFalse(isValidNasFileName('CON'))
    assert.isFalse(isValidNasFileName('con'))
    assert.isFalse(isValidNasFileName('Con.txt'))
    assert.isFalse(isValidNasFileName('COM1'))
    assert.isFalse(isValidNasFileName('lpt9.jpg'))
  })

  test('un nom qui commence par un nom réservé sans l’être reste accepté', ({ assert }) => {
    assert.isTrue(isValidNasFileName('CONTRAT.pdf'))
    assert.isTrue(isValidNasFileName('NULLIFIED.txt'))
  })

  test('⚠️ un nom trop long est refusé', ({ assert }) => {
    assert.isFalse(isValidNasFileName(`${'a'.repeat(256)}.jpg`))
    assert.isTrue(isValidNasFileName(`${'a'.repeat(251)}.jpg`))
  })
})
