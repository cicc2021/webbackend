import { plainToInstance } from 'class-transformer';
import { IsIn, IsOptional, IsString, Matches, MinLength, ValidateIf, validateSync } from 'class-validator';
import { invalidAddresses } from '../payments/networks';

class EnvironmentVariables {
  @Matches(/^postgres(ql)?:\/\/.+/) DATABASE_URL: string;
  @MinLength(32) JWT_SECRET: string;
  @IsString() @MinLength(1) CORS_ORIGINS: string;
  @IsString() PUBLIC_API_ORIGIN: string;
  @IsOptional() @IsIn(['false', 'true', 'no-verify', 'verify']) DATABASE_SSL?: string;
  @IsIn(['local', 's3']) STORAGE_DRIVER: string;

  @ValidateIf((e) => e.STORAGE_DRIVER === 's3') @IsString() @MinLength(1) S3_ENDPOINT: string;
  @ValidateIf((e) => e.STORAGE_DRIVER === 's3') @IsString() @MinLength(1) S3_BUCKET: string;
  @ValidateIf((e) => e.STORAGE_DRIVER === 's3') @IsString() @MinLength(1) S3_ACCESS_KEY: string;
  @ValidateIf((e) => e.STORAGE_DRIVER === 's3') @IsString() @MinLength(1) S3_SECRET_KEY: string;
  @ValidateIf((e) => e.STORAGE_DRIVER === 's3') @IsString() @MinLength(1) S3_PUBLIC_URL: string;
}

/** Throws at boot listing every bad variable, so a bad deploy dies immediately. */
export function validateEnv(raw: Record<string, unknown>) {
  const env = plainToInstance(EnvironmentVariables, raw);
  const errors = validateSync(env, { skipMissingProperties: false });
  const lines = errors.map((e) => `  ${e.property}: ${Object.values(e.constraints ?? {}).join(', ')}`);
  // A mistyped receiving address would send payments nowhere, so refuse to start with one.
  for (const name of invalidAddresses(raw as NodeJS.ProcessEnv)) lines.push(`  ${name}: not a valid address for its network`);
  if ((raw.PAYPAL_CLIENT_ID ? 1 : 0) + (raw.PAYPAL_CLIENT_SECRET ? 1 : 0) === 1) lines.push('  PAYPAL_CLIENT_ID / PAYPAL_CLIENT_SECRET: set both, or neither');
  if (lines.length) {
    throw new Error(`Invalid environment:\n${lines.join('\n')}`);
  }
  return raw;
}
