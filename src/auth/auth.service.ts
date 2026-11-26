import { Injectable, UnauthorizedException } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { createHash, randomBytes, randomUUID } from 'node:crypto';
import { PrismaService } from '../prisma/prisma.service';
import { hashPassword, verifyPassword } from './password';

const REFRESH_TTL_MS = 30 * 24 * 60 * 60 * 1000;
const hashToken = (t: string) => createHash('sha256').update(t).digest('hex');
/** Compared against when the email is unknown, so response time doesn't reveal which emails exist. */
const DUMMY_HASH = hashPassword(randomBytes(16).toString('hex'));

@Injectable()
export class AuthService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly jwt: JwtService,
  ) {}

  private publicUser(u: { id: string; email: string; name: string; role: string }) {
    return { id: u.id, email: u.email, name: u.name, role: u.role };
  }

  private async issue(user: { id: string; email: string; role: string }, familyId: string) {
    const refreshToken = randomBytes(48).toString('base64url');
    await this.prisma.session.create({
      data: {
        userId: user.id,
        familyId,
        tokenHash: hashToken(refreshToken),
        expiresAt: new Date(Date.now() + REFRESH_TTL_MS),
      },
    });
    const accessToken = await this.jwt.signAsync({ sub: user.id, email: user.email, role: user.role, type: 'access' });
    return { accessToken, refreshToken };
  }

  async login(email: string, password: string) {
    const user = await this.prisma.user.findUnique({ where: { email: email.toLowerCase() } });
    const ok = await verifyPassword(password, user?.passwordHash ?? (await DUMMY_HASH));
    if (!user || !ok) throw new UnauthorizedException('Invalid email or password');
    if (!user.isActive) throw new UnauthorizedException('This account has been disabled');
    await this.prisma.user.update({ where: { id: user.id }, data: { lastLoginAt: new Date() } });
    return { ...(await this.issue(user, randomUUID())), user: this.publicUser(user) };
  }

  /** Rotates the token. Presenting an already-rotated token is treated as theft. */
  async refresh(refreshToken: string | undefined) {
    if (!refreshToken) throw new UnauthorizedException('No session');
    const tokenHash = hashToken(refreshToken);
    const session = await this.prisma.session.findUnique({ where: { tokenHash }, include: { user: true } });
    if (!session) throw new UnauthorizedException('Invalid session');
    if (session.expiresAt < new Date()) throw new UnauthorizedException('Session expired');
    if (!session.user.isActive) throw new UnauthorizedException('This account has been disabled');

    // Conditional update: of two concurrent refreshes, only one can claim the token.
    const claimed = await this.prisma.session.updateMany({
      where: { id: session.id, revokedAt: null },
      data: { revokedAt: new Date() },
    });
    if (claimed.count === 0) {
      await this.prisma.session.updateMany({
        where: { familyId: session.familyId, revokedAt: null },
        data: { revokedAt: new Date() },
      });
      throw new UnauthorizedException('Session reuse detected');
    }
    return { ...(await this.issue(session.user, session.familyId)), user: this.publicUser(session.user) };
  }

  async logout(refreshToken: string | undefined) {
    if (!refreshToken) return;
    const session = await this.prisma.session.findUnique({ where: { tokenHash: hashToken(refreshToken) } });
    if (session) {
      await this.prisma.session.updateMany({
        where: { familyId: session.familyId, revokedAt: null },
        data: { revokedAt: new Date() },
      });
    }
  }

  async me(userId: string) {
    const user = await this.prisma.user.findUnique({ where: { id: userId } });
    if (!user || !user.isActive) throw new UnauthorizedException();
    return this.publicUser(user);
  }

  /** Revokes every session, so a leaked password stops working everywhere. */
  async changePassword(userId: string, current: string, next: string) {
    const user = await this.prisma.user.findUniqueOrThrow({ where: { id: userId } });
    if (!(await verifyPassword(current, user.passwordHash))) throw new UnauthorizedException('Current password is incorrect');
    await this.prisma.$transaction([
      this.prisma.user.update({ where: { id: userId }, data: { passwordHash: await hashPassword(next) } }),
      this.prisma.session.updateMany({ where: { userId, revokedAt: null }, data: { revokedAt: new Date() } }),
    ]);
  }
}
