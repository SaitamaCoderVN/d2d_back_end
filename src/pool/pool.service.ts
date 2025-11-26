import { Injectable, Logger } from '@nestjs/common';
import { ProgramService } from '../program/program.service';
import { PublicKey, Connection } from '@solana/web3.js';
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
    treasuryPoolPDA: string;
    availableForDeploySOL: number;
  }> {
    try {
      // Use the exact treasury pool address provided by user
      const TREASURY_POOL_ADDRESS = 'D6h9mgXL5enPyiG2M1W7Jn9yjXh8md1fCAcP5zBJH6ma';
      const treasuryPoolPDA = new PublicKey(TREASURY_POOL_ADDRESS);
      const connection = this.programService.getConnection();
      
      // Verify the derived PDA matches the expected address
      const [derivedPDA] = this.programService.getTreasuryPoolPDA();
      if (!derivedPDA.equals(treasuryPoolPDA)) {
        this.logger.warn(`⚠️  Derived PDA (${derivedPDA.toString()}) does not match expected address (${TREASURY_POOL_ADDRESS})`);
        this.logger.warn(`   Using provided address: ${TREASURY_POOL_ADDRESS}`);
      } else {
        this.logger.log(`✅ Verified PDA matches: ${TREASURY_POOL_ADDRESS}`);
      }
      
      // Fetch both struct data and actual account balance
      const [treasuryPool, accountInfo] = await Promise.all([
        this.programService.getProgram().account.treasuryPool.fetch(treasuryPoolPDA).catch(() => null),
        connection.getAccountInfo(treasuryPoolPDA, 'confirmed'),
      ]);
      
      if (!accountInfo) {
        throw new Error(`Treasury pool account not found at ${TREASURY_POOL_ADDRESS}`);
      }
      
      if (!treasuryPool) {
        this.logger.warn(`⚠️  Could not fetch treasury pool struct, using account balance only`);
      }

      // Get actual account balance (total SOL in the account)
      // This is the REAL amount of SOL in the treasury pool account D6h9mgXL5enPyiG2M1W7Jn9yjXh8md1fCAcP5zBJH6ma
      const actualAccountBalanceLamports = accountInfo.lamports;
      const actualAccountBalanceSOL = actualAccountBalanceLamports / 1_000_000_000;
      
      // Calculate rent exemption (account data size + rent)
      // TreasuryPool struct is ~270 bytes, rent exemption is ~0.00089 SOL
      const accountDataSize = accountInfo.data.length;
      const rentExemption = await connection.getMinimumBalanceForRentExemption(accountDataSize);
      const rentExemptionSOL = rentExemption / 1_000_000_000;
      
      // Get liquidBalance from struct if available
      let liquidBalanceFromStruct = 0;
      let liquidBalanceFromStructSOL = 0;
      if (treasuryPool) {
        liquidBalanceFromStruct = treasuryPool.liquidBalance.toNumber();
        liquidBalanceFromStructSOL = liquidBalanceFromStruct / 1_000_000_000;
      }
      
      // Available SOL = actual balance - rent exemption
      // Rent exemption cannot be used for operations, so we subtract it
      const availableBalanceLamports = Math.max(0, actualAccountBalanceLamports - rentExemption);
      const availableForDeployFromAccount = availableBalanceLamports / 1_000_000_000;
      
      // Use the ACTUAL ACCOUNT BALANCE (total SOL in account) as available for deploy
      // This is what the user wants to see - the total SOL in the treasury pool
      // The user confirmed they have 2.153765954 SOL in this account
      const availableForDeploySOL = actualAccountBalanceSOL;
      
      this.logger.log(`[PoolState] Treasury Pool Address: ${TREASURY_POOL_ADDRESS}`);
      this.logger.log(`   ✅ Account balance (TOTAL SOL): ${actualAccountBalanceSOL.toFixed(9)} SOL (${actualAccountBalanceLamports} lamports)`);
      this.logger.log(`   Rent exemption (locked): ${rentExemptionSOL.toFixed(9)} SOL (${rentExemption} lamports)`);
      this.logger.log(`   Available after rent: ${availableForDeployFromAccount.toFixed(9)} SOL (${availableBalanceLamports} lamports)`);
      if (treasuryPool) {
        this.logger.log(`   Liquid balance (from struct): ${liquidBalanceFromStructSOL.toFixed(9)} SOL (${liquidBalanceFromStruct} lamports)`);
      }
      this.logger.log(`   📊 Displaying: ${availableForDeploySOL.toFixed(9)} SOL (total account balance)`);
      
      // If there's a significant difference between struct and account, log a warning
      if (treasuryPool) {
        const difference = Math.abs(actualAccountBalanceSOL - liquidBalanceFromStructSOL);
        if (difference > 0.01) {
          this.logger.warn(`   ⚠️  Difference detected: ${difference.toFixed(9)} SOL`);
          this.logger.warn(`   Struct liquidBalance: ${liquidBalanceFromStructSOL.toFixed(9)} SOL`);
          this.logger.warn(`   Account balance: ${actualAccountBalanceSOL.toFixed(9)} SOL`);
          this.logger.warn(`   Using account balance as source of truth`);
        }
      }

      return {
        rewardPerShare: treasuryPool?.rewardPerShare?.toString() || '0',
        totalDeposited: treasuryPool?.totalDeposited?.toNumber() || 0,
        liquidBalance: availableBalanceLamports, // Use calculated available balance
        rewardPoolBalance: treasuryPool?.rewardPoolBalance?.toNumber() || 0,
        platformPoolBalance: treasuryPool?.platformPoolBalance?.toNumber() || 0,
        treasuryPoolPDA: TREASURY_POOL_ADDRESS,
        availableForDeploySOL,
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

  /**
   * Get leaderboard of all backers sorted by claimable rewards
   * Fetches all backer deposits from on-chain and calculates rewards
   */
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
    try {
      this.logger.log('📊 Fetching leaderboard data...');
      
      const program = this.programService.getProgram();
      const connection = this.programService.getConnection();
      const poolState = await this.getPoolState();
      const PRECISION = BigInt('1000000000000'); // 1e12
      const rewardPerShare = BigInt(poolState.rewardPerShare);

      // Log pool state for debugging
      this.logger.log(`   Pool State:`);
      this.logger.log(`     Reward Per Share: ${rewardPerShare.toString()}`);
      this.logger.log(`     Total Deposited: ${poolState.totalDeposited / 1e9} SOL`);
      this.logger.log(`     Reward Pool Balance (from struct): ${poolState.rewardPoolBalance / 1e9} SOL`);

      // Fetch Reward Pool balance from the specific address
      const REWARD_POOL_ADDRESS = '3pCnsqt3rvNj4QigLwH3W88LMuYTczgjcuK435z7ZF6b';
      const rewardPoolPDA = new PublicKey(REWARD_POOL_ADDRESS);
      
      let rewardPoolBalance = 0;
      try {
        const rewardPoolInfo = await connection.getAccountInfo(rewardPoolPDA, 'confirmed');
        if (rewardPoolInfo) {
          rewardPoolBalance = rewardPoolInfo.lamports;
          this.logger.log(`   Reward Pool balance: ${rewardPoolBalance / 1e9} SOL (${rewardPoolBalance} lamports)`);
        } else {
          this.logger.warn(`   Reward Pool account not found at ${REWARD_POOL_ADDRESS}`);
        }
      } catch (error) {
        this.logger.warn(`   Failed to fetch reward pool balance: ${error instanceof Error ? error.message : String(error)}`);
      }

      // Fetch all BackerDeposit accounts from on-chain
      let accounts: any[] = [];
      try {
        accounts = await (program.account as any).backerDeposit?.all() || [];
      } catch (e) {
        try {
          // Fallback to lenderStake (legacy name)
          accounts = await (program.account as any).lenderStake?.all() || [];
        } catch (e2) {
          this.logger.warn('Could not fetch backer accounts');
          return {
            leaderboard: [],
            rewardPoolBalance,
            rewardPoolAddress: REWARD_POOL_ADDRESS,
          };
        }
      }

      this.logger.log(`   Found ${accounts.length} backer accounts`);

      const leaderboard: Array<{
        wallet: string;
        depositedAmount: number;
        claimableRewards: number;
        claimedTotal: number;
        isActive: boolean;
      }> = [];

      for (const account of accounts) {
        try {
          const acc = account.account;
          const isActive = acc.isActive;
          const depositedAmount = (acc.depositedAmount as any).toNumber 
            ? (acc.depositedAmount as any).toNumber() 
            : Number(acc.depositedAmount);
          
          // Only include active backers with deposits
          if (isActive && depositedAmount > 0) {
            const rewardDebt = (acc.rewardDebt as any).toBigInt 
              ? (acc.rewardDebt as any).toBigInt() 
              : BigInt(acc.rewardDebt.toString());
            const claimedTotal = (acc.claimedTotal as any).toNumber 
              ? (acc.claimedTotal as any).toNumber() 
              : Number(acc.claimedTotal);
            
            // Calculate claimable rewards
            // Formula: (deposited_amount * reward_per_share - reward_debt) / PRECISION
            const depositedAmountBigInt = BigInt(depositedAmount);
            const accumulated = depositedAmountBigInt * rewardPerShare;
            
            // Ensure we don't get negative values (shouldn't happen, but safe)
            const claimableBigInt = accumulated >= rewardDebt 
              ? (accumulated - rewardDebt) / PRECISION 
              : BigInt(0);
            const claimableRewards = Number(claimableBigInt);

            // Log detailed calculation for debugging (only first few)
            if (leaderboard.length < 3) {
              this.logger.log(`   Backer ${acc.backer.toString().slice(0, 8)}...:`);
              this.logger.log(`     Deposited: ${depositedAmount / 1e9} SOL (${depositedAmount} lamports)`);
              this.logger.log(`     Reward Per Share: ${rewardPerShare.toString()}`);
              this.logger.log(`     Reward Debt: ${rewardDebt.toString()}`);
              this.logger.log(`     Accumulated: ${accumulated.toString()}`);
              this.logger.log(`     Claimable: ${claimableRewards / 1e9} SOL (${claimableRewards} lamports)`);
            }

            leaderboard.push({
              wallet: acc.backer.toString(),
              depositedAmount,
              claimableRewards,
              claimedTotal,
              isActive,
            });
          }
        } catch (error) {
          this.logger.warn(`Failed to process backer account: ${error instanceof Error ? error.message : String(error)}`);
          continue;
        }
      }

      // Sort by claimable rewards (descending)
      leaderboard.sort((a, b) => b.claimableRewards - a.claimableRewards);

      // Calculate totals for verification
      const totalClaimable = leaderboard.reduce((sum, entry) => sum + entry.claimableRewards, 0);
      const totalDeposited = leaderboard.reduce((sum, entry) => sum + entry.depositedAmount, 0);
      const totalClaimed = leaderboard.reduce((sum, entry) => sum + entry.claimedTotal, 0);

      this.logger.log(`✅ Leaderboard generated: ${leaderboard.length} backers`);
      this.logger.log(`   Reward Pool Balance: ${rewardPoolBalance / 1e9} SOL (${rewardPoolBalance} lamports)`);
      this.logger.log(`   Total Claimable (sum of all backers): ${totalClaimable / 1e9} SOL (${totalClaimable} lamports)`);
      this.logger.log(`   Total Claimed (sum of all backers): ${totalClaimed / 1e9} SOL (${totalClaimed} lamports)`);
      this.logger.log(`   Total Deposited: ${totalDeposited / 1e9} SOL (${totalDeposited} lamports)`);
      this.logger.log(`   Verification: Reward Pool (${rewardPoolBalance / 1e9} SOL) should be >= Total Claimable (${totalClaimable / 1e9} SOL)`);
      
      if (totalClaimable > rewardPoolBalance) {
        this.logger.warn(`   ⚠️  WARNING: Total claimable (${totalClaimable / 1e9} SOL) exceeds reward pool balance (${rewardPoolBalance / 1e9} SOL)`);
        this.logger.warn(`   This might indicate reward_per_share is out of sync or rewards have been distributed`);
      }
      
      return {
        leaderboard,
        rewardPoolBalance,
        rewardPoolAddress: REWARD_POOL_ADDRESS,
      };
    } catch (error) {
      this.logger.error(`Failed to get leaderboard: ${error.message}`);
      throw error;
    }
  }
}

