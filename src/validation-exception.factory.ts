import { BadRequestException } from '@nestjs/common';
import { ValidationError } from 'class-validator';

/** Mensagens fixas do class-validator (inglês) → português. */
function translateKnownValidationMessage(msg: string): string {
  const m = msg.match(/^property (\S+) should not exist$/i);
  if (m) {
    return `O campo «${m[1]}» não é permitido neste pedido.`;
  }
  return msg;
}

function collectMessages(errors: ValidationError[]): string[] {
  const out: string[] = [];
  for (const err of errors) {
    if (err.constraints) {
      for (const msg of Object.values(err.constraints)) {
        out.push(translateKnownValidationMessage(msg as string));
      }
    }
    if (err.children?.length) {
      out.push(...collectMessages(err.children));
    }
  }
  return out;
}

/** Igual ao pipe predefinido do Nest, mas com traduções pontuais para o cliente. */
export function validationExceptionFactory(errors: ValidationError[]) {
  const messages = collectMessages(errors);
  const payload =
    messages.length === 0
      ? 'Os dados enviados não são válidos.'
      : messages.length === 1
        ? messages[0]
        : messages;
  return new BadRequestException(payload);
}
