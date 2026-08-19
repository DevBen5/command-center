import { test } from '@japa/runner'
import { courseSectionHref, sectionAnchorId } from '#modules/leitner/shared/course_section_link'

test.group('leitner course section link', () => {
  test('sectionAnchorId préfixe l’id de section', ({ assert }) => {
    assert.equal(sectionAnchorId(12), 'section-12')
  })

  test('courseSectionHref pointe vers le cours avec l’ancre de section', ({ assert }) => {
    assert.equal(courseSectionHref(5, 12), '/revision/cours/5#section-12')
  })
})
