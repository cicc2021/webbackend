import { Body, Controller, Get, Headers, HttpCode, Module, Param, ParseUUIDPipe, Post, UseGuards } from '@nestjs/common';
import { SkipThrottle, Throttle } from '@nestjs/throttler';
import { AdminGuard } from '../common/admin.guard';
import { Public } from '../common/decorators';
import { CreatePaymentDto, QuoteDto, SubmitTxDto } from './payments.dto';
import { PaymentsService } from './payments.service';

/** The payer proves ownership of a payment with this header; the id alone is not enough. */
const SECRET = 'x-payment-secret';

@Public()
@Controller('payments')
export class PublicPaymentsController {
  constructor(private readonly payments: PaymentsService) {}

  @SkipThrottle() @Get('config') config() {
    return this.payments.config();
  }

  @Throttle({ default: { limit: 10, ttl: 60_000 } })
  @Post() create(@Body() dto: CreatePaymentDto) {
    return this.payments.create(dto);
  }

  @Throttle({ default: { limit: 60, ttl: 60_000 } })
  @Get(':id') get(@Param('id', ParseUUIDPipe) id: string, @Headers(SECRET) secret?: string) {
    return this.payments.get(id, secret);
  }

  @Throttle({ default: { limit: 20, ttl: 60_000 } })
  @HttpCode(200) @Post(':id/quote') quote(@Param('id', ParseUUIDPipe) id: string, @Body() dto: QuoteDto, @Headers(SECRET) secret?: string) {
    return this.payments.quote(id, secret, dto.network, dto.asset);
  }

  @Throttle({ default: { limit: 10, ttl: 60_000 } })
  @HttpCode(200) @Post(':id/transaction') submit(@Param('id', ParseUUIDPipe) id: string, @Body() dto: SubmitTxDto, @Headers(SECRET) secret?: string) {
    return this.payments.submitTx(id, secret, dto.txHash);
  }

  @Throttle({ default: { limit: 10, ttl: 60_000 } })
  @HttpCode(200) @Post(':id/paypal/order') paypalOrder(@Param('id', ParseUUIDPipe) id: string, @Headers(SECRET) secret?: string) {
    return this.payments.paypalCreate(id, secret);
  }

  @Throttle({ default: { limit: 10, ttl: 60_000 } })
  @HttpCode(200) @Post(':id/paypal/capture') paypalCapture(@Param('id', ParseUUIDPipe) id: string, @Headers(SECRET) secret?: string) {
    return this.payments.paypalCapture(id, secret);
  }
}

@UseGuards(AdminGuard)
@Controller('admin/payments')
export class AdminPaymentsController {
  constructor(private readonly payments: PaymentsService) {}
  @Get() list() {
    return this.payments.adminList();
  }
  @HttpCode(200) @Post(':id/recheck') recheck(@Param('id', ParseUUIDPipe) id: string) {
    return this.payments.adminRecheck(id);
  }
}

@Module({ controllers: [PublicPaymentsController, AdminPaymentsController], providers: [PaymentsService], exports: [PaymentsService] })
export class PaymentsModule {}
