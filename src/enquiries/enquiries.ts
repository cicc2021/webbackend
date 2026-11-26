import { Body, Controller, Delete, Get, HttpCode, Injectable, Module, Param, ParseUUIDPipe, Patch, Post, UseGuards } from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import { IsBoolean, IsEmail, IsOptional, IsString, MaxLength, MinLength } from 'class-validator';
import { AdminGuard } from '../common/admin.guard';
import { Public } from '../common/decorators';
import { PrismaService } from '../prisma/prisma.service';

export class CreateEnquiryDto {
  @IsString() @MinLength(1) @MaxLength(120) subject: string;
  @IsOptional() @IsString() @MaxLength(120) option?: string;
  @IsString() @MinLength(2) @MaxLength(200) name: string;
  @IsEmail() @MaxLength(254) email: string;
  @IsOptional() @IsString() @MaxLength(60) phone?: string;
  @IsOptional() @IsString() @MaxLength(5000) message?: string;
}
class MarkEnquiryDto {
  @IsBoolean() isRead: boolean;
}

@Injectable()
export class EnquiriesService {
  constructor(private readonly prisma: PrismaService) {}
  create(dto: CreateEnquiryDto) {
    return this.prisma.enquiry.create({ data: dto, select: { id: true } });
  }
  list() {
    return this.prisma.enquiry.findMany({ orderBy: { createdAt: 'desc' }, take: 500 });
  }
  mark(id: string, isRead: boolean) {
    return this.prisma.enquiry.update({ where: { id }, data: { isRead } });
  }
  async remove(id: string) {
    await this.prisma.enquiry.delete({ where: { id } });
  }
}

@Public()
@Controller('enquiries')
export class PublicEnquiriesController {
  constructor(private readonly enquiries: EnquiriesService) {}
  @Throttle({ default: { limit: 5, ttl: 60_000 } })
  @Post() create(@Body() dto: CreateEnquiryDto) {
    return this.enquiries.create(dto);
  }
}

@UseGuards(AdminGuard)
@Controller('admin/enquiries')
export class AdminEnquiriesController {
  constructor(private readonly enquiries: EnquiriesService) {}
  @Get() list() {
    return this.enquiries.list();
  }
  @Patch(':id') mark(@Param('id', ParseUUIDPipe) id: string, @Body() dto: MarkEnquiryDto) {
    return this.enquiries.mark(id, dto.isRead);
  }
  @HttpCode(204) @Delete(':id') remove(@Param('id', ParseUUIDPipe) id: string) {
    return this.enquiries.remove(id);
  }
}

@Module({ controllers: [PublicEnquiriesController, AdminEnquiriesController], providers: [EnquiriesService] })
export class EnquiriesModule {}
