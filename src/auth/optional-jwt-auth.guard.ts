import { ExecutionContext, Injectable } from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';

/**
 * Em rotas @Public(), valida JWT quando enviado (Authorization: Bearer)
 * e preenche request.user; sem token ou inválido, segue como anónimo.
 */
@Injectable()
export class OptionalJwtAuthGuard extends AuthGuard('jwt') {
  canActivate(context: ExecutionContext) {
    const request = context.switchToHttp().getRequest<{ headers?: { authorization?: string } }>();
    const auth = request.headers?.authorization;
    const hasBearer =
      typeof auth === 'string' && auth.trim().toLowerCase().startsWith('bearer ');
    if (!hasBearer) {
      return true;
    }
    return super.canActivate(context) as boolean | Promise<boolean>;
  }

  handleRequest<TUser>(err: unknown, user: TUser | false): TUser | null {
    if (err || !user) {
      return null;
    }
    return user;
  }
}
