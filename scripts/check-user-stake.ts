/**
 * Check user stake account details
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

async function checkUserStake(walletAddress?: string) {
  console.log('\n🔍 CHECKING USER STAKE ACCOUNTS\n');

  const userWallet = walletAddress || adminKeypair.publicKey.toString();
  console.log('User wallet:', userWallet);

  // Derive BackerDeposit PDA (using lender_stake seed for backward compatibility)
  const [backerDepositPDA] = PublicKey.findProgramAddressSync(
    [Buffer.from('lender_stake'), new PublicKey(userWallet).toBuffer()],
    programId
  );

  console.log('BackerDeposit PDA:', backerDepositPDA.toString());
  console.log('');

  try {
    const backerDeposit = await (program.account as any).backerDeposit.fetch(backerDepositPDA);
    console.log('✅ BackerDeposit account found!');
    console.log('   backer:', backerDeposit.backer.toString());
    console.log('   depositedAmount:', backerDeposit.depositedAmount.toNumber() / 1e9, 'SOL');
    console.log('   isActive:', backerDeposit.isActive);
    console.log('   rewardDebt:', backerDeposit.rewardDebt.toString());
    console.log('   claimedTotal:', backerDeposit.claimedTotal.toNumber() / 1e9, 'SOL');

    if (!backerDeposit.isActive) {
      console.log('\n⚠️  ISSUE: isActive = false');
      console.log('   This account is marked as inactive!');
    }

    if (backerDeposit.depositedAmount.toNumber() === 0) {
      console.log('\n⚠️  ISSUE: depositedAmount = 0');
      console.log('   This account has no deposited amount!');
    }

  } catch (error: any) {
    console.log('❌ BackerDeposit account NOT found');
    console.log('   Error:', error.message);
    console.log('');
    console.log('💡 This user has never staked SOL yet.');
  }

  // Also check all BackerDeposit accounts
  console.log('\n📋 Fetching all BackerDeposit accounts...');
  const allBackerDeposits = await (program.account as any).backerDeposit.all();
  console.log(`   Found ${allBackerDeposits.length} total stakers:`);
  allBackerDeposits.forEach((bd: any, idx: number) => {
    const acc = bd.account as any;
    console.log(`   ${idx + 1}. ${acc.backer.toString()}: ${acc.depositedAmount.toNumber() / 1e9} SOL (active: ${acc.isActive})`);
  });
}

const walletArg = process.argv[2];
checkUserStake(walletArg)
  .then(() => process.exit(0))
  .catch(err => {
    console.error('Error:', err);
    process.exit(1);
  });