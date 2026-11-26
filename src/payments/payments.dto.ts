import { IsEmail, IsIn, IsOptional, IsString, Matches, MaxLength, MinLength } from 'class-validator';

export class CreatePaymentDto {
  @IsEmail() @MaxLength(254) email: string;
  @IsOptional() @IsString() @MaxLength(200) name?: string;
  @IsString() @MinLength(2) @MaxLength(160) purpose: string;
  @IsOptional() @IsString() @MaxLength(120) externalRef?: string;
  @IsOptional() @IsString() @MaxLength(1000) notes?: string;
  /** Fixed-precision string, at least 1.00 and at most 1,000,000.00. */
  @Matches(/^(?:[1-9]\d{0,6})(?:\.\d{1,2})?$/, { message: 'Enter an amount between 1 and 1,000,000' }) amount: string;
  @IsIn(['EUR', 'USD']) currency: 'EUR' | 'USD';
}

export class QuoteDto {
  @IsString() @MaxLength(30) network: string;
  @IsString() @MaxLength(12) asset: string;
}

export class SubmitTxDto {
  @IsString() @MinLength(40) @MaxLength(120) txHash: string;
}
