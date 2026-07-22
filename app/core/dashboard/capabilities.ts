/**
 * Les capacités du tableau de bord.
 *
 * L'accueil agrège des chiffres des quatre modules. Une seule capacité pour l'instant :
 * le filtrage de ce qu'un lecteur y voit réellement (les compteurs de Services, par
 * exemple) relève de CC-72, pas de l'accès à la page.
 */
export const DASHBOARD_CAPABILITIES = ['dashboard.view'] as const
