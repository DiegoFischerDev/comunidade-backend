<p align="center">
  <a href="http://nestjs.com/" target="blank"><img src="https://nestjs.com/img/logo-small.svg" width="120" alt="Nest Logo" /></a>
</p>

[circleci-image]: https://img.shields.io/circleci/build/github/nestjs/nest/master?token=abc123def456
[circleci-url]: https://circleci.com/gh/nestjs/nest

  <p align="center">A progressive <a href="http://nodejs.org" target="_blank">Node.js</a> framework for building efficient and scalable server-side applications.</p>
    <p align="center">
<a href="https://www.npmjs.com/~nestjscore" target="_blank"><img src="https://img.shields.io/npm/v/@nestjs/core.svg" alt="NPM Version" /></a>
<a href="https://www.npmjs.com/~nestjscore" target="_blank"><img src="https://img.shields.io/npm/l/@nestjs/core.svg" alt="Package License" /></a>
<a href="https://www.npmjs.com/~nestjscore" target="_blank"><img src="https://img.shields.io/npm/dm/@nestjs/common.svg" alt="NPM Downloads" /></a>
<a href="https://circleci.com/gh/nestjs/nest" target="_blank"><img src="https://img.shields.io/circleci/build/github/nestjs/nest/master" alt="CircleCI" /></a>
<a href="https://discord.gg/G7Qnnhy" target="_blank"><img src="https://img.shields.io/badge/discord-online-brightgreen.svg" alt="Discord"/></a>
<a href="https://opencollective.com/nest#backer" target="_blank"><img src="https://opencollective.com/nest/backers/badge.svg" alt="Backers on Open Collective" /></a>
<a href="https://opencollective.com/nest#sponsor" target="_blank"><img src="https://opencollective.com/nest/sponsors/badge.svg" alt="Sponsors on Open Collective" /></a>
  <a href="https://paypal.me/kamilmysliwiec" target="_blank"><img src="https://img.shields.io/badge/Donate-PayPal-ff3f59.svg" alt="Donate us"/></a>
    <a href="https://opencollective.com/nest#sponsor"  target="_blank"><img src="https://img.shields.io/badge/Support%20us-Open%20Collective-41B883.svg" alt="Support us"></a>
  <a href="https://twitter.com/nestframework" target="_blank"><img src="https://img.shields.io/twitter/follow/nestframework.svg?style=social&label=Follow" alt="Follow us on Twitter"></a>
