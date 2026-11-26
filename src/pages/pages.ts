import { BadRequestException, Body, Controller, Delete, Get, HttpCode, Injectable, Module, NotFoundException, Param, ParseUUIDPipe, Patch, Post, Query, UseGuards } from '@nestjs/common';
import { PartialType } from '@nestjs/swagger';
import { SkipThrottle } from '@nestjs/throttler';
import { Prisma, PublishStatus } from '@prisma/client';
import { IsArray, IsBoolean, IsEnum, IsInt, IsOptional, IsString, IsUUID, MaxLength, MinLength } from 'class-validator';
import { AdminGuard } from '../common/admin.guard';
import { cleanBlocks } from '../common/blocks';
import { Public } from '../common/decorators';
import { slugify } from '../common/sanitize';
import { PrismaService } from '../prisma/prisma.service';

/** First path segments the frontend owns; a page there would never be reachable. */
const RESERVED = ['admin', 'events', 'blog', 'team', 'pages', 'api', 'uploads', '_next'];

export class PageCategoryDto {
  @IsString() @MinLength(1) @MaxLength(100) name: string;
  @IsOptional() @IsString() @MaxLength(100) slug?: string;
  @IsOptional() @IsString() @MaxLength(1000) description?: string;
  @IsOptional() @IsInt() sortOrder?: number;
}
export class CreatePageDto {
  @IsString() @MinLength(1) @MaxLength(300) title: string;
  @IsOptional() @IsString() @MaxLength(100) slug?: string;
  @IsOptional() @IsString() @MaxLength(1000) excerpt?: string;
  @IsOptional() @IsString() @MaxLength(1000) coverUrl?: string;
  @IsOptional() @IsArray() blocks?: unknown[];
  @IsOptional() @IsEnum(PublishStatus) status?: PublishStatus;
  @IsOptional() @IsBoolean() showInNav?: boolean;
  @IsOptional() @IsInt() sortOrder?: number;
  @IsOptional() @IsString() @MaxLength(300) seoTitle?: string;
  @IsOptional() @IsString() @MaxLength(500) seoDescription?: string;
  @IsOptional() @IsUUID() parentId?: string | null;
  @IsOptional() @IsUUID() categoryId?: string | null;
}
export class UpdatePageDto extends PartialType(CreatePageDto) {}

@Injectable()
export class PagesService {
  constructor(private readonly prisma: PrismaService) {}

  listCategories() {
    return this.prisma.pageCategory.findMany({
      orderBy: [{ sortOrder: 'asc' }, { name: 'asc' }],
      include: { _count: { select: { pages: true } } },
    });
  }
  createCategory(dto: PageCategoryDto) {
    return this.prisma.pageCategory.create({ data: { ...dto, slug: slugify(dto.slug || dto.name) } });
  }
  updateCategory(id: string, dto: PageCategoryDto) {
    return this.prisma.pageCategory.update({ where: { id }, data: { ...dto, slug: slugify(dto.slug || dto.name) } });
  }
  async removeCategory(id: string) {
    await this.prisma.pageCategory.delete({ where: { id } });
  }

  listPublic(category?: string, search?: string) {
    return this.prisma.page.findMany({
      where: {
        status: 'PUBLISHED',
        ...(category ? { category: { slug: category } } : {}),
        ...(search ? { title: { contains: search, mode: 'insensitive' as const } } : {}),
      },
      orderBy: [{ sortOrder: 'asc' }, { title: 'asc' }],
      omit: { blocks: true },
      include: { category: true },
    });
  }

  /** Published pages shaped for the header: only what's flagged for navigation. */
  nav() {
    return this.prisma.page.findMany({
      where: { status: 'PUBLISHED', showInNav: true },
      orderBy: [{ sortOrder: 'asc' }, { title: 'asc' }],
      select: { id: true, title: true, path: true, parentId: true },
    });
  }

  async getPublic(path: string) {
    const page = await this.prisma.page.findFirst({
      where: { path, status: 'PUBLISHED' },
      include: {
        category: true,
        parent: { select: { title: true, path: true, status: true } },
        children: { where: { status: 'PUBLISHED' }, orderBy: [{ sortOrder: 'asc' }, { title: 'asc' }], select: { title: true, path: true, excerpt: true, coverUrl: true } },
      },
    });
    if (!page) throw new NotFoundException('Page not found');
    return page;
  }

  listAdmin() {
    return this.prisma.page.findMany({
      orderBy: [{ path: 'asc' }],
      omit: { blocks: true },
      include: { category: true },
    });
  }
  getAdmin(id: string) {
    return this.prisma.page.findUniqueOrThrow({ where: { id } });
  }

  private async buildPath(tx: Prisma.TransactionClient, id: string | null, slug: string, parentId: string | null) {
    if (!slug) throw new BadRequestException('The page needs a URL slug');
    if (!parentId) {
      if (RESERVED.includes(slug)) throw new BadRequestException(`"${slug}" is reserved by the website`);
      return `/${slug}`;
    }
    // Walk up to reject moving a page under its own descendant.
    let cursor: string | null = parentId;
    while (cursor) {
      if (cursor === id) throw new BadRequestException('A page cannot be nested under itself');
      const row: { parentId: string | null } | null = await tx.page.findUnique({ where: { id: cursor }, select: { parentId: true } });
      if (!row) throw new BadRequestException('Parent page not found');
      cursor = row.parentId;
    }
    const parent = await tx.page.findUniqueOrThrow({ where: { id: parentId }, select: { path: true } });
    return `${parent.path}/${slug}`;
  }

