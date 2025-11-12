import { IsNotEmpty, IsString, Matches } from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';

export class VerifyProgramDto {
  @ApiProperty({
    description: 'Devnet program ID to verify',
    example: '5aai4VhRLDCFP2WSHUbGsiSuZxkWzQahhsRkqdfF2jRh',
  })
  @IsNotEmpty()
  @IsString()
  @Matches(/^[1-9A-HJ-NP-Za-km-z]{32,44}$/, {
    message: 'Invalid Solana program ID format',
  })
  programId: string;
}

export class VerifyProgramResponseDto {
  @ApiProperty({ description: 'Whether the program exists and is valid' })
  isValid: boolean;

  @ApiProperty({ description: 'Program ID' })
  programId: string;

  @ApiProperty({ description: 'Program size in bytes', required: false })
  programSize?: number;

  @ApiProperty({ description: 'Estimated rent cost in lamports', required: false })
  estimatedRentCost?: number;

  @ApiProperty({ description: 'Service fee in lamports', required: false })
  serviceFee?: number;

  @ApiProperty({ description: 'Total cost in lamports', required: false })
  totalCost?: number;

  @ApiProperty({ description: 'Error message if verification failed', required: false })
  error?: string;
}

