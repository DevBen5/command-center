/*
|--------------------------------------------------------------------------
| Messages de validation (VineJS) en français
|--------------------------------------------------------------------------
|
| VineJS émet ses messages d'erreur en anglais par défaut. On installe ici un
| fournisseur de messages global pour que tous les formulaires (connexion,
| capture Veille, cartes Leitner…) affichent des erreurs en français.
|
| Source : https://vinejs.dev/docs/custom_error_messages
*/

import vine, { SimpleMessagesProvider } from '@vinejs/vine'

vine.messagesProvider = new SimpleMessagesProvider(
  {
    'required': 'Le champ {{ field }} est obligatoire.',
    'string': 'Le champ {{ field }} doit être une chaîne de caractères.',
    'email': "L'adresse e-mail est invalide.",
    'url': "L'URL est invalide.",
    'enum': 'La valeur du champ {{ field }} est invalide.',
    'minLength': 'Le champ {{ field }} doit contenir au moins {{ min }} caractères.',
    'maxLength': 'Le champ {{ field }} ne doit pas dépasser {{ max }} caractères.',
    // Messages spécifiques à un champ (clé « champ.règle »).
    'password.minLength': 'Le mot de passe est obligatoire.',
    'title.minLength': 'Le titre est obligatoire.',
    'front.minLength': 'Le recto est obligatoire.',
    'back.minLength': 'Le verso est obligatoire.',
  },
  // Noms de champs traduits, utilisés dans les messages ci-dessus ({{ field }}).
  {
    email: 'e-mail',
    password: 'mot de passe',
    title: 'titre',
    url: 'URL',
    content: 'contenu',
    type: 'type',
    front: 'recto',
    back: 'verso',
    tags: 'tags',
    grade: 'note',
  }
)
