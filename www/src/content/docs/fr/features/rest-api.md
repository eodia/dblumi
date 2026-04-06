---
title: API REST & Swagger
---

Chaque action disponible dans l'interface dblumi est aussi accessible via une API REST, ce qui facilite l'automatisation des workflows, l'integration avec les pipelines CI/CD ou la creation d'outils personnalises.

![Documentation Swagger interactive de l'API](/images/feature-swagger.png)

## Documentation Swagger

dblumi integre une documentation Swagger interactive accessible sur `/api/docs`. Parcourez tous les endpoints disponibles, testez-les directement depuis votre navigateur et inspectez les schemas de requetes et reponses.

## Ce que vous pouvez faire

L'API couvre toutes les fonctionnalites :

- **Connexions** — creer, modifier, supprimer et tester des connexions a vos bases de donnees
- **Requetes** — executer du SQL, recuperer les resultats et gerer les requetes sauvegardees
- **Utilisateurs et groupes** — gerer les membres de l'equipe, les roles et les permissions
- **Schema** — parcourir les tables, colonnes, index et contraintes
- **Requetes sauvegardees** — operations CRUD, partage, dossiers et historique des versions

## Spec OpenAPI

L'API suit la specification OpenAPI. Utilisez la spec pour generer des librairies clientes dans tous les langages — TypeScript, Python, Go, Java, et bien d'autres.

## Authentification

Tous les endpoints de l'API necessitent un token JWT valide. Authentifiez-vous via l'endpoint `/auth/login` pour obtenir un token, puis incluez-le dans le header `Authorization` de vos requetes suivantes.
