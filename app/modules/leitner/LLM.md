# Choisir et brancher un LLM local (ingestion d'un cours)

Guide d'usage de `/revision/ingest` : quel modèle charger, comment le connecter, comment vérifier
qu'il répond, et quoi faire quand ça casse.

Le code, lui, est documenté dans `CLAUDE.md` (section « L'ingestion d'un cours par un LLM local »).

---

## 1. Ce que l'application attend, et rien d'autre

Un serveur HTTP qui expose **`POST {LLM_BASE_URL}/chat/completions`** au format OpenAI. C'est le seul
contrat. LM Studio, `llama-server` (llama.cpp), vLLM, Ollama — tous conviennent, et sont
interchangeables sans toucher une ligne de code.

L'application envoie :

```jsonc
{
  "model": "<LLM_MODEL>",
  "messages": [{ "role": "system", "content": "…" }, { "role": "user", "content": "…" }],
  "temperature": 0.2,
  "response_format": { "type": "json_object" } // demandé, jamais présumé — voir plus bas
}
```

et ne lit qu'une chose dans la réponse : `choices[0].message.content`.

> **`response_format` n'est pas universel.** Un serveur qui ne le connaît pas répond `400` : le
> client réessaie alors **une fois sans lui**. Aucune configuration à faire, aucun serveur à exclure.

## 2. Les quatre variables — et pourquoi elles ne sont pas dans l'UI

Dans `.env` (documentées dans `.env.example`, défauts dans `config/llm.ts`) :

| Variable         | Défaut                      | À quoi ça sert                                        |
| ---------------- | --------------------------- | ----------------------------------------------------- |
| `LLM_BASE_URL`   | `http://127.0.0.1:1234/v1`  | Racine de l'API. **Sans** `/chat/completions` au bout. |
| `LLM_MODEL`      | `local-model`               | Nom du modèle, tel que le serveur l'expose.            |
| `LLM_API_KEY`    | *(vide)*                    | Optionnelle : un serveur local n'authentifie rien.     |
| `LLM_TIMEOUT_MS` | `120000`                    | Délai max **par appel** (donc par morceau de cours).   |

⚠️ **Ces valeurs viennent de l'environnement, et n'apparaîtront jamais dans un formulaire.** Un champ
« URL du serveur » dans l'écran de réglages serait une **SSRF** : le serveur émettrait des requêtes
HTTP vers l'hôte du choix de celui qui écrit dans ce champ (y compris une IP interne). Un changement
de serveur LLM se fait dans `.env`, suivi d'un redémarrage — c'est volontairement un geste
d'administration, pas un geste d'utilisateur.

## 3. Choisir le modèle

C'est **ici** que le résultat se joue, pas dans le code. Trois critères, dans cet ordre :

**1. Il doit rendre du JSON fiable.** Le parsing tolère la prose autour, le bloc ` ```json `, et
tente **une** réparation — mais un modèle qui ne sait pas suivre une consigne de format échouera
malgré tout. C'est le premier critère éliminatoire.

**2. Sa fenêtre de contexte doit tenir le morceau.** Un morceau de cours fait au plus **6 000
caractères** (`MAX_CHUNK_CHARS`), soit ~1 500–2 000 tokens, plus la consigne système et la réponse.
**4 096 tokens de contexte suffisent ; 8 192 sont confortables.** En dessous, le serveur tronque le
prompt en silence et le modèle « oublie » la fin du cours.

**3. Il doit synthétiser en français.** Le cours est en français, les cartes le seront aussi. Un
modèle purement anglophone répond souvent en anglais, ou traduit à moitié.

En pratique, un **instruct 7–8B quantisé (Q4_K_M ou mieux)** est le point d'équilibre :
`Qwen2.5-7B-Instruct`, `Mistral-7B-Instruct`, `Llama-3.1-8B-Instruct` tiennent le JSON et le
français. En dessous de 3B, le JSON dérive dès que le cours devient dense — l'ingestion finira en
`failed` avec « le modèle n'a pas rendu de JSON exploitable, même après réparation », ce qui est le
comportement voulu (aucune donnée douteuse en base) mais reste une perte de temps.

Un modèle plus gros donne de meilleures cartes, plus lentement : le plafond, c'est
`LLM_TIMEOUT_MS` **par morceau**. Un cours de 20 000 caractères = ~4 morceaux ; avec un modèle qui
met 60 s par morceau, la requête HTTP tient ~4 minutes — c'est le prix de l'exécution synchrone.

## 4. Brancher le serveur

### LM Studio (le plus simple)

1. Onglet **Search** → télécharge le modèle (ex. `Qwen2.5-7B-Instruct`, quantisation Q4_K_M).
2. Onglet **Developer** (ou « Local Server ») → charge le modèle, règle **Context Length** à 8192,
   puis **Start Server** (port `1234` par défaut).
3. `.env` :
   ```dotenv
   LLM_BASE_URL=http://127.0.0.1:1234/v1
   LLM_MODEL=qwen2.5-7b-instruct
   ```
   Le nom exact est celui affiché par `GET http://127.0.0.1:1234/v1/models`. LM Studio ignore souvent
   ce champ et sert le modèle chargé — mais ne parie pas dessus.

