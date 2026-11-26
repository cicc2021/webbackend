import { BadRequestException, ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { Prisma, RegistrationStatus } from '@prisma/client';
import { cleanHtml, slugify } from '../common/sanitize';
import { draftPayment, PAYABLE_CURRENCIES, PaymentsService } from '../payments/payments.service';
import { PrismaService } from '../prisma/prisma.service';
import { CreateEventDto, EventCategoryDto, EventPackageDto, EventQueryDto, RegisterDto, UpdateEventDto } from './events.dto';

const LIVE: RegistrationStatus[] = ['PENDING', 'CONFIRMED'];
const registrationRef = (n: number) => `CICC-${String(n).padStart(6, '0')}`;
const packageOrder = { orderBy: { sortOrder: 'asc' as const } };

@Injectable()
export class EventsService {
  constructor(private readonly prisma: PrismaService, private readonly payments: PaymentsService) {}

  /* ------------ categories ------------ */
  listCategories() {
    return this.prisma.eventCategory.findMany({
      orderBy: [{ sortOrder: 'asc' }, { name: 'asc' }],
      include: { _count: { select: { events: true } } },
    });
  }
  createCategory(dto: EventCategoryDto) {
    return this.prisma.eventCategory.create({ data: { ...dto, slug: slugify(dto.slug || dto.name) } });
  }
  updateCategory(id: string, dto: EventCategoryDto) {
    return this.prisma.eventCategory.update({ where: { id }, data: { ...dto, slug: slugify(dto.slug || dto.name) } });
  }
  async removeCategory(id: string) {
    await this.prisma.eventCategory.delete({ where: { id } });
  }

  /* ------------ public reads ------------ */
  listPublic(q: EventQueryDto) {
    const now = new Date();
    const where: Prisma.EventWhereInput = { status: 'PUBLISHED' };
    if (q.from || q.to) {
      // Overlap, so a multi-day event shows on every month it touches.
      if (q.to) where.startAt = { lte: new Date(q.to) };
      if (q.from) where.endAt = { gte: new Date(q.from) };
    } else if (q.when === 'past') {
      where.endAt = { lt: now };
    } else if (q.when !== 'all') {
      where.endAt = { gte: now };
    }
    if (q.category) where.category = { slug: q.category };
    if (q.search) where.title = { contains: q.search, mode: 'insensitive' };
    return this.prisma.event.findMany({
      where,
      orderBy: { startAt: q.when === 'past' ? 'desc' : 'asc' },
      take: 200,
      omit: { content: true },
      include: { category: true },
    });
  }

  async getPublic(slug: string) {
    const event = await this.prisma.event.findFirst({
      where: { slug, status: 'PUBLISHED' },
      include: { category: true, packages: { where: { isActive: true }, ...packageOrder } },
    });
    if (!event) throw new NotFoundException('Event not found');
    return { ...event, isOpen: event.endAt >= new Date() };
  }

  /* ------------ admin ------------ */
  listAdmin() {
    return this.prisma.event.findMany({
      orderBy: { startAt: 'desc' },
      omit: { content: true },
      include: { category: true, _count: { select: { registrations: true, packages: true } } },
    });
  }
  getAdmin(id: string) {
    return this.prisma.event.findUniqueOrThrow({ where: { id }, include: { packages: packageOrder } });
  }

  private packageData(p: EventPackageDto, index: number) {
    return {
      name: p.name,
      description: p.description ?? '',
      price: p.price ? new Prisma.Decimal(p.price) : null,
      currency: p.currency ?? 'EUR',
      features: p.features ?? [],
      capacity: p.capacity ?? null,
      sortOrder: p.sortOrder ?? index,
      isActive: p.isActive ?? true,
    };
  }

  private assertDates(startAt: Date, endAt: Date) {
    if (endAt < startAt) throw new BadRequestException('The event must end after it starts');
  }

  create(dto: CreateEventDto) {
    const { packages = [], categoryId, ...rest } = dto;
    this.assertDates(new Date(dto.startAt), new Date(dto.endAt));
    return this.prisma.event.create({
      data: {
        ...rest,
        slug: slugify(dto.slug || dto.title),
        content: cleanHtml(dto.content ?? ''),
        category: categoryId ? { connect: { id: categoryId } } : undefined,
        packages: { create: packages.map((p, i) => this.packageData(p, i)) },
      },
      include: { packages: packageOrder },
    });
  }

  /** Packages not in the list are removed; registrations keep their row with no package. */
  async update(id: string, dto: UpdateEventDto) {
    const { packages, categoryId, ...rest } = dto;
    const data: Prisma.EventUpdateInput = { ...rest };
    if (dto.slug !== undefined) data.slug = slugify(dto.slug || dto.title || '');
    if (dto.content !== undefined) data.content = cleanHtml(dto.content);
    if (categoryId !== undefined) data.category = categoryId ? { connect: { id: categoryId } } : { disconnect: true };

    return this.prisma.$transaction(async (tx) => {
      const current = await tx.event.findUniqueOrThrow({ where: { id } });
      this.assertDates(new Date(dto.startAt ?? current.startAt), new Date(dto.endAt ?? current.endAt));
      await tx.event.update({ where: { id }, data });
      if (packages) {
        const keep = packages.flatMap((p) => (p.id ? [p.id] : []));
        await tx.eventPackage.deleteMany({ where: { eventId: id, id: { notIn: keep } } });
        for (const [i, p] of packages.entries()) {
          const pkg = this.packageData(p, i);
          // Scoped by eventId so a crafted id can't move another event's package here.
          if (p.id) await tx.eventPackage.updateMany({ where: { id: p.id, eventId: id }, data: pkg });
          else await tx.eventPackage.create({ data: { ...pkg, eventId: id } });
        }
      }
      return tx.event.findUniqueOrThrow({ where: { id }, include: { packages: packageOrder } });
    });
  }

  async remove(id: string) {
    await this.prisma.event.delete({ where: { id } });
  }

  /* ------------ registration ------------ */
  /** Runs under a row lock on the event, so two requests can't both take the last seat. */
  async register(slug: string, dto: RegisterDto) {
    const email = dto.email.toLowerCase();
    return this.prisma.$transaction(async (tx) => {
      const [locked] = await tx.$queryRaw<{ id: string }[]>`
        SELECT id FROM "Event" WHERE slug = ${slug} AND status = 'PUBLISHED' FOR UPDATE`;
      if (!locked) throw new NotFoundException('Event not found');
      const event = await tx.event.findUniqueOrThrow({
        where: { id: locked.id },
        include: { packages: { where: { isActive: true } } },
      });
      if (event.endAt < new Date()) throw new BadRequestException('Registration for this event has closed');

      const pkg = dto.packageId ? event.packages.find((p) => p.id === dto.packageId) : undefined;
      if (dto.packageId && !pkg) throw new BadRequestException('That package is not available');
      if (!pkg && event.packages.length) throw new BadRequestException('Please choose a package');

      const existing = await tx.eventRegistration.findUnique({
        where: { eventId_email: { eventId: event.id, email } },
        include: { payments: { select: { status: true } } },
      });
      // An unpaid booking for a priced package can be redone (another package, more seats, or
      // simply a fresh payment); anything paid, being paid, free or confirmed cannot.
      const unpaidBooking = existing?.status === 'PENDING' && existing.payments.length > 0 && existing.payments.every((p) => ['PENDING', 'FAILED', 'EXPIRED'].includes(p.status));
      if (existing && existing.status !== 'CANCELLED' && !unpaidBooking) throw new ConflictException('This email is already registered for this event');

      // The booking being redone gives its own seats back before counting.
      const seats = async (where: Prisma.EventRegistrationWhereInput) =>
        (await tx.eventRegistration.aggregate({ where: { ...where, status: { in: LIVE }, ...(existing ? { NOT: { id: existing.id } } : {}) }, _sum: { attendees: true } }))._sum.attendees ?? 0;
      if (event.capacity !== null && (await seats({ eventId: event.id })) + dto.attendees > event.capacity) {
        throw new ConflictException('This event is fully booked');
      }
      if (pkg?.capacity != null && (await seats({ packageId: pkg.id })) + dto.attendees > pkg.capacity) {
        throw new ConflictException(`The ${pkg.name} package is fully booked`);
      }

      const fields = {
        packageId: pkg?.id ?? null,
        fullName: dto.fullName,
        phone: dto.phone,
        organization: dto.organization ?? '',
        country: dto.country ?? '',
        attendees: dto.attendees,
        notes: dto.notes ?? '',
        status: 'PENDING' as const,
      };
      const reg = existing
        ? await tx.eventRegistration.update({ where: { id: existing.id }, data: fields })
        : await tx.eventRegistration.create({ data: { ...fields, eventId: event.id, email } });
      const reference = registrationRef(reg.reference);

      // A priced package is paid online straight away; the amount comes from the package, never the browser.
      const payable = pkg?.price != null && pkg.price.gt(0) && (PAYABLE_CURRENCIES as readonly string[]).includes(pkg.currency);
      if (!payable) return { reference, status: reg.status, payment: null };
      const total = pkg.price!.mul(dto.attendees).toFixed(2);
      const { secret, data } = draftPayment({
        email,
        name: dto.fullName,
        purpose: `${event.title} – ${pkg.name}`,
        externalRef: reference,
        notes: dto.attendees > 1 ? `${dto.attendees} × ${pkg.price!.toFixed(2)} ${pkg.currency}` : '',
        amount: total,
        currency: pkg.currency,
        registrationId: reg.id,
      });
      const payment = await tx.payment.create({ data });
      return { reference, status: reg.status, payment: { ...this.payments.view(payment), secret } };
    });
  }

  listRegistrations(eventId?: string) {
    return this.prisma.eventRegistration.findMany({
      where: eventId ? { eventId } : undefined,
      orderBy: { createdAt: 'desc' },
      take: 1000,
      include: {
        event: { select: { id: true, title: true, startAt: true } },
        package: { select: { name: true } },
        // The most useful payment first: a paid one if any, otherwise the latest attempt.
        payments: { select: { reference: true, status: true, fiatAmount: true, fiatCurrency: true, method: true, paidAt: true, createdAt: true }, orderBy: [{ paidAt: { sort: 'desc', nulls: 'last' } }, { createdAt: 'desc' }], take: 1 },
      },
    });
  }
  updateRegistration(id: string, status: RegistrationStatus) {
    return this.prisma.eventRegistration.update({ where: { id }, data: { status } });
  }
  async removeRegistration(id: string) {
    await this.prisma.eventRegistration.delete({ where: { id } });
  }
}
