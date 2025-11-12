import { IsNotEmpty, IsString, Matches } from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';

export class CalculateCostDto {
  @ApiProperty({
    description: 'Devnet program ID',
    example: '5aai4VhRLDCFP2WSHUbGsiSuZxkWzQahhsRkqdfF2jRh',
  })
  @IsNotEmpty()
  @IsString()
  @Matches(/^[1-9A-HJ-NP-Za-km-z]{32,44}$/, {
    message: 'Invalid Solana program ID format',
  })
  programId: string;
}

export class CostBreakdownDto {
  @ApiProperty({ description: 'Program size in bytes' })
  programSize: number;

  @ApiProperty({ description: 'Base rent cost in lamports' })
  rentCost: number;

  @ApiProperty({ description: 'Service fee (0.5%) in lamports' })
  serviceFee: number;

  @ApiProperty({ description: 'Deployment platform fee (0.1%) in lamports' })
  deploymentPlatformFee: number;

  @ApiProperty({ description: 'Monthly subscription fee in lamports' })
  monthlyFee: number;

  @ApiProperty({ description: 'Initial subscription months' })
  initialMonths: number;

  @ApiProperty({ description: 'Total payment required in lamports' })
  totalPayment: number;

  @ApiProperty({ description: 'Total payment in SOL' })
  totalPaymentSOL: number;

  @ApiProperty({ description: 'Program hash for deployment request' })
  programHash: string;

  // Note: Treasury wallet removed - payment goes to Treasury Pool PDA
}

