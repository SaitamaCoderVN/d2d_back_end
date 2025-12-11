/**
 * Debug unstake issue - see exactly what's happening
 */
import { AnchorProvider, Program, setProvider } from '@coral-xyz/anchor';
import { Connection, PublicKey, Keypair } from '@solana/web3.js';
import * as fs from 'fs';
import * as path from 'path';

const idlPath = path.join(__dirname, '../../d2d-program-sol/target/idl/d2d_program_sol.json');
const idl = JSON.parse(fs.readFileSync(idlPath, 'utf8'));

const DEVNET_RPC = process.env.SOLANA_DEVNET_RPC || 'https://api.devnet.solana.com';
const connection = new Connection(DEVNET_RPC, 'confirmed');

const adminKeypairPath = process.env.ADMIN_WALLET_PATH || path.join(process.env.HOME!, '.config/solana/id.json');
const adminKeypair = Keypair.fromSecretKey(
  new Uint8Array(JSON.parse(fs.readFileSync(adminKeypairPath, 'utf8')))
);

const wallet = {
  publicKey: adminKeypair.publicKey,
  signTransaction: async (tx: any) => { tx.partialSign(adminKeypair); return tx; },
  signAllTransactions: async (txs: any[]) => txs.map(tx => { tx.partialSign(adminKeypair); return tx; }),
};

const provider = new AnchorProvider(connection, wallet as any, { commitment: 'confirmed' });
setProvider(provider);

const programId = new PublicKey(idl.address);
const program = new Program(idl, provider);

