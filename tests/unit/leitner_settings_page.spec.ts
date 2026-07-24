import { test } from '@japa/runner'
import { scrollTopKeepingAnchor } from '#modules/leitner/shared/settings_page'

/*
|--------------------------------------------------------------------------
| CC-67 — le recalage du défilement après un import (`pages/settings.vue`)
|--------------------------------------------------------------------------
| Après un import JSON, l'utilisateur se retrouvait loin du formulaire qu'il
| venait d'utiliser. La correction suit le bloc Sauvegarde plutôt que le pixel
| de défilement — et c'est ce calcul-là, et lui seul, que ces tests prouvent.
|
| ⚠️ Ce que ces tests ne voient PAS, et ne verront jamais : jsdom ne fait aucun
| layout. Ni la hauteur du tableau, ni `scrollTop`, ni un vrai
| `getBoundingClientRect`, ni le conteneur défilant choisi par la page, ni le
| moment de la mesure (`nextTick`), ni l'ancrage de défilement du navigateur.
| Le comportement se vérifie au navigateur, la recette est dans le ticket.
|
| Ce qui rendrait ces tests inutiles : les écrire sur des valeurs symétriques.
| Un signe inversé donne le bon résultat quand le delta est nul — d'où deux cas
| nominaux **de sens opposés**, tous deux asymétriques.
*/

test.group('Leitner — le défilement qui suit le bloc Sauvegarde', () => {
  test("l'ancre remontée à l'écran fait redescendre le défilement", ({ assert }) => {
    // Le navigateur a remonté `scrollTop` de 200 px pour garder fixe la ligne de
    // tableau sur laquelle il s'était ancré : le bloc, lui, n'a pas bougé du
    // document, il est juste passé 200 px plus haut à l'écran. On le redescend.
    assert.equal(scrollTopKeepingAnchor({ scrollTop: 1200, topBefore: 300, topAfter: 100 }), 1000)
  })

  test("l'ancre poussée vers le bas fait descendre le défilement", ({ assert }) => {
    // L'autre sens : l'import a créé des catégories, la taxonomie a grandi
    // au-dessus du bloc dans la même colonne, le bloc a réellement descendu.
    assert.equal(scrollTopKeepingAnchor({ scrollTop: 1200, topBefore: 300, topAfter: 460 }), 1360)
  })

  test('une ancre immobile ne déplace rien', ({ assert }) => {
    // Le cas témoin : un import entièrement dédupliqué n'ajoute aucune ligne.
    // Rien ne doit bouger — surtout pas « un peu ».
    assert.equal(scrollTopKeepingAnchor({ scrollTop: 1200, topBefore: 300, topAfter: 300 }), 1200)
  })

  test('le défilement rendu ne descend jamais sous zéro', ({ assert }) => {
    // Un défilement négatif n'existe pas : le navigateur l'écrêterait, autant ne
    // pas le prétendre. Le haut de page est la meilleure approximation.
    assert.equal(scrollTopKeepingAnchor({ scrollTop: 40, topBefore: 300, topAfter: 100 }), 0)
  })
})