  /** Paths are derived, so renaming or moving a page rewrites every descendant's. */
  private async rewriteChildren(tx: Prisma.TransactionClient, id: string, path: string) {
    const children = await tx.page.findMany({ where: { parentId: id }, select: { id: true, slug: true } });
    for (const child of children) {
      const childPath = `${path}/${child.slug}`;
      await tx.page.update({ where: { id: child.id }, data: { path: childPath } });
      await this.rewriteChildren(tx, child.id, childPath);
    }
  }

  create(dto: CreatePageDto) {
    const { blocks, parentId, categoryId, ...rest } = dto;
    const slug = slugify(dto.slug || dto.title);
    return this.prisma.$transaction(async (tx) => {
      const path = await this.buildPath(tx, null, slug, parentId ?? null);
      return tx.page.create({
        data: {
          ...rest,
          slug,
          path,
          blocks: cleanBlocks(blocks ?? []) as Prisma.InputJsonValue,
          parent: parentId ? { connect: { id: parentId } } : undefined,
          category: categoryId ? { connect: { id: categoryId } } : undefined,
        },
      });
    });
  }

  update(id: string, dto: UpdatePageDto) {
    const { blocks, parentId, categoryId, ...rest } = dto;
    return this.prisma.$transaction(async (tx) => {
      const current = await tx.page.findUniqueOrThrow({ where: { id } });
      const slug = dto.slug !== undefined ? slugify(dto.slug || dto.title || current.title) : current.slug;
      const nextParent = parentId !== undefined ? parentId : current.parentId;
      const path = await this.buildPath(tx, id, slug, nextParent);
      const data: Prisma.PageUpdateInput = { ...rest, slug, path };
      if (blocks !== undefined) data.blocks = cleanBlocks(blocks) as Prisma.InputJsonValue;
      if (parentId !== undefined) data.parent = parentId ? { connect: { id: parentId } } : { disconnect: true };
      if (categoryId !== undefined) data.category = categoryId ? { connect: { id: categoryId } } : { disconnect: true };
      const page = await tx.page.update({ where: { id }, data });
      if (path !== current.path) await this.rewriteChildren(tx, id, path);
      return page;
    });
  }

  /** Children move up one level, keeping their pages alive at a new path. */
  async remove(id: string) {
    await this.prisma.$transaction(async (tx) => {
      const page = await tx.page.findUniqueOrThrow({ where: { id } });
      const children = await tx.page.findMany({ where: { parentId: id } });
      await tx.page.delete({ where: { id } });
      for (const child of children) {
        const path = await this.buildPath(tx, child.id, child.slug, page.parentId);
        await tx.page.update({ where: { id: child.id }, data: { path, parentId: page.parentId } });
        await this.rewriteChildren(tx, child.id, path);
      }
    });
  }
}

@Public()
@SkipThrottle()
@Controller('pages')
export class PublicPagesController {
  constructor(private readonly pages: PagesService) {}
  @Get() list(@Query('category') category?: string, @Query('search') search?: string) {
    return this.pages.listPublic(category, search);
  }
  @Get('nav') nav() {
    return this.pages.nav();
  }
  @Get('categories') categories() {
    return this.pages.listCategories();
  }
  @Get('by-path') byPath(@Query('path') path: string) {
    return this.pages.getPublic(path);
  }
}

@UseGuards(AdminGuard)
@Controller('admin')
export class AdminPagesController {
  constructor(private readonly pages: PagesService) {}
  @Get('pages') list() {
    return this.pages.listAdmin();
  }
  @Get('pages/:id') get(@Param('id', ParseUUIDPipe) id: string) {
    return this.pages.getAdmin(id);
  }
  @Post('pages') create(@Body() dto: CreatePageDto) {
    return this.pages.create(dto);
  }
  @Patch('pages/:id') update(@Param('id', ParseUUIDPipe) id: string, @Body() dto: UpdatePageDto) {
    return this.pages.update(id, dto);
  }
  @HttpCode(204) @Delete('pages/:id') remove(@Param('id', ParseUUIDPipe) id: string) {
    return this.pages.remove(id);
  }
  @Get('page-categories') categories() {
    return this.pages.listCategories();
  }
  @Post('page-categories') createCategory(@Body() dto: PageCategoryDto) {
    return this.pages.createCategory(dto);
  }
  @Patch('page-categories/:id') updateCategory(@Param('id', ParseUUIDPipe) id: string, @Body() dto: PageCategoryDto) {
    return this.pages.updateCategory(id, dto);
  }
  @HttpCode(204) @Delete('page-categories/:id') removeCategory(@Param('id', ParseUUIDPipe) id: string) {
    return this.pages.removeCategory(id);
  }
}

@Module({ controllers: [PublicPagesController, AdminPagesController], providers: [PagesService] })
export class PagesModule {}
