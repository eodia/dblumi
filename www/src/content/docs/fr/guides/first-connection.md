---
title: Premiere connexion
---

Une fois dblumi lance, connectez-le a votre base de donnees.

## Ajouter une connexion

1. Cliquez sur **Nouvelle connexion** dans la barre laterale
2. Selectionnez votre pilote : **PostgreSQL**, **MySQL** ou **Oracle**
3. Renseignez les details de connexion : hote, port, nom de la base, identifiant, mot de passe
4. Etiquetez l'environnement : `prod`, `staging`, `dev` ou `local`
5. Cliquez sur **Tester la connexion** pour verifier, puis **Enregistrer**

## Visibilite de la connexion

Par defaut, une connexion est **privee** — vous seul pouvez la voir. Vous pouvez la partager avec des utilisateurs ou groupes specifiques depuis les parametres de la connexion.

![Explorateur de tables montrant le contenu de la base avec le schema en sidebar](/dblumi/images/feature-connection.png)

## C'est pret

Une fois connecte, vous arrivez sur la page **Vue d'ensemble** — votre tableau de bord pour cette base de donnees. De la, vous pouvez ouvrir l'editeur SQL, parcourir votre schema ou acceder a une requete sauvegardee.
