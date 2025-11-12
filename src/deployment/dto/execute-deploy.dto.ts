import { IsNotEmpty, IsString, IsNumber, Matches } from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';

export class ExecuteDeployDto {
  @ApiProperty({
    description: 'User wallet address (developer)',
    example: 'Hs4Hxe7k43p4YJqqyRnhoXboBB7MCzN8QpqW9NXuSrF8',
  })
  @IsNotEmpty()
  @IsString()
  userWalletAddress: string;

  @ApiProperty({
    description: 'Devnet program ID to deploy',
    example: '5aai4VhRLDCFP2WSHUbGsiSuZxkWzQahhsRkqdfF2jRh',
  })
  @IsNotEmpty()
  @IsString()
  @Matches(/^[1-9A-HJ-NP-Za-km-z]{32,44}$/, {
    message: 'Invalid Solana program ID format',
  })
  devnetProgramId: string;

  @ApiProperty({
    description: 'Payment transaction signature',
    example: '2ZE7Rz...',
  })
  @IsNotEmpty()
  @IsString()
  paymentSignature: string;

  @ApiProperty({
    description: 'Program hash from cost calculation',
  })
  @IsNotEmpty()
  @IsString()
  programHash: string;

  @ApiProperty({
    description: 'Service fee in lamports',
  })
  @IsNotEmpty()
  @IsNumber()
  serviceFee: number;

  @ApiProperty({
    description: 'Deployment platform fee in lamports',
  })
  @IsNotEmpty()
  @IsNumber()
  deploymentPlatformFee: number;

  @ApiProperty({
    description: 'Monthly fee in lamports',
  })
  @IsNotEmpty()
  @IsNumber()
  monthlyFee: number;

  @ApiProperty({
    description: 'Initial months',
  })
  @IsNotEmpty()
  @IsNumber()
  initialMonths: number;

  @ApiProperty({
    description: 'Deployment cost in lamports',
  })
  @IsNotEmpty()
  @IsNumber()
  deploymentCost: number;
}

export class ExecuteDeployResponseDto {
  @ApiProperty({ description: 'Deployment ID' })
  deploymentId: string;

  @ApiProperty({ description: 'Status of deployment' })
  status: string;

  @ApiProperty({ description: 'Message' })
  message: string;
}

