# Configurar VPS Hostinger para Comunidade RPM (sem afetar o evo)

Este guia configura a aplicação **Comunidade RPM** na mesma VPS onde já roda o **evo** (RPM/evo), usando subdomínios e portas internas para não interferir no projeto existente.

**Subdomínios usados:**

| Ambiente | Frontend (app) | Backend (API) |
|----------|----------------|---------------|
| Produção | comunidade.rafaapelomundo.com | api-comunidade.rafaapelomundo.com |
| Stage    | stage.rafaapelomundo.com      | api-stage.rafaapelomundo.com      |


---

## 1. Subdomínios no painel Hostinger (hPanel)

1. Acesse o **hPanel** da Hostinger e entre no serviço **VPS**.
2. Vá em **Domínios** (ou **Domains**) e selecione **rafaapelomundo.com**.
3. Abra a seção **Subdomínios** (Subdomains).
4. Crie **4 subdomínios** apontando para a **raiz** do domínio (ou para a mesma pasta/document root que o painel usar para o domínio principal; o tráfego será tratado pelo Nginx na VPS, não por pasta no painel):

   - **comunidade** → comunidade.rafaapelomundo.com  
   - **api-comunidade** → api-comunidade.rafaapelomundo.com  
   - **stage** → stage.rafaapelomundo.com  
   - **api-stage** → api-stage.rafaapelomundo.com  

5. Se o painel pedir "Document root", pode usar algo como `/comunidade` ou o padrão; o que importa é que o **DNS** aponte para o IP da sua VPS.

**DNS:** Confirme que os registros A (ou CNAME) desses subdomínios apontam para o **IP da VPS**. No hPanel isso costuma ser configurado automaticamente ao criar o subdomínio. Se gerir DNS em outro lugar, crie A para cada um apontando para o IP da VPS.

---

## 2. Acesso SSH à VPS

1. No hPanel, anote **IP da VPS**, **usuário SSH** (ex.: `root` ou `u123456789`) e use **chave SSH** ou senha.
2. No seu Mac, teste o acesso:

```bash
ssh SEU_USUARIO@IP_DA_VPS
```

Se ainda não tiver chave SSH para o GitHub Actions, crie uma e adicione a **pública** no hPanel (SSH Access) e a **privada** no repositório como secret `VPS_SSH_PRIVATE_KEY`.

---

## 3. Verificar o que já existe (evo) – não alterar

1. Descubra onde está o projeto evo e como o Nginx está configurado:

```bash
# Projeto evo (só conferir, não alterar)
ls -la /root/RPM/evo   # ou o caminho que você usa

# Nginx: arquivo principal e sites
ls -la /etc/nginx/
ls -la /etc/nginx/sites-enabled/   # ou /etc/nginx/conf.d/
cat /etc/nginx/sites-enabled/*    # ou nginx.conf
```

2. Anote em qual arquivo estão os `server { ... }` do evo (ex.: `/etc/nginx/sites-enabled/evo` ou `default`). **Não edite esses blocos.** Só vamos **adicionar** novos arquivos de site para a Comunidade.

3. Confirme se há Certbot (Let’s Encrypt):

```bash
which certbot
certbot --version
```

Se não houver, instale (ex.: `apt update && apt install -y certbot python3-certbot-nginx` no Ubuntu/Debian).

---

## 4. Instalar Docker e Docker Compose (se ainda não tiver)

Execute **apenas se** na VPS ainda não existir Docker:

```bash
# Ubuntu/Debian
apt update && apt install -y ca-certificates curl
install -m 0755 -d /etc/apt/keyrings
curl -fsSL https://download.docker.com/linux/ubuntu/gpg -o /etc/apt/keyrings/docker.asc
chmod a644 /etc/apt/keyrings/docker.asc
echo "deb [arch=$(dpkg --print-architecture) signed-by=/etc/apt/keyrings/docker.asc] https://download.docker.com/linux/ubuntu $(. /etc/os-release && echo "$VERSION_CODENAME") stable" | tee /etc/apt/sources.list.d/docker.list > /dev/null
apt update && apt install -y docker-ce docker-ce-cli containerd.io docker-buildx-plugin docker-compose-plugin
systemctl enable docker && systemctl start docker
```

Confirme:

```bash
docker --version
docker compose version
```

---

## 5. Diretórios da Comunidade (fora do evo)

Use diretórios **separados** do evo (por exemplo em `/opt`):

```bash
sudo mkdir -p /opt/comunidade-prod /opt/comunidade-stage
sudo chown $USER:$USER /opt/comunidade-prod /opt/comunidade-stage
```

