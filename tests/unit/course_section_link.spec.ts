import { test } from '@japa/runner'
import { courseSectionHref, sectionAnchorId } from '#core/shared/services/course_section_link'

test.group('course section link', () => {
  test('sectionAnchorId préfixe l’id de section', ({ assert }) => {
    assert.equal(sectionAnchorId(12), 'section-12')
  })

  test('courseSectionHref pointe vers le cours avec l’ancre de section', ({ assert }) => {
    assert.equal(courseSectionHref(5, 12), '/corpus/5#section-12')
  })
})
