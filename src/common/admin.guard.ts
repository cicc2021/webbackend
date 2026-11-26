import { CanActivate, ExecutionContext, Injectable } from '@nestjs/common';
import { AuthUser } from './decorators';

/** Content management: administrators and editors. */
@Injectable()
export class AdminGuard implements CanActivate {
  canActivate(ctx: ExecutionContext) {
    const user = ctx.switchToHttp().getRequest().user as AuthUser | undefined;
    return user?.role === 'ADMIN' || user?.role === 'EDITOR';
  }
}

/** Account management: administrators only. */
@Injectable()
export class SuperAdminGuard implements CanActivate {
  canActivate(ctx: ExecutionContext) {
    return (ctx.switchToHttp().getRequest().user as AuthUser | undefined)?.role === 'ADMIN';
  }
}
