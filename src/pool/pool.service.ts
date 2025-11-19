import { Injectable, Logger } from '@nestjs/common';
import { ProgramService } from '../program/program.service';
import { PublicKey } from '@solana/web3.js';
import { SupabaseService } from '../supabase/supabase.service';

@Injectable()
export class PoolService {
  private readonly logger = new Logger(PoolService.name);

  constructor(
    private readonly programService: ProgramService,
    private readonly supabaseService: SupabaseService,
  ) {}

  /**
   * Credit fees to pools and update reward_per_share
   * Calls on-chain credit_fee_to_pool instruction
   */
  async creditFeeToPool(feeReward: number, feePlatform: number): Promise<{ success: boolean; txSignature?: string }> {
    try {
      this.logger.log(`Crediting fees: reward=${feeReward}, platform=${feePlatform} lamports`);

      // Call on-chain instruction
      const txSignature = await this.programService.creditFeeToPool(feeReward, feePlatform);

      // Update DB after successful on-chain call
      await this.syncPoolStateFromChain();

      return {
        success: true,
        txSignature,
      };
    } catch (error) {
      this.logger.error(`Failed to credit fees: ${error.message}`);
      throw error;
    }
  }

  /**
   * Get current pool state from on-chain
   */
  async getPoolState(): Promise<{
    rewardPerShare: string;
    totalDeposited: number;
    liquidBalance: number;
    rewardPoolBalance: number;
    platformPoolBalance: number;
  }> {
    try {
      const [treasuryPoolPDA] = this.programService.getTreasuryPoolPDA();
      const treasuryPool = await this.programService.getProgram().account.treasuryPool.fetch(treasuryPoolPDA);

      return {
        rewardPerShare: treasuryPool.rewardPerShare.toString(),
        totalDeposited: treasuryPool.totalDeposited.toNumber(),
        liquidBalance: treasuryPool.liquidBalance.toNumber(),
        rewardPoolBalance: treasuryPool.rewardPoolBalance.toNumber(),
        platformPoolBalance: treasuryPool.platformPoolBalance.toNumber(),
      };
    } catch (error) {
      this.logger.error(`Failed to get pool state: ${error.message}`);
      throw error;
    }
  }

  /**
   * Sync pool state from on-chain to DB
   */
  async syncPoolStateFromChain(): Promise<{ success: boolean }> {
    try {
      const poolState = await this.getPoolState();
      const [treasuryPoolPDA] = this.programService.getTreasuryPoolPDA();

      // Update pool table
      const { error } = await this.supabaseService.getClient()
        .from('pool')
        .update({
          reward_per_share: poolState.rewardPerShare,
          total_deposited: poolState.totalDeposited,
          liquid_balance: poolState.liquidBalance,
          reward_pool_balance: poolState.rewardPoolBalance,
          platform_pool_balance: poolState.platformPoolBalance,
          updated_at: new Date().toISOString(),
        })
        .eq('id', '00000000-0000-0000-0000-000000000000');

      if (error) {
        throw new Error(`Failed to update pool in DB: ${error.message}`);
      }

      // Create snapshot
      await this.supabaseService.getClient()
        .from('pools_snapshot')
        .insert({
          reward_per_share: poolState.rewardPerShare,
          total_deposited: poolState.totalDeposited,
          liquid_balance: poolState.liquidBalance,
          reward_pool_balance: poolState.rewardPoolBalance,
          platform_pool_balance: poolState.platformPoolBalance,
          treasury_pool_pda: treasuryPoolPDA.toString(),
        });

      this.logger.log('✅ Pool state synced to DB');
      return { success: true };
    } catch (error) {
      this.logger.error(`Failed to sync pool state: ${error.message}`);
      throw error;
    }
  }

  /**
   * Calculate claimable rewards for a backer
   * Formula: (deposited_amount * reward_per_share - reward_debt) / PRECISION
   */
  async calculateClaimableRewards(backerWallet: string): Promise<number> {
    try {
      const poolState = await this.getPoolState();
      const [backerDepositPDA] = this.programService.getBackerDepositPDA(new PublicKey(backerWallet));
      
      const backerDeposit = await this.programService.getProgram()
        .account.backerDeposit.fetch(backerDepositPDA);

      const PRECISION = BigInt('1000000000000'); // 1e12
      const depositedAmount = BigInt(backerDeposit.depositedAmount.toNumber());
      const rewardPerShare = BigInt(poolState.rewardPerShare);
      const rewardDebt = backerDeposit.rewardDebt.toBigInt();

      // Calculate: (deposited_amount * reward_per_share - reward_debt) / PRECISION
      const accumulated = depositedAmount * rewardPerShare;
      const claimable = (accumulated - rewardDebt) / PRECISION;

      return Number(claimable);
    } catch (error) {
      this.logger.error(`Failed to calculate claimable rewards: ${error.message}`);
      return 0;
    }
  }
}