---

## 6. Arquivos em `/opt/comunidade-prod`

1. Copie o compose **sem nginx** (para não disputar porta 80/443 com o evo):

```bash
# No seu Mac (a partir da pasta do repo backend)
scp deploy/docker-compose.prod.vps.yml SEU_USUARIO@IP_DA_VPS:/opt/comunidade-prod/docker-compose.yml
```

Ou na VPS, crie `/opt/comunidade-prod/docker-compose.yml` com o conteúdo de `deploy/docker-compose.prod.vps.yml`.

2. Crie o `.env` de produção:

```bash
sudo nano /opt/comunidade-prod/.env
```

Conteúdo (troque pelos seus valores e pelo usuário GitHub em minúsculo):

```env
IMAGE_BACKEND=ghcr.io/diegofischerdev/comunidade-backend:latest
IMAGE_FRONTEND=ghcr.io/diegofischerdev/comunidade-frontend:latest

POSTGRES_PASSWORD=senha_forte_postgres_prod
JWT_SECRET=um_jwt_secreto_longo_e_aleatorio_prod
FRONTEND_URL=https://comunidade.rafaapelomundo.com
NEXT_PUBLIC_API_URL=https://api-comunidade.rafaapelomundo.com
```

Salve (Ctrl+O, Enter, Ctrl+X).

---

## 7. Arquivos em `/opt/comunidade-stage`

1. Copie o compose de stage:

```bash
scp deploy/docker-compose.stage.vps.yml SEU_USUARIO@IP_DA_VPS:/opt/comunidade-stage/docker-compose.yml
```

2. Crie o `.env` de stage:

```bash
sudo nano /opt/comunidade-stage/.env
```

```env
IMAGE_BACKEND=ghcr.io/diegofischerdev/comunidade-backend:stage
IMAGE_FRONTEND=ghcr.io/diegofischerdev/comunidade-frontend:stage

POSTGRES_PASSWORD=outra_senha_postgres_stage
JWT_SECRET=outro_jwt_stage
FRONTEND_URL=https://stage.rafaapelomundo.com
NEXT_PUBLIC_API_URL=https://api-stage.rafaapelomundo.com
```

Salve.

---

## 8. Nginx no host (reverso proxy para a Comunidade)

O **Nginx já instalado na VPS** (o mesmo que serve o evo) vai receber o tráfego dos 4 subdomínios e repassar para os containers. **Não mexa nos blocos do evo.**

1. Crie um arquivo só para a Comunidade, por exemplo:

```bash
sudo nano /etc/nginx/sites-available/comunidade
```

(Em alguns sistemas o diretório é `conf.d`: use `/etc/nginx/conf.d/comunidade.conf`.)

2. Cole o conteúdo abaixo.

```nginx
# Comunidade RPM - Produção e Stage (proxy para containers)
# Não altera o comportamento do evo.

# Redirecionar HTTP -> HTTPS (produção)
server {
    listen 80;
    server_name comunidade.rafaapelomundo.com api-comunidade.rafaapelomundo.com;
    return 301 https://$host$request_uri;
}

# Redirecionar HTTP -> HTTPS (stage)
server {
    listen 80;
    server_name stage.rafaapelomundo.com api-stage.rafaapelomundo.com;
    return 301 https://$host$request_uri;
}

# Produção - Frontend
server {
    listen 443 ssl;
    server_name comunidade.rafaapelomundo.com;
    ssl_certificate /etc/letsencrypt/live/comunidade.rafaapelomundo.com/fullchain.pem;
    ssl_certificate_key /etc/letsencrypt/live/comunidade.rafaapelomundo.com/privkey.pem;
    location / {
        proxy_pass http://127.0.0.1:13000;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection 'upgrade';
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
        proxy_cache_bypass $http_upgrade;
    }
}

# Produção - API (mesmo certificado do frontend produção)
server {
    listen 443 ssl;
    server_name api-comunidade.rafaapelomundo.com;
    ssl_certificate /etc/letsencrypt/live/comunidade.rafaapelomundo.com/fullchain.pem;
    ssl_certificate_key /etc/letsencrypt/live/comunidade.rafaapelomundo.com/privkey.pem;
    location / {
        proxy_pass http://127.0.0.1:13001;
        proxy_http_version 1.1;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
    }
}

# Stage - Frontend
server {
    listen 443 ssl;
    server_name stage.rafaapelomundo.com;
    ssl_certificate /etc/letsencrypt/live/stage.rafaapelomundo.com/fullchain.pem;
    ssl_certificate_key /etc/letsencrypt/live/stage.rafaapelomundo.com/privkey.pem;
    location / {
        proxy_pass http://127.0.0.1:13002;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection 'upgrade';
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
        proxy_cache_bypass $http_upgrade;
    }
}

# Stage - API (mesmo certificado do frontend stage)
server {
    listen 443 ssl;
    server_name api-stage.rafaapelomundo.com;
    ssl_certificate /etc/letsencrypt/live/stage.rafaapelomundo.com/fullchain.pem;
    ssl_certificate_key /etc/letsencrypt/live/stage.rafaapelomundo.com/privkey.pem;
    location / {
        proxy_pass http://127.0.0.1:13003;
        proxy_http_version 1.1;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
    }
}
```

