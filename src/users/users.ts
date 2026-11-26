import { BadRequestException, Body, Controller, Delete, Get, HttpCode, Injectable, Module, Param, ParseUUIDPipe, Patch, Post, UseGuards } from '@nestjs/common';
import { Role } from '@prisma/client';
import { IsBoolean, IsEmail, IsEnum, IsOptional, IsString, MaxLength, MinLength } from 'class-validator';
import { hashPassword } from '../auth/password';
import { SuperAdminGuard } from '../common/admin.guard';
import { CurrentUser } from '../common/decorators';
import { PrismaService } from '../prisma/prisma.service';

export class CreateUserDto {
  @IsEmail() @MaxLength(254) email: string;
  @IsString() @MinLength(1) @MaxLength(120) name: string;
  @IsEnum(Role) role: Role;
  @IsString() @MinLength(10) @MaxLength(200) password: string;
}
export class UpdateUserDto {
  @IsOptional() @IsString() @MinLength(1) @MaxLength(120) name?: string;
  @IsOptional() @IsEnum(Role) role?: Role;
  @IsOptional() @IsBoolean() isActive?: boolean;
  /** Setting a new password signs the person out everywhere. */
  @IsOptional() @IsString() @MinLength(10) @MaxLength(200) password?: string;
}

const PUBLIC = { id: true, email: true, name: true, role: true, isActive: true, lastLoginAt: true, createdAt: true } as const;

@Injectable()
export class UsersService {
  constructor(private readonly prisma: PrismaService) {}

  list() {
    return this.prisma.user.findMany({ orderBy: [{ isActive: 'desc' }, { name: 'asc' }], select: PUBLIC });
  }

  async create(dto: CreateUserDto) {
    return this.prisma.user.create({
      data: { email: dto.email.toLowerCase(), name: dto.name, role: dto.role, passwordHash: await hashPassword(dto.password) },
      select: PUBLIC,
    });
  }

  /** The site must always keep one active administrator who can manage accounts. */
  private async assertAdminRemains(exceptId: string) {
    const others = await this.prisma.user.count({ where: { role: 'ADMIN', isActive: true, id: { not: exceptId } } });
    if (others === 0) throw new BadRequestException('There must always be at least one active administrator');
  }

  async update(actorId: string, id: string, dto: UpdateUserDto) {
    const target = await this.prisma.user.findUniqueOrThrow({ where: { id } });
    if (id === actorId && dto.isActive === false) throw new BadRequestException('You cannot disable your own account');
    const losesAdmin = target.role === 'ADMIN' && target.isActive && (dto.role === 'EDITOR' || dto.isActive === false);
    if (losesAdmin) await this.assertAdminRemains(id);
    const { password, ...rest } = dto;
    const data = { ...rest, ...(password ? { passwordHash: await hashPassword(password) } : {}) };
    return this.prisma.$transaction(async (tx) => {
      const user = await tx.user.update({ where: { id }, data, select: PUBLIC });
      // A new password, a role change or disabling the account ends that person's existing sessions.
      if (password || dto.isActive === false || (dto.role && dto.role !== target.role)) {
        await tx.session.updateMany({ where: { userId: id, revokedAt: null }, data: { revokedAt: new Date() } });
      }
      return user;
    });
  }

  async remove(actorId: string, id: string) {
    if (id === actorId) throw new BadRequestException('You cannot delete your own account');
    const target = await this.prisma.user.findUniqueOrThrow({ where: { id } });
    if (target.role === 'ADMIN' && target.isActive) await this.assertAdminRemains(id);
    await this.prisma.user.delete({ where: { id } });
  }
}

@UseGuards(SuperAdminGuard)
@Controller('admin/users')
export class UsersController {
  constructor(private readonly users: UsersService) {}
  @Get() list() {
    return this.users.list();
  }
  @Post() create(@Body() dto: CreateUserDto) {
    return this.users.create(dto);
  }
  @Patch(':id') update(@CurrentUser('userId') actor: string, @Param('id', ParseUUIDPipe) id: string, @Body() dto: UpdateUserDto) {
    return this.users.update(actor, id, dto);
  }
  @HttpCode(204) @Delete(':id') remove(@CurrentUser('userId') actor: string, @Param('id', ParseUUIDPipe) id: string) {
    return this.users.remove(actor, id);
  }
}

@Module({ controllers: [UsersController], providers: [UsersService] })
export class UsersModule {}
