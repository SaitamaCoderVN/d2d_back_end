import { Injectable, Logger, Inject, forwardRef } from '@nestjs/common';
import { ProgramService } from '../program/program.service';
import { PublicKey, Connection } from '@solana/web3.js';
import { SupabaseService } from '../supabase/supabase.service';
import { BorshAccountsCoder } from '@coral-xyz/anchor';
import { getTreasuryPoolAddress, getRewardPoolAddress } from '../program/utils/pda.utils';

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
    availableForWithdrawSOL: number; // Withdrawal pool balance in SOL
  }> {
    try {
      // Derive treasury pool PDA from seeds (no hardcoding)
      const treasuryPoolPDA = getTreasuryPoolAddress();
      const TREASURY_POOL_ADDRESS = treasuryPoolPDA.toString();
      const connection = this.programService.getConnection();
      
      this.logger.log(`✅ Using derived Treasury Pool PDA: ${TREASURY_POOL_ADDRESS}`);
      
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
      // This is the REAL amount of SOL in the treasury pool account
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
        liquidBalance: availableBalanceLamports, // Use calculated available balance (shared between deployments and withdrawals)
        rewardPoolBalance: treasuryPool?.rewardPoolBalance?.toNumber() || 0,
        platformPoolBalance: treasuryPool?.platformPoolBalance?.toNumber() || 0,
        treasuryPoolPDA: TREASURY_POOL_ADDRESS,
        availableForDeploySOL,
        availableForWithdrawSOL: availableForDeploySOL, // Same as liquid_balance (shared pool)
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
   * Formula: pending_rewards + (deposited_amount * reward_per_share - reward_debt) / PRECISION
   */
  async calculateClaimableRewards(backerWallet: string): Promise<number> {
    try {
      const poolState = await this.getPoolState();
      const [backerDepositPDA] = this.programService.getBackerDepositPDA(new PublicKey(backerWallet));

      const backerDeposit = await this.programService.getProgram()
        .account.backerDeposit.fetch(backerDepositPDA);

      const PRECISION = BigInt('1000000000000'); // 1e12
      const depositedAmount = BigInt(backerDeposit.depositedAmount.toNumber());
      const pendingRewards = backerDeposit.pendingRewards?.toNumber() || 0;
      const rewardPerShare = BigInt(poolState.rewardPerShare);
      const rewardDebt = backerDeposit.rewardDebt.toBigInt();

      // Calculate: (deposited_amount * reward_per_share - reward_debt) / PRECISION
      const accumulated = depositedAmount * rewardPerShare;
      const rewardsFromRewardPerShare = (accumulated - rewardDebt) / PRECISION;

      // Total claimable = pending_rewards + rewards from reward_per_share
      const totalClaimable = pendingRewards + Number(rewardsFromRewardPerShare);

      return totalClaimable;
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

      // Derive Reward Pool PDA from seeds (no hardcoding)
      const rewardPoolPDA = getRewardPoolAddress();
      const REWARD_POOL_ADDRESS = rewardPoolPDA.toString();
      
      let rewardPoolBalance = 0;
      try {
        const rewardPoolInfo = await connection.getAccountInfo(rewardPoolPDA, 'confirmed');
        if (rewardPoolInfo) {
          rewardPoolBalance = rewardPoolInfo.lamports;
          this.logger.log(`   Reward Pool balance: ${rewardPoolBalance / 1e9} SOL (${rewardPoolBalance} lamports)`);
        } else {
          this.logger.warn(`   Reward Pool account not found at ${REWARD_POOL_ADDRESS} (derived from seeds)`);
        }
      } catch (error) {
        this.logger.warn(`   Failed to fetch reward pool balance: ${error instanceof Error ? error.message : String(error)}`);
      }

      // Fetch all BackerDeposit accounts from on-chain
      let accounts: any[] = [];
      const programId = program.programId;
      this.logger.log(`   Program ID: ${programId.toString()}`);
      this.logger.log(`   Reward Per Share: ${rewardPerShare.toString()}`);
      
      try {
        this.logger.log('   Attempting to fetch backerDeposit accounts using program.account.backerDeposit.all()...');
        accounts = await (program.account as any).backerDeposit?.all() || [];
        this.logger.log(`   ✅ Successfully fetched ${accounts.length} backerDeposit accounts`);
        
        if (accounts.length === 0) {
          this.logger.warn(`   ⚠️  No accounts found via .all() method - this might indicate:`);
          this.logger.warn(`      - No backers have staked yet`);
          this.logger.warn(`      - Program ID mismatch`);
          this.logger.warn(`      - Network mismatch (checking ${this.programService.getConnection().rpcEndpoint})`);
        }
      } catch (e: any) {
        this.logger.warn(`   ⚠️  Failed to fetch backerDeposit: ${e?.message || String(e)}`);
        try {
          this.logger.log('   Attempting fallback to lenderStake...');
          accounts = await (program.account as any).lenderStake?.all() || [];
          this.logger.log(`   ✅ Successfully fetched ${accounts.length} lenderStake accounts (legacy)`);
        } catch (e2: any) {
          this.logger.error(`   ❌ Failed to fetch lenderStake: ${e2?.message || String(e2)}`);
          this.logger.error('   Stack trace:', e2?.stack);
          
          // Try alternative method: getProgramAccounts with discriminator
          try {
            this.logger.log('   Attempting alternative method: getProgramAccounts...');
            const programId = this.programService.getProgram().programId;
            const allAccounts = await connection.getProgramAccounts(programId, {
              filters: [
                {
                  dataSize: 165, // BackerDeposit account size: 8 (discriminator) + 32 (backer) + 8 (depositedAmount) + 16 (rewardDebt) + 8 (claimedTotal) + 1 (isActive) + 1 (bump) = 74 bytes, but let's use 165 to be safe
                },
              ],
            });
            
            this.logger.log(`   Found ${allAccounts.length} accounts via getProgramAccounts`);
            
            // Decode accounts manually
            const coder = new BorshAccountsCoder(program.idl as any);
            const backerDepositDiscriminator = Buffer.from([233, 24, 109, 17, 7, 122, 24, 21]); // From IDL
            
            for (const accountInfo of allAccounts) {
              try {
                // Account data from getProgramAccounts is already a Buffer
                const accountData = accountInfo.account.data instanceof Buffer 
                  ? accountInfo.account.data 
                  : Buffer.from(accountInfo.account.data);
                
                // Check if account starts with backerDeposit discriminator
                if (accountData.length >= 8 && accountData.slice(0, 8).equals(backerDepositDiscriminator)) {
                  const decoded = coder.decode('backerDeposit', accountData);
                  accounts.push({
                    publicKey: accountInfo.pubkey,
                    account: decoded,
                  });
                }
              } catch (decodeError: any) {
                // Skip accounts that can't be decoded
                this.logger.debug(`   Skipped account ${accountInfo.pubkey.toString()}: ${decodeError?.message || String(decodeError)}`);
                continue;
              }
            }
            
            this.logger.log(`   ✅ Decoded ${accounts.length} backerDeposit accounts from getProgramAccounts`);
          } catch (e3: any) {
            this.logger.error(`   ❌ Alternative method also failed: ${e3?.message || String(e3)}`);
            this.logger.warn('   Returning empty leaderboard');
            return {
              leaderboard: [],
              rewardPoolBalance,
              rewardPoolAddress: REWARD_POOL_ADDRESS,
            };
          }
        }
      }

      this.logger.log(`   Found ${accounts.length} backer accounts total`);

      // If no accounts found, log detailed information
      if (accounts.length === 0) {
        this.logger.warn(`   ⚠️  NO BACKER ACCOUNTS FOUND ON-CHAIN`);
        this.logger.warn(`   This means:`);
        this.logger.warn(`     1. No one has staked SOL yet`);
        this.logger.warn(`     2. Reward Pool has ${rewardPoolBalance / 1e9} SOL from developer fees`);
        this.logger.warn(`     3. Once backers stake, they will be able to claim these rewards`);
        this.logger.warn(`   Program ID: ${programId.toString()}`);
        this.logger.warn(`   Network: ${this.programService.getConnection().rpcEndpoint}`);
      }

      const leaderboard: Array<{
        wallet: string;
        depositedAmount: number;
        claimableRewards: number;
        claimedTotal: number;
        isActive: boolean;
      }> = [];

      // Log all accounts found (before filtering)
      this.logger.log(`   Processing ${accounts.length} accounts...`);
      
      for (const account of accounts) {
        try {
          const acc = account.account;
          
          // Handle different account structures (from .all() vs manual decode)
          const backerPubkey = acc.backer 
            ? (acc.backer instanceof PublicKey ? acc.backer : new PublicKey(acc.backer))
            : account.publicKey;
          
          const isActive = acc.isActive !== undefined ? acc.isActive : acc.is_active;
          const depositedAmount = (acc.depositedAmount as any)?.toNumber
            ? (acc.depositedAmount as any).toNumber()
            : (acc.deposited_amount !== undefined ? Number(acc.deposited_amount) : Number(acc.depositedAmount || 0));
          const pendingRewards = (acc.pendingRewards as any)?.toNumber
            ? (acc.pendingRewards as any).toNumber()
            : (acc.pending_rewards !== undefined ? Number(acc.pending_rewards) : Number(acc.pendingRewards || 0));

          // Log each account for debugging
          const backerStr = backerPubkey instanceof PublicKey ? backerPubkey.toString() : String(backerPubkey);
          this.logger.log(`   Account ${backerStr.slice(0, 8)}...: isActive=${isActive}, deposited=${depositedAmount / 1e9} SOL, pending=${pendingRewards / 1e9} SOL`);

          // Calculate all values first
          const rewardDebt = (acc.rewardDebt as any)?.toBigInt
            ? (acc.rewardDebt as any).toBigInt()
            : (acc.reward_debt !== undefined ? BigInt(acc.reward_debt.toString()) : BigInt(acc.rewardDebt?.toString() || '0'));
          const claimedTotal = (acc.claimedTotal as any)?.toNumber
            ? (acc.claimedTotal as any).toNumber()
            : (acc.claimed_total !== undefined ? Number(acc.claimed_total) : Number(acc.claimedTotal || 0));

          // Calculate claimable rewards
          // Formula: pending_rewards + (deposited_amount * reward_per_share - reward_debt) / PRECISION
          const depositedAmountBigInt = BigInt(depositedAmount);
          const accumulated = depositedAmountBigInt * rewardPerShare;

          // Ensure we don't get negative values (shouldn't happen, but safe)
          const rewardsFromRewardPerShare = accumulated >= rewardDebt
            ? (accumulated - rewardDebt) / PRECISION
            : BigInt(0);

          // Total claimable = pending_rewards + rewards from reward_per_share
          const claimableRewards = pendingRewards + Number(rewardsFromRewardPerShare);
          
          // Log detailed info for each account
          this.logger.log(`     - Deposited: ${depositedAmount / 1e9} SOL, Claimable: ${claimableRewards / 1e9} SOL, Claimed: ${claimedTotal / 1e9} SOL`);
          
          // Include ALL accounts that have:
          // 1. Active deposits (isActive && depositedAmount > 0), OR
          // 2. Claimable rewards > 0, OR
          // 3. Claimed rewards > 0
          // This ensures we show all backers who have ever participated, even if they've withdrawn
          const hasActiveDeposit = isActive && depositedAmount > 0;
          const hasClaimableRewards = claimableRewards > 0;
          const hasClaimedRewards = claimedTotal > 0;
          
          if (hasActiveDeposit || hasClaimableRewards || hasClaimedRewards) {

            // Log detailed calculation for all accounts (for debugging)
            const backerStr = backerPubkey instanceof PublicKey ? backerPubkey.toString() : String(backerPubkey);
            this.logger.log(`   ✅ Including backer ${backerStr.slice(0, 8)}...${backerStr.slice(-8)}:`);
            this.logger.log(`     - Deposited: ${depositedAmount / 1e9} SOL (${depositedAmount} lamports)`);
            this.logger.log(`     - Reward Per Share: ${rewardPerShare.toString()}`);
            this.logger.log(`     - Reward Debt: ${rewardDebt.toString()}`);
            this.logger.log(`     - Accumulated: ${accumulated.toString()}`);
            this.logger.log(`     - Claimable: ${claimableRewards / 1e9} SOL (${claimableRewards} lamports)`);
            this.logger.log(`     - Claimed: ${claimedTotal / 1e9} SOL (${claimedTotal} lamports)`);
            this.logger.log(`     - Total Rewards: ${(claimableRewards + claimedTotal) / 1e9} SOL`);

            leaderboard.push({
              wallet: backerPubkey instanceof PublicKey ? backerPubkey.toString() : String(backerPubkey),
              depositedAmount,
              claimableRewards,
              claimedTotal,
              isActive,
            });
          }
        } catch (error) {
          this.logger.warn(`Failed to process backer account: ${error instanceof Error ? error.message : String(error)}`);
          this.logger.debug(`   Account data: ${JSON.stringify(account, null, 2)}`);
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
    } catch (error: any) {
      this.logger.error(`Failed to get leaderboard: ${error?.message || String(error)}`);
      this.logger.error(`Stack: ${error?.stack}`);
      
      // Return empty leaderboard instead of throwing to prevent 500 errors
      // This allows frontend to display "No backers found" message
      const rewardPoolAddress = getRewardPoolAddress().toString();
      return {
        leaderboard: [],
        rewardPoolBalance: 0,
        rewardPoolAddress: rewardPoolAddress,
      };
    }
  }

  /**
   * Calculate excess rewards (surplus) in Reward Pool
   * Excess = reward_pool_balance - total_claimable_rewards
   * Only the authorized admin can withdraw this excess
   */
  async calculateExcessRewards(): Promise<{
    rewardPoolBalance: number; // lamports
    totalClaimableRewards: number; // lamports - sum of all backers' claimable rewards
    excessRewards: number; // lamports - surplus that can be withdrawn by authorized admin
    leaderboard: Array<{
      wallet: string;
      depositedAmount: number;
      claimableRewards: number;
      claimedTotal: number;
    }>;
  }> {
    try {
      this.logger.log('📊 Calculating excess rewards...');
      
      // Get leaderboard to calculate total claimable
      const leaderboardData = await this.getLeaderboard();
      const totalClaimable = leaderboardData.leaderboard.reduce(
        (sum, entry) => sum + entry.claimableRewards,
        0
      );
      
      const excessRewards = Math.max(0, leaderboardData.rewardPoolBalance - totalClaimable);
      
      this.logger.log(`   Reward Pool Balance: ${leaderboardData.rewardPoolBalance / 1e9} SOL`);
      this.logger.log(`   Total Claimable Rewards: ${totalClaimable / 1e9} SOL`);
      this.logger.log(`   Excess Rewards (surplus): ${excessRewards / 1e9} SOL`);
      
      if (excessRewards > 0) {
        this.logger.log(`   ✅ Excess rewards available for authorized admin withdrawal`);
      } else {
        this.logger.log(`   ⚠️  No excess rewards (all rewards are claimable by backers)`);
      }
      
      return {
        rewardPoolBalance: leaderboardData.rewardPoolBalance,
        totalClaimableRewards: totalClaimable,
        excessRewards,
        leaderboard: leaderboardData.leaderboard.map(entry => ({
          wallet: entry.wallet,
          depositedAmount: entry.depositedAmount,
          claimableRewards: entry.claimableRewards,
          claimedTotal: entry.claimedTotal,
        })),
      };
    } catch (error: any) {
      this.logger.error(`Failed to calculate excess rewards: ${error?.message || String(error)}`);
      // Return empty data instead of throwing
      return {
        rewardPoolBalance: 0,
        totalClaimableRewards: 0,
        excessRewards: 0,
        leaderboard: [],
      };
    }
  }

  /**
   * Get user's stake and reward information
   */
  /**
   * Calculate maximum unstake amount using liquid_balance
   *
   * With simplified pool system:
   * - liquid_balance is shared between deployments and withdrawals
   * - Max unstake = min(userStake, liquidBalance)
   */
  async calculateMaxUnstake(walletAddress: string): Promise<{
    userStake: number;
    maxUnstake: number;
    poolLiquidBalance: number;
    poolWithdrawalBalance: number; // Same as liquid_balance (for backward compatibility)
    poolTotalDeposited: number;
    poolUtilization: number;
    canUnstake: boolean;
    reason?: string;
  }> {
    try {
      this.logger.log(`💰 Calculating max unstake for wallet: ${walletAddress}`);

      // Get pool state
      const poolState = await this.getPoolState();
      const liquidBalance = poolState.liquidBalance; // lamports (shared between deployments and withdrawals)
      const totalDeposited = poolState.totalDeposited; // lamports

      // Get user stake
      this.logger.log(`   🔍 Fetching user stake info for wallet: ${walletAddress}`);
      const userInfo = await this.getUserStakeInfo(walletAddress);
      const userStake = userInfo.depositedAmount; // lamports
      this.logger.log(`   📊 User stake info result:`);
      this.logger.log(`     depositedAmount: ${userStake} lamports (${userStake / 1e9} SOL)`);
      this.logger.log(`     isActive: ${userInfo.isActive}`);

      // Calculate current utilization (for display purposes)
      const currentUtilization = totalDeposited > 0
        ? ((totalDeposited - liquidBalance) / totalDeposited) * 100
        : 0;

      this.logger.log(`   Pool State:`);
      this.logger.log(`     Total Deposited: ${totalDeposited / 1e9} SOL`);
      this.logger.log(`     Liquid Balance (shared for deploy & withdraw): ${liquidBalance / 1e9} SOL`);
      this.logger.log(`     Current Utilization: ${currentUtilization.toFixed(2)}%`);
      this.logger.log(`   User Stake: ${userStake / 1e9} SOL`);

      // Check if user has any stake
      // Allow unstake if deposited_amount > 0, even if isActive = false
      // This handles cases where isActive was incorrectly set to false
      // If user has deposited_amount > 0, they should be able to withdraw
      if (userStake === 0) {
        return {
          userStake: 0,
          maxUnstake: 0,
          poolLiquidBalance: liquidBalance,
          poolWithdrawalBalance: liquidBalance, // Same as liquid_balance for backward compatibility
          poolTotalDeposited: totalDeposited,
          poolUtilization: currentUtilization,
          canUnstake: false,
          reason: 'No stake found. Please stake SOL first.',
        };
      }

      // Check if liquid_balance has any balance
      if (liquidBalance === 0) {
        return {
          userStake,
          maxUnstake: 0,
          poolLiquidBalance: liquidBalance,
          poolWithdrawalBalance: liquidBalance, // Same as liquid_balance for backward compatibility
          poolTotalDeposited: totalDeposited,
          poolUtilization: currentUtilization,
          canUnstake: false,
          reason: 'Liquid balance is empty. All SOL may have been used for deployments.',
        };
      }

      // Max unstake is the minimum of:
      // 1. User's stake (can't unstake more than they have)
      // 2. Liquid balance (shared between deployments and withdrawals)
      let maxUnstake = Math.min(
        userStake,
        liquidBalance
      );

      // Ensure non-negative
      maxUnstake = Math.max(0, Math.floor(maxUnstake));

      const canUnstake = maxUnstake > 0;
      let reason: string | undefined;

      if (!canUnstake) {
        if (liquidBalance === 0) {
          reason = `Liquid balance is empty. Available for withdrawal: ${(liquidBalance / 1e9).toFixed(4)} SOL`;
        } else if (userStake === 0) {
          reason = 'No stake found. Please stake SOL first.';
        } else {
          reason = 'Cannot unstake at this time';
        }
      }

      this.logger.log(`   Max Unstake Calculation (using liquid_balance):`);
      this.logger.log(`     User Stake: ${userStake / 1e9} SOL`);
      this.logger.log(`     Liquid Balance: ${liquidBalance / 1e9} SOL`);
      this.logger.log(`     Final Max Unstake: ${maxUnstake / 1e9} SOL`);
      this.logger.log(`     Can Unstake: ${canUnstake}`);
      if (reason) this.logger.log(`     Reason: ${reason}`);

      return {
        userStake,
        maxUnstake,
        poolLiquidBalance: liquidBalance,
        poolWithdrawalBalance: liquidBalance, // Same as liquid_balance for backward compatibility
        poolTotalDeposited: totalDeposited,
        poolUtilization: currentUtilization,
        canUnstake,
        reason,
      };
    } catch (error) {
      this.logger.error(`Failed to calculate max unstake: ${error.message}`);
      throw error;
    }
  }

  async getUserStakeInfo(walletAddress: string): Promise<{
    wallet: string;
    depositedAmount: number; // lamports
    claimableRewards: number; // lamports
    claimedTotal: number; // lamports
    isActive: boolean;
    totalRewards: number; // lamports (claimable + claimed)
  }> {
    try {
      this.logger.log(`📊 Fetching stake info for wallet: ${walletAddress}`);

      const program = this.programService.getProgram();
      const poolState = await this.getPoolState();
      const PRECISION = BigInt('1000000000000'); // 1e12
      const rewardPerShare = BigInt(poolState.rewardPerShare);

      // Get BackerDeposit PDA
      const [backerDepositPDA] = this.programService.getBackerDepositPDA(new PublicKey(walletAddress));

      this.logger.log(`   BackerDeposit PDA: ${backerDepositPDA.toString()}`);

      try {
        // Try to fetch as backerDeposit first, fallback to lenderStake (legacy)
        let backerDeposit: any = null;
        try {
          backerDeposit = await program.account.backerDeposit.fetch(
          backerDepositPDA,
          'confirmed' // Force confirmed commitment to get latest state
        );
          this.logger.log(`   ✅ Fetched as backerDeposit`);
        } catch (backerDepositError: any) {
          this.logger.log(`   ⚠️  Failed to fetch as backerDeposit: ${backerDepositError.message}`);
          // Try legacy lenderStake account name
          try {
            backerDeposit = await (program.account as any).lenderStake.fetch(
              backerDepositPDA,
              'confirmed'
            );
            this.logger.log(`   ✅ Fetched as lenderStake (legacy)`);
          } catch (lenderStakeError: any) {
            this.logger.log(`   ❌ Failed to fetch as lenderStake: ${lenderStakeError.message}`);
            throw backerDepositError; // Throw original error
          }
        }

        // Extract data with proper error handling
        const isActive = backerDeposit.isActive !== undefined ? backerDeposit.isActive : (backerDeposit as any).is_active || false;
        const depositedAmount = backerDeposit.depositedAmount
          ? (typeof backerDeposit.depositedAmount === 'number'
              ? backerDeposit.depositedAmount
              : backerDeposit.depositedAmount.toNumber())
          : ((backerDeposit as any).deposited_amount
              ? (typeof (backerDeposit as any).deposited_amount === 'number'
                  ? (backerDeposit as any).deposited_amount
                  : (backerDeposit as any).deposited_amount.toNumber())
              : 0);
        const pendingRewards = backerDeposit.pendingRewards
          ? (typeof backerDeposit.pendingRewards === 'number'
              ? backerDeposit.pendingRewards
              : backerDeposit.pendingRewards.toNumber())
          : ((backerDeposit as any).pending_rewards
              ? (typeof (backerDeposit as any).pending_rewards === 'number'
                  ? (backerDeposit as any).pending_rewards
                  : (backerDeposit as any).pending_rewards.toNumber())
              : 0);
        const rewardDebt = backerDeposit.rewardDebt
          ? (typeof backerDeposit.rewardDebt === 'bigint'
              ? backerDeposit.rewardDebt
              : backerDeposit.rewardDebt.toBigInt())
          : ((backerDeposit as any).reward_debt
              ? (typeof (backerDeposit as any).reward_debt === 'bigint'
                  ? (backerDeposit as any).reward_debt
                  : BigInt((backerDeposit as any).reward_debt.toString()))
              : BigInt(0));
        const claimedTotal = backerDeposit.claimedTotal
          ? (typeof backerDeposit.claimedTotal === 'number'
              ? backerDeposit.claimedTotal
              : backerDeposit.claimedTotal.toNumber())
          : ((backerDeposit as any).claimed_total
              ? (typeof (backerDeposit as any).claimed_total === 'number'
                  ? (backerDeposit as any).claimed_total
                  : (backerDeposit as any).claimed_total.toNumber())
              : 0);
        
        this.logger.log(`   📊 Extracted data:`);
        this.logger.log(`     isActive: ${isActive}`);
        this.logger.log(`     depositedAmount: ${depositedAmount} lamports (${depositedAmount / 1e9} SOL)`);
        this.logger.log(`     pendingRewards: ${pendingRewards} lamports (${pendingRewards / 1e9} SOL)`);
        this.logger.log(`     rewardDebt: ${rewardDebt.toString()}`);
        this.logger.log(`     claimedTotal: ${claimedTotal} lamports (${claimedTotal / 1e9} SOL)`);

        // Validate extracted data
        if (depositedAmount === 0 && isActive) {
          this.logger.warn(`   ⚠️  WARNING: depositedAmount is 0 but isActive is true - this might be an issue`);
        }
        if (depositedAmount > 0 && !isActive) {
          this.logger.warn(`   ⚠️  WARNING: depositedAmount > 0 (${depositedAmount / 1e9} SOL) but isActive is false - account will be reactivated on unstake`);
        }

        // Calculate claimable rewards
        // Formula: pending_rewards + (deposited_amount * reward_per_share - reward_debt) / PRECISION
        const depositedAmountBigInt = BigInt(depositedAmount);
        const accumulated = depositedAmountBigInt * rewardPerShare;

        // Ensure we don't get negative values
        const rewardsFromRewardPerShare = accumulated >= rewardDebt
          ? (accumulated - rewardDebt) / PRECISION
          : BigInt(0);

        // Total claimable = pending_rewards + rewards from reward_per_share
        const claimableRewards = pendingRewards + Number(rewardsFromRewardPerShare);
        const totalRewards = claimableRewards + claimedTotal;

        this.logger.log(`   ✅ User stake info:`);
        this.logger.log(`     Deposited: ${depositedAmount / 1e9} SOL`);
        this.logger.log(`     Claimable: ${claimableRewards / 1e9} SOL`);
        this.logger.log(`     Claimed: ${claimedTotal / 1e9} SOL`);
        this.logger.log(`     Total Rewards: ${totalRewards / 1e9} SOL`);

        return {
          wallet: walletAddress,
          depositedAmount,
          claimableRewards,
          claimedTotal,
          isActive,
          totalRewards,
        };
      } catch (error: any) {
        // User hasn't staked yet - handle various error messages
        const errorMessage = error?.message || String(error);
        const errorCode = error?.code || error?.errorCode || '';
        
        // Log full error for debugging
        this.logger.warn(`   ⚠️  Error fetching stake account:`);
        this.logger.warn(`     Message: ${errorMessage}`);
        this.logger.warn(`     Code: ${errorCode}`);
        this.logger.warn(`     PDA: ${backerDepositPDA.toString()}`);

        // Check if account exists on-chain (even if deserialization fails)
        try {
          const program = this.programService.getProgram();
          const accountInfo = await program.provider.connection.getAccountInfo(backerDepositPDA, 'confirmed');
          if (accountInfo) {
            this.logger.warn(`     ⚠️  Account EXISTS on-chain but deserialization failed!`);
            this.logger.warn(`     Account size: ${accountInfo.data.length} bytes`);
            this.logger.warn(`     Account owner: ${accountInfo.owner.toString()}`);
            this.logger.warn(`     This might be an old account format that needs migration.`);
            
            // Try to parse raw account data manually
            try {
              // BackerDeposit layout: 8 (discriminator) + 32 (backer) + 8 (depositedAmount) + 16 (rewardDebt) + 8 (claimedTotal) + 1 (isActive) + 1 (bump)
              const data = accountInfo.data;
              if (data.length >= 74) {
                // Skip discriminator (8 bytes)
                let offset = 8;
                
                // Read backer (32 bytes) - skip
                offset += 32;
                
                // Read depositedAmount (8 bytes, u64, little-endian)
                const depositedAmountBuffer = data.slice(offset, offset + 8);
                const depositedAmount = Number(depositedAmountBuffer.readBigUInt64LE(0));
                offset += 8;
                
                // Read rewardDebt (16 bytes, u128, little-endian) - skip for now
                offset += 16;
                
                // Read claimedTotal (8 bytes, u64, little-endian)
                const claimedTotalBuffer = data.slice(offset, offset + 8);
                const claimedTotal = Number(claimedTotalBuffer.readBigUInt64LE(0));
                offset += 8;
                
                // Read isActive (1 byte, bool)
                const isActive = data[offset] === 1;
                
                this.logger.log(`     ✅ Successfully parsed raw account data:`);
                this.logger.log(`       depositedAmount: ${depositedAmount} lamports (${depositedAmount / 1e9} SOL)`);
                this.logger.log(`       claimedTotal: ${claimedTotal} lamports (${claimedTotal / 1e9} SOL)`);
                this.logger.log(`       isActive: ${isActive}`);
                
                // Return parsed data instead of 0
                if (depositedAmount > 0) {
                  this.logger.log(`     ✅ Returning parsed data (account has ${depositedAmount / 1e9} SOL staked)`);
                  return {
                    wallet: walletAddress,
                    depositedAmount,
                    claimableRewards: 0, // Can't calculate without rewardDebt
                    claimedTotal,
                    isActive,
                    totalRewards: claimedTotal,
                  };
                }
              }
            } catch (parseError: any) {
              this.logger.warn(`     Could not parse raw account data: ${parseError.message}`);
            }
            
            // Account exists but can't deserialize - might be old format
            // Return 0 but log warning
          } else {
            this.logger.log(`     ℹ️  Account does not exist on-chain`);
          }
        } catch (accountCheckError: any) {
          this.logger.warn(`     Could not check account existence: ${accountCheckError.message}`);
        }

        if (
          errorMessage.includes('Account does not exist') ||
          errorMessage.includes('not found') ||
          errorMessage.includes('InvalidAccountData') ||
          errorCode === 'InvalidAccountData' ||
          errorCode === 3001 || // AccountDiscriminatorMismatch
          errorCode === 3002 || // AccountDiscriminatorMismatch
          errorCode === 3003 // AccountDidNotDeserialize
        ) {
          this.logger.log(`   ℹ️  User hasn't staked yet or account needs migration`);
          return {
            wallet: walletAddress,
            depositedAmount: 0,
            claimableRewards: 0,
            claimedTotal: 0,
            isActive: false,
            totalRewards: 0,
          };
        }
        
        // Log unexpected errors but don't throw - return empty data instead
        this.logger.warn(`   ⚠️  Unexpected error - returning empty stake info`);
        return {
          wallet: walletAddress,
          depositedAmount: 0,
          claimableRewards: 0,
          claimedTotal: 0,
          isActive: false,
          totalRewards: 0,
        };
      }
    } catch (error: any) {
      // Catch-all error handler
      this.logger.error(`Failed to get user stake info: ${error?.message || String(error)}`);
      this.logger.error(`Stack: ${error?.stack}`);
      
      // Return empty data instead of throwing to prevent 500 errors
      return {
        wallet: walletAddress,
        depositedAmount: 0,
        claimableRewards: 0,
        claimedTotal: 0,
        isActive: false,
        totalRewards: 0,
      };
    }
  }

  /**
   * Get utilization history (daily SOL usage)
   */
  async getUtilizationHistory(): Promise<{
    history: Array<{ date: string; solUsed: number; deploymentCount: number }>;
    currentUtilizationRate: number;
    projectedApy: number;
  }> {
    try {
      this.logger.log('📊 Calculating utilization history...');
      
      // 1. Get all deployments
      const deployments = await this.supabaseService.getAllDeployments();
      
      // 2. Group by date
      const dailyStats = new Map<string, { solUsed: number; deploymentCount: number }>();
      
      deployments.forEach(d => {
        if (!d.created_at) return;
        
        const date = new Date(d.created_at).toISOString().split('T')[0];
        const cost = (d.deployment_cost || 0) / 1_000_000_000; // Convert to SOL
        
        const current = dailyStats.get(date) || { solUsed: 0, deploymentCount: 0 };
        dailyStats.set(date, {
          solUsed: current.solUsed + cost,
          deploymentCount: current.deploymentCount + 1
        });
      });
      
      // 3. Convert to array and sort
      const history = Array.from(dailyStats.entries())
        .map(([date, stats]) => ({
          date,
          solUsed: stats.solUsed,
          deploymentCount: stats.deploymentCount
        }))
        .sort((a, b) => a.date.localeCompare(b.date));
        
      // If history is empty, add some dummy data for today if it's a fresh dev env
      if (history.length === 0) {
         const today = new Date().toISOString().split('T')[0];
         history.push({ date: today, solUsed: 0, deploymentCount: 0 });
      }
      
      // 4. Calculate current utilization rate
      const poolState = await this.getPoolState();
      const totalPoolSOL = poolState.availableForDeploySOL;
      
      // Sum of active deployments (approximate - ideally we check status)
      // For now, assume deployments in last 30 days are "active" or just take totalDeposited vs liquidBalance
      // Better: Utilization = (TotalDeposited - LiquidBalance) / TotalDeposited
      // But liquidBalance is tricky because of rent.
      // Let's use the poolState values:
      
      let utilizationRate = 0;
      if (poolState.totalDeposited > 0) {
          // Calculate used amount
          // Total Deposited - Available Liquid = Used
          // Note: liquidBalance in poolState is "available for deploy"
          const usedSOL = (poolState.totalDeposited / 1e9) - (poolState.liquidBalance / 1e9);
          utilizationRate = Math.max(0, usedSOL) / (poolState.totalDeposited / 1e9);
      }
      
      // Cap at 100%
      utilizationRate = Math.min(1, utilizationRate);
      
      // 5. Calculate APY based on utilization
      // Base APY: 5%
      // Max APY: 20% (at 100% utilization)
      // Formula: APY = 5 + (15 * utilizationRate)
      const baseApy = 5;
      const maxBonusApy = 15;
      const projectedApy = baseApy + (maxBonusApy * utilizationRate);
      
      this.logger.log(`   Utilization Rate: ${(utilizationRate * 100).toFixed(2)}%`);
      this.logger.log(`   Projected APY: ${projectedApy.toFixed(2)}%`);
      
      return {
        history: history.slice(-30), // Last 30 days
        currentUtilizationRate: utilizationRate,
        projectedApy
      };
      
    } catch (error) {
      this.logger.error(`Failed to get utilization history: ${error.message}`);
      return {
        history: [],
        currentUtilizationRate: 0,
        projectedApy: 5 // Fallback default
      };
    }
  }
}
