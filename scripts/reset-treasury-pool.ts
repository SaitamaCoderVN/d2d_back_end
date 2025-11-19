/**
 * Script to reset and reinitialize Treasury Pool after struct layout changes
 * 
 * This script:
 * 1. Closes the old treasury_pool account (if exists)
 * 2. Reinitializes with new struct layout
 * 
 * Usage:
 *   cd d2d_back_end
 *   pnpm ts-node scripts/reset-treasury-pool.ts
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
  console.log('🔧 Resetting Treasury Pool Account');
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
  
  const [rewardPoolPda] = PublicKey.findProgramAddressSync(
    [Buffer.from('reward_pool')],
    PROGRAM_ID
  );
  
  const [platformPoolPda] = PublicKey.findProgramAddressSync(
    [Buffer.from('platform_pool')],
    PROGRAM_ID
  );

  console.log(`📦 Treasury Pool PDA: ${treasuryPoolPda.toString()}`);
  console.log(`📦 Reward Pool PDA: ${rewardPoolPda.toString()}`);
  console.log(`📦 Platform Pool PDA: ${platformPoolPda.toString()}\n`);

  // Check if treasury pool exists
  const accountInfo = await connection.getAccountInfo(treasuryPoolPda);
  
  if (accountInfo) {
    console.log(`⚠️  Old treasury pool account exists!`);
    console.log(`   Size: ${accountInfo.data.length} bytes`);
    console.log(`   Balance: ${accountInfo.lamports / LAMPORTS_PER_SOL} SOL`);
    console.log(`   Owner: ${accountInfo.owner.toString()}\n`);

    // Check if it's the old layout (114 bytes) or new layout (278 bytes)
    if (accountInfo.data.length < 200) {
      console.log('❌ Account has old struct layout (< 200 bytes)');
      console.log('   Need to close and reinitialize\n');
      
      console.log('📋 Closing account using close_treasury_pool instruction...\n');
      
      try {
        // Call close_treasury_pool instruction
        const closeTx = await program.methods
          .closeTreasuryPool()
          .accountsPartial({
            treasuryPool: treasuryPoolPda,
            admin: adminKeypair.publicKey,
            systemProgram: SystemProgram.programId,
          })
          .signers([adminKeypair])
          .rpc();
        
        console.log(`✅ Close transaction sent!`);
        console.log(`   Transaction: ${closeTx}`);
        console.log(`   Explorer: https://explorer.solana.com/tx/${closeTx}?cluster=${environment}\n`);
        
        // Wait for confirmation
        await connection.confirmTransaction(closeTx, 'confirmed');
        console.log('✅ Account closed successfully\n');
        
        // Wait a bit for account to be fully closed
        await new Promise(resolve => setTimeout(resolve, 2000));
        
        // Verify account is closed
        const accountInfoAfter = await connection.getAccountInfo(treasuryPoolPda);
        if (accountInfoAfter) {
          console.log(`⚠️  Account still exists (rent-exempt)`);
          console.log(`   Balance: ${accountInfoAfter.lamports / LAMPORTS_PER_SOL} SOL`);
          console.log(`   This is OK - account is rent-exempt and can be reinitialized\n`);
        } else {
          console.log('✅ Account completely closed\n');
        }
        
      } catch (closeError: any) {
        console.error('\n❌ Error closing account:', closeError.message);
        console.error('   You may need to close it manually first.');
        console.error(`   Run: pnpm ts-node scripts/close-treasury-pool.ts\n`);
        throw closeError;
      }
    } else {
      console.log('✅ Account has new struct layout (>= 200 bytes)');
      console.log('   No need to reset\n');
      return;
    }
  } else {
    console.log('✅ Treasury pool account does not exist');
    console.log('   Will create new account with new layout\n');
  }

  // Reinitialize with new layout
  console.log('📝 Reinitializing with new struct layout...\n');
  
  const devWallet = adminKeypair.publicKey; // Use admin as dev wallet
  const initialApy = new anchor.BN(0); // Not used in new model, but required by instruction

  try {
    // Use reinitialize_treasury_pool instead of initialize
    // This works even if account exists (rent-exempt)
    const tx = await program.methods
      .reinitializeTreasuryPool(initialApy, devWallet)
      .accountsPartial({
        treasuryPool: treasuryPoolPda,
        rewardPool: rewardPoolPda,
        platformPool: platformPoolPda,
        admin: adminKeypair.publicKey,
        devWallet: devWallet,
        systemProgram: SystemProgram.programId,
      })
      .signers([adminKeypair])
      .rpc();
    
    console.log(`✅ Treasury Pool reinitialized!`);
    console.log(`   Transaction: ${tx}`);
    console.log(`   Explorer: https://explorer.solana.com/tx/${tx}?cluster=${environment}\n`);
    
    // Wait for confirmation
    await connection.confirmTransaction(tx, 'confirmed');
    console.log('✅ Transaction confirmed\n');
    
    // Verify the account can be fetched
    console.log('🔍 Verifying account...');
    const treasuryPool = await program.account.treasuryPool.fetch(treasuryPoolPda);
    
    console.log('\n📊 Treasury Pool State:');
    console.log(`   reward_per_share: ${treasuryPool.rewardPerShare.toString()}`);
    console.log(`   total_deposited: ${treasuryPool.totalDeposited.toString()}`);
    console.log(`   liquid_balance: ${treasuryPool.liquidBalance.toString()}`);
    console.log(`   reward_pool_balance: ${treasuryPool.rewardPoolBalance.toString()}`);
    console.log(`   platform_pool_balance: ${treasuryPool.platformPoolBalance.toString()}`);
    console.log(`   admin: ${treasuryPool.admin.toString()}`);
    console.log(`   dev_wallet: ${treasuryPool.devWallet.toString()}`);
    console.log(`   emergency_pause: ${treasuryPool.emergencyPause}`);
    
    console.log('\n✅ Treasury Pool reset and reinitialized successfully!');
    console.log('═══════════════════════════════════════════════');
    
  } catch (error: any) {
    if (error.toString().includes('already in use')) {
      console.error('\n❌ Account already exists with old layout!');
      console.error('   Solution: Close the account first, then reinitialize.');
      console.error(`   Command: solana program close ${treasuryPoolPda.toString()} --bypass-warning`);
      console.error('\n   After closing, run this script again.\n');
    } else {
      console.error('\n❌ Error:', error);
      throw error;
    }
  }
}

main().catch((error) => {
  console.error('Fatal error:', error);
  process.exit(1);
});

