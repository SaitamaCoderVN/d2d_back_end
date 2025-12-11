/**
 * Script to diagnose unstake issues
 * Checks:
 * 1. Treasury Pool account size
 * 2. withdrawal_pool_balance field
 * 3. liquid_balance
 * 4. Ability to unstake
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

async function checkUnstakeIssues() {
  console.log('\n🔍 CHECKING UNSTAKE ISSUES\n');
  console.log('Program ID:', programId.toString());
  console.log('Treasury Pool PDA:', treasuryPoolPDA.toString());
  console.log('Admin:', adminKeypair.publicKey.toString());
  console.log('');

  // 1. Check if Treasury Pool account exists
  console.log('📋 1. Checking Treasury Pool Account...');
  const accountInfo = await connection.getAccountInfo(treasuryPoolPDA);

  if (!accountInfo) {
    console.log('❌ Treasury Pool account does NOT exist!');
    console.log('   You need to initialize it first.');
    return;
  }

  console.log('✅ Account exists');
  console.log(`   Owner: ${accountInfo.owner.toString()}`);
  console.log(`   Size: ${accountInfo.data.length} bytes`);
  console.log(`   Lamports: ${accountInfo.lamports / 1e9} SOL`);

  // Calculate expected size
  // TreasuryPool struct size calculation:
  // See treasury_pool.rs #[derive(InitSpace)]
  const expectedMinSize = 270; // Approximate size with all fields
  console.log(`   Expected size: ~${expectedMinSize} bytes or more`);

  if (accountInfo.data.length < expectedMinSize) {
    console.log(`⚠️  Account size is SMALLER than expected!`);
    console.log(`   This means the account has OLD LAYOUT (missing withdrawal_pool_balance)`);
    console.log(`   Solution: Run migration instruction`);
  } else {
    console.log('✅ Account size looks correct');
  }
  console.log('');

  // 2. Try to deserialize Treasury Pool
  console.log('📋 2. Attempting to deserialize Treasury Pool...');
  try {
    const treasuryPool = await (program.account as any).treasuryPool.fetch(treasuryPoolPDA);
    console.log('✅ Successfully deserialized!');
    console.log('   Treasury Pool State:');
    console.log(`     reward_per_share: ${treasuryPool.rewardPerShare?.toString() || '0'}`);
    console.log(`     total_deposited: ${(treasuryPool.totalDeposited?.toNumber() || 0) / 1e9} SOL`);
    console.log(`     liquid_balance: ${(treasuryPool.liquidBalance?.toNumber() || 0) / 1e9} SOL`);

    // Check withdrawal_pool_balance
    const withdrawalPoolBalance = (treasuryPool as any).withdrawalPoolBalance;
    if (withdrawalPoolBalance !== undefined) {
      const withdrawalSOL = withdrawalPoolBalance.toNumber() / 1e9;
      console.log(`     withdrawal_pool_balance: ${withdrawalSOL} SOL`);

      if (withdrawalPoolBalance.toNumber() === 0) {
        console.log('⚠️  withdrawal_pool_balance is ZERO!');
        console.log('   Users cannot unstake when withdrawal pool is empty.');
        console.log('   Possible causes:');
        console.log('   1. No SOL has been staked yet');
        console.log('   2. All SOL has been deployed');
        console.log('   3. Need to call sync_liquid_balance or rebalance');
      } else {
        console.log(`✅ withdrawal_pool_balance has funds: ${withdrawalSOL} SOL`);
      }
    } else {
      console.log('❌ withdrawal_pool_balance field MISSING!');
      console.log('   Account has OLD LAYOUT - migration required!');
    }

    console.log(`     reward_pool_balance: ${(treasuryPool.rewardPoolBalance?.toNumber() || 0) / 1e9} SOL`);
    console.log(`     platform_pool_balance: ${(treasuryPool.platformPoolBalance?.toNumber() || 0) / 1e9} SOL`);
    console.log(`     emergency_pause: ${treasuryPool.emergencyPause || false}`);
    console.log('');
  } catch (error: any) {
    console.log('❌ Failed to deserialize!');
    console.log(`   Error: ${error.message}`);
    if (
      error.message?.includes('AccountDidNotDeserialize') ||
      error.message?.includes('offset') ||
      error.message?.includes('Failed to deserialize')
    ) {
      console.log('');
      console.log('🔧 DIAGNOSIS:');
      console.log('   The account has OLD LAYOUT (before withdrawal_pool_balance was added)');
      console.log('   Current IDL expects new layout with withdrawal_pool_balance field');
      console.log('');
      console.log('💡 SOLUTION:');
      console.log('   Run migration instruction:');
      console.log('   ```');
      console.log('   npm run migrate-treasury-pool');
      console.log('   ```');
      console.log('   Or manually call: program.methods.migrateTreasuryPool().rpc()');
    }
    console.log('');
    return;
  }

  // 3. Check if migration instruction exists
  console.log('📋 3. Checking for migration instruction...');
  const migrationInstruction = idl.instructions.find((ix: any) => ix.name === 'migrate_treasury_pool');
  if (migrationInstruction) {
    console.log('✅ migrate_treasury_pool instruction found in IDL');
  } else {
    console.log('⚠️  migrate_treasury_pool instruction NOT found');
  }
  console.log('');

  // 4. Summary and recommendations
  console.log('📊 SUMMARY & RECOMMENDATIONS:\n');

  const treasuryPool = await (program.account as any).treasuryPool.fetch(treasuryPoolPDA).catch(() => null);
  if (!treasuryPool) {
    console.log('❌ CRITICAL: Cannot deserialize Treasury Pool');
    console.log('   → RUN MIGRATION: npm run migrate-treasury-pool');
    return;
  }

  const withdrawalBalance = (treasuryPool as any).withdrawalPoolBalance?.toNumber() || 0;
  const liquidBalance = treasuryPool.liquidBalance?.toNumber() || 0;
  const totalDeposited = treasuryPool.totalDeposited?.toNumber() || 0;

  if (withdrawalBalance === 0 && liquidBalance > 0) {
    console.log('⚠️  ISSUE: withdrawal_pool_balance is 0 but liquid_balance has funds');
    console.log('   This happens after migration if rebalance hasn\'t run yet.');
    console.log('   → SOLUTION: When users stake/unstake, it will auto-migrate');
    console.log('   → OR: Run sync_liquid_balance instruction');
  } else if (withdrawalBalance === 0 && liquidBalance === 0) {
    console.log('ℹ️  No liquidity in pool');
    console.log('   Users cannot unstake because there are no funds.');
    console.log('   → Need users to stake SOL first');
  } else if (withdrawalBalance > 0) {
    console.log(`✅ System looks healthy!`);
    console.log(`   - Withdrawal pool: ${withdrawalBalance / 1e9} SOL (available for unstake)`);
    console.log(`   - Liquid balance: ${liquidBalance / 1e9} SOL (available for deploy)`);
    console.log(`   - Total deposited: ${totalDeposited / 1e9} SOL`);
    console.log('   Users should be able to unstake up to withdrawal pool balance.');
  }

  console.log('');
  console.log('🔗 Next steps:');
  console.log('   1. If migration needed: npm run migrate-treasury-pool');
  console.log('   2. Test unstake with: npm run test-unstake <wallet> <amount>');
  console.log('   3. Check max unstake: curl http://localhost:3001/api/pool/max-unstake/<wallet>');
  console.log('');
}

checkUnstakeIssues()
  .then(() => {
    console.log('✅ Check complete\n');
    process.exit(0);
  })
  .catch((err) => {
    console.error('❌ Error:', err);
    process.exit(1);
  });