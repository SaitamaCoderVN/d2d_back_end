import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { AnchorProvider, Program, Wallet, BN } from '@coral-xyz/anchor';
import { Connection, Keypair, PublicKey, SystemProgram } from '@solana/web3.js';
import * as fs from 'fs';
import * as path from 'path';

// Import IDL and Types
import IDL from './idl/d2d_program_sol.json';
import { D2dProgramSol } from './types/d2d_program_sol';

// Program ID from IDL
const PROGRAM_ID = new PublicKey(IDL.address);

export interface DeploymentRequestAccounts {
  treasuryPool: PublicKey;
  deployRequest: PublicKey;
  userStats: PublicKey;
  developer: PublicKey;
  admin: PublicKey;
  ephemeralKey: PublicKey;
  // Note: treasuryWallet removed - Treasury Pool PDA handles all SOL
}

@Injectable()
export class ProgramService implements OnModuleInit {
  private readonly logger = new Logger(ProgramService.name);
  private program: Program<D2dProgramSol>;
  private provider: AnchorProvider;
  private connection: Connection;
  private adminKeypair: Keypair;
  private adminKeypairPath: string | null = null;
  // Note: No treasuryWalletPubkey needed - Treasury Pool PDA holds all SOL

  async onModuleInit() {
    await this.initialize();
  }

  private async initialize() {
    try {
      // Setup connection - use environment-aware RPC
      const environment = (process.env.SOLANA_ENV || 'devnet').toLowerCase();
      const rpcUrl = environment === 'devnet'
        ? process.env.SOLANA_DEVNET_RPC || 'https://api.devnet.solana.com'
        : process.env.SOLANA_MAINNET_RPC || 'https://api.mainnet-beta.solana.com';
      
      this.logger.log(`🌐 Initializing ProgramService for ${environment.toUpperCase()}`);
      this.connection = new Connection(rpcUrl, 'confirmed');
      
      // Load admin keypair
      this.adminKeypair = this.loadAdminKeypair();

      // Create provider
      const wallet = new Wallet(this.adminKeypair);
      this.provider = new AnchorProvider(this.connection, wallet, {
        preflightCommitment: 'confirmed',
        commitment: 'confirmed',
      });

      // Initialize program with proper typing
      this.program = new Program<D2dProgramSol>(
        IDL as D2dProgramSol,
        this.provider
      );

      this.logger.log('✅ D2D Program Service initialized');
      this.logger.log(`   Program ID: ${PROGRAM_ID.toString()}`);
      this.logger.log(`   Admin: ${this.adminKeypair.publicKey.toString()}`);
      this.logger.log(`   Treasury: Treasury Pool PDA (program-owned account)`);
      
      // Verify D2D program is deployed
      await this.verifyProgramDeployed();
    } catch (error) {
      this.logger.error(`Failed to initialize program service: ${error.message}`);
      throw error;
    }
  }

  /**
   * Verify that the D2D program is deployed and accessible
   */
  private async verifyProgramDeployed(): Promise<boolean> {
    try {
      this.logger.log('🔍 Verifying D2D program deployment...');
      
      const programId = PROGRAM_ID;
      const environment = process.env.SOLANA_ENV || 'devnet';
      const rpcUrl = this.connection.rpcEndpoint;
      
      const accountInfo = await this.connection.getAccountInfo(programId);
      
      if (!accountInfo) {
        this.logger.error('═══════════════════════════════════════════════');
        this.logger.error('❌ D2D Program NOT FOUND');
        this.logger.error(`   Program ID: ${programId.toString()}`);
        this.logger.error(`   Network: ${environment.toUpperCase()}`);
        this.logger.error(`   RPC: ${rpcUrl}`);
        this.logger.error('');
        this.logger.error('💡 This will cause "DeclaredProgramIdMismatch" error!');
        this.logger.error('');
        this.logger.error('📋 To fix:');
        this.logger.error('   1. Deploy the D2D program:');
        this.logger.error('      cd programs/d2d-program-sol');
        this.logger.error('      anchor build');
        this.logger.error(`      anchor deploy --provider.cluster ${environment}`);
        this.logger.error('');
        this.logger.error('   2. Update declare_id!() in lib.rs with new Program ID');
        this.logger.error('   3. Rebuild and copy IDL:');
        this.logger.error('      anchor build');
        this.logger.error('      cp target/idl/d2d_program_sol.json ../../backend/src/program/idl/');
        this.logger.error('═══════════════════════════════════════════════');
        return false;
      }
      
      if (!accountInfo.executable) {
        this.logger.error(`❌ Account is not executable: ${programId.toString()}`);
        return false;
      }
      
      this.logger.log('✅ D2D Program verified successfully');
      this.logger.log(`   Program ID: ${programId.toString()}`);
      this.logger.log(`   Owner: ${accountInfo.owner.toString()}`);
      this.logger.log(`   Data Length: ${accountInfo.data.length} bytes`);
      
      // Check if treasury pool is initialized
      await this.ensureTreasuryPoolInitialized();
      
      return true;
    } catch (error) {
      this.logger.error(`❌ Failed to verify D2D program: ${error.message}`);
      this.logger.warn('   Continuing anyway, but deployment may fail...');
      return false;
    }
  }

