import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { APP_FILTER, APP_GUARD } from '@nestjs/core';
import { ThrottlerGuard, ThrottlerModule } from '@nestjs/throttler';
import { AuthModule } from './auth/auth.module';
import { JwtAuthGuard } from './auth/jwt-auth.guard';
import { BlogModule } from './blog/blog';
import { AllExceptionsFilter } from './common/all-exceptions.filter';
import configuration from './config/configuration';
import { validateEnv } from './config/env.validation';
import { DashboardModule } from './dashboard/dashboard';
import { EnquiriesModule } from './enquiries/enquiries';
import { EventsModule } from './events/events.module';
import { HealthController } from './health/health.controller';
import { MediaModule } from './media/media.module';
import { PagesModule } from './pages/pages';
import { PrismaModule } from './prisma/prisma.module';
import { StaffModule } from './staff/staff';
import { UsersModule } from './users/users';
import { PaymentsModule } from './payments/payments.module';

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
      load: [configuration],
      validate: validateEnv,
      envFilePath: ['.env.local', `.env.${process.env.NODE_ENV ?? 'development'}`, '.env'],
    }),
    ThrottlerModule.forRoot([{ ttl: 60_000, limit: 120 }]),
    PrismaModule,
    AuthModule,
    MediaModule,
    StaffModule,
    EventsModule,
    PagesModule,
    BlogModule,
    EnquiriesModule,
    DashboardModule,
    UsersModule,
    PaymentsModule,
  ],
  controllers: [HealthController],
  providers: [
    { provide: APP_GUARD, useClass: ThrottlerGuard },
    { provide: APP_GUARD, useClass: JwtAuthGuard },
    { provide: APP_FILTER, useClass: AllExceptionsFilter },
  ],
})
export class AppModule {}
