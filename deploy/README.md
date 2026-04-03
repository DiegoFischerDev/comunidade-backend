# Deploy na VPS (Comunidade RPM)

Este repositório contém o **backend**. O frontend fica em outro repositório. Os dois são implantados na mesma VPS, com dois ambientes: **produção** (branch `main`) e **stage** (branch `stage`).

## Pré-requisitos na VPS

- Docker e Docker Compose instalados
- Acesso SSH com chave
- Domínios (ou subdomínios) apontando para o IP da VPS, por exemplo:
  - **Produção:** `app.seudominio.com`, `api.seudominio.com`
  - **Stage:** `stage.seudominio.com`, `api-stage.seudominio.com`

## 1. Estrutura de pastas na VPS

Crie dois diretórios:

```bash
sudo mkdir -p /opt/comunidade-prod /opt/comunidade-stage
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
```

- Ajuste em `nginx.conf` os `server_name` para seus domínios

## 3. Stage (`/opt/comunidade-stage`)

- Copie `deploy/docker-compose.stage.yml` para `/opt/comunidade-stage/docker-compose.yml`.
- Copie `deploy/nginx.stage.conf` para `/opt/comunidade-stage/nginx.stage.conf`.
- Crie `mkdir -p /opt/comunidade-stage/certs-stage` e coloque (ou gere) certificados para `stage.seudominio.com` e `api-stage.seudominio.com`.
- Crie `/opt/comunidade-stage/.env` com:

```env
IMAGE_BACKEND=ghcr.io/SEU_USER/comunidade-backend:stage
IMAGE_FRONTEND=ghcr.io/SEU_USER/comunidade-frontend:stage

POSTGRES_PASSWORD=outra_senha_postgres_stage
JWT_SECRET=outro_jwt_stage
FRONTEND_URL=https://stage.seudominio.com
NEXT_PUBLIC_API_URL=https://api-stage.seudominio.com

# Cal.com (webhook na API — mesmo segredo que no painel Cal.com)
CALCOM_WEBHOOK_SECRET=whsec_...

# Opcional — preços da taxa “novo agendamento Rafa” (default 2000 se omitir no compose antigo)
STRIPE_RAFA_CALL_EUR_CENTS=2000
STRIPE_RAFA_CALL_PIX_BRL=2000
```

A URL do embed Cal.com (`NEXT_PUBLIC_CALCOM_EMBED_URL`) entra no **build** da imagem do frontend: defina o secret `NEXT_PUBLIC_CALCOM_EMBED_URL_STAGE` no GitHub Actions do repositório do frontend e faça push na branch `stage` para rebuild.

- Ajuste os `server_name` em `nginx.stage.conf`. Stage usa portas **8080** e **8443** no host para não conflitar com produção.

## 4. Subir os ambientes

**Produção:**

```bash
cd /opt/comunidade-prod
docker compose pull
docker compose up -d
```

**Migrações (rodar uma vez após o primeiro deploy do backend):**

```bash
docker compose exec backend npx prisma migrate deploy
```

**Stage:**

```bash
cd /opt/comunidade-stage
docker compose pull
docker compose up -d
docker compose exec backend npx prisma migrate deploy
```

## 5. GitHub Actions (secrets no repositório)

**Backend:** em **Settings → Secrets and variables → Actions** crie:

| Nome                 | Descrição                          |
|----------------------|------------------------------------|
| `VPS_HOST`           | IP ou hostname da VPS              |
| `VPS_USER`           | Usuário SSH (ex.: `root` ou `deploy`) |
| `VPS_SSH_PRIVATE_KEY`| Chave privada SSH (conteúdo completo) |

**Frontend:** os mesmos acima e mais:

| Nome                        | Descrição (build do Next usa em tempo de build) |
|-----------------------------|--------------------------------------------------|
| `NEXT_PUBLIC_API_URL`       | URL da API de **produção** (ex.: `https://api.seudominio.com`) |
| `NEXT_PUBLIC_API_URL_STAGE` | URL da API de **stage** (ex.: `https://api-stage.seudominio.com`) |

Ao dar **push** em `main`, o workflow faz build da imagem, envia para o GHCR e na VPS executa `docker compose pull backend` (ou `frontend`) e `up -d` em `/opt/comunidade-prod`. Em **push** em `stage`, o mesmo em `/opt/comunidade-stage`.

## 6. Permissão das imagens no GHCR

Após o primeiro push, as imagens ficam em **Packages** do seu usuário/organização. Por padrão podem ser privadas. Para a VPS puxar sem login, você pode:

- Tornar o pacote público em **Package settings**, ou  
- Fazer login no Docker na VPS: `echo $GITHUB_TOKEN | docker login ghcr.io -u SEU_USER --password-stdin` (use um Personal Access Token com permissão `read:packages`).