  /**
   * Check if treasury pool is initialized, initialize if needed
   */
  private async ensureTreasuryPoolInitialized(): Promise<void> {
    try {
      const [treasuryPoolPDA] = this.getTreasuryPoolPDA();
      
      this.logger.log('🔍 Checking Treasury Pool initialization...');
      this.logger.log(`   Treasury Pool PDA: ${treasuryPoolPDA.toString()}`);
      
      const accountInfo = await this.connection.getAccountInfo(treasuryPoolPDA);
      
      if (accountInfo) {
        this.logger.log('✅ Treasury Pool already initialized');
        this.logger.log(`   Data Length: ${accountInfo.data.length} bytes`);
        
        // Check if treasury has sufficient funds
        await this.ensureTreasuryHasFunds();
        return;
      }
      
      // Treasury pool not initialized, initialize it
      this.logger.warn('⚠️  Treasury Pool NOT initialized');
      this.logger.log('🔧 Initializing Treasury Pool...');
      
      await this.initializeTreasuryPool();
      
      this.logger.log('✅ Treasury Pool initialized successfully');
      
      // Stake initial funds for testing
      await this.ensureTreasuryHasFunds();
    } catch (error) {
      this.logger.error(`❌ Failed to check/initialize Treasury Pool: ${error.message}`);
      throw error;
    }
  }

  /**
   * Ensure Treasury Pool has sufficient funds for deployments
   */
  private async ensureTreasuryHasFunds(): Promise<void> {
    try {
      this.logger.log('');
      this.logger.log('🔍 Checking Treasury Pool funds...');
      
      const [treasuryPoolPDA] = this.getTreasuryPoolPDA();
      const treasuryPoolAccount = await this.program.account.treasuryPool.fetch(
        treasuryPoolPDA,
        'confirmed' // Force confirmed commitment to get latest state
      );
      
      const totalStakedSOL = treasuryPoolAccount.totalStaked.toNumber() / 1_000_000_000;
      const minRequiredSOL = 3; // Minimum 3 SOL for at least 1 deployment
      
      this.logger.log(`   Total Staked: ${totalStakedSOL.toFixed(4)} SOL`);
      this.logger.log(`   Min Required: ${minRequiredSOL} SOL`);
      
      if (totalStakedSOL >= minRequiredSOL) {
        this.logger.log(`✅ Treasury Pool has sufficient funds`);
        return;
      }

      // Insufficient funds; just warn and provide guidance instead of auto-staking
      this.logger.warn(`⚠️  Insufficient funds in Treasury Pool`);
      this.logger.warn(`   Additional stake required: ${(minRequiredSOL - totalStakedSOL).toFixed(4)} SOL`);
      this.logger.warn('   Please stake manually via stakeSolToTreasury() or the staking UI.');
      this.logger.warn('');
      this.logger.warn('   Example CLI:');
      this.logger.warn('     pnpm ts-node backend/scripts/stake-to-treasury.ts <amountSOL>');
      this.logger.warn('');
      this.logger.warn('   The backend will continue running, but deployments may fail');
      this.logger.warn('   until sufficient funds are available in the Treasury Pool.');
      this.logger.warn('');
    } catch (error) {
      this.logger.error(`❌ Failed to check/fund Treasury Pool: ${error.message}`);
      
      // Don't throw - allow backend to start even if staking fails
      this.logger.warn('');
      this.logger.warn('⚠️  ⚠️  ⚠️  WARNING ⚠️  ⚠️  ⚠️');
      this.logger.warn('   Treasury Pool has insufficient funds!');
      this.logger.warn('   Deployments will fail until funds are added.');
      this.logger.warn('   Solution: Call stakeSolToTreasury() manually or');
      this.logger.warn('            ensure admin wallet has sufficient SOL.');
      this.logger.warn('⚠️  ⚠️  ⚠️  ⚠️  ⚠️  ⚠️  ⚠️  ⚠️  ⚠️  ⚠️');
      this.logger.warn('');
    }
  }