3. Ative o site (se usar sites-available/enabled):

```bash
sudo ln -s /etc/nginx/sites-available/comunidade /etc/nginx/sites-enabled/
```

4. **Ainda não faça reload no Nginx** – primeiro geramos os certificados SSL (passo 9). Se você carregar o Nginx agora, vai dar erro por faltar os certificados.

---

## 9. Certificados SSL (Let’s Encrypt)

Gere certificados **antes** de dar reload no Nginx. Se o Nginx estiver ocupando a porta 80, use o plugin webroot ou pare o Nginx só durante o `certbot certonly --standalone` (o evo pode ficar indisponível por alguns segundos). Alternativa: usar `certbot certonly --webroot -w /var/www/html` se o Nginx já servir algo em `/var/www/html`.

**Opção A – Standalone (Nginx precisa liberar a porta 80 temporariamente):**

Com vários `-d`, o Certbot gera **um** certificado e um **único** diretório (nome do primeiro `-d`). Use o mesmo caminho nos dois `server` (front e API) de cada ambiente.

```bash
# Parar Nginx momentaneamente (evo ficará indisponível por alguns segundos)
sudo systemctl stop nginx

# Certificado produção (comunidade + api-comunidade) → diretório live/comunidade.rafaapelomundo.com
sudo certbot certonly --standalone -d comunidade.rafaapelomundo.com -d api-comunidade.rafaapelomundo.com --email seu@email.com --agree-tos --no-eff-email

# Certificado stage (stage + api-stage) → diretório live/stage.rafaapelomundo.com
sudo certbot certonly --standalone -d stage.rafaapelomundo.com -d api-stage.rafaapelomundo.com --email seu@email.com --agree-tos --no-eff-email

# Subir Nginx de novo
sudo systemctl start nginx
```

No Nginx, use o **mesmo** certificado para o par de cada ambiente: produção usa `live/comunidade.rafaapelomundo.com` nos dois blocos (comunidade e api-comunidade); stage usa `live/stage.rafaapelomundo.com` nos dois blocos (stage e api-stage).

**Opção B – Webroot (Nginx continua rodando):**

Configure um `server { listen 80; server_name ...; root /var/www/certbot; }` para cada nome e use:

```bash
sudo certbot certonly --webroot -w /var/www/html -d comunidade.rafaapelomundo.com -d api-comunidade.rafaapelomundo.com --email seu@email.com --agree-tos --no-eff-email
# Repita para stage e api-stage.
```

Depois dos certificados:

```bash
sudo nginx -t
sudo systemctl reload nginx
```

---

## 10. Login no GitHub Container Registry (GHCR) na VPS

Para o Docker na VPS puxar imagens privadas do GHCR:

1. No GitHub: **Settings → Developer settings → Personal access tokens**. Crie um token com scope **read:packages**.
2. Na VPS:

```bash
echo SEU_TOKEN_AQUI | sudo docker login ghcr.io -u DiegoFischerDev --password-stdin
```

(Substitua `SEU_TOKEN_AQUI` e o usuário se for outro.) Assim os `docker compose pull` (manual ou via GitHub Actions) conseguirão baixar as imagens.

Se as imagens forem **públicas**, esse login não é obrigatório.

---

## 11. Primeiro deploy manual (produção)

1. Baixar imagens e subir os containers:

```bash
cd /opt/comunidade-prod
docker compose pull
docker compose up -d
```

2. Rodar migrações do Prisma (uma vez):

```bash
docker compose exec backend npx prisma migrate deploy
```

3. Verificar:

```bash
docker compose ps
curl -s http://127.0.0.1:13001/   # deve responder algo do backend
curl -s -o /dev/null -w "%{http_code}" http://127.0.0.1:13000/   # frontend
```

