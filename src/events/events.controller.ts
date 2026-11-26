import { Body, Controller, Delete, Get, HttpCode, Param, ParseUUIDPipe, Patch, Post, Query, UseGuards } from '@nestjs/common';
import { SkipThrottle, Throttle } from '@nestjs/throttler';
import { AdminGuard } from '../common/admin.guard';
import { Public } from '../common/decorators';
import { CreateEventDto, EventCategoryDto, EventQueryDto, RegisterDto, RegistrationStatusDto, UpdateEventDto } from './events.dto';
import { EventsService } from './events.service';

@Public()
@Controller('events')
export class PublicEventsController {
  constructor(private readonly events: EventsService) {}

  // Read routes are fetched by the Next server, so one IP makes all of them.
  @SkipThrottle() @Get() list(@Query() q: EventQueryDto) {
    return this.events.listPublic(q);
  }
  @SkipThrottle() @Get('categories') categories() {
    return this.events.listCategories();
  }
  @SkipThrottle() @Get(':slug') get(@Param('slug') slug: string) {
    return this.events.getPublic(slug);
  }
  @Throttle({ default: { limit: 10, ttl: 60_000 } })
  @Post(':slug/register')
  register(@Param('slug') slug: string, @Body() dto: RegisterDto) {
    return this.events.register(slug, dto);
  }
}

@UseGuards(AdminGuard)
@Controller('admin')
export class AdminEventsController {
  constructor(private readonly events: EventsService) {}

  @Get('events') list() {
    return this.events.listAdmin();
  }
  @Get('events/:id') get(@Param('id', ParseUUIDPipe) id: string) {
    return this.events.getAdmin(id);
  }
  @Post('events') create(@Body() dto: CreateEventDto) {
    return this.events.create(dto);
  }
  @Patch('events/:id') update(@Param('id', ParseUUIDPipe) id: string, @Body() dto: UpdateEventDto) {
    return this.events.update(id, dto);
  }
  @HttpCode(204) @Delete('events/:id') remove(@Param('id', ParseUUIDPipe) id: string) {
    return this.events.remove(id);
  }

  @Get('event-categories') categories() {
    return this.events.listCategories();
  }
  @Post('event-categories') createCategory(@Body() dto: EventCategoryDto) {
    return this.events.createCategory(dto);
  }
  @Patch('event-categories/:id') updateCategory(@Param('id', ParseUUIDPipe) id: string, @Body() dto: EventCategoryDto) {
    return this.events.updateCategory(id, dto);
  }
  @HttpCode(204) @Delete('event-categories/:id') removeCategory(@Param('id', ParseUUIDPipe) id: string) {
    return this.events.removeCategory(id);
  }

  @Get('registrations') registrations(@Query('eventId') eventId?: string) {
    return this.events.listRegistrations(eventId);
  }
  @Patch('registrations/:id') setStatus(@Param('id', ParseUUIDPipe) id: string, @Body() dto: RegistrationStatusDto) {
    return this.events.updateRegistration(id, dto.status);
  }
  @HttpCode(204) @Delete('registrations/:id') removeRegistration(@Param('id', ParseUUIDPipe) id: string) {
    return this.events.removeRegistration(id);
  }
}