  /**
   * Initialize the D2D program's treasury pool
   */
  async initializeTreasuryPool(): Promise<string> {
    try {
      this.logger.log('═══════════════════════════════════════════════');
      this.logger.log('📋 Initializing D2D Treasury Pool...');
      this.logger.log('═══════════════════════════════════════════════');
      
      const [treasuryPoolPDA] = this.getTreasuryPoolPDA();
      
      // Default initial APY (10% = 1000 basis points)
      const initialApy = new BN(1000);
      
      this.logger.log(`   Treasury Pool PDA: ${treasuryPoolPDA.toString()}`);
      this.logger.log(`   Admin: ${this.adminKeypair.publicKey.toString()}`);
      this.logger.log(`   Initial APY: ${initialApy.toString()} basis points (10%)`);
      
      // Note: treasury_wallet is stored but not used for transfers
      // Just pass admin's pubkey for backward compatibility
      const tx = await this.program.methods
        .initialize(
          initialApy,
          this.adminKeypair.publicKey // Use admin as treasury_wallet (not used for transfers)
        )
        .accountsPartial({
          admin: this.adminKeypair.publicKey,
          treasuryWallet: this.adminKeypair.publicKey, // Just for storage, not actual transfers
        })
        .signers([this.adminKeypair])
        .rpc();
      
      this.logger.log(`✅ Treasury Pool initialization successful!`);
      this.logger.log(`   Transaction: ${tx}`);
      this.logger.log(`   Explorer: https://explorer.solana.com/tx/${tx}?cluster=${process.env.SOLANA_ENV || 'devnet'}`);
      this.logger.log('═══════════════════════════════════════════════');
      
      return tx;
    } catch (error) {
      this.logger.error('═══════════════════════════════════════════════');
      this.logger.error(`❌ Failed to initialize Treasury Pool`);
      this.logger.error(`   Error: ${error.message}`);
      
      if (error.logs) {
        this.logger.error('   Program Logs:');
        error.logs.forEach((log: string, i: number) => {
          this.logger.error(`     [${i}] ${log}`);
        });
      }
      
      this.logger.error('═══════════════════════════════════════════════');
      
      throw new Error(`Failed to initialize Treasury Pool: ${error.message}`);
    }
  }

  private loadAdminKeypair(): Keypair {
    const adminWalletPath = process.env.ADMIN_WALLET_PATH;
    
    if (!adminWalletPath) {
      throw new Error('ADMIN_WALLET_PATH not configured');
    }

    try {
      this.adminKeypairPath = adminWalletPath;
      const secretKey = JSON.parse(fs.readFileSync(adminWalletPath, 'utf-8'));
      return Keypair.fromSecretKey(Uint8Array.from(secretKey));
    } catch (error) {
      this.logger.error(`Failed to load admin keypair: ${error.message}`);
      throw new Error('Failed to load admin wallet');
    }
  }
  
  getAdminKeypairPath(): string | null {
    return this.adminKeypairPath;
  }

  /**
   * Get PDA for treasury pool
   */
  getTreasuryPoolPDA(): [PublicKey, number] {
    return PublicKey.findProgramAddressSync(
      [Buffer.from('treasury_pool')],
      PROGRAM_ID
    );
  }

  /**
   * Get Lender Stake PDA
   */
  private getLenderStakePDA(lender: PublicKey): [PublicKey, number] {
    return PublicKey.findProgramAddressSync(
      [Buffer.from('lender_stake'), lender.toBytes()],
      PROGRAM_ID
    );
  }

