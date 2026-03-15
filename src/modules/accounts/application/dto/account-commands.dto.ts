import { IsNotEmpty, IsNumber, IsOptional, IsPositive, IsString, Length } from 'class-validator';

export class CreateAccountDto {
  @IsString()
  @Length(3, 64)
  accountId!: string;

  @IsString()
  @Length(3, 64)
  ownerId!: string;

  @IsString()
  @Length(3, 3)
  currency!: string;

  @IsOptional()
  @IsString()
  actor?: string;
}

export class DepositMoneyDto {
  @IsNumber()
  @IsPositive()
  amount!: number;

  @IsString()
  @Length(3, 3)
  currency!: string;

  @IsString()
  @IsNotEmpty()
  transactionId!: string;

  @IsOptional()
  @IsString()
  actor?: string;
}

export class WithdrawMoneyDto extends DepositMoneyDto {}

export class FreezeAccountDto {
  @IsString()
  @IsNotEmpty()
  reason!: string;

  @IsOptional()
  @IsString()
  actor?: string;
}
