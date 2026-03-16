import { IsNotEmpty, IsNumber, IsPositive, IsString, Length } from 'class-validator';

export class InitiateTransferDto {
  @IsString()
  @IsNotEmpty()
  sourceAccountId!: string;

  @IsString()
  @IsNotEmpty()
  destinationAccountId!: string;

  @IsNumber()
  @IsPositive()
  amount!: number;

  @IsString()
  @Length(3, 3)
  currency!: string;
}
