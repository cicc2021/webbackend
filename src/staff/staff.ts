import { Body, Controller, Delete, Get, HttpCode, Injectable, Module, Param, ParseUUIDPipe, Patch, Post, UseGuards } from '@nestjs/common';
import { PartialType } from '@nestjs/swagger';
import { SkipThrottle } from '@nestjs/throttler';
import { IsBoolean, IsEmail, IsInt, IsOptional, IsString, IsUUID, MaxLength, MinLength, ValidateIf } from 'class-validator';
import { AdminGuard } from '../common/admin.guard';
import { Public } from '../common/decorators';
import { PrismaService } from '../prisma/prisma.service';

/** The group whose (single) member is named on the website. Every other group shows countries only. */
export const PRESIDENT_GROUP = "President's Desk";

export class CreateStaffDto {
  @IsString() @MinLength(1) @MaxLength(200) name: string;
  @IsString() @MinLength(1) @MaxLength(200) designation: string;
  @IsOptional() @IsString() @MaxLength(100) group?: string;
  @IsOptional() @IsString() @MaxLength(100) country?: string;
  @IsOptional() @ValidateIf((o) => o.email !== '') @IsEmail() email?: string;
  @IsOptional() @IsString() @MaxLength(60) phone?: string;
  @IsOptional() @IsString() @MaxLength(300) linkedin?: string;
  @IsOptional() @IsString() @MaxLength(200) location?: string;
  @IsOptional() @IsString() @MaxLength(4000) bio?: string;
  @IsOptional() @IsString() @MaxLength(1000) photoUrl?: string;
  @IsOptional() @IsInt() sortOrder?: number;
  @IsOptional() @IsBoolean() isPublished?: boolean;
  /** Department page to list this person on; null for the main MHQ team page. */
  @IsOptional() @ValidateIf((o) => o.pageId !== null) @IsUUID() pageId?: string | null;
}
export class UpdateStaffDto extends PartialType(CreateStaffDto) {}

@Injectable()
export class StaffService {
  constructor(private readonly prisma: PrismaService) {}

  /**
   * What the public may see of the team: the President's name and position, and for every other
   * body only the countries it represents. Names, positions and contact details stay internal.
   */
  async governance() {
    const people = await this.prisma.staffMember.findMany({
      where: { isPublished: true, pageId: null },
      orderBy: [{ sortOrder: 'asc' }, { name: 'asc' }],
      select: { name: true, designation: true, group: true, country: true },
    });
    const president = people.find((p) => p.group === PRESIDENT_GROUP);
    const bodies: { name: string; countries: string[] }[] = [];
    for (const p of people) {
      if (p.group === PRESIDENT_GROUP) continue;
      let body = bodies.find((b) => b.name === p.group);
      if (!body) bodies.push((body = { name: p.group, countries: [] }));
      const country = p.country.trim();
      if (country && !body.countries.includes(country)) body.countries.push(country);
    }
    for (const b of bodies) b.countries.sort((x, y) => x.localeCompare(y));
    return { president: president ? { name: president.name, designation: president.designation } : null, bodies };
  }
  listAll() {
    return this.prisma.staffMember.findMany({
      orderBy: [{ sortOrder: 'asc' }, { name: 'asc' }],
      include: { page: { select: { id: true, title: true, path: true } } },
    });
  }
  get(id: string) {
    return this.prisma.staffMember.findUniqueOrThrow({ where: { id } });
  }
  create(dto: CreateStaffDto) {
    return this.prisma.staffMember.create({ data: dto });
  }
  update(id: string, dto: UpdateStaffDto) {
    return this.prisma.staffMember.update({ where: { id }, data: dto });
  }
  async remove(id: string) {
    await this.prisma.staffMember.delete({ where: { id } });
  }
}

@Public()
@SkipThrottle()
@Controller()
export class PublicStaffController {
  constructor(private readonly staff: StaffService) {}
  @Get('governance') governance() {
    return this.staff.governance();
  }
  /** Retired: it used to list names. Kept so older website builds get an empty team, not an error. */
  @Get('staff') list() {
    return [];
  }
}

@UseGuards(AdminGuard)
@Controller('admin/staff')
export class AdminStaffController {
  constructor(private readonly staff: StaffService) {}
  @Get() list() {
    return this.staff.listAll();
  }
  @Get(':id') get(@Param('id', ParseUUIDPipe) id: string) {
    return this.staff.get(id);
  }
  @Post() create(@Body() dto: CreateStaffDto) {
    return this.staff.create(dto);
  }
  @Patch(':id') update(@Param('id', ParseUUIDPipe) id: string, @Body() dto: UpdateStaffDto) {
    return this.staff.update(id, dto);
  }
  @HttpCode(204) @Delete(':id') remove(@Param('id', ParseUUIDPipe) id: string) {
    return this.staff.remove(id);
  }
}

@Module({ controllers: [PublicStaffController, AdminStaffController], providers: [StaffService] })
export class StaffModule {}