  /**
   * Stake SOL into Treasury Pool as a lender
   */
  async stakeSolToTreasury(amount: number, lockPeriod: number = 0): Promise<string> {
    try {
      this.logger.log('═══════════════════════════════════════════════');
      this.logger.log(`💰 Staking ${amount} SOL to Treasury Pool...`);
      this.logger.log('═══════════════════════════════════════════════');
      
      const [treasuryPoolPDA] = this.getTreasuryPoolPDA();
      const [lenderStakePDA] = this.getLenderStakePDA(this.adminKeypair.publicKey);
      
      const amountLamports = amount * 1_000_000_000; // Convert SOL to lamports
      const lockPeriodBN = new BN(lockPeriod); // Lock period in seconds (0 = no lock)
      
      this.logger.log(`   Lender: ${this.adminKeypair.publicKey.toString()}`);
      this.logger.log(`   Amount: ${amount} SOL (${amountLamports} lamports)`);
      this.logger.log(`   Lock Period: ${lockPeriod} seconds`);
      this.logger.log(`   Treasury Pool PDA: ${treasuryPoolPDA.toString()}`);
      this.logger.log(`   Lender Stake PDA: ${lenderStakePDA.toString()}`);
      
      // Note: Treasury Pool PDA (program-owned account) is now used for SOL storage
      // No need to pass treasury_wallet anymore
      const tx = await this.program.methods
        .stakeSol(new BN(amountLamports), lockPeriodBN)
        .accountsPartial({
          lender: this.adminKeypair.publicKey,
        })
        .signers([this.adminKeypair])
        .rpc();
      
      this.logger.log(`📤 Transaction sent: ${tx}`);
      this.logger.log(`   Explorer: https://explorer.solana.com/tx/${tx}?cluster=${process.env.SOLANA_ENV || 'devnet'}`);
      
      // ✅ FIX: Wait for transaction confirmation
      this.logger.log(`⏳ Waiting for transaction confirmation...`);
      
      const latestBlockhash = await this.connection.getLatestBlockhash('confirmed');
      await this.connection.confirmTransaction({
        signature: tx,
        blockhash: latestBlockhash.blockhash,
        lastValidBlockHeight: latestBlockhash.lastValidBlockHeight,
      }, 'confirmed');
      
      this.logger.log(`✅ Transaction confirmed on-chain!`);
      
      // ✅ FIX: Verify state updated
      this.logger.log(`🔍 Verifying treasury pool state...`);
      
      // Wait a bit for RPC cache to update
      await new Promise(resolve => setTimeout(resolve, 2000));
      
      const treasuryPoolAccount = await this.program.account.treasuryPool.fetch(
        treasuryPoolPDA,
        'confirmed'
      );
      
      const totalStakedSOL = treasuryPoolAccount.totalStaked.toNumber() / 1_000_000_000;
      
      this.logger.log(`✅ Verified on-chain state:`);
      this.logger.log(`   Total Staked: ${totalStakedSOL.toFixed(4)} SOL`);
      
      if (totalStakedSOL < amount * 0.9) { // Allow 10% tolerance for fees
        this.logger.warn(`⚠️  Warning: Expected ${amount} SOL but found ${totalStakedSOL} SOL`);
      }
      
      this.logger.log('═══════════════════════════════════════════════');
      
      return tx;
    } catch (error) {
      this.logger.error('═══════════════════════════════════════════════');
      this.logger.error(`❌ Failed to stake SOL to Treasury Pool`);
      this.logger.error(`   Error: ${error.message}`);
      
      if (error.logs) {
        this.logger.error('   Program Logs:');
        error.logs.forEach((log: string, i: number) => {
          this.logger.error(`     [${i}] ${log}`);
        });
      }
      
      this.logger.error('═══════════════════════════════════════════════');
      
      throw new Error(`Failed to stake SOL: ${error.message}`);
    }
  }

  /**
   * Get PDA for deploy request
   */
  getDeployRequestPDA(programHash: Buffer): [PublicKey, number] {
    return PublicKey.findProgramAddressSync(
      [Buffer.from('deploy_request'), programHash],
      PROGRAM_ID
    );
  }

  /**
   * Get PDA for user deploy stats
   */
  private getUserStatsPDA(developer: PublicKey): [PublicKey, number] {
    return PublicKey.findProgramAddressSync(
      [Buffer.from('user_stats'), developer.toBuffer()],
      PROGRAM_ID
    );
  }

