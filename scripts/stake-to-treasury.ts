import { Connection, Keypair, PublicKey } from '@solana/web3.js';
import { AnchorProvider, Program, Wallet } from '@coral-xyz/anchor';
import * as fs from 'fs';
import * as path from 'path';
import { BN } from '@coral-xyz/anchor';

// Load IDL
const IDL = JSON.parse(
  fs.readFileSync(
    path.join(__dirname, '../src/program/idl/d2d_program_sol.json'),
    'utf8'
  )
);

// Import utility functions
import { getD2DProgramId, getTreasuryPoolPDA } from '../src/program/utils/pda.utils';

async function main() {
  // Get program ID from IDL (single source of truth - no env override)
  const programIdStr = getD2DProgramId().toString();
  const adminWalletPath = process.env.ADMIN_WALLET_PATH || '/Users/saitamacoder/.config/solana/id.json';
  const rpcUrl = process.env.SOLANA_DEVNET_RPC || 'https://api.devnet.solana.com';
  const treasuryWalletStr = process.env.TREASURY_WALLET_ADDRESS || 'A1dVA8adW1XXgcVmLCtbrvbVEVA1n3Q7kNPaTZVonjpq';

  console.log('\n🔐 Loading admin wallet from:', adminWalletPath);
  const adminKeypairData = JSON.parse(fs.readFileSync(adminWalletPath, 'utf8'));
  const adminKeypair = Keypair.fromSecretKey(Uint8Array.from(adminKeypairData));
  console.log('✅ Admin wallet:', adminKeypair.publicKey.toBase58());

  // Setup connection and provider
  const connection = new Connection(rpcUrl, 'confirmed');
  const wallet = new Wallet(adminKeypair);
  const provider = new AnchorProvider(connection, wallet, {
    commitment: 'confirmed',
  });

  // Setup program
  const programId = new PublicKey(programIdStr);
  const program = new Program(IDL, provider);
  console.log('✅ Program ID:', programId.toBase58());

  // Derive Treasury Pool PDA (no hardcoding)
  const [treasuryPoolPDA] = getTreasuryPoolPDA();
  console.log('✅ Treasury Pool PDA:', treasuryPoolPDA.toBase58());

  // Check if Treasury Pool is initialized
  try {
    const treasuryPoolAccount: any = await (program.account as any).treasuryPool.fetch(treasuryPoolPDA);
    console.log('\n📊 Current Treasury Pool State:');
    console.log('   Total Staked:', treasuryPoolAccount.totalStaked.toNumber() / 1e9, 'SOL');
    console.log('   Total Lent:', treasuryPoolAccount.totalLent.toNumber() / 1e9, 'SOL');
    console.log('   Total Backers:', treasuryPoolAccount.totalBackers.toNumber());
  } catch (error) {
    console.log('\n⚠️  Treasury Pool account exists but may not be properly initialized.');
    console.log('   Continuing anyway - stakeSol instruction will init if needed...');
  }

  // Derive Lender Stake PDA
  const [lenderStakePDA] = PublicKey.findProgramAddressSync(
    [Buffer.from('lender_stake'), adminKeypair.publicKey.toBuffer()],
    programId
  );
  console.log('✅ Lender Stake PDA:', lenderStakePDA.toBase58());

  // Stake 10 SOL
  const stakeAmount = new BN(10 * 1e9); // 10 SOL in lamports
  const lockPeriod = new BN(0); // No lock period for testing
  const treasuryWallet = new PublicKey(treasuryWalletStr);
  
  console.log('\n💰 Staking', stakeAmount.toNumber() / 1e9, 'SOL to Treasury Pool...');
  console.log('   Treasury Wallet:', treasuryWallet.toBase58());

  try {
    const tx = await (program.methods as any)
      .stakeSol(stakeAmount, lockPeriod)
      .accounts({
        treasuryPool: treasuryPoolPDA,
        lenderStake: lenderStakePDA,
        lender: adminKeypair.publicKey,
        treasuryWallet: treasuryWallet,
        systemProgram: new PublicKey('11111111111111111111111111111111'),
      })
      .signers([adminKeypair])
      .rpc();

    console.log('✅ Stake transaction sent! TX:', tx);
    console.log('🔗 Explorer:', `https://explorer.solana.com/tx/${tx}?cluster=devnet`);

    // Wait for confirmation
    console.log('\n⏳ Waiting for confirmation...');
    await connection.confirmTransaction(tx, 'confirmed');
    console.log('✅ Transaction confirmed!');

    // Wait a bit for state to update
    await new Promise(r => setTimeout(r, 3000));

    // Fetch updated state
    try {
      const treasuryPoolAccount: any = await (program.account as any).treasuryPool.fetch(treasuryPoolPDA);
      console.log('\n📊 Updated Treasury Pool State:');
      console.log('   Total Staked:', treasuryPoolAccount.totalStaked.toNumber() / 1e9, 'SOL');
      console.log('   Total Lent:', treasuryPoolAccount.totalLent.toNumber() / 1e9, 'SOL');
      console.log('   Total Backers:', treasuryPoolAccount.totalBackers.toNumber());
    } catch (err: any) {
      console.log('\n⚠️  Could not fetch Treasury Pool state:', err.message);
    }

    try {
      const lenderStakeAccount: any = await (program.account as any).lenderStake.fetch(lenderStakePDA);
      console.log('\n📊 Your Lender Stake:');
      console.log('   Staked Amount:', lenderStakeAccount.stakedAmount.toNumber() / 1e9, 'SOL');
    } catch (err: any) {
      console.log('\n⚠️  Could not fetch Lender Stake state:', err.message);
    }

    console.log('\n✅ Done! Staking transaction completed successfully.');
    console.log('   Check explorer link above for details.');
  } catch (error: any) {
    console.error('\n❌ Failed to stake SOL:', error.message);
    if (error.logs) {
      console.error('Transaction logs:', error.logs);
    }
    process.exit(1);
  }
}

main().catch(console.error);

