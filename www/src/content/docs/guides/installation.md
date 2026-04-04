---
title: Installation
---

dblumi is self-hosted. The recommended way to run it is with Docker.

## Requirements

- Docker and Docker Compose
- A PostgreSQL, MySQL, or Oracle database to connect to

## Docker Compose (recommended)

Create a `docker-compose.yml` file:

```yaml
services:
  dblumi:
    image: dblumi/dblumi:latest
    ports:
      - "3000:3000"
    environment:
      - JWT_SECRET=your-secret-here
    volumes:
      - dblumi-data:/app/data

volumes:
  dblumi-data:
```

Then run:

```bash
docker compose up -d
```

dblumi will be available at `http://localhost:3000`.

## First launch

On first launch, you will be prompted to create an admin account. This account has full access to manage users, groups, and connections.

## Next step

[Add your first connection →](/guides/first-connection/)