  /**
   * Call deploy_program instruction
   */
  async callDeployProgram(
    programHash: Buffer,
    serviceFee: number,
    monthlyFee: number,
    initialMonths: number,
    deploymentCost: number,
    developer: PublicKey,
    ephemeralKey: PublicKey,
  ): Promise<string> {
    try {
      // Validate inputs
      if (!programHash || programHash.length !== 32) {
        throw new Error('Invalid program hash: must be 32 bytes');
      }
      if (!developer) {
        throw new Error('Invalid developer: PublicKey is required');
      }
      if (!ephemeralKey) {
        throw new Error('Invalid ephemeral key: PublicKey is required');
      }
      if (serviceFee < 0 || monthlyFee < 0 || deploymentCost < 0) {
        throw new Error('Fees cannot be negative');
      }
      if (initialMonths < 0 || initialMonths > 4294967295) {
        throw new Error('Invalid initial_months: must be u32');
      }

      const [treasuryPoolPDA] = this.getTreasuryPoolPDA();
      const [deployRequestPDA] = this.getDeployRequestPDA(programHash);
      const [userStatsPDA] = this.getUserStatsPDA(developer);

      this.logger.log('═══════════════════════════════════════════════');
      this.logger.log('📋 Calling deploy_program instruction...');
      this.logger.log('───────────────────────────────────────────────');
      this.logger.log(`  Program Hash: ${programHash.toString('hex')}`);
      this.logger.log(`  Developer: ${developer.toString()}`);
      this.logger.log(`  Ephemeral Key: ${ephemeralKey.toString()}`);
      this.logger.log(`  Service Fee: ${serviceFee} lamports`);
      this.logger.log(`  Monthly Fee: ${monthlyFee} lamports`);
      this.logger.log(`  Initial Months: ${initialMonths}`);
      this.logger.log(`  Deployment Cost: ${deploymentCost} lamports`);
      this.logger.log('───────────────────────────────────────────────');
      this.logger.log(`  Treasury Pool PDA: ${treasuryPoolPDA.toString()}`);
      this.logger.log(`  Deploy Request PDA: ${deployRequestPDA.toString()}`);
      this.logger.log(`  User Stats PDA: ${userStatsPDA.toString()}`);
      this.logger.log(`  Admin: ${this.adminKeypair.publicKey.toString()}`);
      this.logger.log('═══════════════════════════════════════════════');

      // Convert numbers to BN for u64 types (service_fee, monthly_fee, deployment_cost)
      // initial_months is u32, so regular number is fine
      const serviceFeeU64 = new BN(serviceFee);
      const monthlyFeeU64 = new BN(monthlyFee);
      const deploymentCostU64 = new BN(deploymentCost);

      this.logger.log('🔢 Converted to BN:');
      this.logger.log(`  Service Fee: ${serviceFeeU64.toString()}`);
      this.logger.log(`  Monthly Fee: ${monthlyFeeU64.toString()}`);
      this.logger.log(`  Deployment Cost: ${deploymentCostU64.toString()}`);

      // ⚠️  CRITICAL ISSUE: The Anchor program requires BOTH developer AND admin to sign
      // The IDL shows: "developer": { "signer": true, "writable": true }
      // 
      // Problem: The backend only has access to the admin keypair, not the developer's wallet.
      // 
      // Solutions:
      // 1. [PROPER] Frontend creates a partial transaction, signs it, sends to backend,
      //    backend adds admin signature and broadcasts
      // 2. [TESTING] Temporarily use admin as both signer (implemented below)
      // 3. [PRODUCTION] Change the Solana program to not require developer signature
      //
      // See SIGNATURE_ISSUE_FIX.md for detailed solutions
      
      // TEMPORARY WORKAROUND FOR TESTING: Use admin as developer
      const isDevelopment = process.env.NODE_ENV !== 'production' && 
                           process.env.SOLANA_ENV === 'devnet';
      
      const effectiveDeveloper = isDevelopment 
        ? this.adminKeypair.publicKey  // Use admin for testing ⚠️
        : developer;                    // Use real developer in production
      
      if (isDevelopment) {
        this.logger.warn('═══════════════════════════════════════════════');
        this.logger.warn('⚠️  DEVELOPMENT MODE WORKAROUND ACTIVE');
        this.logger.warn('   Using admin wallet as both developer AND admin');
        this.logger.warn('   This is for TESTING ONLY!');
        this.logger.warn('');
        this.logger.warn('   Original developer: ' + developer.toString());
        this.logger.warn('   Effective developer: ' + effectiveDeveloper.toString());
        this.logger.warn('   Admin: ' + this.adminKeypair.publicKey.toString());
        this.logger.warn('');
        this.logger.warn('   ⚠️  This will NOT work in production!');
        this.logger.warn('   See SIGNATURE_ISSUE_FIX.md for proper solution');
        this.logger.warn('═══════════════════════════════════════════════');
      } else {
        this.logger.warn('═══════════════════════════════════════════════');
        this.logger.warn('⚠️  PRODUCTION MODE: Multi-sig required');
        this.logger.warn('   This transaction will FAIL without developer signature!');
        this.logger.warn('   Developer: ' + developer.toString());
        this.logger.warn('   Admin: ' + this.adminKeypair.publicKey.toString());
        this.logger.warn('═══════════════════════════════════════════════');
      }

      const tx = await this.program.methods
        .deployProgram(
          Array.from(programHash),
          serviceFeeU64,      // BN for u64
          monthlyFeeU64,      // BN for u64
          initialMonths,      // number for u32
          deploymentCostU64   // BN for u64
        )
        .accountsPartial({
          developer: effectiveDeveloper,  // Admin in dev, real developer in prod
          admin: this.adminKeypair.publicKey,
          treasuryWallet: this.adminKeypair.publicKey, // Just for validation, not used for transfers
          ephemeralKey: ephemeralKey,
        })
        .signers([this.adminKeypair])
        .rpc();

      this.logger.log(`✅ deploy_program transaction successful!`);
      this.logger.log(`   Signature: ${tx}`);
      this.logger.log(`   Explorer: https://explorer.solana.com/tx/${tx}?cluster=${process.env.SOLANA_ENV || 'devnet'}`);
      this.logger.log('═══════════════════════════════════════════════');
      
      return tx;
    } catch (error) {
      this.logger.error('═══════════════════════════════════════════════');
      this.logger.error(`❌ Failed to call deploy_program`);
      this.logger.error(`   Error: ${error.message}`);
      this.logger.error(`   Stack: ${error.stack}`);
      this.logger.error('═══════════════════════════════════════════════');
      
      throw new Error(`On-chain deployment failed: ${error.message}`);
    }
  }

