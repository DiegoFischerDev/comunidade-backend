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

Copia `backend/.env.example` para `backend/.env` e preenche os valores.

**Docker Compose** (`deploy/docker-compose*.yml`): o serviço `backend` usa `env_file: .env` — não é preciso repetir cada variável no YAML; só `PORT`, `NODE_ENV` e `DATABASE_URL` ficam explícitos (esta última aponta para o serviço `postgres`).

## Variáveis de ambiente (essenciais)

| Variável | Descrição |
|----------|-----------|
| `PORT` / `NODE_ENV` | Porta e ambiente. |
| `DATABASE_URL` | PostgreSQL (local: porta **5433** no host com `docker compose` na raiz do repo). |
| `JWT_SECRET` | Segredo JWT (produção: longo e aleatório). |
| `FRONTEND_URL` | URL do Next.js (CORS, links). |
| `PUBLIC_API_BASE_URL` | URL pública desta API (links a `/uploads/...` em imóveis; alinhar com `NEXT_PUBLIC_API_URL`). |
| `COMMUNITY_INTERNAL_SECRET` | Igual ao **wa-verify-receiver** (confirmação de registo WhatsApp). |
| `EVOLUTION_API_URL`, `EVOLUTION_API_KEY`, `EVOLUTION_INSTANCE` (+ secundária / ativa / failover, opcional) | Evolution API. |
| `EVOLUTION_HOUSES_RELOCATION_GROUP_JID` | JID do grupo de anúncios de imóveis (`EVOLUTION_HOUSES_GROUP_JID` é alias no código). |
| `WHATSAPP_REGISTRATION_NUMBER` (+ secundário, opcional) | Números nos links `wa.me` (sem `+`). |
| `STRIPE_SECRET_KEY`, `STRIPE_WEBHOOK_SECRET`, `STRIPE_AMOUNT_EUR_CENTS`, `STRIPE_PIX_AMOUNT_BRL` | Stripe. |
| `STRIPE_RAFA_CALL_EUR_CENTS`, `STRIPE_RAFA_CALL_PIX_BRL`, `RAFA_CALL_*` | Rafa Call (preços e horários em JSON). |

**R2 (opcional):** `R2_ENDPOINT`, `R2_BUCKET`, `R2_ACCESS_KEY_ID`, `R2_SECRET_ACCESS_KEY`, `R2_PUBLIC_BASE_URL` — sem isto, media fica em `uploads/houses/` no disco.

### Afinamento (opcional, omissões no código).

Não precisas de definir nada disto no `.env` em condições normais.

- **Transcodificação de vídeo** (`HOUSE_VIDEO_*`): omissões em `src/partner/house-video-transcode.ts` (ex. CRF 28, largura máx. 1280). Define só se quiseres desativar (`HOUSE_VIDEO_TRANSCODE_ENABLED=0`) ou afinar qualidade.
- **Evolution / timeouts / base64** (`EVOLUTION_REQUEST_TIMEOUT_MS`, `EVOLUTION_VIDEO_MAX_BASE64_FALLBACK_BYTES`, `MEDIA_PUBLIC_URL_READY_MAX_WAIT_MS`, etc.): omissões em `whatsapp.service.ts` e `partner.service.ts`.
- **Nginx à frente da Evolution:** `client_max_body_size` e `proxy_read_timeout` altos o suficiente para vídeos.

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
