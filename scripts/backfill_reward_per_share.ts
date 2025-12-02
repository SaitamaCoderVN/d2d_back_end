/**
 * Backfill script for reward-per-share migration
 * 
 * Fetches on-chain data and updates database with:
 * - Pool state (reward_per_share, total_deposited, liquid_balance, etc.)
 * - Backer deposits (reward_debt, deposited_amount, claimed_total)
 * 
 * Usage:
 *   npm run backfill:reward-per-share
 *   OR
 *   ts-node scripts/backfill_reward_per_share.ts
 */

import { Connection, PublicKey, Keypair } from '@solana/web3.js';
import { Program, AnchorProvider, Wallet } from '@coral-xyz/anchor';
import { createClient } from '@supabase/supabase-js';
import * as fs from 'fs';
import * as path from 'path';
import IDL from '../src/program/idl/d2d_program_sol.json';
import { D2dProgramSol } from '../src/program/types/d2d_program_sol';
import { getD2DProgramId, getTreasuryPoolPDA } from '../src/program/utils/pda.utils';

// Configuration
const RPC_URL = process.env.SOLANA_RPC_URL || 'https://api.devnet.solana.com';
// Get program ID from IDL (no hardcoding)
const PROGRAM_ID = getD2DProgramId();
const SUPABASE_URL = process.env.SUPABASE_URL || '';
const SUPABASE_SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || '';

// Constants
const PRECISION = BigInt('1000000000000'); // 1e12

interface TreasuryPoolData {
  rewardPerShare: bigint;
  totalDeposited: number;
  liquidBalance: number;
  rewardPoolBalance: number;
  platformPoolBalance: number;
}

interface BackerDepositData {
  wallet: string;
  depositedAmount: number;
  rewardDebt: bigint;
  claimedTotal: number;
}

async function fetchTreasuryPool(program: Program<D2dProgramSol>, treasuryPoolPda: PublicKey): Promise<TreasuryPoolData> {
  try {
    const treasuryPool = await program.account.treasuryPool.fetch(treasuryPoolPda);
    
    return {
      rewardPerShare: (treasuryPool.rewardPerShare as any).toBigInt ? (treasuryPool.rewardPerShare as any).toBigInt() : BigInt(treasuryPool.rewardPerShare.toString()),
      totalDeposited: (treasuryPool.totalDeposited as any).toNumber ? (treasuryPool.totalDeposited as any).toNumber() : Number(treasuryPool.totalDeposited),
      liquidBalance: (treasuryPool.liquidBalance as any).toNumber ? (treasuryPool.liquidBalance as any).toNumber() : Number(treasuryPool.liquidBalance),
      rewardPoolBalance: (treasuryPool.rewardPoolBalance as any).toNumber ? (treasuryPool.rewardPoolBalance as any).toNumber() : Number(treasuryPool.rewardPoolBalance),
      platformPoolBalance: (treasuryPool.platformPoolBalance as any).toNumber ? (treasuryPool.platformPoolBalance as any).toNumber() : Number(treasuryPool.platformPoolBalance),
    };
  } catch (error) {
    console.error('Error fetching treasury pool:', error);
    throw error;
  }
}

async function fetchAllBackers(
  program: Program<D2dProgramSol>,
  connection: Connection
): Promise<BackerDepositData[]> {
  const backers: BackerDepositData[] = [];
  
  try {
    // Fetch all BackerDeposit accounts
    // Try both account names (IDL might use either)
    let accounts: any[] = [];
    try {
      accounts = await (program.account as any).backerDeposit?.all() || [];
    } catch (e) {
      try {
        accounts = await (program.account as any).lenderStake?.all() || [];
      } catch (e2) {
        console.warn('Could not fetch backer accounts, returning empty array');
      }
    }
    
    for (const account of accounts) {
      const acc = account.account;
      const isActive = acc.isActive;
      const depositedAmount = (acc.depositedAmount as any).toNumber ? (acc.depositedAmount as any).toNumber() : Number(acc.depositedAmount);
      
      if (isActive && depositedAmount > 0) {
        const rewardDebt = (acc.rewardDebt as any).toBigInt ? (acc.rewardDebt as any).toBigInt() : BigInt(acc.rewardDebt.toString());
        const claimedTotal = (acc.claimedTotal as any).toNumber ? (acc.claimedTotal as any).toNumber() : Number(acc.claimedTotal);
        
        backers.push({
          wallet: acc.backer.toString(),
          depositedAmount,
          rewardDebt,
          claimedTotal,
        });
      }
    }
  } catch (error) {
    console.error('Error fetching backers:', error);
    throw error;
  }
  
  return backers;
}

