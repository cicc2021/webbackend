import { PartialType } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { IsArray, IsBoolean, IsDateString, IsEmail, IsEnum, IsIn, IsInt, IsOptional, IsString, IsUUID, Matches, Max, MaxLength, Min, MinLength, ValidateNested } from 'class-validator';
import { PublishStatus, RegistrationStatus } from '@prisma/client';

export class EventCategoryDto {
  @IsString() @MinLength(1) @MaxLength(100) name: string;
  @IsOptional() @IsString() @MaxLength(100) slug?: string;
  @IsOptional() @IsString() @MaxLength(1000) description?: string;
  @IsOptional() @Matches(/^#[0-9a-f]{6}$/i) color?: string;
  @IsOptional() @IsInt() sortOrder?: number;
}

export class EventPackageDto {
  /** Present when editing an existing package; omitted for a new one. */
  @IsOptional() @IsUUID() id?: string;
  @IsString() @MinLength(1) @MaxLength(150) name: string;
  @IsOptional() @IsString() @MaxLength(2000) description?: string;
  /** Fixed-precision string. Null or empty means price on request. */
  @IsOptional() @Matches(/^(\d{1,10}(\.\d{1,2})?)?$/) price?: string | null;
  @IsOptional() @Matches(/^[A-Z]{3}$/) currency?: string;
  @IsOptional() @IsArray() @IsString({ each: true }) @MaxLength(300, { each: true }) features?: string[];
  @IsOptional() @IsInt() @Min(1) capacity?: number | null;
  @IsOptional() @IsInt() sortOrder?: number;
  @IsOptional() @IsBoolean() isActive?: boolean;
}

export class CreateEventDto {
  @IsString() @MinLength(1) @MaxLength(300) title: string;
  @IsOptional() @IsString() @MaxLength(100) slug?: string;
  @IsOptional() @IsString() @MaxLength(1000) summary?: string;
  @IsOptional() @IsString() content?: string;
  @IsOptional() @IsString() @MaxLength(1000) coverUrl?: string;
  @IsOptional() @IsString() @MaxLength(300) location?: string;
  @IsDateString() startAt: string;
  @IsDateString() endAt: string;
  @IsOptional() @IsInt() @Min(1) capacity?: number | null;
  @IsOptional() @IsBoolean() isFeatured?: boolean;
  @IsOptional() @IsEnum(PublishStatus) status?: PublishStatus;
  @IsOptional() @IsUUID() categoryId?: string | null;
  @IsOptional() @IsArray() @ValidateNested({ each: true }) @Type(() => EventPackageDto) packages?: EventPackageDto[];
}
export class UpdateEventDto extends PartialType(CreateEventDto) {}

export class RegisterDto {
  @IsOptional() @IsUUID() packageId?: string;
  @IsString() @MinLength(2) @MaxLength(200) fullName: string;
  @IsEmail() @MaxLength(254) email: string;
  @IsString() @MinLength(5) @MaxLength(60) phone: string;
  @IsOptional() @IsString() @MaxLength(200) organization?: string;
  @IsOptional() @IsString() @MaxLength(100) country?: string;
  @IsInt() @Min(1) @Max(50) attendees: number;
  @IsOptional() @IsString() @MaxLength(2000) notes?: string;
}

export class RegistrationStatusDto {
  @IsEnum(RegistrationStatus) status: RegistrationStatus;
}

export class EventQueryDto {
  @IsOptional() @IsDateString() from?: string;
  @IsOptional() @IsDateString() to?: string;
  @IsOptional() @IsString() @MaxLength(100) category?: string;
  @IsOptional() @IsIn(['upcoming', 'past', 'all']) when?: 'upcoming' | 'past' | 'all';
  @IsOptional() @IsString() @MaxLength(100) search?: string;
}
