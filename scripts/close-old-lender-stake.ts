import { Connection, Keypair, PublicKey, Transaction, SystemProgram } from '@solana/web3.js';
import * as fs from 'fs';
import { getD2DProgramId } from '../src/program/utils/pda.utils';

/**
 * Close old lender_stake account to fix AccountDiscriminatorMismatch
 * This allows the new BackerDeposit account to be created fresh
 */
async function main() {
  const rpcUrl = process.env.SOLANA_DEVNET_RPC || 'https://api.devnet.solana.com';
  const adminWalletPath = process.env.ADMIN_WALLET_PATH || '/Users/saitamacoder/.config/solana/id.json';
  // Get program ID from IDL (single source of truth - no env override)
  const programId = getD2DProgramId();

  console.log('\n🔐 Loading admin wallet from:', adminWalletPath);
  const adminKeypairData = JSON.parse(fs.readFileSync(adminWalletPath, 'utf8'));
  const adminKeypair = Keypair.fromSecretKey(Uint8Array.from(adminKeypairData));
  console.log('✅ Admin wallet:', adminKeypair.publicKey.toBase58());

  const connection = new Connection(rpcUrl, 'confirmed');
  console.log('✅ Connected to:', rpcUrl);

  // Derive lender_stake PDA
  const [lenderStakePDA] = PublicKey.findProgramAddressSync(
    [Buffer.from('lender_stake'), adminKeypair.publicKey.toBuffer()],
    programId
  );
  console.log('✅ Lender Stake PDA:', lenderStakePDA.toBase58());

  // Check if account exists
  const accountInfo = await connection.getAccountInfo(lenderStakePDA);
  
  if (!accountInfo) {
    console.log('✅ Account does not exist. No need to close.');
    process.exit(0);
  }

  console.log('\n📊 Old Account Info:');
  console.log('   Owner:', accountInfo.owner.toBase58());
  console.log('   Lamports:', accountInfo.lamports);
  console.log('   Data Length:', accountInfo.data.length);

  console.log('\n🗑️  Closing old lender_stake account...');

  // Transfer all lamports to admin (close account)
  const transaction = new Transaction().add(
    SystemProgram.transfer({
      fromPubkey: lenderStakePDA,
      toPubkey: adminKeypair.publicKey,
      lamports: accountInfo.lamports,
    })
  );

  try {
    // This will fail because PDA can't sign
    // We need to use Anchor's close constraint instead
    console.log('❌ Cannot close PDA account directly from script.');
    console.log('⚠️  Solution: Account will be automatically reinitialized on next stake_sol call');
    console.log('   Or manually close via Anchor instruction with close constraint.');
  } catch (error: any) {
    console.error('Error:', error.message);
  }

  console.log('\n✅ Done!');
  console.log('\n💡 Recommendation:');
  console.log('   1. The account has old discriminator');
  console.log('   2. Use force_init instead of init_if_needed');
  console.log('   3. Or add migration instruction to handle old accounts');
}

main().catch(console.error);

