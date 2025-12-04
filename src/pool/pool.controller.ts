import { Controller, Post, Get, Body, Param, UseGuards, HttpCode, HttpStatus } from '@nestjs/common';
import { ApiTags, ApiOperation, ApiResponse, ApiBearerAuth } from '@nestjs/swagger';
import { PoolService } from './pool.service';
import { ProgramService } from '../program/program.service';
import { AdminGuard } from '../common/guards/admin.guard';

export class CreditFeeDto {
  feeReward: number; // in lamports
  feePlatform: number; // in lamports
}

export class PoolStateResponseDto {
  rewardPerShare: string; // BigInt as string
  totalDeposited: number; // Total SOL deposited (lamports)
  liquidBalance: number; // Available SOL for deployment (lamports) - THIS IS "Available for Deploy"
  rewardPoolBalance: number; // Reward pool balance (lamports)
  platformPoolBalance: number; // Platform pool balance (lamports)
  treasuryPoolPDA: string; // Treasury Pool PDA address
  availableForDeploySOL: number; // Available SOL for deployment (in SOL, not lamports)
}

@ApiTags('pool')
@Controller('pool')
export class PoolController {
  constructor(
    private readonly poolService: PoolService,
    private readonly programService: ProgramService,
  ) {}

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

  /**
   * Sync liquid_balance with actual account balance
   * Admin-only endpoint to fix liquid_balance when it's out of sync
   */
  @Post('sync-liquid-balance')
  @UseGuards(AdminGuard)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Sync liquid_balance with account balance (admin only)' })
  @ApiResponse({ status: 200, description: 'liquid_balance synced successfully' })
  @ApiResponse({ status: 401, description: 'Unauthorized' })
  @HttpCode(HttpStatus.OK)
  async syncLiquidBalance(): Promise<{ success: boolean; txSignature: string }> {
    const txSignature = await this.programService.syncLiquidBalance();
    return { success: true, txSignature };
  }

  /**
   * Get leaderboard of all backers sorted by claimable rewards
   */
  @Get('leaderboard')
  @ApiOperation({ summary: 'Get leaderboard of backers sorted by claimable rewards' })
  @ApiResponse({ status: 200, description: 'Leaderboard data' })
  async getLeaderboard(): Promise<{
    leaderboard: Array<{
      wallet: string;
      depositedAmount: number; // lamports
      claimableRewards: number; // lamports
      claimedTotal: number; // lamports
      isActive: boolean;
    }>;
    rewardPoolBalance: number; // lamports - Total SOL in reward pool
    rewardPoolAddress: string; // Reward pool PDA address
  }> {
    return await this.poolService.getLeaderboard();
  }

  /**
   * Get user's stake and reward information
   */
  @Get('user/:wallet')
  @ApiOperation({ summary: "Get user's stake and reward information" })
  @ApiResponse({ status: 200, description: 'User stake and reward data' })
  async getUserStakeInfo(@Param('wallet') wallet: string): Promise<{
    wallet: string;
    depositedAmount: number; // lamports
    claimableRewards: number; // lamports
    claimedTotal: number; // lamports
    isActive: boolean;
    totalRewards: number; // lamports (claimable + claimed)
  }> {
    return await this.poolService.getUserStakeInfo(wallet);
  }

  /**
   * Get excess rewards calculation (surplus available for withdrawal)
   */
  @Get('excess-rewards')
  @ApiOperation({ summary: 'Calculate excess rewards in Reward Pool' })
  @ApiResponse({ status: 200, description: 'Excess rewards calculation' })
  async getExcessRewards(): Promise<{
    rewardPoolBalance: number;
    totalClaimableRewards: number;
    excessRewards: number;
    leaderboard: Array<{
      wallet: string;
      depositedAmount: number;
      claimableRewards: number;
      claimedTotal: number;
    }>;
  }> {
    return await this.poolService.calculateExcessRewards();
  }

  /**
   * Get utilization history and projected APY
   */
  @Get('utilization')
  @ApiOperation({ summary: 'Get pool utilization history and projected APY' })
  @ApiResponse({ status: 200, description: 'Utilization data' })
  async getUtilization(): Promise<{
    history: Array<{ date: string; solUsed: number; deploymentCount: number }>;
    currentUtilizationRate: number;
    projectedApy: number;
  }> {
    return await this.poolService.getUtilizationHistory();
  }

  /**
   * Admin withdraw excess from Reward Pool
   * Only the authorized admin (A1dVA8adW1XXgcVmLCtbrvbVEVA1n3Q7kNPaTZVonjpq) can withdraw
   * Only excess rewards (surplus) can be withdrawn, not backers' claimable rewards
   */
  @Post('admin/withdraw-reward-pool')
  @UseGuards(AdminGuard)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Admin withdraw excess from Reward Pool (authorized admin only)' })
  @ApiResponse({ status: 200, description: 'Withdrawal successful' })
  @ApiResponse({ status: 401, description: 'Unauthorized' })
  @ApiResponse({ status: 400, description: 'Amount exceeds excess rewards' })
  @HttpCode(HttpStatus.OK)
  async adminWithdrawRewardPool(
    @Body() dto: { amount: number; destination: string; reason: string },
  ): Promise<{ success: boolean; txSignature: string; excessRewards: number }> {
    // Calculate excess rewards first
    const excessData = await this.poolService.calculateExcessRewards();
    
    // Verify withdrawal amount doesn't exceed excess
    if (dto.amount > excessData.excessRewards) {
      throw new Error(
        `Cannot withdraw ${dto.amount / 1e9} SOL. ` +
        `Only ${excessData.excessRewards / 1e9} SOL excess available. ` +
        `Total claimable by backers: ${excessData.totalClaimableRewards / 1e9} SOL`
      );
    }
    
    const { PublicKey } = await import('@solana/web3.js');
    const destination = new PublicKey(dto.destination);
    const txSignature = await this.programService.adminWithdrawRewardPool(
      dto.amount,
      destination,
      dto.reason,
    );
    return { 
      success: true, 
      txSignature,
      excessRewards: excessData.excessRewards,
    };
  }
}