</p>
  <!--[![Backers on Open Collective](https://opencollective.com/nest/backers/badge.svg)](https://opencollective.com/nest#backer)
  [![Sponsors on Open Collective](https://opencollective.com/nest/sponsors/badge.svg)](https://opencollective.com/nest#sponsor)-->

## Description

[Nest](https://github.com/nestjs/nest) framework TypeScript starter repository.

## Project setup

```bash
$ npm install
```

Copia `backend/.env.example` para `backend/.env` e preenche os valores. O `.env.example` lista só chaves e valores de exemplo; a documentação está nesta secção.

## Variáveis de ambiente

### Aplicação e base de dados

| Variável | Descrição |
|----------|-----------|
| `PORT` | Porta HTTP do backend (ex.: `3001`). |
| `NODE_ENV` | `development` ou `production`. |
| `DATABASE_URL` | Connection string PostgreSQL. Em desenvolvimento, o projeto usa Postgres na porta **5433** no host para não colidir com outra instância local; sobe com `docker compose up -d` na pasta do repositório (ver `docker-compose` na raiz do monorepo). |

### JWT e URLs públicas

| Variável | Descrição |
|----------|-----------|
| `JWT_SECRET` | Segredo para assinar tokens; em produção deve ser longo e aleatório. |
| `FRONTEND_URL` | URL do site Next.js (CORS e links em emails/mensagens, ex. boas-vindas WhatsApp após registo). |
| `PUBLIC_API_BASE_URL` | URL absoluta desta API quando o servidor precisa de gerar links para ficheiros servidos pelo backend (ex. imóveis com media em disco: gravam `/uploads/...` na BD; o frontend costuma usar `NEXT_PUBLIC_API_URL` alinhado com isto). |

### Cloudflare R2 (opcional)

Sem estas variáveis, imagens/vídeos de imóveis ficam em `uploads/houses/` no disco.

| Variável | Descrição |
|----------|-----------|
| `R2_ENDPOINT` | Endpoint S3-compatible, ex.: `https://<accountid>.r2.cloudflarestorage.com`. |
| `R2_BUCKET` | Nome do bucket. |
| `R2_ACCESS_KEY_ID` / `R2_SECRET_ACCESS_KEY` | Credenciais R2. |
| `R2_PUBLIC_BASE_URL` | URL pública (custom domain ou r2.dev) para ficheiros; sem barra final. |

### Vídeo de imóveis (transcodificação)

No upload, vídeos **maiores que ~400 KB** são reencodados com **ffmpeg** (binário via pacote `ffmpeg-static`) para **MP4 (H.264 + AAC)**, largura máx. reduzida e bitrate mais baixo — o ficheiro guardado e enviado ao WhatsApp fica tipicamente **muito mais leve**, o que evita falhas por tamanho. Se a transcodificação falhar, usa-se o original.

| Variável | Descrição |
|----------|-----------|
| `HOUSE_VIDEO_TRANSCODE_ENABLED` | `0` / `false` / `off` desativa. Omissão: ativo. |
| `HOUSE_VIDEO_TRANSCODE_MIN_INPUT_BYTES` | Só reencoda se o upload for **maior** que isto (omissão: `400000`). |
| `HOUSE_VIDEO_MAX_WIDTH` | Largura máxima em px; escala mantendo proporção (omissão: `1280`). |
| `HOUSE_VIDEO_CRF` | Qualidade libx264 (`18`–`51`; **maior** = ficheiro menor, omissão `28`). |
| `HOUSE_VIDEO_AUDIO_KBPS` | Bitrate AAC aproximado em kb/s (omissão: `96`). |
| `HOUSE_VIDEO_FFMPEG_TIMEOUT_MS` | Tempo máximo do processo ffmpeg em ms (omissão: `900000`, 15 min). |

### Confirmação de registo via WhatsApp

| Variável | Descrição |
|----------|-----------|
| `COMMUNITY_INTERNAL_SECRET` | Segredo partilhado com o serviço que recebe webhooks da Evolution (`POST /auth/whatsapp/confirm`). Deve coincidir com `COMMUNITY_INTERNAL_SECRET` no projeto **wa-verify-receiver** (ou equivalente). |

### Evolution API e envio WhatsApp

| Variável | Descrição |
|----------|-----------|
| `EVOLUTION_API_URL` | URL base da Evolution (sem barra final). |
| `EVOLUTION_API_KEY` | Chave da API (`apikey` no header). |
| `EVOLUTION_INSTANCE` | Nome da instância principal. |
| `EVOLUTION_INSTANCE_SECONDARY` | Instância extra (opcional), ex. chatbot. |
| `EVOLUTION_ACTIVE_INSTANCE` | Força qual instância tentar primeiro (opcional). |
| `EVOLUTION_FAILOVER_ENABLED` | `1` (omissão): tenta a secundária se a principal falhar. |
| `EVOLUTION_HOUSES_RELOCATION_GROUP_JID` ou `EVOLUTION_HOUSES_GROUP_JID` | JID do grupo WhatsApp dos anúncios de imóveis (relocation), ex. `120363...@g.us`. |

### Vídeo no WhatsApp (Evolution) e limites

O envio de vídeo usa URL pública (recomendado) ou, em último recurso, base64 no JSON. Vídeos grandes falham facilmente se o proxy tiver corpo de pedido baixo ou timeouts curtos.

| Variável | Descrição |
|----------|-----------|
| `EVOLUTION_MAX_MEDIA_BASE64_CHARS` | Teto de caracteres base64 por pedido (útil se o nginx limitar o body). Ex.: `4000000`. Omissão: sem teto além do limite prático do WhatsApp (~16 MB). |
| `EVOLUTION_VIDEO_MAX_BASE64_FALLBACK_BYTES` | Acima deste tamanho em **bytes do ficheiro**, o backend não tenta fallback em base64 (JSON grande → frequentemente **413** no nginx). Omissão: `2097152` (2 MB). |
| `EVOLUTION_REQUEST_TIMEOUT_MS` | Timeout do `fetch` do **backend para a Evolution** (ms). Omissão: `180000` (3 min). |
| `MEDIA_PUBLIC_URL_READY_MAX_WAIT_MS` | Tempo máximo de polling até a URL pública do vídeo (R2/CDN) responder antes de chamar a Evolution. Omissão: ~20 s (ficheiros pequenos) e ~90 s (vídeos ≥ 3 MB no código). |

### Nginx (ou outro proxy) à frente da Evolution

No servidor onde corre a Evolution API:

- `client_max_body_size` alto se algum fluxo enviar mídia em base64 (ex.: `50m`).
- `proxy_read_timeout` / `send_timeout` altos para a Evolution **descarregar o vídeo pela URL pública** (ex.: 120 s ou mais).

### Números WhatsApp (links públicos)

| Variável | Descrição |
|----------|-----------|
| `WHATSAPP_REGISTRATION_NUMBER` | Número no link `wa.me/...` do registo (sem `+`). |
| `WHATSAPP_REGISTRATION_NUMBER_SECONDARY` | Número alternativo (opcional), ex. automações. |

### Stripe

| Variável | Descrição |
|----------|-----------|
| `STRIPE_SECRET_KEY` | Chave secreta Stripe. |
| `STRIPE_WEBHOOK_SECRET` | Segredo do webhook (`whsec_...`). |
| `STRIPE_AMOUNT_EUR_CENTS` | Valor da anuidade em **cêntimos** EUR (cartão, MB WAY). Ex.: `2300` = 23,00 €. |
| `STRIPE_PIX_AMOUNT_BRL` | Valor em **centavos** BRL (Pix). Ex.: `2300` = R$ 23,00. |
| `STRIPE_RAFA_CALL_EUR_CENTS` | Taxa de novo agendamento Rafa Call (EUR, cêntimos), após consumir a chamada incluída. |
| `STRIPE_RAFA_CALL_PIX_BRL` | Idem para Pix (BRL, centavos). |

### Agendamento Rafa Call (Cal.com interno)

| Variável | Descrição |
|----------|-----------|
| `RAFA_CALL_DURATION_MINUTES` | Duração padrão da chamada. |
| `RAFA_CALL_BUFFER_MINUTES` | Folga entre slots. |
| `RAFA_CALL_WINDOW_DAYS` | Dias à frente para mostrar disponibilidade no popup. |
| `RAFA_CALL_WORKING_HOURS_JSON` | JSON por dia da semana: lista de intervalos `[início, fim]` no timezone do utilizador. Chaves: `mon` … `sun`. Exemplo: `{"mon":[["10:00","18:00"]],"tue":[["10:00","18:00"]],"sat":[],"sun":[]}`. |

## Compile and run the project

```bash
# development
$ npm run start

# watch mode
$ npm run start:dev

# production mode
$ npm run start:prod
```

## Run tests

```bash
# unit tests
$ npm run test

# e2e tests
$ npm run test:e2e

# test coverage
$ npm run test:cov
```

## Deployment.

When you're ready to deploy your NestJS application to production, there are some key steps you can take to ensure it runs as efficiently as possible. Check out the [deployment documentation](https://docs.nestjs.com/deployment) for more information

If you are looking for a cloud-based platform to deploy your NestJS application, check out [Mau](https://mau.nestjs.com), our official platform for deploying NestJS applications on AWS. Mau makes deployment straightforward and fast, requiring just a few simple steps:

```bash
$ npm install -g @nestjs/mau
$ mau deploy
```

With Mau, you can deploy your application in just a few clicks, allowing you to focus on building features rather than managing infrastructure

## Resources

Check out a few resources that may come in handy when working with NestJS:

- Visit the [NestJS Documentation](https://docs.nestjs.com) to learn more about the framework
- For questions and support, please visit our [Discord channel](https://discord.gg/G7Qnnhy).
- To dive deeper and get more hands-on experience, check out our official video [courses](https://courses.nestjs.com/)
- Deploy your application to AWS with the help of [NestJS Mau](https://mau.nestjs.com) in just a few clicks.
- Visualize your application graph and interact with the NestJS application in real-time using [NestJS Devtools](https://devtools.nestjs.com).
- Need help with your project (part-time to full-time)? Check out our official [enterprise support](https://enterprise.nestjs.com).
- To stay in the loop and get updates, follow us on [X](https://x.com/nestframework) and [LinkedIn](https://linkedin.com/company/nestjs).
- Looking for a job, or have a job to offer? Check out our official [Jobs board](https://jobs.nestjs.com).

## Support

Nest is an MIT-licensed open source project. It can grow thanks to the sponsors and support by the amazing backers. If you'd like to join them, please [read more here](https://docs.nestjs.com/support).

## Stay in touch

- Author - [Kamil Myśliwiec](https://twitter.com/kammysliwiec)
- Website - [https://nestjs.com](https://nestjs.com/)
- Twitter - [@nestframework](https://twitter.com/nestframework)

## License

Nest is [MIT licensed](https://github.com/nestjs/nest/blob/master/LICENSE)