### llama.cpp (`llama-server`)

```bash
llama-server -m ./models/qwen2.5-7b-instruct-q4_k_m.gguf -c 8192 --port 8080
```

```dotenv
LLM_BASE_URL=http://127.0.0.1:8080/v1
LLM_MODEL=qwen2.5-7b-instruct
```

`-c 8192` est le point important : c'est la fenêtre de contexte (critère 2).

### vLLM

```bash
vllm serve Qwen/Qwen2.5-7B-Instruct --port 8000 --max-model-len 8192
```

```dotenv
LLM_BASE_URL=http://127.0.0.1:8000/v1
LLM_MODEL=Qwen/Qwen2.5-7B-Instruct
```

Ici `LLM_MODEL` doit être **exactement** le nom servi, sans quoi vLLM répond `404`.

### Ollama

Ollama expose une couche compatible OpenAI :

```dotenv
LLM_BASE_URL=http://127.0.0.1:11434/v1
LLM_MODEL=qwen2.5:7b
```

`LLM_MODEL` est le tag du modèle (`ollama list`).

## 5. Vérifier avant de soumettre un cours

Le serveur répond, et le nom du modèle est bon :

```bash
curl http://127.0.0.1:1234/v1/models
```

Il rend bien du JSON quand on le lui demande — c'est exactement la requête que fait l'application :

```bash
curl http://127.0.0.1:1234/v1/chat/completions \
  -H "content-type: application/json" \
  -d '{
    "model": "qwen2.5-7b-instruct",
    "temperature": 0.2,
    "response_format": {"type": "json_object"},
    "messages": [
      {"role": "system", "content": "Réponds UNIQUEMENT par {\"cards\":[{\"front\":\"…\",\"back\":\"…\"}]}"},
      {"role": "user", "content": "Le handshake TLS négocie les clés et les algorithmes."}
    ]
  }'
```

Si `choices[0].message.content` est un objet JSON avec des `cards`, le modèle est bon pour le
service. S'il te répond une phrase polie, change de modèle : le tien ne suit pas les consignes.

Puis, dans l'application : `/revision/ingest` → colle un cours → **Analyser le cours**. Relis les
brouillons, corrige-les, valide. Les cartes validées naissent en **boîte 1, dues aujourd'hui**, et
sont dédupliquées sur le couple (recto, thème) : ré-ingérer le même cours n'ajoute rien.

## 6. Quand ça casse

L'échec n'est jamais silencieux : l'ingestion passe en **Échec**, son message s'affiche sur la page,
et **aucun brouillon n'est écrit** (pas de moitié de cours en base).

| Message                                                     | Cause probable                                                                                                       |
| ----------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------- |
| « est injoignable ou n'a pas répondu en moins de N s »       | Serveur éteint, mauvais port, ou modèle trop lent → augmente `LLM_TIMEOUT_MS`, ou prends un modèle plus petit.        |
| « a répondu 404 »                                            | `LLM_BASE_URL` mal formée (il manque `/v1`, ou il y a `/chat/completions` en trop), ou `LLM_MODEL` inconnu du serveur. |
| « a répondu 400 »                                            | Nom de modèle refusé. Vérifie-le avec `GET /v1/models`.                                                               |
| « a renvoyé une réponse vide »                               | Aucun modèle chargé côté serveur (LM Studio serveur démarré, mais modèle non chargé).                                 |
| « n'a pas rendu de JSON exploitable, même après réparation » | Le modèle ne tient pas la consigne de format : il est trop petit, ou ce n'est pas une variante *instruct*.             |
| « Le cours dépasse le plafond de 20 000 caractères »         | Découpe le cours, ou soumets-le en plusieurs fois (l'asynchrone lèvera ce plafond).                                   |

Deux réglages seulement, et ils sont dans `.env` : le **modèle** et le **timeout**. Le reste
(découpage, fusion, réparation, boîte 1, déduplication) est du code, et n'a pas à être touché.