async function updatePoolInDB(
  supabase: any,
  poolData: TreasuryPoolData
): Promise<void> {
  const { error } = await supabase
    .from('pool')
    .update({
      reward_per_share: poolData.rewardPerShare.toString(),
      total_deposited: poolData.totalDeposited,
      liquid_balance: poolData.liquidBalance,
      reward_pool_balance: poolData.rewardPoolBalance,
      platform_pool_balance: poolData.platformPoolBalance,
      updated_at: new Date().toISOString(),
    })
    .eq('id', '00000000-0000-0000-0000-000000000000');
  
  if (error) {
    throw new Error(`Failed to update pool: ${error.message}`);
  }
  
  console.log('✅ Pool updated in database');
}

async function updateBackersInDB(
  supabase: any,
  backers: BackerDepositData[]
): Promise<void> {
  for (const backer of backers) {
    // Upsert backer record
    const { error } = await supabase
      .from('backers')
      .upsert({
        wallet_address: backer.wallet,
        deposited_amount: backer.depositedAmount,
        reward_debt: backer.rewardDebt.toString(),
        claimed_total: backer.claimedTotal,
        is_active: true,
        updated_at: new Date().toISOString(),
      }, {
        onConflict: 'wallet_address',
      });
    
    if (error) {
      console.error(`Failed to update backer ${backer.wallet}:`, error);
    } else {
      console.log(`✅ Updated backer: ${backer.wallet}`);
    }
  }
}

async function createSnapshot(
  supabase: any,
  poolData: TreasuryPoolData,
  treasuryPoolPda: PublicKey
): Promise<void> {
  const { error } = await supabase
    .from('pools_snapshot')
    .insert({
      reward_per_share: poolData.rewardPerShare.toString(),
      total_deposited: poolData.totalDeposited,
      liquid_balance: poolData.liquidBalance,
      reward_pool_balance: poolData.rewardPoolBalance,
      platform_pool_balance: poolData.platformPoolBalance,
      treasury_pool_pda: treasuryPoolPda.toString(),
    });
  
  if (error) {
    console.error('Failed to create snapshot:', error);
  } else {
    console.log('✅ Snapshot created');
  }
}

async function main() {
  console.log('🚀 Starting reward-per-share backfill...');
  
  // Initialize connection
  const connection = new Connection(RPC_URL, 'confirmed');
  const keypair = Keypair.generate(); // Dummy keypair for provider
  const wallet = new Wallet(keypair);
  const provider = new AnchorProvider(connection, wallet, {
    commitment: 'confirmed',
  });
  const program = new Program<D2dProgramSol>(IDL as D2dProgramSol, provider);
  
  // Initialize Supabase
  if (!SUPABASE_URL || !SUPABASE_SERVICE_KEY) {
    throw new Error('SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY must be set');
  }
  const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY);
  
  // Derive Treasury Pool PDA (no hardcoding)
  const [treasuryPoolPda] = getTreasuryPoolPDA();
  
  console.log(`📊 Fetching on-chain data from: ${treasuryPoolPda.toString()}`);
  
  // Fetch on-chain data
  const poolData = await fetchTreasuryPool(program, treasuryPoolPda);
  const backers = await fetchAllBackers(program, connection);
  
  console.log(`\n📈 Pool State:`);
  console.log(`  reward_per_share: ${poolData.rewardPerShare}`);
  console.log(`  total_deposited: ${poolData.totalDeposited} lamports`);
  console.log(`  liquid_balance: ${poolData.liquidBalance} lamports`);
  console.log(`  reward_pool_balance: ${poolData.rewardPoolBalance} lamports`);
  console.log(`  platform_pool_balance: ${poolData.platformPoolBalance} lamports`);
  console.log(`\n👥 Found ${backers.length} active backers`);
  
  // Update database
  await updatePoolInDB(supabase, poolData);
  await updateBackersInDB(supabase, backers);
  await createSnapshot(supabase, poolData, treasuryPoolPda);
  
  console.log('\n✅ Backfill completed successfully!');
}

// Run if executed directly
if (require.main === module) {
  main().catch(console.error);
}

export { main as backfillRewardPerShare };

