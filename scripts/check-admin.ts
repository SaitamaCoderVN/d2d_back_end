import { Connection, PublicKey } from '@solana/web3.js';
import { AnchorProvider, Program } from '@coral-xyz/anchor';
import * as fs from 'fs';
import * as path from 'path';

const idlPath = path.join(__dirname, '../../d2d-program-sol/target/idl/d2d_program_sol.json');
const idl = JSON.parse(fs.readFileSync(idlPath, 'utf8'));

const DEVNET_RPC = process.env.SOLANA_DEVNET_RPC || 'https://api.devnet.solana.com';
const connection = new Connection(DEVNET_RPC, 'confirmed');

const programId = new PublicKey(idl.address);

// Load admin keypair
const adminKeypairPath = process.env.ADMIN_WALLET_PATH || path.join(process.env.HOME!, '.config/solana/id.json');
const adminKeypair = JSON.parse(fs.readFileSync(adminKeypairPath, 'utf8'));
const myAdminKey = require('@solana/web3.js').Keypair.fromSecretKey(new Uint8Array(adminKeypair)).publicKey;

async function checkAdmin() {
  console.log('\n🔍 CHECKING ADMIN\n');
  console.log('Program ID:', programId.toString());
  console.log('My admin wallet:', myAdminKey.toString());
  console.log('');
  
  const [treasuryPoolPDA] = PublicKey.findProgramAddressSync(
    [Buffer.from('treasury_pool')],
    programId
  );
  
  console.log('Treasury Pool PDA:', treasuryPoolPDA.toString());
  
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
    const storedAdmin = treasuryPool.admin;
    
    console.log('Stored admin in account:', storedAdmin.toString());
    console.log('');
    
    if (storedAdmin.toString() === myAdminKey.toString()) {
      console.log('✅ Admin matches!');
    } else {
      console.log('❌ Admin DOES NOT match!');
      console.log('   Expected:', myAdminKey.toString());
      console.log('   Actual:', storedAdmin.toString());
      console.log('');
      console.log('   Solutions:');
      console.log('   1. Use the correct admin wallet (stored in account)');
      console.log('   2. Or update admin in treasury pool account');
    }
  } catch (error: any) {
    console.error('❌ Error fetching account:', error.message);
  }
}

checkAdmin().then(() => process.exit(0)).catch(err => {
  console.error('Error:', err);
  process.exit(1);
});
