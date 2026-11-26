import { Module } from '@nestjs/common';
import { PaymentsModule } from '../payments/payments.module';
import { AdminEventsController, PublicEventsController } from './events.controller';
import { EventsService } from './events.service';

@Module({ imports: [PaymentsModule], controllers: [PublicEventsController, AdminEventsController], providers: [EventsService] })
export class EventsModule {}