  /**
   * Request deployment funds from treasury pool (NEW ARCHITECTURE)
   * This replaces callDeployProgram for the new Web3.js deployment flow
   * 
   * Flow:
   * 1. This method transfers deployment_cost from treasury to ephemeral_key
   * 2. Backend then deploys using pure Web3.js (BPFLoaderUpgradeable)
   * 3. Backend calls confirmDeploymentSuccess to finalize
   */
  async requestDeploymentFunds(
    programHash: Buffer,
    serviceFee: number,
    monthlyFee: number,
    initialMonths: number,
    deploymentCost: number,
    developer: PublicKey,
  ): Promise<string> {

    try {
      // Validate inputs
      if (!Buffer.isBuffer(programHash) || programHash.length !== 32) {
        throw new Error('Invalid program hash: must be 32-byte Buffer');
      }
      if (!(developer instanceof PublicKey)) {
        throw new Error('Invalid developer: must be PublicKey');
      }
      if (serviceFee <= 0 || monthlyFee <= 0 || initialMonths <= 0 || deploymentCost <= 0) {
        throw new Error('Invalid amounts: all values must be positive');
      }

      // Get PDAs
      const treasuryPoolPDA = this.getTreasuryPoolPDA();
      const [deployRequestPDA] = PublicKey.findProgramAddressSync(
        [Buffer.from('deploy_request'), programHash],
        this.program.programId,
      );
      const [userStatsPDA] = PublicKey.findProgramAddressSync(
        [Buffer.from('user_stats'), developer.toBuffer()],
        this.program.programId,
      );

      this.logger.log('═══════════════════════════════════════════════');
      this.logger.log('💰 Requesting deployment funds from Treasury Pool...');
      this.logger.log('═══════════════════════════════════════════════');
      this.logger.log(`  Program Hash: ${programHash.toString('hex')}`);
      this.logger.log(`  Developer: ${developer.toString()}`);
      this.logger.log(`  Service Fee: ${serviceFee} lamports (${serviceFee / 1e9} SOL)`);
      this.logger.log(`  Monthly Fee: ${monthlyFee} lamports (${monthlyFee / 1e9} SOL)`);
      this.logger.log(`  Initial Months: ${initialMonths}`);
      this.logger.log(`  Deployment Cost: ${deploymentCost} lamports (${deploymentCost / 1e9} SOL)`);
      this.logger.log('───────────────────────────────────────────────');
      this.logger.log(`  Treasury Pool PDA: ${treasuryPoolPDA.toString()}`);
      this.logger.log(`  Deploy Request PDA: ${deployRequestPDA.toString()}`);
      this.logger.log(`  User Stats PDA: ${userStatsPDA.toString()}`);
      this.logger.log('═══════════════════════════════════════════════');

      // Convert to BN for u64
      const serviceFeeU64 = new BN(serviceFee);
      const monthlyFeeU64 = new BN(monthlyFee);
      const deploymentCostU64 = new BN(deploymentCost);

      // TEMPORARY: Use admin as developer for testing
      const isDevelopment = process.env.NODE_ENV !== 'production' && 
                           process.env.SOLANA_ENV === 'devnet';
      
      const effectiveDeveloper = isDevelopment 
        ? this.adminKeypair.publicKey 
        : developer;

      if (isDevelopment) {
        this.logger.warn('⚠️  DEV MODE: Using admin as developer (testing only)');
      }

      // Call request_deployment_funds instruction (without ephemeral key)
      const tx = await this.program.methods
        .requestDeploymentFunds(
          Array.from(programHash),
          serviceFeeU64,
          monthlyFeeU64,
          initialMonths,
          deploymentCostU64
        )
        .accountsPartial({
          developer: effectiveDeveloper,
          admin: this.adminKeypair.publicKey,
          treasuryWallet: this.adminKeypair.publicKey, // Just for validation, not used for transfers
        })
        .signers([this.adminKeypair])
        .rpc();

      this.logger.log('');
      this.logger.log('✅ Deployment request created successfully!');
      this.logger.log(`   Transaction: ${tx}`);
      this.logger.log(`   Deploy request created with status: PendingDeployment`);
      this.logger.log(`   Developer payment: ${(serviceFee + monthlyFee * initialMonths) / 1e9} SOL`);
      this.logger.log(`   Deployment cost reserved: ${deploymentCost / 1e9} SOL`);
      this.logger.log('   Deployment cost reserved in Treasury Pool (temporary wallet will be funded later)');
      this.logger.log(`   Note: Temporary wallet will be funded separately by backend`);
      this.logger.log(`   Explorer: https://explorer.solana.com/tx/${tx}?cluster=${process.env.SOLANA_ENV || 'devnet'}`);
      this.logger.log('═══════════════════════════════════════════════');
      
      return tx;
    } catch (error) {
      this.logger.error('═══════════════════════════════════════════════');
      this.logger.error(`❌ Failed to request deployment funds`);
      this.logger.error(`   Error: ${error.message}`);
      if (error.logs) {
        this.logger.error(`   Program Logs:`);
        error.logs.forEach((log: string, i: number) => {
          this.logger.error(`     [${i}] ${log}`);
        });
      }
      this.logger.error(`   Stack: ${error.stack}`);
      this.logger.error('═══════════════════════════════════════════════');
      
      throw new Error(`Failed to request deployment funds: ${error.message}`);
    }
  }

