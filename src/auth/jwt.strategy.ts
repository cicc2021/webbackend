import { Injectable, UnauthorizedException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PassportStrategy } from '@nestjs/passport';
import { ExtractJwt, Strategy } from 'passport-jwt';
import { AuthConfig } from '../config/configuration';
import { AuthUser } from '../common/decorators';
import { PrismaService } from '../prisma/prisma.service';

@Injectable()
export class JwtStrategy extends PassportStrategy(Strategy) {
  constructor(
    config: ConfigService,
    private readonly prisma: PrismaService,
  ) {
    super({
      jwtFromRequest: ExtractJwt.fromAuthHeaderAsBearerToken(),
      secretOrKey: config.getOrThrow<AuthConfig>('auth').jwtSecret,
      algorithms: ['HS256'],
    });
  }

  /** Checked on every request, so disabling an account or changing its role takes effect at once. */
  async validate(payload: { sub: string; email: string; role: string; type: string }): Promise<AuthUser> {
    if (payload.type !== 'access') throw new UnauthorizedException();
    const user = await this.prisma.user.findUnique({ where: { id: payload.sub }, select: { email: true, role: true, isActive: true } });
    if (!user?.isActive) throw new UnauthorizedException();
    return { userId: payload.sub, email: user.email, role: user.role };
  }
}
