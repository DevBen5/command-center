import { test } from '@japa/runner'

/**
 * La CSP est active (CC-78) et dit ce qu'elle doit dire.
 *
 * ⚠️ Ce test prouve l'EN-TÊTE, pas l'inoffensivité : une directive trop stricte
 * casserait un écran sans faire rougir quoi que ce soit ici — jsdom ne charge
 * rien, seul un navigateur voit une violation CSP. Le passage navigateur (dev
 * ET build de prod) fait partie du ticket ; ce spec empêche seulement la CSP
 * de disparaître ou de s'affaiblir en silence.
 */
test.group('Core / en-têtes de sécurité', () => {
  test('la CSP est posée, stricte sur les scripts', async ({ client, assert }) => {
    const response = await client.get('/login')

    response.assertStatus(200)
    const csp = response.header('content-security-policy')
    assert.exists(csp)

    // La directive qui compte : aucun script inline, aucun tiers.
    assert.include(csp!, "script-src 'self'")
    assert.notInclude(csp!.split('script-src')[1]!.split(';')[0]!, 'unsafe-inline')

    assert.include(csp!, "default-src 'self'")
    assert.include(csp!, "object-src 'none'")
    assert.include(csp!, "frame-ancestors 'none'")
    assert.include(csp!, "form-action 'self'")
    // Les deux seuls tiers du dépôt : Google Fonts, feuille et fichiers.
    assert.include(csp!, 'https://fonts.googleapis.com')
    assert.include(csp!, 'https://fonts.gstatic.com')
  })
})