  /**
   * Fund temporary wallet for deployment
   * Only backend admin can call this instruction
   */
  async fundTemporaryWallet(
    programHash: Buffer,
    temporaryWalletPubkey: PublicKey,
    deploymentCost: number,
  ): Promise<string> {
    try {
      this.logger.log('═══════════════════════════════════════════════');
      this.logger.log('🔑 Funding temporary wallet for deployment...');
      this.logger.log(`  Program Hash: ${programHash.toString('hex')}`);
      this.logger.log(`  Temporary Wallet: ${temporaryWalletPubkey.toString()}`);
      this.logger.log(`  Amount: ${deploymentCost} lamports (${deploymentCost / 1e9} SOL)`);
      this.logger.log('───────────────────────────────────────────────');

      // Derive PDAs
      const [treasuryPoolPDA] = this.getTreasuryPoolPDA();
      const [deployRequestPDA] = this.getDeployRequestPDA(programHash);

      this.logger.log(`  Treasury Pool PDA: ${treasuryPoolPDA.toString()}`);
      this.logger.log(`  Deploy Request PDA: ${deployRequestPDA.toString()}`);
      this.logger.log('═══════════════════════════════════════════════');

      // Convert to BN for u64
      const deploymentCostU64 = new BN(deploymentCost);

      // Call fund_temporary_wallet instruction
      const tx = await (this.program.methods as any)
        .fundTemporaryWallet(
          Array.from(programHash),
          deploymentCostU64
        )
        .accountsPartial({
          admin: this.adminKeypair.publicKey,
          temporaryWallet: temporaryWalletPubkey,
        })
        .signers([this.adminKeypair])
        .rpc();

      this.logger.log('');
      this.logger.log('✅ Temporary wallet funded successfully!');
      this.logger.log(`   Transaction: ${tx}`);
      this.logger.log(`   Temporary wallet received: ${deploymentCost / 1e9} SOL`);
      this.logger.log(`   Explorer: https://explorer.solana.com/tx/${tx}?cluster=${process.env.SOLANA_ENV || 'devnet'}`);
      this.logger.log('═══════════════════════════════════════════════');
      
      return tx;
    } catch (error) {
      this.logger.error('═══════════════════════════════════════════════');
      this.logger.error(`❌ Failed to fund temporary wallet`);
      this.logger.error(`   Error: ${error.message}`);
      if (error.logs) {
        this.logger.error(`   Program Logs:`);
        error.logs.forEach((log: string, i: number) => {
          this.logger.error(`     [${i}] ${log}`);
        });
      }
      this.logger.error(`   Stack: ${error.stack}`);
      this.logger.error('═══════════════════════════════════════════════');
      
      throw new Error(`Failed to fund temporary wallet: ${error.message}`);
    }
  }

