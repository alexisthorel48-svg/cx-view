# CX View — API d'intégration entrante (v1)

Point d'entrée unique pour que **CX Commerce**, **CX One** (ou tout autre système interne CX-COM)
poussent des tâches vers CX View, sans avoir chacun à réinventer un format ou un mécanisme de
fiabilité différent. Toute tâche est authentifiée, dédupliquée (idempotence) et traitée de façon
asynchrone — l'appelant reçoit immédiatement une confirmation de prise en charge, pas une exécution
synchrone fragile.

Base URL : `https://cx-view.be`

## 1. Authentification

Chaque système appelant (CX Commerce, CX One, ...) reçoit une **clé API dédiée**, générée côté
CX View par un admin (voir §4). Elle s'envoie en en-tête standard :

```
Authorization: Bearer cxv_xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx
```

La clé n'est jamais stockée en clair côté CX View (seul son hash SHA-256 l'est) et n'est affichée
qu'une seule fois, au moment de sa création — à conserver précieusement côté appelant (coffre-fort
de secrets applicatif, pas en dur dans le code).

Une clé invalide ou désactivée renvoie `401`.

## 2. Envoyer une tâche

```
POST /api/integrations/inbound/v1/tasks
```

```json
{
  "external_task_id": "cx-commerce-order-48213",
  "type": "PING",
  "payload": { "any": "json object specific to the task type" }
}
```

- `external_task_id` **(obligatoire)** — identifiant unique côté appelant (ex. ID de commande,
  ID d'action métier). C'est la clé d'idempotence : voir §3.
- `type` **(obligatoire)** — type de tâche, en majuscules. Voir §5 pour les types actuellement
  supportés.
- `payload` — objet libre, propre à chaque type de tâche.

**Réponses :**

| Cas | HTTP | Corps |
|---|---|---|
| Tâche acceptée (nouvelle) | `202` | `{ "ok": true, "task": {...} }` |
| Tâche déjà reçue (rejouée) | `200` | `{ "ok": true, "idempotent": true, "task": {...} }` |
| Type de tâche inconnu | `202` | `{ "ok": true, "task": { "status": "FAILED", "error_message": "..." } }` |
| Champ manquant | `400` | `{ "error": "..." }` |
| Clé API invalide | `401` | `{ "error": "..." }` |

Un objet `task` a la forme :

```json
{
  "id": 42,
  "external_task_id": "cx-commerce-order-48213",
  "type": "PING",
  "status": "PENDING",
  "result": {},
  "error_message": null,
  "created_at": "2026-08-04T12:17:01.194Z",
  "updated_at": "2026-08-04T12:17:01.194Z"
}
```

`status` suit ce cycle : `PENDING` → `PROCESSING` → `DONE` ou `FAILED`. Un échec transitoire est
retenté automatiquement (jusqu'à 3 tentatives) avant de passer en `FAILED` définitif.

## 3. Idempotence

Si le même `external_task_id` est envoyé plusieurs fois par le **même client**, CX View ne crée
**jamais** de deuxième tâche : la réponse (`200`, `idempotent: true`) renvoie l'état de la tâche
existante, quel que soit son statut. C'est pensé pour absorber sans risque les retries réseau ou
les doubles clics/doubles envois côté CX Commerce / CX One — aucune diffusion ne sera dupliquée.

L'unicité est garantie par contrainte en base (`client_id` + `external_task_id`), pas seulement
côté application — même deux requêtes strictement simultanées ne créeront pas deux tâches.

## 4. Consulter le statut d'une tâche

```
GET /api/integrations/inbound/v1/tasks/:id
```

Renvoie le même objet `task` que ci-dessus. `404` si la tâche n'appartient pas au client
authentifié.

À utiliser en polling léger (ex. toutes les 5-10s) si l'appelant a besoin de connaître le résultat
d'une tâche après l'avoir soumise — le traitement étant asynchrone, le résultat n'est pas
disponible immédiatement dans la réponse du `POST`.

## 5. Types de tâches supportés

| Type | Statut | Description |
|---|---|---|
| `PING` | ✅ Actif | Test de connectivité/aller-retour. Renvoie `{ pong: true, echoed: <payload> }`. |
| *(à définir)* | 🕗 À venir | Les types métier réels (ex. attribution d'une playlist/visuel à un écran suite à une commande) seront ajoutés une fois le format exact convenu avec les équipes CX Commerce / CX One. |

Envoyer un `type` non enregistré ne plante rien : la tâche est créée en base avec le statut
`FAILED` et un message d'erreur explicite, immédiatement visible via `GET /tasks/:id`.

## 6. Gestion des clés API (côté admin CX View)

Réservé aux comptes `ADMIN`/`SUPER_ADMIN`, via l'admin web CX View (session existante) :

- `GET /api/v2/integrations/inbound/clients` — liste des clients (sans les clés).
- `POST /api/v2/integrations/inbound/clients` — `{ "name": "CX Commerce" }` → crée un client et
  renvoie la clé **une seule fois** dans la réponse (`api_key`). Si elle est perdue, il faut créer
  un nouveau client (pas de "régénération" pour l'instant).
- `POST /api/v2/integrations/inbound/clients/:id/revoke` — désactive une clé immédiatement.

## 7. Prochaines étapes

Cette API pose la fondation (authentification, idempotence, file asynchrone) demandée pour que CX
View puisse recevoir des tâches de CX Commerce et CX One sans traitement synchrone fragile. Reste
à définir **avec ces équipes** le ou les types de tâches métier réels et leur `payload` exact (ex.
attribution de playlist, poussée d'un visuel côté médiathèque) avant d'ajouter leurs handlers dans
`modules/cx_view_integrations_inbound_v1.js` (registre `HANDLERS`).
