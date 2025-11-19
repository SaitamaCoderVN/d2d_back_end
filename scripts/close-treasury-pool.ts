/**
 * Script to close treasury pool account using close_treasury_pool instruction
 * 
 * This script:
 * 1. Calls the close_treasury_pool instruction to transfer all lamports to admin
 * 2. Makes the account rent-exempt (effectively closing it)
 * 
 * Usage:
 *   cd d2d_back_end
 *   pnpm ts-node scripts/close-treasury-pool.ts
 */

import * as anchor from '@coral-xyz/anchor';
import { Program } from '@coral-xyz/anchor';
import { Connection, Keypair, PublicKey, SystemProgram, LAMPORTS_PER_SOL } from '@solana/web3.js';
import * as fs from 'fs';
import * as path from 'path';
import * as dotenv from 'dotenv';

// Load environment variables
dotenv.config({ path: path.join(__dirname, '../.env') });

// Import IDL
import IDL from '../src/program/idl/d2d_program_sol.json';
import { D2dProgramSol } from '../src/program/types/d2d_program_sol';

const PROGRAM_ID = new PublicKey(IDL.address);

async function main() {
  console.log('═══════════════════════════════════════════════');
  console.log('🔧 Closing Treasury Pool Account');
  console.log('═══════════════════════════════════════════════\n');

  // Setup connection
  const environment = (process.env.SOLANA_ENV || 'devnet').toLowerCase();
  const rpcUrl = environment === 'devnet'
    ? process.env.SOLANA_DEVNET_RPC || 'https://api.devnet.solana.com'
    : process.env.SOLANA_MAINNET_RPC || 'https://api.mainnet-beta.solana.com';
  
  console.log(`🌐 Environment: ${environment.toUpperCase()}`);
  console.log(`🔗 RPC: ${rpcUrl}\n`);

  const connection = new Connection(rpcUrl, 'confirmed');

  // Load admin keypair
  const adminWalletPath = process.env.ADMIN_WALLET_PATH;
  if (!adminWalletPath) {
    throw new Error('ADMIN_WALLET_PATH not set in .env');
  }

  const secretKey = JSON.parse(fs.readFileSync(adminWalletPath, 'utf-8'));
  const adminKeypair = Keypair.fromSecretKey(Uint8Array.from(secretKey));
  
  console.log(`👤 Admin: ${adminKeypair.publicKey.toString()}\n`);

  // Create provider
  const wallet = new anchor.Wallet(adminKeypair);
  const provider = new anchor.AnchorProvider(connection, wallet, {
    preflightCommitment: 'confirmed',
    commitment: 'confirmed',
  });

  // Initialize program
  const program = new Program<D2dProgramSol>(IDL as D2dProgramSol, provider);

  // Derive PDAs
  const [treasuryPoolPda] = PublicKey.findProgramAddressSync(
    [Buffer.from('treasury_pool')],
    PROGRAM_ID
  );

  console.log(`📦 Treasury Pool PDA: ${treasuryPoolPda.toString()}\n`);

  // Check account before closing
  const accountInfo = await connection.getAccountInfo(treasuryPoolPda);
  
  if (!accountInfo) {
    console.log('✅ Account does not exist or already closed\n');
    return;
  }

  const balanceBefore = accountInfo.lamports;
  const balanceSOL = balanceBefore / LAMPORTS_PER_SOL;
  
  console.log(`📊 Account Info:`);
  console.log(`   Size: ${accountInfo.data.length} bytes`);
  console.log(`   Balance: ${balanceSOL.toFixed(9)} SOL (${balanceBefore} lamports)`);
  console.log(`   Owner: ${accountInfo.owner.toString()}\n`);

  if (balanceBefore === 0) {
    console.log('✅ Account has no balance, already closed\n');
    return;
  }

  // Confirm before closing
  console.log('⚠️  WARNING: This will transfer all lamports to admin!');
  console.log(`   Amount: ${balanceSOL.toFixed(9)} SOL\n`);
  console.log('Proceeding with close...\n');

  try {
    // Call close_treasury_pool instruction
    const tx = await program.methods
      .closeTreasuryPool()
      .accountsPartial({
        treasuryPool: treasuryPoolPda,
        admin: adminKeypair.publicKey,
        systemProgram: SystemProgram.programId,
      })
      .signers([adminKeypair])
      .rpc();
    
    console.log(`✅ Close transaction sent!`);
    console.log(`   Transaction: ${tx}`);
    console.log(`   Explorer: https://explorer.solana.com/tx/${tx}?cluster=${environment}\n`);
    
    // Wait for confirmation
    await connection.confirmTransaction(tx, 'confirmed');
    console.log('✅ Transaction confirmed\n');
    
    // Verify account after closing
    const accountInfoAfter = await connection.getAccountInfo(treasuryPoolPda);
    if (accountInfoAfter) {
      const balanceAfter = accountInfoAfter.lamports;
      const balanceAfterSOL = balanceAfter / LAMPORTS_PER_SOL;
      console.log(`📊 Account after close:`);
      console.log(`   Balance: ${balanceAfterSOL.toFixed(9)} SOL (${balanceAfter} lamports)`);
      console.log(`   Status: Rent-exempt (account effectively closed)\n`);
    } else {
      console.log('✅ Account completely closed (no longer exists)\n');
    }
    
    // Check admin balance
    const adminBalance = await connection.getBalance(adminKeypair.publicKey);
    const adminBalanceSOL = adminBalance / LAMPORTS_PER_SOL;
    console.log(`💰 Admin balance: ${adminBalanceSOL.toFixed(9)} SOL\n`);
    
    console.log('✅ Treasury Pool closed successfully!');
    console.log('   You can now run reset-treasury-pool.ts to reinitialize with new layout.');
    console.log('═══════════════════════════════════════════════');
    
  } catch (error: any) {
    console.error('\n❌ Error closing treasury pool:', error);
    
    if (error.message?.includes('AccountDidNotDeserialize')) {
      console.error('\n💡 This is expected - the account has old layout.');
      console.error('   The close_treasury_pool instruction should still work.');
      console.error('   Please check the transaction logs for details.\n');
    }
    
    throw error;
  }
}

main().catch((error) => {
  console.error('Fatal error:', error);
  process.exit(1);
});
