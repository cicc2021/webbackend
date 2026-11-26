import { Body, Controller, Delete, Get, HttpCode, Injectable, Module, NotFoundException, Param, ParseUUIDPipe, Patch, Post, Query, UseGuards } from '@nestjs/common';
import { PartialType } from '@nestjs/swagger';
import { SkipThrottle } from '@nestjs/throttler';
import { Prisma, PublishStatus } from '@prisma/client';
import { IsDateString, IsEnum, IsOptional, IsString, IsUUID, MaxLength, MinLength } from 'class-validator';
import { AdminGuard } from '../common/admin.guard';
import { Public } from '../common/decorators';
import { cleanHtml, slugify } from '../common/sanitize';
import { PrismaService } from '../prisma/prisma.service';

export class BlogCategoryDto {
  @IsString() @MinLength(1) @MaxLength(100) name: string;
  @IsOptional() @IsString() @MaxLength(100) slug?: string;
}
export class CreatePostDto {
  @IsString() @MinLength(1) @MaxLength(300) title: string;
  @IsOptional() @IsString() @MaxLength(100) slug?: string;
  @IsOptional() @IsString() @MaxLength(1000) excerpt?: string;
  @IsOptional() @IsString() content?: string;
  @IsOptional() @IsString() @MaxLength(1000) coverUrl?: string;
  @IsOptional() @IsString() @MaxLength(200) authorName?: string;
  @IsOptional() @IsEnum(PublishStatus) status?: PublishStatus;
  @IsOptional() @IsDateString() publishedAt?: string;
  @IsOptional() @IsUUID() categoryId?: string | null;
}
export class UpdatePostDto extends PartialType(CreatePostDto) {}

@Injectable()
export class BlogService {
  constructor(private readonly prisma: PrismaService) {}

  listCategories() {
    return this.prisma.blogCategory.findMany({ orderBy: { name: 'asc' }, include: { _count: { select: { posts: true } } } });
  }
  createCategory(dto: BlogCategoryDto) {
    return this.prisma.blogCategory.create({ data: { name: dto.name, slug: slugify(dto.slug || dto.name) } });
  }
  updateCategory(id: string, dto: BlogCategoryDto) {
    return this.prisma.blogCategory.update({ where: { id }, data: { name: dto.name, slug: slugify(dto.slug || dto.name) } });
  }
  async removeCategory(id: string) {
    await this.prisma.blogCategory.delete({ where: { id } });
  }

  listPublic(category?: string) {
    return this.prisma.blogPost.findMany({
      where: { status: 'PUBLISHED', ...(category ? { category: { slug: category } } : {}) },
      orderBy: { publishedAt: 'desc' },
      take: 100,
      omit: { content: true },
      include: { category: true },
    });
  }
  async getPublic(slug: string) {
    const post = await this.prisma.blogPost.findFirst({ where: { slug, status: 'PUBLISHED' }, include: { category: true } });
    if (!post) throw new NotFoundException('Post not found');
    return post;
  }

  listAdmin() {
    return this.prisma.blogPost.findMany({ orderBy: { updatedAt: 'desc' }, omit: { content: true }, include: { category: true } });
  }
  getAdmin(id: string) {
    return this.prisma.blogPost.findUniqueOrThrow({ where: { id } });
  }

  create(dto: CreatePostDto) {
    const { categoryId, ...rest } = dto;
    return this.prisma.blogPost.create({
      data: {
        ...rest,
        slug: slugify(dto.slug || dto.title),
        content: cleanHtml(dto.content ?? ''),
        publishedAt: dto.publishedAt ?? (dto.status === 'PUBLISHED' ? new Date() : null),
        category: categoryId ? { connect: { id: categoryId } } : undefined,
      },
    });
  }

  async update(id: string, dto: UpdatePostDto) {
    const { categoryId, ...rest } = dto;
    const current = await this.prisma.blogPost.findUniqueOrThrow({ where: { id } });
    const data: Prisma.BlogPostUpdateInput = { ...rest };
    if (dto.slug !== undefined) data.slug = slugify(dto.slug || dto.title || current.title);
    if (dto.content !== undefined) data.content = cleanHtml(dto.content);
    // First publish stamps the date; later edits keep it.
    if (dto.status === 'PUBLISHED' && !current.publishedAt && !dto.publishedAt) data.publishedAt = new Date();
    if (categoryId !== undefined) data.category = categoryId ? { connect: { id: categoryId } } : { disconnect: true };
    return this.prisma.blogPost.update({ where: { id }, data });
  }

  async remove(id: string) {
    await this.prisma.blogPost.delete({ where: { id } });
  }
}

@Public()
@SkipThrottle()
@Controller('blog')
export class PublicBlogController {
  constructor(private readonly blog: BlogService) {}
  @Get() list(@Query('category') category?: string) {
    return this.blog.listPublic(category);
  }
  @Get('categories') categories() {
    return this.blog.listCategories();
  }
  @Get(':slug') get(@Param('slug') slug: string) {
    return this.blog.getPublic(slug);
  }
}

@UseGuards(AdminGuard)
@Controller('admin')
export class AdminBlogController {
  constructor(private readonly blog: BlogService) {}
  @Get('blog') list() {
    return this.blog.listAdmin();
  }
  @Get('blog/:id') get(@Param('id', ParseUUIDPipe) id: string) {
    return this.blog.getAdmin(id);
  }
  @Post('blog') create(@Body() dto: CreatePostDto) {
    return this.blog.create(dto);
  }
  @Patch('blog/:id') update(@Param('id', ParseUUIDPipe) id: string, @Body() dto: UpdatePostDto) {
    return this.blog.update(id, dto);
  }
  @HttpCode(204) @Delete('blog/:id') remove(@Param('id', ParseUUIDPipe) id: string) {
    return this.blog.remove(id);
  }
  @Get('blog-categories') categories() {
    return this.blog.listCategories();
  }
  @Post('blog-categories') createCategory(@Body() dto: BlogCategoryDto) {
    return this.blog.createCategory(dto);
  }
  @Patch('blog-categories/:id') updateCategory(@Param('id', ParseUUIDPipe) id: string, @Body() dto: BlogCategoryDto) {
    return this.blog.updateCategory(id, dto);
  }
  @HttpCode(204) @Delete('blog-categories/:id') removeCategory(@Param('id', ParseUUIDPipe) id: string) {
    return this.blog.removeCategory(id);
  }
}

@Module({ controllers: [PublicBlogController, AdminBlogController], providers: [BlogService] })
export class BlogModule {}
