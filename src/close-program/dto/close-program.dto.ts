import { ApiProperty } from '@nestjs/swagger';
import { IsString, IsNotEmpty } from 'class-validator';

export class CloseProgramDto {
  @ApiProperty({
    description: 'Deployment ID of the program to close',
    example: '123e4567-e89b-12d3-a456-426614174000',
  })
  @IsString()
  @IsNotEmpty()
  deploymentId: string;

  @ApiProperty({
    description: 'User wallet address (for verification)',
    example: '7xKXtg2CW87d97TXJSDpbD5jBkheTqA83TZRuJosgAsU',
  })
  @IsString()
  @IsNotEmpty()
  userWalletAddress: string;
}

export class CloseProgramResponseDto {
  @ApiProperty({
    description: 'Deployment ID',
  })
  deploymentId: string;

  @ApiProperty({
    description: 'New deployment status',
  })
  status: string;

  @ApiProperty({
    description: 'Transaction signature for closing the program',
  })
  closeSignature: string;

  @ApiProperty({
    description: 'Transaction signature for refunding SOL to treasury pool',
    required: false,
  })
  refundSignature?: string;

  @ApiProperty({
    description: 'Total lamports recovered and returned to treasury pool',
  })
  recoveredLamports: number;

  @ApiProperty({
    description: 'Response message',
  })
  message: string;
}

