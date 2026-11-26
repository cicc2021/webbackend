import { Body, Controller, Get, HttpCode, Post, Req, Res } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Throttle } from '@nestjs/throttler';
import { CookieOptions, Request, Response } from 'express';
import { AuthConfig, AppConfig } from '../config/configuration';
import { CurrentUser, Public } from '../common/decorators';
import { ChangePasswordDto, LoginDto } from './auth.dto';
import { AuthService } from './auth.service';

const COOKIE = 'cicc_refresh';

/**
 * The refresh token lives in an httpOnly cookie that scripts can't read; the access token stays
 * in memory on the client. SameSite=Strict is the CSRF protection for the refresh endpoints,
 * which relies on the site and API sharing a parent domain.
 */
@Controller('auth')
export class AuthController {
  constructor(
    private readonly auth: AuthService,
    private readonly config: ConfigService,
  ) {}

  private cookieOptions(): CookieOptions {
    const { apiPrefix } = this.config.getOrThrow<AppConfig>('app');
    return {
      httpOnly: true,
      sameSite: 'strict',
      secure: this.config.getOrThrow<AuthConfig>('auth').cookieSecure,
      path: `/${apiPrefix}/auth`,
    };
  }

  private setCookie(res: Response, token: string) {
    res.cookie(COOKIE, token, { ...this.cookieOptions(), maxAge: 30 * 24 * 60 * 60 * 1000 });
  }

  @Public()
  @Throttle({ default: { limit: 10, ttl: 60_000 } })
  @HttpCode(200)
  @Post('login')
  async login(@Body() dto: LoginDto, @Res({ passthrough: true }) res: Response) {
    const { refreshToken, ...rest } = await this.auth.login(dto.email, dto.password);
    this.setCookie(res, refreshToken);
    return rest;
  }

  @Public()
  @Throttle({ default: { limit: 30, ttl: 60_000 } })
  @HttpCode(200)
  @Post('refresh')
  async refresh(@Req() req: Request, @Res({ passthrough: true }) res: Response) {
    const { refreshToken, ...rest } = await this.auth.refresh(req.cookies?.[COOKIE]);
    this.setCookie(res, refreshToken);
    return rest;
  }

  @Public()
  @HttpCode(204)
  @Post('logout')
  async logout(@Req() req: Request, @Res({ passthrough: true }) res: Response) {
    await this.auth.logout(req.cookies?.[COOKIE]);
    res.clearCookie(COOKIE, this.cookieOptions());
  }

  @Get('me')
  me(@CurrentUser('userId') userId: string) {
    return this.auth.me(userId);
  }

  @Throttle({ default: { limit: 10, ttl: 60_000 } })
  @HttpCode(204)
  @Post('change-password')
  async changePassword(
    @CurrentUser('userId') userId: string,
    @Body() dto: ChangePasswordDto,
    @Res({ passthrough: true }) res: Response,
  ) {
    await this.auth.changePassword(userId, dto.currentPassword, dto.newPassword);
    res.clearCookie(COOKIE, this.cookieOptions());
  }
}
