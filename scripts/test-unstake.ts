/**
 * Test unstake for a specific wallet
 *
 * Usage:
 *   npx ts-node scripts/test-unstake.ts <wallet_address>
 *
 * This will:
 * 1. Check user's stake
 * 2. Calculate max unstake
 * 3. Show what would happen if user unstakes
 */

import { AnchorProvider, Program, setProvider } from '@coral-xyz/anchor';
import { Connection, PublicKey, Keypair } from '@solana/web3.js';
import * as fs from 'fs';
import * as path from 'path';

// Load IDL
const idlPath = path.join(__dirname, '../../d2d-program-sol/target/idl/d2d_program_sol.json');
const idl = JSON.parse(fs.readFileSync(idlPath, 'utf8'));

// Load admin keypair
const adminKeypairPath = process.env.ADMIN_WALLET_PATH || path.join(process.env.HOME!, '.config/solana/id.json');
const adminKeypair = Keypair.fromSecretKey(
  new Uint8Array(JSON.parse(fs.readFileSync(adminKeypairPath, 'utf8')))
);

const DEVNET_RPC = process.env.SOLANA_DEVNET_RPC || 'https://api.devnet.solana.com';
const connection = new Connection(DEVNET_RPC, 'confirmed');

const wallet = {
  publicKey: adminKeypair.publicKey,
  signTransaction: async (tx: any) => {
    tx.partialSign(adminKeypair);
    return tx;
  },
  signAllTransactions: async (txs: any[]) => {
    return txs.map((tx) => {
      tx.partialSign(adminKeypair);
      return tx;
    });
  },
};

const provider = new AnchorProvider(connection, wallet as any, { commitment: 'confirmed' });
setProvider(provider);

const programId = new PublicKey(idl.address);
const program = new Program(idl, provider);

// Derive PDAs
const [treasuryPoolPDA] = PublicKey.findProgramAddressSync(
  [Buffer.from('treasury_pool')],
  programId
);

async function testUnstake(walletAddress: string) {
  console.log('\n🧪 TESTING UNSTAKE\n');

  const userPubkey = new PublicKey(walletAddress);
  console.log('User wallet:', userPubkey.toString());
  console.log('');

  // Get backer deposit PDA
  const [backerDepositPDA] = PublicKey.findProgramAddressSync(
    [Buffer.from('lender_stake'), userPubkey.toBuffer()],
    programId
  );

  // Step 1: Check user's stake
  console.log('📋 Step 1: Checking user stake...');
  let backerDeposit;
  try {
    backerDeposit = await (program.account as any).backerDeposit.fetch(backerDepositPDA);
    const depositedSOL = backerDeposit.depositedAmount.toNumber() / 1e9;
    console.log(`   ✅ User has staked: ${depositedSOL} SOL`);
    console.log(`   Is active: ${backerDeposit.isActive}`);
    console.log(`   Reward debt: ${backerDeposit.rewardDebt.toString()}`);
    console.log(`   Claimed total: ${backerDeposit.claimedTotal.toNumber() / 1e9} SOL`);
  } catch (error: any) {
    console.log('   ℹ️  User has NOT staked yet (account not found)');
    console.log('   Nothing to unstake.');
    return;
  }

  if (!backerDeposit.isActive) {
    console.log('   ⚠️  User stake is INACTIVE');
    console.log('   Cannot unstake inactive stake.');
    return;
  }

  const userStake = backerDeposit.depositedAmount.toNumber() / 1e9;
  console.log('');

  // Step 2: Check treasury pool
  console.log('📋 Step 2: Checking treasury pool...');
  let treasuryPool;
  try {
    treasuryPool = await (program.account as any).treasuryPool.fetch(treasuryPoolPDA);
    const liquidSOL = treasuryPool.liquidBalance.toNumber() / 1e9;
    const withdrawalSOL = treasuryPool.withdrawalPoolBalance.toNumber() / 1e9;
    const totalDeposited = treasuryPool.totalDeposited.toNumber() / 1e9;

    console.log(`   Total deposited: ${totalDeposited} SOL`);
    console.log(`   Liquid balance: ${liquidSOL} SOL (for deployments)`);
    console.log(`   Withdrawal pool: ${withdrawalSOL} SOL (for unstaking)`);
    console.log('');
  } catch (error: any) {
    console.error('   ❌ Cannot fetch treasury pool');
    return;
  }

  const withdrawalBalance = treasuryPool.withdrawalPoolBalance.toNumber() / 1e9;

  // Step 3: Calculate max unstake
  console.log('📋 Step 3: Calculating max unstake...');
  const maxUnstake = Math.min(userStake, withdrawalBalance);
  console.log(`   User stake: ${userStake.toFixed(6)} SOL`);
  console.log(`   Withdrawal pool: ${withdrawalBalance.toFixed(6)} SOL`);
  console.log(`   Max unstake: ${maxUnstake.toFixed(6)} SOL`);
  console.log('');

  // Step 4: Analysis
  console.log('📊 ANALYSIS:\n');

  if (withdrawalBalance === 0) {
    console.log('❌ CANNOT UNSTAKE');
    console.log('   Reason: Withdrawal pool is empty');
    console.log('   Solution: Run "npx ts-node scripts/fix-unstake-now.ts"');
  } else if (maxUnstake < userStake) {
    console.log('⚠️  PARTIAL UNSTAKE ONLY');
    console.log(`   User wants to unstake: ${userStake.toFixed(6)} SOL`);
    console.log(`   But can only unstake: ${maxUnstake.toFixed(6)} SOL`);
    console.log(`   Shortfall: ${(userStake - maxUnstake).toFixed(6)} SOL`);
    console.log('');
    console.log('   Reason: Withdrawal pool has insufficient funds');
    if (withdrawalBalance < treasuryPool.liquidBalance.toNumber() / 1e9 / 4) {
      console.log('   The withdrawal pool needs rebalancing!');
      console.log('   Solution: Run "npx ts-node scripts/fix-unstake-now.ts"');
    } else {
      console.log('   Most SOL is deployed or reserved for deployments');
      console.log('   Wait for deployments to close or more users to stake');
    }
  } else {
    console.log('✅ CAN UNSTAKE FULL AMOUNT');
    console.log(`   User can unstake up to: ${maxUnstake.toFixed(6)} SOL`);
    console.log(`   Remaining in withdrawal pool: ${(withdrawalBalance - maxUnstake).toFixed(6)} SOL`);
  }

  console.log('');
  console.log('🔗 Test on frontend:');
  console.log(`   1. Connect wallet: ${walletAddress}`);
  console.log('   2. Go to /backer/unstake page');
  console.log(`   3. Try to unstake ${Math.min(maxUnstake, 0.1).toFixed(4)} SOL (small test)`);
  console.log('');
}

// Get wallet from command line
const walletAddress = process.argv[2];

if (!walletAddress) {
  console.error('❌ Usage: npx ts-node scripts/test-unstake.ts <wallet_address>');
  console.error('');
  console.error('Example:');
  console.error('  npx ts-node scripts/test-unstake.ts A1dVA8adW1XXgcVmLCtbrvbVEVA1n3Q7kNPaTZVonjpq');
  process.exit(1);
}

testUnstake(walletAddress)
  .then(() => {
    console.log('✅ Test complete\n');
    process.exit(0);
  })
  .catch((err) => {
    console.error('❌ Error:', err);
    process.exit(1);
  });