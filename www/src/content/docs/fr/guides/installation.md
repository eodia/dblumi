---
title: Installation
---

dblumi est auto-heberge. La methode recommandee est d'utiliser Docker.

## Prerequis

- Docker et Docker Compose
- Une base de donnees PostgreSQL, MySQL ou Oracle a laquelle se connecter

## Docker Compose (recommande)

Creez un fichier `docker-compose.yml` :

```yaml
services:
  dblumi:
    image: dblumi/dblumi:latest
    ports:
      - "3000:3000"
    environment:
      - JWT_SECRET=votre-secret-ici
    volumes:
      - dblumi-data:/app/data

volumes:
  dblumi-data:
```

Puis lancez :

```bash
docker compose up -d
```

dblumi sera accessible sur `http://localhost:3000`.

## Premier lancement

Au premier lancement, vous serez invite a creer un compte administrateur. Ce compte a un acces complet pour gerer les utilisateurs, groupes et connexions.

## Etape suivante

[Ajouter votre premiere connexion →](/fr/guides/first-connection/)
