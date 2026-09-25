---
title: Premiere connexion
---

Une fois dblumi lance, connectez-le a votre base de donnees.

## Ajouter une connexion

1. Cliquez sur **Nouvelle connexion** dans la barre laterale
2. Sélectionnez votre pilote : **PostgreSQL**, **MySQL**, **Oracle**, **SQL Server**, **SQLite**, **Trino**, **Snowflake**, **MongoDB** ou **Redis**
3. Renseignez les details de connexion : hote, port, nom de la base, identifiant, mot de passe
4. Etiquetez l'environnement : `prod`, `staging`, `dev` ou `local`
5. Cliquez sur **Tester la connexion** pour verifier, puis **Enregistrer**

Pour **Trino**, le port par defaut est `8080` et le champ base de donnees porte la cible : `hive` pour un catalogue, `hive/default` pour un catalogue et un schema.

Le mot de passe est optionnel sur Trino — laissez-le vide pour un cluster sans authentification. La gestion des utilisateurs de base et l'import/synchronisation de donnees ne sont pas disponibles sur les connexions Trino.

Pour **MongoDB**, le port par défaut est `27017` et la base par défaut est `test`. Le champ hôte accepte aussi une URI complète : collez votre chaîne Atlas (`mongodb+srv://user:pass@cluster0.example.net/shop`) dans l'onglet connection string. L'identifiant et le mot de passe sont déplacés dans leurs champs et stockés chiffrés, et les options comme `authSource` ou `replicaSet` sont conservées. Identifiant et mot de passe sont optionnels pour un serveur sans authentification.

Les requêtes utilisent la syntaxe mongosh, une commande par instruction :

```js
db.orders.find({ total: { $gt: 100 } }).sort({ at: -1 })
db.orders.aggregate([{ $group: { _id: "$customer", revenue: { $sum: "$total" } } }])
db.getCollection("2024-archive").countDocuments({})
```

Les commandes sont analysées, jamais évaluées : variables, fonctions et `use` ne sont pas supportés (changez de base avec le sélecteur de base). Les écritures passent par les mêmes garde-fous que le SQL : `deleteMany({})` ou `drop()` demandent une confirmation. L'éditeur de structure, les utilisateurs de base et la synchronisation ne sont pas disponibles sur MongoDB ; l'import CSV crée des documents dans une collection.

Pour **SQL Server**, le port par défaut est `1433`. Pour joindre une instance nommée, écrivez-la dans le champ hôte (`serveur-bd\SQLEXPRESS`) : le port est alors résolu par le service SQL Browser. Activez le SSL pour Azure SQL. Les scripts peuvent séparer leurs lots par `GO` : un lot qui déclare des variables (`DECLARE @n`) ou crée une procédure, une fonction, un trigger ou une vue s'exécute d'un bloc, les autres sont découpés en un onglet de résultat par instruction. Chaque script s'exécute sur une session dédiée : `USE`, `SET`, les tables temporaires et les transactions (`BEGIN TRAN … ROLLBACK`) se comportent comme dans SSMS, sans toucher les autres utilisateurs. T-SQL n'a pas d'`EXPLAIN` : le bouton correspondant est masqué.

Pour **Snowflake**, le champ hôte contient l'identifiant de compte (`monorg-moncompte`, ou l'URL complète `https://….snowflakecomputing.com`) — il n'y a pas de port. Le champ base accepte `ANALYTICS` ou `ANALYTICS/PUBLIC` pour fixer un schéma ; le warehouse et le rôle sont optionnels. Le champ mot de passe accepte un mot de passe ou une clé privée PEM (`-----BEGIN PRIVATE KEY-----…`) pour l'authentification par paire de clés, nécessaire aux utilisateurs de service. L'exploration du schéma passe par des commandes `SHOW` et ne réveille pas le warehouse ; le nombre total de lignes d'un résultat est fourni par Snowflake, sans seconde requête de comptage.

Pour **Redis**, le port par défaut est `6379` et le champ base contient l'index de base (`0` par défaut). Le champ hôte accepte aussi une URL `redis://user:pass@hôte:6379/0` (`rediss://` pour TLS). Identifiant et mot de passe sont optionnels. Les commandes suivent la syntaxe redis-cli, une par ligne :

```
SCAN 0 MATCH user:* COUNT 1000
HGETALL user:42
SET session:abc "une valeur" EX 3600
```

Redis n'a pas de tables : l'explorateur de schéma liste les préfixes de clés (`user:*`, `session:*`), et en ouvrir un affiche une ligne par clé avec son type, son TTL, sa taille et — pour les chaînes — sa valeur. Dans cette grille, vous pouvez renommer une clé, changer son TTL, modifier une valeur texte, insérer des clés texte et supprimer des clés. `FLUSHDB`, `FLUSHALL` et les commandes d'administration demandent une confirmation ; `KEYS` prévient qu'il bloque le serveur. `SUBSCRIBE` et `MONITOR` ne sont pas supportés (leur flux ne s'arrête jamais) ; `MULTI … EXEC`, `SELECT` et les commandes bloquantes comme `BLPOP` s'exécutent sur une connexion dédiée.

## Visibilite de la connexion

Par defaut, une connexion est **privee** — vous seul pouvez la voir. Vous pouvez la partager avec des utilisateurs ou groupes specifiques depuis les parametres de la connexion.

![Explorateur de tables montrant le contenu de la base avec le schema en sidebar](/dblumi/images/feature-connection.png)

## C'est pret

Une fois connecte, vous arrivez sur la page **Vue d'ensemble** — votre tableau de bord pour cette base de donnees. De la, vous pouvez ouvrir l'editeur SQL, parcourir votre schema ou acceder a une requete sauvegardee.
