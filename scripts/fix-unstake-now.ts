/**
 * QUICK FIX: Sync liquid balance và rebalance withdrawal pool
 * Chạy script này để fix vấn đề unstake NGAY LẬP TỨC
 *
 * Usage:
 *   npx ts-node scripts/fix-unstake-now.ts
 */

import { AnchorProvider, Program, setProvider, BN } from '@coral-xyz/anchor';
import { Connection, PublicKey, Keypair, SystemProgram } from '@solana/web3.js';
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

async function fixUnstakeIssue() {
  console.log('\n🔧 FIXING UNSTAKE ISSUE\n');
  console.log('Admin:', adminKeypair.publicKey.toString());
  console.log('Treasury Pool:', treasuryPoolPDA.toString());
  console.log('');

  // Step 1: Check current state
  console.log('📋 Step 1: Checking current state...');
  const accountInfo = await connection.getAccountInfo(treasuryPoolPDA);
  if (!accountInfo) {
    console.error('❌ Treasury Pool account not found!');
    process.exit(1);
  }

  const beforeBalance = accountInfo.lamports / 1e9;
  console.log(`   Treasury Pool balance: ${beforeBalance} SOL`);

  let treasuryPool;
  try {
    treasuryPool = await (program.account as any).treasuryPool.fetch(treasuryPoolPDA);
    console.log(`   liquid_balance (before): ${treasuryPool.liquidBalance.toNumber() / 1e9} SOL`);
    console.log(`   withdrawal_pool_balance (before): ${treasuryPool.withdrawalPoolBalance.toNumber() / 1e9} SOL`);
    console.log(`   total_deposited: ${treasuryPool.totalDeposited.toNumber() / 1e9} SOL`);
  } catch (error: any) {
    console.error('❌ Cannot fetch treasury pool:', error.message);
    process.exit(1);
  }

  const beforeWithdrawal = treasuryPool.withdrawalPoolBalance.toNumber() / 1e9;
  const beforeLiquid = treasuryPool.liquidBalance.toNumber() / 1e9;

  // Step 2: Call force_rebalance (emergency instruction without admin check)
  console.log('\n📋 Step 2: Calling force_rebalance instruction...');
  console.log('   This will:');
  console.log('   1. Update liquid_balance from actual account balance');
  console.log('   2. Rebalance withdrawal_pool_balance = liquid_balance / 4');
  console.log('   Note: Using emergency force_rebalance (no admin check)');

  try {
    // Note: force_rebalance allows any signer (emergency workaround)
    const tx = await program.methods
      .forceRebalance()
      .accounts({
        treasuryPool: treasuryPoolPDA,
        treasuryPda: treasuryPoolPDA,
        signer: adminKeypair.publicKey,
      })
      .signers([adminKeypair])
      .rpc();

    console.log('   ✅ Transaction sent:', tx);
    console.log('   ⏳ Waiting for confirmation...');

    await connection.confirmTransaction(tx, 'confirmed');
    console.log('   ✅ Transaction confirmed!');
  } catch (error: any) {
    console.error('❌ Failed to rebalance:', error.message);
    if (error.logs) {
      console.error('   Logs:', error.logs.join('\n   '));
    }
    process.exit(1);
  }

  // Step 3: Verify the fix
  console.log('\n📋 Step 3: Verifying the fix...');
  await new Promise(resolve => setTimeout(resolve, 2000)); // Wait for state to update

  try {
    treasuryPool = await (program.account as any).treasuryPool.fetch(treasuryPoolPDA);
    const afterWithdrawal = treasuryPool.withdrawalPoolBalance.toNumber() / 1e9;
    const afterLiquid = treasuryPool.liquidBalance.toNumber() / 1e9;

    console.log(`   liquid_balance (after): ${afterLiquid} SOL`);
    console.log(`   withdrawal_pool_balance (after): ${afterWithdrawal} SOL`);
    console.log('');

    // Check if fix worked
    const expectedWithdrawal = afterLiquid / 4;
    const difference = Math.abs(afterWithdrawal - expectedWithdrawal);

    if (difference < 0.001) {
      console.log('✅ SUCCESS! Withdrawal pool rebalanced correctly!');
      console.log(`   Before: ${beforeWithdrawal.toFixed(6)} SOL`);
      console.log(`   After:  ${afterWithdrawal.toFixed(6)} SOL`);
      console.log(`   Expected: ${expectedWithdrawal.toFixed(6)} SOL`);
      console.log('');
      console.log('🎉 Users can now unstake up to', afterWithdrawal.toFixed(6), 'SOL');
    } else {
      console.log('⚠️  Warning: Withdrawal pool not at expected ratio');
      console.log(`   Current: ${afterWithdrawal.toFixed(6)} SOL`);
      console.log(`   Expected: ${expectedWithdrawal.toFixed(6)} SOL (25% of liquid)`);
      console.log(`   Difference: ${difference.toFixed(6)} SOL`);
    }
  } catch (error: any) {
    console.error('❌ Failed to verify:', error.message);
    process.exit(1);
  }

  // Step 4: Recommendations
  console.log('\n📝 Next Steps:');
  console.log('   1. Test unstake: npm run test-unstake <wallet> <amount>');
  console.log('   2. Check max unstake: curl http://localhost:3001/api/pool/max-unstake/<wallet>');
  console.log('   3. Monitor: npx ts-node scripts/check-unstake-issues.ts');
  console.log('');
}

fixUnstakeIssue()
  .then(() => {
    console.log('✅ Fix complete!\n');
    process.exit(0);
  })
  .catch((err) => {
    console.error('❌ Error:', err);
    process.exit(1);
  });