---
title: Securite & Garde-fous
---

dblumi est construit avec la securite comme priorite.

## Garde-fous des requetes

Avant l'execution de toute requete destructrice, dblumi affiche une modale de confirmation avec le niveau de risque. Voir [Editeur SQL → Garde-fous de securite](/fr/features/sql-editor/#garde-fous-de-securite) pour le detail complet.

## Stockage des identifiants

- Les mots de passe des bases de donnees sont chiffres avec **AES-256-GCM**
- Les cles API des fournisseurs IA sont chiffrees avec **AES-256**
- Les identifiants ne quittent jamais votre serveur

## Authentification

- Email/mot de passe avec stockage hache securise (Argon2)
- OAuth/SSO : Keycloak, GitHub, Google
- Sessions basees sur JWT avec revocation de tokens

## Gestion des mots de passe

- **Changer le mot de passe** depuis le menu utilisateur (pour les comptes locaux, pas OAuth)
- **Mot de passe oublie** avec lien de reinitialisation par email (necessite la configuration SMTP)
- Indicateur de force du mot de passe (faible / correct / fort)
- Les tokens de reinitialisation sont haches (SHA-256) et a usage unique, expirent apres 1 heure
- Toutes les sessions existantes sont invalidees apres un changement ou une reinitialisation

## Controle d'acces base sur les roles

| Role | Capacites |
|------|-----------|
| Admin | Acces complet — utilisateurs, groupes, connexions |
| Editeur | Creer et modifier des requetes, gerer ses propres connexions |
| Lecteur | Acces en lecture seule aux requetes et connexions partagees |

## Controle d'acces par connexion

Chaque connexion peut etre privee, partagee avec des utilisateurs specifiques ou partagee avec des groupes. Les admins peuvent voir toutes les connexions.
