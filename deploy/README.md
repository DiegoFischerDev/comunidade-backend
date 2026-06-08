# Deploy na VPS (Comunidade Rafa Portugal)

Este repositório contém o **backend**. O frontend fica em outro repositório. Deploy na VPS apenas em **produção** (branch `main`).

## Pré-requisitos na VPS

- Docker e Docker Compose instalados
- Acesso SSH com chave
- Domínios (ou subdomínios) apontando para o IP da VPS, por exemplo:
  - **Produção:** `app.seudominio.com`, `api.seudominio.com`

## 1. Estrutura de pastas na VPS

```bash
sudo mkdir -p /opt/comunidade-prod
```

## 2. Produção (`/opt/comunidade-prod`)

- Copie `deploy/docker-compose.prod.yml` para `/opt/comunidade-prod/docker-compose.yml`.
- Copie `deploy/nginx.prod.conf` para `/opt/comunidade-prod/nginx.conf`.
- Crie a pasta de certificados: `mkdir -p /opt/comunidade-prod/certs` e coloque os arquivos do Certbot (ex.: `fullchain.pem`, `privkey.pem`), ou gere com `certbot certonly --standalone -d app.seudominio.com -d api.seudominio.com`.
- Crie `/opt/comunidade-prod/.env` com:

```env
# Troque SEU_USER pelo seu usuário do GitHub (minúsculo)
IMAGE_BACKEND=ghcr.io/SEU_USER/comunidade-backend:latest
IMAGE_FRONTEND=ghcr.io/SEU_USER/comunidade-frontend:latest

POSTGRES_PASSWORD=senha_forte_postgres
JWT_SECRET=seu_jwt_secreto_longo
FRONTEND_URL=https://app.seudominio.com
NEXT_PUBLIC_API_URL=https://api.seudominio.com
NEXT_PUBLIC_SITE_URL=https://app.seudominio.com
```

O `NEXT_PUBLIC_*` que o **browser** usa vem do **build** da imagem (GitHub Actions). O `.env` na máquina alinha o serviço; para alterar o URL no JS do cliente, reconstrói a imagem do frontend.

- Ajuste em `nginx.conf` os `server_name` para seus domínios

## 3. Subir o ambiente

Não usamos `migrate` no `command` do serviço `backend` (juntar `npx` + Prisma a cada **arranque** do serviço em VPS com pouca RAM costumava acabar com **exit 137** / OOM). A imagem inicia só `node dist/src/main.js` (ver `backend/Dockerfile`).

Aplica as migrações **depois** do `up` (o backend já corre só com o Nest):

**Produção:**

```bash
cd /opt/comunidade-prod
docker compose pull
docker compose up -d
docker compose exec -T backend npx prisma migrate deploy
```

**O mesmo passo de migração que o GitHub Actions** (só Postgres levantado primeiro, depois `migrate` num one-shot):  
`docker compose up -d postgres` → `docker compose run --rm --no-deps backend npx prisma migrate deploy` → `docker compose up -d`

### Migração falhada (erro P3009)

Se uma migração falhou uma vez (por SQL errado, OOM, etc.), o Prisma regista isso e **recusa** novos `migrate deploy` até resolveres.

1. Garante que o código em `prisma/migrations/` na imagem ou no repo está **corrigido** (já não tenta `partners` / `users` em vez de `"Partner"` / `"User"`).
2. Na VPS, em `/opt/comunidade-prod`, **marca a migração falhada como revertida** para o Prisma voltar a tentá-la:

```bash
docker compose exec -T backend npx prisma migrate resolve --rolled-back 20260422120000_partner_engagement
```

3. Volta a aplicar:

```bash
docker compose exec -T backend npx prisma migrate deploy
```

Se a falha tiver deixado objetos na base (enum, tabelas a meio), pode ser preciso limpar manualmente no Postgres antes do passo 3; na falha original (tabela errada) em geral **nada** ficou aplicado.

## 4. GitHub Actions (secrets no repositório)

**Backend:** em **Settings → Secrets and variables → Actions** crie:

| Nome                 | Descrição                          |
|----------------------|------------------------------------|
| `VPS_HOST`           | IP ou hostname da VPS              |
| `VPS_USER`           | Usuário SSH (ex.: `root` ou `deploy`) |
| `VPS_SSH_PRIVATE_KEY`| Chave privada SSH (conteúdo completo) |

**Frontend:** os mesmos acima e mais:

| Nome                         | Descrição (build do Next usa em tempo de build) |
|------------------------------|--------------------------------------------------|
| `NEXT_PUBLIC_API_URL`        | URL da API de **produção** (ex.: `https://api.seudominio.com`) |
| `NEXT_PUBLIC_SITE_URL`       | URL pública do site de **produção** (ex.: `https://app.seudominio.com`) |

Push em `main` faz build, push ao GHCR e `docker compose pull` + `up -d` em `/opt/comunidade-prod`.

## 5. Permissão das imagens no GHCR

Após o primeiro push, as imagens ficam em **Packages** do seu usuário/organização. Por padrão podem ser privadas. Para a VPS puxar sem login, você pode:

- Tornar o pacote público em **Package settings**, ou  
- Fazer login no Docker na VPS: `echo $GITHUB_TOKEN | docker login ghcr.io -u SEU_USER --password-stdin` (use um Personal Access Token com permissão `read:packages`).
