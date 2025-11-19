import { Controller, Post, Get, Body, UseGuards, HttpCode, HttpStatus } from '@nestjs/common';
import { ApiTags, ApiOperation, ApiResponse, ApiBearerAuth } from '@nestjs/swagger';
import { PoolService } from './pool.service';
import { AdminGuard } from '../common/guards/admin.guard';

export class CreditFeeDto {
  feeReward: number; // in lamports
  feePlatform: number; // in lamports
}

export class PoolStateResponseDto {
  rewardPerShare: string; // BigInt as string
  totalDeposited: number;
  liquidBalance: number;
  rewardPoolBalance: number;
  platformPoolBalance: number;
}

@ApiTags('pool')
@Controller('api/pool')
export class PoolController {
  constructor(private readonly poolService: PoolService) {}

  /**
   * Credit fees to pools and update reward_per_share
   * Admin-only endpoint
   */
  @Post('credit-fee')
  @UseGuards(AdminGuard)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Credit fees to pools (admin only)' })
  @ApiResponse({ status: 200, description: 'Fees credited successfully' })
  @ApiResponse({ status: 401, description: 'Unauthorized' })
  @HttpCode(HttpStatus.OK)
  async creditFee(@Body() dto: CreditFeeDto): Promise<{ success: boolean; txSignature?: string }> {
    return await this.poolService.creditFeeToPool(dto.feeReward, dto.feePlatform);
  }

  /**
   * Get current pool state
   */
  @Get('state')
  @ApiOperation({ summary: 'Get current pool state' })
  @ApiResponse({ status: 200, description: 'Pool state', type: PoolStateResponseDto })
  async getPoolState(): Promise<PoolStateResponseDto> {
    return await this.poolService.getPoolState();
  }

  /**
   * Sync pool state from on-chain to DB
   */
  @Post('sync')
  @UseGuards(AdminGuard)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Sync pool state from on-chain to DB (admin only)' })
  @ApiResponse({ status: 200, description: 'Pool state synced' })
  async syncPoolState(): Promise<{ success: boolean }> {
    return await this.poolService.syncPoolStateFromChain();
  }
}

