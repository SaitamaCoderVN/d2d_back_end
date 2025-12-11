import { Connection, PublicKey } from '@solana/web3.js';
import { AnchorProvider, Program } from '@coral-xyz/anchor';
import * as fs from 'fs';
import * as path from 'path';

const idlPath = path.join(__dirname, '../../d2d-program-sol/target/idl/d2d_program_sol.json');
const idl = JSON.parse(fs.readFileSync(idlPath, 'utf8'));

const DEVNET_RPC = process.env.SOLANA_DEVNET_RPC || 'https://api.devnet.solana.com';
const connection = new Connection(DEVNET_RPC, 'confirmed');

const programId = new PublicKey(idl.address);

async function checkBump() {
  console.log('\n🔍 CHECKING BUMP SEED\n');
  console.log('Program ID:', programId.toString());
  
  // Derive PDA
  const [treasuryPoolPDA, derivedBump] = PublicKey.findProgramAddressSync(
    [Buffer.from('treasury_pool')],
    programId
  );
  
  console.log('Treasury Pool PDA:', treasuryPoolPDA.toString());
  console.log('Derived bump:', derivedBump);
  console.log('');
  
  // Fetch account data
  const accountInfo = await connection.getAccountInfo(treasuryPoolPDA);
  if (!accountInfo) {
    console.error('❌ Account not found');
    return;
  }
  
  console.log('Account found, size:', accountInfo.data.length, 'bytes');
  
  // Try to read bump from account data
  // TreasuryPool bump field is near the end
  // Let's read the last few fields
  const data = accountInfo.data;
  
  // Skip discriminator (8 bytes) and read structure
  // Based on treasury_pool.rs, bump is one of the last fields
  // bump: u8 is at a specific offset
  
  // Read the bump field (need to know exact offset)
  // For now, let's try to fetch via Anchor
  const provider = new AnchorProvider(
    connection,
    {
      publicKey: PublicKey.default,
      signTransaction: async (tx) => tx,
      signAllTransactions: async (txs) => txs,
    } as any,
    { commitment: 'confirmed' }
  );
  
  const program = new Program(idl, provider);
  
  try {
    const treasuryPool = await (program.account as any).treasuryPool.fetch(treasuryPoolPDA);
    const storedBump = treasuryPool.bump;
    
    console.log('Stored bump in account:', storedBump);
    console.log('Derived bump from PDA:', derivedBump);
    console.log('');
    
    if (storedBump === derivedBump) {
      console.log('✅ Bumps match!');
    } else {
      console.log('❌ Bumps DO NOT match!');
      console.log('   This is the issue causing ConstraintSeeds error');
      console.log('');
      console.log('   Solutions:');
      console.log('   1. Update bump in account to match derived bump');
      console.log('   2. Or use UncheckedAccount and manual verification');
    }
  } catch (error: any) {
    console.error('❌ Error fetching account:', error.message);
  }
}

checkBump().then(() => process.exit(0)).catch(err => {
  console.error('Error:', err);
  process.exit(1);
});
