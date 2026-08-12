import { configApp } from '@adonisjs/eslint-config'

/**
 * ⚠️ **`pgdata` doit être ignoré, sinon `npm run lint` NE DÉMARRE PAS sur un poste de
 * développement** — et il reste vert en CI, ce qui est la pire moitié du problème.
 *
 * Postgres écrit dans un bind mount du dépôt (`./pgdata`, voir le `CLAUDE.md` racine, « Les
 * données ») et le dossier appartient à l'utilisateur du conteneur en `drwx------`. ESLint 9
 * balaie l'arborescence **avant** de lire quoi que ce soit et sort sur
 * `EACCES: permission denied, scandir '.../pgdata'` : pas un fichier analysé, pas une règle
 * appliquée, code de sortie non nul. Le gate n'échoue donc pas sur du code — il n'existe pas.
 *
 * ⚠️ **`.gitignore` ne suffit pas, et c'est le piège.** ESLint 9 ne lit plus `.gitignore`
 * (il faudrait `includeIgnoreFile`) : `pgdata` y figure depuis toujours sans que ça change rien.
 *
 * ⚠️ **Et la CI ne peut pas attraper cette classe de défaut** : un runner GitHub n'a jamais lancé
 * `docker compose up`, donc `pgdata` n'y existe pas et `npm run lint` y passe. C'est exactement la
 * symétrie inverse de ce que `ci.yml` apporte d'habitude (un runner n'a pas de `.env`, donc il
 * attrape les fuites de configuration). Ici, seul un poste réel voit la panne.
 *
 * Les deux autres entrées sont des sorties de build, ignorées pour la même raison de principe :
 * du code généré n'a pas à être relu.
 */
export default configApp({
  ignores: ['pgdata/**', 'build/**', 'public/assets/**'],
})