  /**
   * Confirm deployment success and return excess funds to treasury
   */
  async confirmDeploymentSuccess(
    programHash: Buffer,
    deployedProgramId: PublicKey,
    ephemeralKey: PublicKey,
    recoveredFunds: number,
  ): Promise<string> {

    try {
      const [treasuryPoolPDA] = this.getTreasuryPoolPDA();
      const [deployRequestPDA] = this.getDeployRequestPDA(programHash);

      const deployRequestAccount = await this.program.account.deployRequest.fetch(
        deployRequestPDA,
      );

      this.logger.log('═══════════════════════════════════════════════');
      this.logger.log('✅ Confirming deployment success...');
      this.logger.log('═══════════════════════════════════════════════');
      this.logger.log(`  Request ID: ${programHash.toString('hex')}`);
      this.logger.log(`  Deployed Program ID: ${deployedProgramId.toString()}`);
      this.logger.log(`  Ephemeral Key: ${ephemeralKey.toString()}`);

      const tx = await (this.program.methods as any)
        .confirmDeploymentSuccess(
          Array.from(programHash),
          deployedProgramId,
          new BN(recoveredFunds),
        )
        .accounts({
          treasuryPool: treasuryPoolPDA,
          deployRequest: deployRequestPDA,
          admin: this.adminKeypair.publicKey,
          ephemeralKey,
          developerWallet: deployRequestAccount.developer,
          systemProgram: SystemProgram.programId,
        })
        .signers([this.adminKeypair])
        .rpc();

      this.logger.log('');
      this.logger.log('✅ Deployment confirmed on-chain!');
      this.logger.log(`   Transaction: ${tx}`);
      this.logger.log(`   Status updated to: Active`);
      if (recoveredFunds > 0) {
        this.logger.log(`   Recovered funds credited: ${recoveredFunds / 1_000_000_000} SOL`);
      } else {
        this.logger.log(`   No residual funds to credit`);
      }
      this.logger.log(`   Explorer: https://explorer.solana.com/tx/${tx}?cluster=${process.env.SOLANA_ENV || 'devnet'}`);
      this.logger.log('═══════════════════════════════════════════════');

      return tx;
    } catch (error) {
      this.logger.error('Failed to confirm deployment success:', error.message);
      throw new Error(`Failed to confirm deployment: ${error.message}`);
    }
  }


  /**
   * Confirm deployment failure
   */
  async confirmDeploymentFailure(
    requestId: Buffer,
    programHash: Buffer,
    developer: PublicKey,
    ephemeralKey: PublicKey,
    failureReason: string,
  ): Promise<string> {
    try {
      const [treasuryPoolPDA] = this.getTreasuryPoolPDA();
      const [deployRequestPDA] = this.getDeployRequestPDA(programHash);

      this.logger.log('Confirming deployment failure...');
      this.logger.log(`  Reason: ${failureReason}`);
      
      const tx = await (this.program.methods as any)
        .confirmDeploymentFailure(
          Array.from(requestId),
          failureReason
        )
        .accounts({
          treasuryPool: treasuryPoolPDA,
          deployRequest: deployRequestPDA,
          admin: this.adminKeypair.publicKey,
          developerWallet: developer,
          ephemeralKey,
          systemProgram: SystemProgram.programId,
        })
        .signers([this.adminKeypair])
        .rpc();

      this.logger.log(`✅ confirm_deployment_failure transaction: ${tx}`);
      return tx;
    } catch (error) {
      this.logger.error(`Failed to confirm deployment failure: ${error.message}`);
      throw error;
    }
  }

  /**
   * Fetch treasury pool state
   */
  async getTreasuryPoolState(): Promise<any> {
    try {
      const [treasuryPoolPDA] = this.getTreasuryPoolPDA();
      const accountInfo = await this.program.account.treasuryPool.fetch(treasuryPoolPDA);
      return accountInfo;
    } catch (error) {
      this.logger.error(`Failed to fetch treasury pool state: ${error.message}`);
      throw error;
    }
  }

  /**
   * Fetch deploy request state
   */
  async getDeployRequestState(programHash: Buffer): Promise<any> {
    try {
      const [deployRequestPDA] = this.getDeployRequestPDA(programHash);
      const accountInfo = await this.program.account.deployRequest.fetch(deployRequestPDA);
      return accountInfo;
    } catch (error) {
      this.logger.error(`Failed to fetch deploy request state: ${error.message}`);
      return null; // Return null if account doesn't exist yet
    }
  }

  /**
   * Get program instance (for advanced usage)
   */
  getProgram(): Program<D2dProgramSol> {
    return this.program;
  }

  /**
   * Get connection instance
   */
  getConnection(): Connection {
    return this.connection;
  }

  /**
   * Get admin keypair
   */
  getAdminKeypair(): Keypair {
    return this.adminKeypair;
  }

  /**
   * Note: Treasury wallet concept removed - Treasury Pool PDA handles all SOL
   * Use getTreasuryPoolPDA() instead
   */
}