4. No navegador: **https://comunidade.rafaapelomundo.com** (e API em **https://api-comunidade.rafaapelomundo.com**).

---

## 12. Primeiro deploy manual (stage)

```bash
cd /opt/comunidade-stage
docker compose pull
docker compose up -d
docker compose exec backend npx prisma migrate deploy
```

Teste: **https://stage.rafaapelomundo.com** e **https://api-stage.rafaapelomundo.com**.

---

## Banco de dados (Postgres) na VPS

Neste projeto, **o Postgres roda em container na própria VPS**, dentro do `docker compose` de cada ambiente:

- **Produção**: `/opt/comunidade-prod` com volume **`postgres_data_prod`**
- **Stage**: `/opt/comunidade-stage` com volume **`postgres_data_stage`**

O backend liga ao Postgres via rede do compose:

- `DATABASE_URL=postgresql://comunidade:${POSTGRES_PASSWORD}@postgres:5432/comunidade?schema=public`

Isso significa que:

- Os dados **persistem** enquanto o volume existir
- Um **reset total** do banco (para eliminar inconsistências/drift) é feito removendo o volume (`docker compose down -v`)

### Reset total do banco (Stage)

```bash
cd /opt/comunidade-stage
docker compose down -v
docker compose up -d
docker compose exec -T backend npx prisma migrate deploy
docker compose exec -T backend npm run seed:admin
```

### Reset total do banco (Produção)

```bash
cd /opt/comunidade-prod
docker compose down -v
docker compose up -d
docker compose exec -T backend npx prisma migrate deploy
docker compose exec -T backend npm run seed:admin
```

### Seed do admin (requer variáveis no .env da VPS)

Para o `npm run seed:admin` funcionar dentro do container (imagem de produção), defina no `.env` do ambiente:

```env
ADMIN_EMAIL="admin@seudominio.com"
ADMIN_PASSWORD="SENHA_FORTE"
ADMIN_NAME="Admin"
ADMIN_WHATSAPP=""
```

### Troubleshooting Postgres (usuário e database)

Se você precisar executar `psql` dentro do container (para debugar migrations, checar tabelas/colunas, etc.), **não assuma** que o usuário é `postgres`. Neste projeto, normalmente o container sobe com:

- **`POSTGRES_USER=comunidade`**
- **`POSTGRES_DB=comunidade`**

Para confirmar pelo próprio container:

```bash
cd /opt/comunidade-stage
docker compose exec postgres sh -lc 'echo "USER=$POSTGRES_USER DB=$POSTGRES_DB"'
```

E para rodar um comando SQL usando esses valores:

```bash
docker compose exec postgres sh -lc 'psql -U "$POSTGRES_USER" -d "$POSTGRES_DB" -c "SELECT 1;"'
```

---

## 13. GitHub Actions (secrets)

Nos repositórios **comunidade-backend** e **comunidade-frontend**, em **Settings → Secrets and variables → Actions**, configure:

| Secret | Valor |
|--------|--------|
| `VPS_HOST` | IP da VPS |
| `VPS_USER` | Usuário SSH (ex.: root) |
| `VPS_SSH_PRIVATE_KEY` | Conteúdo da chave privada SSH |

No repositório do **frontend** apenas:

| Secret | Valor |
|--------|--------|
| `NEXT_PUBLIC_API_URL` | https://api-comunidade.rafaapelomundo.com |
| `NEXT_PUBLIC_API_URL_STAGE` | https://api-stage.rafaapelomundo.com |

Os workflows fazem deploy em **/opt/comunidade-prod** (branch main) e **/opt/comunidade-stage** (branch stage), com `docker compose pull` e `up -d` do serviço correspondente. Os arquivos de workflow já usam esses caminhos; confira se o usuário SSH tem permissão de escrita em `/opt/comunidade-prod` e `/opt/comunidade-stage`.

---

## 14. Resumo – o que fica onde

- **Evo:** continua no diretório atual (ex.: RPM/evo), com os mesmos `server` blocks no Nginx e portas 80/443 compartilhadas.
- **Comunidade:**  
  - Containers em **/opt/comunidade-prod** e **/opt/comunidade-stage**, escutando só em **127.0.0.1** (13000, 13001, 13002, 13003).  
  - Nginx do **host** recebe tráfego em 80/443 e encaminha por `server_name` para essas portas, sem alterar a configuração do evo.

Assim a Comunidade RPM fica isolada por subdomínio e porta, e o evo segue funcionando como antes.
