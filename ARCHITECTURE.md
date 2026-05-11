# RotmaniApp — Documentation Technique Complète

> Document de prise en main manuelle du projet : logique, code, flux de paiement.

---

## Table des matières

1. [Vue d'ensemble](#1-vue-densemble)
2. [Stack technique](#2-stack-technique)
3. [Structure des dossiers](#3-structure-des-dossiers)
4. [Variables d'environnement](#4-variables-denvironnement)
5. [Base de données (Supabase)](#5-base-de-données-supabase)
6. [Routes API — détail complet](#6-routes-api--détail-complet)
7. [Bibliothèques internes (lib/)](#7-bibliothèques-internes-lib)
8. [Composants frontend](#8-composants-frontend)
9. [Flux de paiement complets](#9-flux-de-paiement-complets)
10. [Gestion des erreurs](#10-gestion-des-erreurs)
11. [Internationalisation](#11-internationalisation)
12. [Sécurité & conformité PCI](#12-sécurité--conformité-pci)
13. [Décisions d'architecture importantes](#13-décisions-darchitecture-importantes)
14. [Guide de prise en main manuelle](#14-guide-de-prise-en-main-manuelle)

---

## 1. Vue d'ensemble

**RotmaniApp** est une application de checkout (paiement) sur mesure, intégrée à Shopify, qui remplace le checkout natif de Shopify. Elle est construite en Next.js (App Router) et permet à un marchand d'accepter des paiements via la passerelle israélienne **Tranzila**.

### Ce que fait l'application

- Reçoit un panier depuis Shopify (ou via un lien de démo).
- Affiche un formulaire de paiement personnalisé (design maîtrisé, non celui de Shopify).
- Traite les paiements via Tranzila (carte bancaire + 3D Secure, Bit — paiement mobile israélien).
- Supporte les cartes cadeaux (validation, débit, génération et envoi par email).
- Crée la commande Shopify une fois le paiement confirmé.
- Envoie les emails de confirmation (commande + cartes cadeaux) via Resend.

### Qui appelle quoi ?

```
Shopify (boutique) 
    → crée une session de paiement via POST /api/checkout/session
    → redirige le client vers /checkout/[sessionId]

Client (navigateur)
    → remplit le formulaire client + paiement
    → appelle POST /api/checkout/charge
    → SDK Tranzila gère les Hosted Fields (iframe sécurisé)
    → le navigateur est redirigé vers /api/checkout/callback (ou 3ds/bit variants)

Backend (callbacks)
    → crée la commande Shopify
    → débite la carte cadeau
    → génère les cartes cadeaux achetées
    → envoie les emails
    → met à jour la session en base → statut 'paid'
```

---

## 2. Stack technique

| Couche | Technologie | Version |
|---|---|---|
| Framework | Next.js (App Router) | 16.2.0 |
| Langage | TypeScript | 5.7.3 |
| UI | React | 19 |
| Style | Tailwind CSS v4 | 4.2.0 |
| Composants | Radix UI + Shadcn/UI | — |
| Base de données | Supabase (PostgreSQL) | 2.101.1 |
| Paiement | Tranzila (API REST custom) | — |
| E-commerce | Shopify Admin API | 2024-04 |
| Email | Resend + React Email | 6.10.0 |
| Formulaires | React Hook Form + Zod | 7.54.1 / 3.24.1 |
| Analytics | Vercel Analytics | 1.6.1 |
| Hébergement | Vercel | — |

---

## 3. Structure des dossiers

```
rotmaniApp/
│
├── app/                          # Next.js App Router
│   ├── api/
│   │   ├── checkout/
│   │   │   ├── session/          # Créer / récupérer une session de paiement
│   │   │   │   └── reset/        # Réinitialiser une session pour retry
│   │   │   ├── charge/           # Initier le paiement (cœur de la logique)
│   │   │   ├── handshake/        # Générer un token Tranzila (thtk)
│   │   │   ├── callback/         # Retour Tranzila après paiement CB
│   │   │   ├── 3ds-callback/     # Retour banque après challenge 3DS
│   │   │   ├── 3ds-complete/     # Complétion manuelle 3DS (appelé par le front)
│   │   │   ├── bit-callback/
│   │   │   │   └── [status]/     # Retour Bit (success / failure / notify)
│   │   │   ├── gift-card/        # Valider un code de carte cadeau
│   │   │   └── test-shopify/     # Endpoint de test Shopify (stub)
│   │   └── test-tranzila/        # Endpoint de test Tranzila
│   │
│   ├── checkout/
│   │   ├── [sessionId]/          # Page principale du checkout (client)
│   │   ├── success/              # Page de confirmation de paiement
│   │   └── error/                # Page d'erreur de paiement
│   │
│   ├── page.tsx                  # Page d'accueil / démo
│   └── layout.tsx                # Layout racine avec contexte de langue
│
├── components/
│   ├── checkout/
│   │   ├── payment-form.tsx      # Formulaire paiement + logique SDK Tranzila
│   │   ├── customer-form.tsx     # Informations client (nom, adresse, etc.)
│   │   ├── gift-card-form.tsx    # Saisie et application de carte cadeau
│   │   ├── order-summary.tsx     # Résumé du panier
│   │   ├── checkout-header.tsx   # En-tête
│   │   └── checkout-footer.tsx   # Pied de page (liens légaux)
│   ├── emails/
│   │   ├── order-confirmation-email.tsx  # Email confirmation commande
│   │   ├── gift-card-email.tsx           # Email carte cadeau → destinataire
│   │   └── gift-card-buyer-email.tsx     # Email carte cadeau → acheteur
│   └── ui/                       # Composants UI génériques (Shadcn/Radix)
│
├── lib/
│   ├── tranzila.ts               # Client SDK Tranzila (charge, 3DS, Bit, handshake)
│   ├── shopify.ts                # Création de commandes Shopify
│   ├── gift-cards.ts             # Logique cartes cadeaux (créer, valider, débiter)
│   ├── email.ts                  # Envoi d'emails (Resend)
│   ├── types.ts                  # Types TypeScript globaux
│   ├── translations.ts           # Traductions (hébreu / anglais)
│   ├── language-context.tsx      # Context React pour la langue
│   ├── terms.ts                  # Textes conditions générales
│   ├── utils.ts                  # Helpers (cn() pour Tailwind)
│   └── supabase/
│       ├── server.ts             # Client Supabase côté serveur
│       └── client.ts             # Client Supabase côté client
│
├── public/                       # Images, logos
├── scripts/                      # Scripts utilitaires
├── .env.local                    # Variables d'environnement (non versionné)
├── .env.example                  # Template des variables
├── next.config.mjs               # Config Next.js
├── tailwind.config.mjs           # Config Tailwind
├── tsconfig.json                 # Config TypeScript
└── package.json                  # Dépendances
```

---

## 4. Variables d'environnement

Fichier : `.env.local` (à créer à partir de `.env.example`)

```bash
# ─── Tranzila ───────────────────────────────────────────
TRANZILA_TERMINAL=fxprotmina                # Nom du terminal marchand
NEXT_PUBLIC_TRANZILA_TERMINAL=fxprotmina    # Idem, exposé au frontend
NEXT_PUBLIC_TRANZILA_TEST_MODE=true         # true = mode test, false = production
TRANZILA_TERMINAL_PASSWORD=xxx             # Mot de passe terminal (pour handshake)
TRANZILA_APP_KEY=xxx                       # Clé API (pour charges directes)
TRANZILA_SECRET=xxx                        # Secret HMAC

# ─── Shopify ────────────────────────────────────────────
SHOPIFY_STORE_DOMAIN=rotmina-israel.myshopify.com
SHOPIFY_ACCESS_TOKEN=shpat_xxx             # Token Admin Shopify
SHOPIFY_API_VERSION=2024-04

# ─── Supabase ───────────────────────────────────────────
NEXT_PUBLIC_SUPABASE_URL=https://xxx.supabase.co
NEXT_PUBLIC_SUPABASE_ANON_KEY=xxx
SUPABASE_SERVICE_ROLE_KEY=xxx              # Clé service (accès complet, non exposée)

# ─── Email ──────────────────────────────────────────────
RESEND_API_KEY=re_xxx
FROM_EMAIL=noreply@votredomaine.com

# ─── App ────────────────────────────────────────────────
NEXT_PUBLIC_APP_URL=https://votreapp.vercel.app

# ─── Cartes cadeaux (optionnel) ─────────────────────────
GIFT_CARD_PRODUCT_ID=123456789             # ID produit Shopify carte cadeau
GIFT_CARD_PRODUCT_HANDLE=gift-card         # Handle Shopify carte cadeau
```

> **Important :** `SUPABASE_SERVICE_ROLE_KEY` et `TRANZILA_APP_KEY` ne doivent jamais être exposés côté client (pas de préfixe `NEXT_PUBLIC_`).

---

## 5. Base de données (Supabase)

### Table : `payment_sessions`

C'est la table centrale qui suit le cycle de vie complet d'un paiement.

```sql
CREATE TABLE payment_sessions (
  id                     UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  shop                   TEXT NOT NULL,               -- ex: "rotmina-israel.myshopify.com"
  idempotency_key        TEXT NOT NULL UNIQUE,         -- Prévient les doubles charges
  cart                   JSONB NOT NULL,               -- Panier complet (items, prix)
  customer               JSONB,                        -- Infos client (null jusqu'à saisie)
  status                 TEXT NOT NULL DEFAULT 'pending',
  -- Valeurs possibles : pending | processing | pending_3ds | pending_bit | paid | failed
  amount                 NUMERIC NOT NULL,             -- Montant total en ILS
  currency               TEXT NOT NULL DEFAULT 'ILS',
  draft_order_id         TEXT,                         -- ID brouillon Shopify (si utilisé)
  order_id               TEXT,                         -- ID commande Shopify créée
  tranzila_transaction_id TEXT,                        -- ID transaction Tranzila
  raw_response           JSONB,                        -- Réponse brute Tranzila + métadonnées
  error_message          TEXT,                         -- Message d'erreur (si failed)
  created_at             TIMESTAMPTZ DEFAULT now(),
  updated_at             TIMESTAMPTZ DEFAULT now()
);
```

### Table : `gift_cards`

```sql
CREATE TABLE gift_cards (
  id                     UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  code                   TEXT NOT NULL UNIQUE,         -- Format : ROTM-XXXX-XXXX-X
  original_amount        NUMERIC NOT NULL,
  balance                NUMERIC NOT NULL,             -- Solde restant
  currency               TEXT NOT NULL DEFAULT 'ILS',
  status                 TEXT NOT NULL DEFAULT 'active',
  -- Valeurs : active | depleted | disabled
  purchased_session_id   UUID REFERENCES payment_sessions(id),
  purchased_order_id     TEXT,                         -- ID commande Shopify d'achat
  buyer_email            TEXT,
  recipient_name         TEXT,
  recipient_email        TEXT,
  sender_name            TEXT,
  sender_email           TEXT,
  personal_message       TEXT,
  email_sent             BOOLEAN DEFAULT false,
  last_used_at           TIMESTAMPTZ,
  created_at             TIMESTAMPTZ DEFAULT now(),
  updated_at             TIMESTAMPTZ DEFAULT now()
);
```

### Statuts de session — transitions

```
[Création] → pending
[POST /charge démarre] → processing       (verrou anti-concurrence)
[3DS en attente] → pending_3ds
[Bit en attente] → pending_bit
[Succès confirmé] → paid
[Échec / refus] → failed
```

---

## 6. Routes API — détail complet

### `POST /api/checkout/session`

**Fichier :** `app/api/checkout/session/route.ts`

**Rôle :** Créer une nouvelle session de paiement (appelé par Shopify ou la démo).

**Corps de la requête :**
```json
{
  "shop": "rotmina-israel.myshopify.com",
  "idempotencyKey": "cart_abc123",
  "cart": {
    "items": [...],
    "subtotal": 100,
    "shipping": 0,
    "tax": 17,
    "total": 117,
    "currency": "ILS"
  }
}
```

**Logique :**
1. Vérifie les CORS (origines autorisées).
2. Si `idempotencyKey` existe déjà en base → retourne la session existante (idem potence).
3. Convertit les devises étrangères (USD/EUR/GBP → ILS) si nécessaire.
4. Gère les prix Shopify en centimes (divise par 100 si `total > 10000` présumé en centimes).
5. Insère la session en base avec statut `pending`.
6. Retourne `{ sessionId }`.

**Réponse :**
```json
{ "sessionId": "uuid-de-la-session" }
```

---

### `GET /api/checkout/session?id=<sessionId>`

**Rôle :** Récupérer une session existante (appelé par le frontend au chargement).

**Réponse :** Objet `PaymentSession` complet.

---

### `POST /api/checkout/session/reset`

**Fichier :** `app/api/checkout/session/reset/route.ts`

**Rôle :** Remettre une session en état `pending` pour permettre un retry.

**Corps :**
```json
{ "sessionId": "uuid" }
```

**Logique :**
- Autorisé uniquement si statut actuel est `processing`, `pending_3ds`, ou `pending_bit`.
- Interdit si la session est déjà `paid` ou `failed` de façon définitive.
- Efface `error_message`.
- Remet le statut à `pending`.

**Réponse :**
```json
{ "reset": true, "reason": "reset from processing" }
```

---

### `POST /api/checkout/charge` ⭐ Route principale

**Fichier :** `app/api/checkout/charge/route.ts` (~850 lignes)

**Rôle :** Cœur de la logique de paiement. Initie la transaction selon la méthode choisie.

**Corps de la requête :**
```json
{
  "sessionId": "uuid",
  "customer": {
    "email": "client@example.com",
    "firstName": "Jean",
    "lastName": "Dupont",
    "address": "123 Rue de la Paix",
    "city": "Paris",
    "postalCode": "75001",
    "country": "FR",
    "phone": "0612345678"
  },
  "paymentMethod": "card",        // "card" ou "bit"
  "cardNumber": "4111...",        // Si paiement direct (rare, Hosted Fields préféré)
  "giftCardCode": "ROTM-XXXX-XXXX-X",   // Optionnel
  "giftCardAmount": 50            // Optionnel
}
```

**Logique étape par étape :**

```
1. Récupérer la session depuis Supabase
   └─ Erreur si non trouvée ou déjà paid/failed

2. Passer le statut à 'processing' (verrou)

3. Mettre à jour customer dans la session

4. Calculer le montant à facturer
   └─ Si carte cadeau : amount = session.amount - giftCardAmount
   └─ Si carte cadeau couvre tout : amount = 0

5. Routing selon le montant et la méthode
   ├─ amount = 0 (carte cadeau couvre tout)
   │   └─ Marquer comme 'paid' directement
   │   └─ Débiter la carte cadeau
   │   └─ Créer commande Shopify
   │   └─ Envoyer emails
   │   └─ Retourner { success: true }
   │
   ├─ Carte test détectée (5430050220380520 en non-prod)
   │   └─ Même logique que ci-dessus
   │
   ├─ paymentMethod = 'card' (Hosted Fields)
   │   └─ Appeler tranzila.getHandshakeToken(amount)
   │   └─ Retourner { requiresHostedFields: true, thtk, terminal, chargeAmount, callbackUrl }
   │   └─ Le SDK front prend le relais
   │
   └─ paymentMethod = 'bit'
       ├─ Si password Tranzila configuré → Hosted Fields
       │   └─ Retourner { requiresHostedFields: true, thtk, ... }
       └─ Sinon → API REST Bit
           └─ Appeler tranzila.initBit({ success_url, fail_url, notify_url, ... })
           └─ Retourner { redirectUrl } ou { requiresHostedFields: true, ... }
```

**Réponse typique (Hosted Fields CB) :**
```json
{
  "success": false,
  "requiresHostedFields": true,
  "thtk": "token_tranzila",
  "terminal": "fxprotmina",
  "chargeAmount": 468.46,
  "currency": "1",
  "callbackUrl": "https://app.vercel.app/api/checkout/callback",
  "sessionId": "uuid",
  "paymentMethod": "card"
}
```

**Réponse si paiement immédiat (carte cadeau totale, carte test) :**
```json
{
  "success": true,
  "confirmationCode": "123456",
  "shopifyOrderUrl": "https://admin.shopify.com/...",
  "generatedGiftCards": [...],
  "giftCardRemainingBalance": 0
}
```

---

### `GET /api/checkout/handshake`

**Fichier :** `app/api/checkout/handshake/route.ts`

**Rôle :** Générer un token Tranzila frais à la demande.

**Paramètres :** `?amount=468.46&currency=ILS`

**Réponse :**
```json
{ "thtk": "token_tranzila_frais", "terminal": "fxprotmina" }
```

---

### `POST /api/checkout/callback`

**Fichier :** `app/api/checkout/callback/route.ts` (~258 lignes)

**Rôle :** Callback Tranzila après paiement CB (Hosted Fields). Reçoit la confirmation de la passerelle.

**Supporte GET et POST** (Tranzila peut utiliser l'un ou l'autre).

**Paramètres reçus (form-data ou query params) :**
```
Response=000              # Code réponse (000 = succès)
index=session_uuid        # ID de session (si passé via merchant_data)
ConfirmationCode=123456   # Code de confirmation
merchant_data=session_uuid
```

**Logique :**
1. Extraire `sessionId` depuis `merchant_data` ou `index`.
2. Si réponse = `000` → succès.
3. Idempotence : si session déjà `paid` avec `order_id`, retourner succès sans rien refaire.
4. Créer la commande Shopify (si pas encore créée).
5. Envoyer l'email de confirmation.
6. Mettre à jour session → `paid`.
7. Générer les cartes cadeaux (si commande contient des produits cartes cadeaux).
8. Retourner une page HTML avec un script JavaScript `postMessage` vers la fenêtre parente.

**Page HTML retournée :**
```html
<html>
  <script>
    // Brise le contexte iframe/popup et redirige la fenêtre parente
    if (window.opener) {
      window.opener.postMessage({ type: '3DS_COMPLETE', success: true, url: '/checkout/success?...' }, '*');
      window.close();
    } else {
      window.location.href = '/checkout/success?session=...';
    }
  </script>
</html>
```

---

### `GET|POST /api/checkout/3ds-callback`

**Fichier :** `app/api/checkout/3ds-callback/route.ts` (~283 lignes)

**Rôle :** Callback reçu de la banque (ACS) après le challenge 3D Secure.

**Paramètres :**
```
track_id=xxxx             # ID de transaction Tranzila
merchant_data=session_uuid
```

**Logique :**
1. Valider que `merchant_data` correspond à la session.
2. Appeler `tranzila.complete3DS(trackId)` pour finaliser la transaction côté Tranzila.
3. Si succès (`processor_response_code === '000'`) :
   - Débiter la carte cadeau (si utilisée).
   - Générer les cartes cadeaux achetées.
   - Créer la commande Shopify.
   - Envoyer les emails.
   - Mettre session → `paid`.
4. Si échec → session → `failed` + `error_message`.
5. Retourner page HTML avec `postMessage` breakout.

---

### `POST /api/checkout/3ds-complete`

**Fichier :** `app/api/checkout/3ds-complete/route.ts` (~264 lignes)

**Rôle :** Appelé par le frontend quand il détecte manuellement que le 3DS est terminé (polling, realtime).

**Corps :**
```json
{ "sessionId": "uuid", "trackId": "xxxx" }
```

**Logique :** Identique à `3ds-callback`, mais déclenché côté frontend.

**Cas spéciaux :**
- Si session déjà `paid` → retourner succès immédiatement (idempotence).
- Si Tranzila répond `pending` → retourner `{ pending: true }` (retry).

**Réponse succès :**
```json
{
  "success": true,
  "confirmationCode": "123456",
  "shopifyOrderUrl": "https://...",
  "generatedGiftCards": [...],
  "giftCardRemainingBalance": 0
}
```

---

### `GET|POST /api/checkout/bit-callback/[status]`

**Fichier :** `app/api/checkout/bit-callback/[status]/route.ts` (~353 lignes)

**Rôle :** Callbacks de paiement Bit. Le paramètre `[status]` est dynamique.

**Routes actives :**
- `/bit-callback/success` — Client a payé dans l'app Bit.
- `/bit-callback/failure` — Client a annulé.
- `/bit-callback/cancel` — Client a annulé.
- `/bit-callback/notify` — Webhook serveur-à-serveur de Tranzila (confirmation définitive).

**Logique par statut :**

| Statut | Action |
|---|---|
| `success` | Idempotence → débit carte cadeau → commande Shopify → email → session `paid` |
| `notify` | Même logique (webhook de confirmation) — toujours retourne 200 |
| `failure` | Session → `failed` + message d'erreur |
| `cancel` | Session → `failed` + "Payment cancelled" |

---

### `POST /api/checkout/gift-card`

**Fichier :** `app/api/checkout/gift-card/route.ts`

**Rôle :** Valider un code de carte cadeau saisi par le client.

**Corps :**
```json
{ "code": "ROTM-ABCD-EFGH-1" }
```

**Logique :**
1. Normaliser le code (uppercase, trim).
2. Chercher dans la table `gift_cards`.
3. Vérifier : `status = 'active'`, `balance > 0`.
4. Retourner les infos.

**Réponse succès :**
```json
{ "id": "uuid", "code": "ROTM-ABCD-EFGH-1", "balance": 150, "currency": "ILS" }
```

**Réponse erreur :**
```json
{ "error": "Gift card not found" }   // 404
{ "error": "Gift card has no remaining balance" }  // 400
```

---

## 7. Bibliothèques internes (lib/)

### `lib/tranzila.ts` — Client Tranzila

**Classe :** `TranzilaClient`

#### `getHandshakeToken(sum?, currency?): Promise<string | null>`
- Génère un token `thtk` pour initier les Hosted Fields.
- Requiert `TRANZILA_TERMINAL_PASSWORD`.
- Endpoint : `POST https://api.tranzila.com/v1/handshake/create`
- Retourne le `thtk` ou `null` si password non configuré.

#### `charge(params): Promise<TranzilaResponse>`
- Charge directe via API (rarement utilisée — les Hosted Fields sont préférés).
- Authentification HMAC-SHA256 avec `TRANZILA_APP_KEY` + `TRANZILA_SECRET`.

#### `complete3DS(trackId): Promise<TranzilaResponse>`
- Finalise une transaction 3DS après le challenge.
- Endpoint : `POST https://api.tranzila.com/v1/transaction/credit_card/3ds/complete`
- Paramètres : `{ terminal_name, track_id }`

#### `initBit(params): Promise<any>`
- Initialise un paiement Bit.
- Endpoint : `POST https://api.tranzila.com/v1/transaction/bit/init`
- Paramètres : `{ terminal_name, sum, currency, success_url, fail_url, notify_url, merchant_data }`
- Retourne : objet avec `url`, `redirect_url`, `bit_url`, `deep_link`

#### `static isSuccess(response): boolean`
Logique multi-niveaux :
```
1. response.error_code === 0 ?
2. response.transaction_result.processor_response_code === '000' ?
3. response.Response === '000' ? (legacy)
4. response.success === true ?
5. Présence d'un ConfirmationCode ?
```

#### `static getErrorMessage(response): string`
Mappe les codes d'erreur Tranzila en messages lisibles :
- `051` → "Insufficient funds" (fonds insuffisants)
- `054` → "Expired card" (carte expirée)
- `001-010` → Problèmes émetteur
- `033` → Problème de devise
- etc.

---

### `lib/shopify.ts` — Création de commandes

#### `createShopifyOrder(params): Promise<any>`

**Entrée :**
```typescript
{
  session: PaymentSession,   // Session de paiement avec panier
  customer: CustomerInfo,    // Infos client
  transactionId?: string,    // ID transaction Tranzila
  giftCard?: GiftCardInfo    // Carte cadeau utilisée (si applicable)
}
```

**Logique :**
1. Parser les `variant_id` (format numérique ou GID Shopify).
2. Construire le tableau `transactions` :
   - Si carte cadeau utilisée → 2 transactions (GC + CB).
   - Sinon → 1 transaction (CB).
3. Construire les `line_items` depuis `session.cart.items`.
4. Définir `financial_status: 'paid'` (commande déjà payée).
5. Ajouter les adresses, tags (`Custom Checkout, Tranzila`), notes.
6. Appel : `POST https://{SHOPIFY_STORE_DOMAIN}/admin/api/2024-04/orders.json`
7. Retourner l'objet commande Shopify (avec `id`, `name`, `order_status_url`).

---

### `lib/gift-cards.ts` — Système cartes cadeaux

#### `isGiftCardProduct(item: CartItem): boolean`
Détecte un produit carte cadeau par :
- Correspondance avec `GIFT_CARD_PRODUCT_ID` (env var).
- Correspondance avec `GIFT_CARD_PRODUCT_HANDLE` (env var).
- Mots-clés dans le titre : `"gift card"`, `"carte cadeau"`, `"גיפט קארד"`, `"כרטיס מתנה"`.

#### `createGiftCard(params): Promise<GiftCardRecord>`
- Génère un code unique format `ROTM-XXXX-XXXX-X`.
- Retry jusqu'à 10 fois en cas de collision.
- Insère en base avec statut `active`.

#### `validateGiftCard(code): Promise<GiftCardRecord | null>`
- Normalise le code (uppercase).
- Retourne l'enregistrement ou `null`.

#### `debitGiftCard(params): Promise<GiftCardRecord>`
- Récupère le solde actuel.
- Décrémente du montant (plafonné au solde disponible).
- Passe à `depleted` si solde ≤ 0.
- Met à jour `last_used_at`.

#### `generateGiftCardsForOrder(params): Promise<GiftCardRecord[]>`
- Filtre les items du panier qui sont des cartes cadeaux.
- Pour chaque carte (× quantité) :
  - Crée une carte cadeau (montant = prix de l'item).
  - Extrait les propriétés : `recipient_name`, `recipient_email`, `sender_name`, `personal_message`.
  - Envoie un email au destinataire (si `recipient_email` fourni).
  - Envoie un email à l'acheteur (si `sender_email` ou `buyer_email` fourni).
  - Marque `email_sent = true`.

---

### `lib/email.ts` — Envoi d'emails

**Service :** Resend

Toutes les fonctions sont **non-bloquantes** : un échec d'envoi est logué mais ne plante pas le paiement.

#### `sendOrderConfirmationEmail(params)`
- **À :** email client
- **Sujet :** `Order Confirmation #1234 🛍️`
- **Template :** `OrderConfirmationEmail`
- **Contenu :** items, sous-total, livraison, taxes, total, lien commande

#### `sendGiftCardEmailToRecipient(params)`
- **À :** `recipient_email`
- **Sujet :** `You received a Gift Card from {sender_name}! 🎁`
- **Template :** `GiftCardEmail`
- **Contenu :** code, montant, message personnel

#### `sendGiftCardEmailToBuyer(params)`
- **À :** `buyer_email`
- **Sujet :** `Your Gift Card Purchase Confirmation`
- **Template :** `GiftCardBuyerEmail`
- **Contenu :** code, nom du destinataire, montant

---

### `lib/types.ts` — Types TypeScript

```typescript
// Panier
interface CartItem {
  id: string
  title: string
  quantity: number
  price: number           // En ILS
  image?: string
  variant?: string
  sku?: string
  variant_id?: string | number
  product_id?: string | number
  handle?: string
  properties?: Record<string, string>   // Ex: { recipient_email: "...", personal_message: "..." }
}

interface CartData {
  items: CartItem[]
  subtotal: number
  shipping: number
  tax: number
  total: number
  currency: string
}

// Client
interface CustomerInfo {
  email: string
  firstName: string
  lastName: string
  address: string
  city: string
  postalCode: string
  country: string
  phone: string
}

// Session de paiement
interface PaymentSession {
  id: string
  shop: string
  idempotency_key: string
  cart: CartData
  customer: CustomerInfo | null
  status: 'pending' | 'processing' | 'paid' | 'failed' | 'expired' | 'pending_3ds' | 'pending_bit'
  amount: number
  currency: string
  draft_order_id: string | null
  order_id: string | null
  tranzila_transaction_id: string | null
  raw_response: Record<string, unknown> | null
  error_message: string | null
  created_at: string
  updated_at: string
}

// Carte cadeau appliquée au panier
interface GiftCardInfo {
  id: string
  code: string
  balance: number
  currency: string
  appliedAmount: number
}
```

---

## 8. Composants frontend

### `components/checkout/payment-form.tsx` (~500 lignes)

**Composant le plus complexe du projet.** Gère toute la logique d'interaction avec le SDK Tranzila.

**État interne (refs, pas state) :**
- `hostedFieldsRef` — Instance SDK Tranzila (ref pour éviter les re-renders).
- `is3DSActiveRef` — Verrou : 3DS en cours.
- `cancelledRef` — Verrou : paiement annulé.
- `channelRef` — Canal Supabase Realtime.
- `pollIntervalRef` — Intervalle de polling de session.
- `messageHandlerRef` — Écouteur PostMessage.
- `popupRef` — Référence à la popup 3DS.

**Fonctions clés :**

```
initTranzila()
  → Charge le script SDK Tranzila depuis gateway.tranzila.com
  → window.TzlaHostedFields.create({ terminal, fields: [...], styles: {...} })
  → Attache les Hosted Fields aux divs #card-number, #expiry, #cvv

handlePayment()
  → POST /api/checkout/charge
  → Reçoit { requiresHostedFields, thtk, chargeAmount, callbackUrl }
  → Appelle hostedFields.charge(thtk, { sum, currency, installments, ... })
  → Le SDK ouvre la popup 3DS automatiquement

handleBitPayment()
  → POST /api/checkout/charge avec paymentMethod: 'bit'
  → Appelle hostedFields.chargeBit(thtk, { sum, currency, ... })
  → Le SDK ouvre la popup de QR Bit

startRealtimeSubscription(sessionId)
  → Supabase realtime : écoute les changements sur payment_sessions
  → Si status === 'paid' → onSuccess()
  → Si status === 'failed' → onError()

startSessionPolling(sessionId)
  → GET /api/checkout/session?id=...  toutes les 5 secondes
  → Fallback si le realtime échoue

messageHandler (window.addEventListener 'message')
  → Écoute les postMessages depuis la popup/iframe callback
  → type '3DS_COMPLETE' → ferme la popup, redirige
  → type 'PAYMENT_SUCCESS' / 'PAYMENT_ERROR' → traite le résultat
```

---

### `components/checkout/customer-form.tsx`

Formulaire d'informations client (étape 1 du checkout).

**Champs :** Email, Prénom, Nom, Adresse, Ville, Code postal, Pays (dropdown), Téléphone.

**Validation :**
- Email : format email obligatoire.
- Code postal : validation par pays (Israël : 5-7 chiffres, UK, US...).
- Téléphone : 9-15 chiffres.
- Tous les champs sont obligatoires.

---

### `components/checkout/gift-card-form.tsx`

**Fonctionnement :**
1. Client saisit son code → bouton "Apply".
2. `POST /api/checkout/gift-card { code }`.
3. Si valide → affiche le code + solde disponible.
4. Le montant est soustrait du total dans `OrderSummary`.
5. Bouton "Remove" pour retirer la carte.
6. Avertissement : la carte cadeau est débitée intégralement, sans mensualités.

---

### `components/checkout/order-summary.tsx`

Affiche :
- Items du panier (image, titre, quantité, prix).
- Sous-total, livraison (gratuite), taxe.
- Remise carte cadeau (si appliquée).
- **Total** (gras, mis en évidence).
- Collapsible sur mobile.

---

### Pages

#### `/app/checkout/[sessionId]/page.tsx`

Page principale du checkout (composant client `"use client"`).

**3 étapes :**
```
Étape 1 : CustomerForm     → saisie des infos client
Étape 2 : PaymentForm      → paiement (+ GiftCardForm + OrderSummary)
Étape 3 : Processing       → loader pendant la confirmation
```

Au chargement : `GET /api/checkout/session?id=...` pour récupérer les infos du panier.

#### `/app/checkout/success/page.tsx`

Affiche :
- Checkmark vert + "Payment Successful".
- Code de confirmation Tranzila.
- Infos carte cadeau utilisée (si applicable).
- Cartes cadeaux générées (avec bouton copier le code).
- Avertissement de sauvegarder les codes.

#### `/app/checkout/error/page.tsx`

Affiche :
- Icône rouge X + "Payment Failed".
- Message d'erreur.
- Bouton "Try Again" → retour à `/checkout/[sessionId]`.

---

## 9. Flux de paiement complets

### Flux 1 : Paiement carte bancaire avec 3DS

```
1. Shopify → POST /api/checkout/session
   └─ Retourne : { sessionId }

2. Navigateur → /checkout/[sessionId]
   └─ GET /api/checkout/session → chargement du panier

3. Client remplit le formulaire client (CustomerForm)

4. Client clique "Payer"
   └─ POST /api/checkout/charge
      └─ Backend : statut session → 'processing'
      └─ Backend : GET handshake token Tranzila
      └─ Retourne : { requiresHostedFields: true, thtk, chargeAmount, callbackUrl }

5. Frontend charge le SDK Tranzila
   └─ <script src="https://gateway.tranzila.com/hostedfields/TzlaHostedFields.js">
   └─ TzlaHostedFields.create() → inject les iframes dans les divs de saisie CB

6. SDK : hostedFields.charge(thtk, { sum, currency, installments, callbackUrl })
   └─ Tranzila traite la carte
   └─ Si 3DS requis : ouvre popup bancaire (URL ACS de la banque)

7. Client complète le challenge 3DS dans la popup

8. Banque redirige vers /api/checkout/3ds-callback?track_id=...&merchant_data=sessionId
   └─ Backend : tranzila.complete3DS(trackId)
   └─ Si succès (code 000) :
      ├─ Débit carte cadeau (si utilisée)
      ├─ createShopifyOrder(...)
      ├─ sendOrderConfirmationEmail(...)
      ├─ generateGiftCardsForOrder(...)  (si items GC dans le panier)
      └─ session.status → 'paid'

9. Page callback → postMessage vers fenêtre parente :
   { type: '3DS_COMPLETE', success: true, url: '/checkout/success?...' }

10. Frontend reçoit le message → ferme popup → redirige vers /checkout/success
```

---

### Flux 2 : Paiement Bit (paiement mobile israélien)

```
1-3. Identique au flux CB

4. Client sélectionne "Pay with Bit" → clique "Payer"
   └─ POST /api/checkout/charge { paymentMethod: 'bit' }
   └─ Backend : GET handshake token Tranzila
   └─ Retourne : { requiresHostedFields: true, thtk, ... }

5. Frontend : hostedFields.chargeBit(thtk, { sum, currency, ... })
   └─ SDK Tranzila ouvre un modal en plein écran avec un QR code

6. Client scanne le QR dans l'app Bit → confirme le paiement

7. Tranzila redirige le navigateur vers :
   └─ /api/checkout/bit-callback/success  (si paiement confirmé)
   └─ /api/checkout/bit-callback/failure  (si annulé)

8. Tranzila envoie aussi un webhook serveur-à-serveur :
   └─ POST /api/checkout/bit-callback/notify (confirmation définitive)

9. Backend (bit-callback/success ou notify) :
   ├─ Idempotence (si déjà paid, skip)
   ├─ Débit carte cadeau (si utilisée)
   ├─ createShopifyOrder(...)
   ├─ sendOrderConfirmationEmail(...)
   └─ session.status → 'paid'

10. Callback page → postMessage → Frontend → /checkout/success
```

---

### Flux 3 : Paiement intégral par carte cadeau

```
1-3. Identique, + client saisit son code de carte cadeau dans GiftCardForm

4. POST /api/checkout/gift-card { code }
   └─ Valide le code, retourne { balance: 200 }
   └─ Frontend soustrait du total → nouveau total affiché

5. Client clique "Payer"
   └─ POST /api/checkout/charge { giftCardCode, giftCardAmount: 200, ... }

6. Backend :
   └─ chargeAmount = session.amount - giftCardAmount = 0
   └─ Montant = 0 → paiement immédiat sans Tranzila
   └─ debitGiftCard(code, 200)
   └─ createShopifyOrder(...)
   └─ sendOrderConfirmationEmail(...)
   └─ session.status → 'paid'
   └─ Retourne { success: true, ... }

7. Frontend → /checkout/success (pas de popup, pas de 3DS)
```

---

### Mécanisme de confirmation triple (anti-perte)

Pour éviter qu'un paiement soit confirné mais non capturé côté frontend, 3 mécanismes coexistent :

```
┌─────────────────────────────────────────────────────────────┐
│ Mécanisme 1 : Supabase Realtime                             │
│   - Abonnement WebSocket sur payment_sessions               │
│   - Dès que status = 'paid' en base → onSuccess()          │
│   - Le plus fiable (push serveur)                           │
├─────────────────────────────────────────────────────────────┤
│ Mécanisme 2 : Session Polling                               │
│   - GET /api/checkout/session?id=... toutes les 5 secondes  │
│   - Fallback si WebSocket indisponible                      │
├─────────────────────────────────────────────────────────────┤
│ Mécanisme 3 : PostMessage depuis popup/iframe               │
│   - Callback page envoie postMessage au parent              │
│   - Intercepté par window.addEventListener('message', ...)  │
│   - Traitement immédiat sans attendre le polling            │
└─────────────────────────────────────────────────────────────┘
```

---

## 10. Gestion des erreurs

### Codes de réponse Tranzila

| Code | Signification |
|---|---|
| `000` | Approuvé ✅ |
| `001` | Contacter l'émetteur |
| `051` | Fonds insuffisants |
| `054` | Carte expirée |
| `091` | Émetteur indisponible |
| `096` | Erreur système |

### Statuts de session

| Statut | Signification |
|---|---|
| `pending` | Session créée, en attente |
| `processing` | Charge en cours (verrou) |
| `pending_3ds` | Attente challenge 3DS |
| `pending_bit` | Attente confirmation Bit |
| `paid` | Paiement réussi |
| `failed` | Paiement refusé ou erreur |

### Codes HTTP des routes API

| Code | Signification |
|---|---|
| `200` | Succès |
| `400` | Requête invalide (champs manquants, état incorrect) |
| `404` | Session ou carte cadeau introuvable |
| `500` | Erreur serveur (API externe, DB) |

---

## 11. Internationalisation

**Fichier :** `lib/translations.ts`

**Langues :** Hébreu (`he`) et Anglais (`en`).

**Utilisation :**
```typescript
const { t, lang } = useLanguage()
t('customerForm.email')   // → 'Email' (en) ou 'אימייל' (he)
```

**Clés disponibles :** `header`, `footer`, `checkout`, `customerForm` (20+ clés), `orderSummary` (10+), `giftCardForm` (10+), `paymentForm` (70+), `success` (10+), `errorPage`, `demo`.

**Contexte de langue :** `lib/language-context.tsx` → Provider React `<LanguageProvider>` dans `layout.tsx`.

---

## 12. Sécurité & conformité PCI

| Point | Implémentation |
|---|---|
| **Données CB jamais sur serveur** | Tranzila Hosted Fields (iframe) — les numéros de carte ne transitent jamais par notre backend |
| **Token-based** | Seul le `thtk` (token session) et le `track_id` circulent |
| **CORS** | Liste d'origines autorisées hardcodée dans les routes API |
| **Idempotence** | `idempotency_key` prévient les doubles débits |
| **Verrou de session** | Statut `processing` empêche les charges concurrentes |
| **3DS vérifié côté serveur** | `complete3DS` appelé backend, pas seulement frontend |
| **Codes cartes cadeaux** | 16 caractères aléatoires (`ROTM-XXXX-XXXX-X`), non prédictibles |
| **Emails non-bloquants** | Échec email ≠ échec paiement (loggué, non fatal) |
| **Clés secrètes non exposées** | `SUPABASE_SERVICE_ROLE_KEY`, `TRANZILA_APP_KEY`, etc. sans préfixe `NEXT_PUBLIC_` |

---

## 13. Décisions d'architecture importantes

### 1. Hosted Fields plutôt que charge directe
Les données carte ne touchent jamais nos serveurs. Le SDK Tranzila injecte ses propres iframes sécurisées dans notre formulaire. Seul un token (`thtk`) circule.

### 2. Refs pour le SDK (pas de state React)
`hostedFieldsRef` est une `ref`, pas du state. Cela évite les re-renders intempestifs qui détruiraient et recréraient les Hosted Fields pendant que l'utilisateur saisit sa carte.

### 3. Triple mécanisme de confirmation
Realtime + polling + postMessage. Garantit que même si une connexion WebSocket tombe ou qu'une popup se ferme anormalement, le paiement est bien capturé.

### 4. Emails non-bloquants
Un échec d'envoi d'email ne plante pas le paiement. La commande Shopify est créée et la session est `paid` même si Resend est indisponible.

### 5. Tout en ILS côté serveur
La conversion de devise (USD/EUR → ILS) est faite à la création de session. Tout le traitement interne est en ILS pour garantir la cohérence entre les APIs.

---

## 14. Guide de prise en main manuelle

### Lancer le projet en local

```bash
# 1. Installer les dépendances
npm install

# 2. Créer le fichier .env.local à partir du template
cp .env.example .env.local
# → Remplir toutes les variables (Tranzila, Shopify, Supabase, Resend)

# 3. Lancer en développement
npm run dev
# → http://localhost:3000

# 4. Tester le checkout demo
# → Ouvrir http://localhost:3000 → "Try Demo Checkout"
```

### Tester un paiement

**Carte de test (mode non-production) :**
- Numéro : `5430050220380520`
- Toute date d'expiration future, tout CVV
- → Paiement confirmé immédiatement sans passer par Tranzila

**Test Tranzila :**
- Vérifier la connexion : `GET /api/test-tranzila`

### Accéder à la base de données

Dashboard Supabase → Tables `payment_sessions` et `gift_cards`.

Pour retrouver une session par ID :
```sql
SELECT * FROM payment_sessions WHERE id = 'uuid-de-la-session';
```

Pour voir les paiements réussis récents :
```sql
SELECT id, shop, amount, status, order_id, created_at 
FROM payment_sessions 
WHERE status = 'paid' 
ORDER BY created_at DESC 
LIMIT 20;
```

Pour vérifier une carte cadeau :
```sql
SELECT code, balance, status, last_used_at 
FROM gift_cards 
WHERE code = 'ROTM-XXXX-XXXX-X';
```

### Forcer une session en `paid` manuellement (urgence)

Si un paiement est confirmé par Tranzila mais que la session est bloquée :
```sql
UPDATE payment_sessions 
SET status = 'paid', 
    tranzila_transaction_id = 'XXXX',
    order_id = 'shopify_order_id',
    updated_at = now()
WHERE id = 'uuid-de-la-session';
```

### Réinitialiser une session pour retry

Via l'API :
```bash
curl -X POST https://votreapp.vercel.app/api/checkout/session/reset \
  -H "Content-Type: application/json" \
  -d '{"sessionId": "uuid"}'
```

### Créer une commande Shopify manuellement (si manquante)

La logique est dans `lib/shopify.ts` → `createShopifyOrder()`.
La session contient toutes les infos nécessaires (`cart`, `customer`, `tranzila_transaction_id`).

### Débiter manuellement une carte cadeau

La logique est dans `lib/gift-cards.ts` → `debitGiftCard()`.
```typescript
await debitGiftCard({ code: 'ROTM-XXXX', amount: 100, sessionId: 'uuid' })
```

### Points d'entrée clés pour modifications

| Besoin | Fichier à modifier |
|---|---|
| Logique de charge / routing de paiement | `app/api/checkout/charge/route.ts` |
| Client Tranzila (méthodes API) | `lib/tranzila.ts` |
| Création de commande Shopify | `lib/shopify.ts` |
| Logique cartes cadeaux | `lib/gift-cards.ts` |
| Templates d'emails | `components/emails/` |
| Formulaire de paiement (UI + SDK) | `components/checkout/payment-form.tsx` |
| Formulaire client | `components/checkout/customer-form.tsx` |
| Page de succès | `app/checkout/success/page.tsx` |
| Variables d'environnement | `.env.local` |
| Config Next.js (redirects, etc.) | `next.config.mjs` |

---

*Document généré le 11 mai 2026 — à mettre à jour si l'architecture évolue.*