async function debugUnstake(walletAddress: string) {
  console.log('\n🔍 DEBUG UNSTAKE ISSUE\n');
  console.log('═══════════════════════════════════════════════════════════');
  console.log('Target wallet:', walletAddress);
  console.log('═══════════════════════════════════════════════════════════\n');

  // Step 1: Check Treasury Pool
  console.log('📋 Step 1: Checking Treasury Pool...');
  const [treasuryPoolPDA] = PublicKey.findProgramAddressSync(
    [Buffer.from('treasury_pool')],
    programId
  );
  console.log('   Treasury Pool PDA:', treasuryPoolPDA.toString());

  try {
    const treasuryPool = await (program.account as any).treasuryPool.fetch(treasuryPoolPDA);
    console.log('   ✅ Treasury Pool found');
    console.log('   withdrawal_pool_balance:', treasuryPool.withdrawalPoolBalance.toNumber() / 1e9, 'SOL');
    console.log('   liquid_balance:', treasuryPool.liquidBalance.toNumber() / 1e9, 'SOL');
    console.log('   total_deposited:', treasuryPool.totalDeposited.toNumber() / 1e9, 'SOL');
    console.log('   emergency_pause:', treasuryPool.emergencyPause);

    if (treasuryPool.emergencyPause) {
      console.log('   ⚠️  WARNING: Emergency pause is ACTIVE!');
    }

    if (treasuryPool.withdrawalPoolBalance.toNumber() === 0) {
      console.log('   ⚠️  WARNING: Withdrawal pool is EMPTY!');
    }
  } catch (error: any) {
    console.log('   ❌ Failed to fetch treasury pool:', error.message);
    process.exit(1);
  }

  // Step 2: Check BackerDeposit account
  console.log('\n📋 Step 2: Checking BackerDeposit account...');

  // Try multiple seed variations
  const seedVariations = [
    { name: 'lender_stake', seed: 'lender_stake' },
    { name: 'backer_deposit', seed: 'backer_deposit' },
  ];

  let foundAccount = null;
  let foundSeed = null;

  for (const variation of seedVariations) {
    const [backerDepositPDA] = PublicKey.findProgramAddressSync(
      [Buffer.from(variation.seed), new PublicKey(walletAddress).toBuffer()],
      programId
    );

    console.log(`   Trying seed "${variation.name}"`);
    console.log(`   PDA: ${backerDepositPDA.toString()}`);

    try {
      const backerDeposit = await (program.account as any).backerDeposit.fetch(backerDepositPDA);
      console.log(`   ✅ FOUND with seed "${variation.name}"!`);
      foundAccount = backerDeposit;
      foundSeed = variation.name;
      break;
    } catch (error: any) {
      console.log(`   ❌ Not found with this seed`);
    }
  }

  console.log('');

  if (!foundAccount) {
    console.log('❌ NO BACKER DEPOSIT ACCOUNT FOUND');
    console.log('');
    console.log('This wallet has never staked SOL.');
    console.log('');
    console.log('💡 Solution:');
    console.log('   1. Make sure you are using the correct wallet address');
    console.log('   2. This wallet needs to stake SOL first before unstaking');
    console.log('   3. Check if the wallet address in frontend matches the one here');
    process.exit(1);
  }

  // Step 3: Display account details
  console.log('═══════════════════════════════════════════════════════════');
  console.log('✅ BACKER DEPOSIT ACCOUNT DETAILS');
  console.log('═══════════════════════════════════════════════════════════');
  console.log('Found using seed:', foundSeed);
  console.log('Backer:', foundAccount.backer.toString());
  console.log('Deposited Amount:', foundAccount.depositedAmount.toNumber() / 1e9, 'SOL');
  console.log('Is Active:', foundAccount.isActive);
  console.log('Reward Debt:', foundAccount.rewardDebt.toString());
  console.log('Claimed Total:', foundAccount.claimedTotal.toNumber() / 1e9, 'SOL');
  console.log('');

  // Step 4: Check for issues
  let hasIssues = false;

  if (!foundAccount.isActive) {
    console.log('⚠️  ISSUE #1: isActive = false');
    console.log('   This account is marked as INACTIVE!');
    console.log('   The account cannot unstake until it is reactivated.');
    hasIssues = true;
  }

  if (foundAccount.depositedAmount.toNumber() === 0) {
    console.log('⚠️  ISSUE #2: depositedAmount = 0');
    console.log('   This account has no funds deposited.');
    console.log('   Nothing to unstake!');
    hasIssues = true;
  }

  // Step 5: Calculate max unstake
  console.log('═══════════════════════════════════════════════════════════');
  console.log('📊 UNSTAKE CALCULATION');
  console.log('═══════════════════════════════════════════════════════════');

  const treasuryPool = await (program.account as any).treasuryPool.fetch(treasuryPoolPDA);
  const withdrawalPoolBalance = treasuryPool.withdrawalPoolBalance.toNumber() / 1e9;
  const userDeposited = foundAccount.depositedAmount.toNumber() / 1e9;
  const maxUnstake = Math.min(withdrawalPoolBalance, userDeposited);

  console.log('User deposited amount:', userDeposited, 'SOL');
  console.log('Withdrawal pool balance:', withdrawalPoolBalance, 'SOL');
  console.log('Max unstake amount:', maxUnstake, 'SOL');
  console.log('');

  if (maxUnstake === 0) {
    console.log('❌ CANNOT UNSTAKE');
    if (withdrawalPoolBalance === 0) {
      console.log('   Reason: Withdrawal pool is empty');
      console.log('   Solution: Wait for pool to be rebalanced or for deployments to close');
    } else if (userDeposited === 0) {
      console.log('   Reason: User has no deposited amount');
      console.log('   Solution: Stake SOL first');
    }
  } else {
    console.log('✅ CAN UNSTAKE');
    console.log(`   User can unstake up to ${maxUnstake} SOL`);
  }

  console.log('');
  console.log('═══════════════════════════════════════════════════════════');

  if (!hasIssues && maxUnstake > 0) {
    console.log('✅ NO ISSUES FOUND - UNSTAKE SHOULD WORK!');
    console.log('');
    console.log('If unstake still fails on frontend:');
    console.log('1. Check browser console for detailed error');
    console.log('2. Verify wallet connection in frontend');
    console.log('3. Check that frontend is using the correct wallet address');
    console.log('4. Check RPC endpoint and network (devnet/mainnet)');
  } else {
    console.log('⚠️  ISSUES FOUND - FIX THESE BEFORE UNSTAKING');
  }

  console.log('═══════════════════════════════════════════════════════════\n');
}

const walletArg = process.argv[2];

if (!walletArg) {
  console.error('Usage: npx ts-node scripts/debug-unstake.ts <WALLET_ADDRESS>');
  process.exit(1);
}

debugUnstake(walletArg)
  .then(() => process.exit(0))
  .catch(err => {
    console.error('Error:', err);
    process.exit(1);
  });