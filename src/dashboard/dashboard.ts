import { Controller, Get, Injectable, Module, UseGuards } from '@nestjs/common';
import { AdminGuard } from '../common/admin.guard';
import { PrismaService } from '../prisma/prisma.service';

@Injectable()
export class DashboardService {
  constructor(private readonly prisma: PrismaService) {}

  async summary() {
    const now = new Date();
    const [pages, posts, staff, upcomingEvents, registrations, pendingRegistrations, unreadEnquiries, media, nextEvents, latestRegistrations, latestEnquiries] = await Promise.all([
      this.prisma.page.count(),
      this.prisma.blogPost.count(),
      this.prisma.staffMember.count(),
      this.prisma.event.count({ where: { status: 'PUBLISHED', endAt: { gte: now } } }),
      this.prisma.eventRegistration.count(),
      this.prisma.eventRegistration.count({ where: { status: 'PENDING' } }),
      this.prisma.enquiry.count({ where: { isRead: false } }),
      this.prisma.media.count(),
      this.prisma.event.findMany({
        where: { status: 'PUBLISHED', endAt: { gte: now } },
        orderBy: { startAt: 'asc' },
        take: 5,
        select: { id: true, title: true, startAt: true, endAt: true, location: true, coverUrl: true, _count: { select: { registrations: true } } },
      }),
      this.prisma.eventRegistration.findMany({
        orderBy: { createdAt: 'desc' },
        take: 6,
        select: { id: true, fullName: true, status: true, createdAt: true, event: { select: { title: true } } },
      }),
      this.prisma.enquiry.findMany({
        where: { isRead: false },
        orderBy: { createdAt: 'desc' },
        take: 5,
        select: { id: true, name: true, subject: true, createdAt: true },
      }),
    ]);
    return { pages, posts, staff, upcomingEvents, registrations, pendingRegistrations, unreadEnquiries, media, nextEvents, latestRegistrations, latestEnquiries };
  }
}

@UseGuards(AdminGuard)
@Controller('admin/dashboard')
export class DashboardController {
  constructor(private readonly dashboard: DashboardService) {}
  @Get() summary() {
    return this.dashboard.summary();
  }
}

@Module({ controllers: [DashboardController], providers: [DashboardService] })
export class DashboardModule {}
