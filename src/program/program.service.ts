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
      
      // First check if account exists and its size
      const accountInfo = await this.connection.getAccountInfo(treasuryPoolPDA);
      if (!accountInfo) {
        this.logger.warn('⚠️  Treasury Pool account does not exist');
        this.logger.warn('   Please initialize it first using initializeTreasuryPool()');
        return;
      }
      
      this.logger.log(`   Account size: ${accountInfo.data.length} bytes`);
      
      // Check if account has old layout (< 200 bytes)
      if (accountInfo.data.length < 200) {
        this.logger.error('═══════════════════════════════════════════════');
        this.logger.error('❌ TREASURY POOL HAS OLD STRUCT LAYOUT!');
        this.logger.error(`   Current size: ${accountInfo.data.length} bytes`);
        this.logger.error('   Required size: ~278 bytes (new layout)');
        this.logger.error('');
        this.logger.error('💡 The treasury pool account was created with an old struct.');
        this.logger.error('   It needs to be reset and reinitialized.');
        this.logger.error('');
        this.logger.error('📋 To fix:');
        this.logger.error('   1. Close the old account:');
        this.logger.error(`      solana program close ${treasuryPoolPDA.toString()} --bypass-warning`);
        this.logger.error('   2. Run reset script:');
        this.logger.error('      cd d2d_back_end && pnpm ts-node scripts/reset-treasury-pool.ts');
        this.logger.error('═══════════════════════════════════════════════');
        return; // Don't try to fetch, it will fail
      }
      
      // Try to fetch with new layout
      const treasuryPoolAccount = await this.program.account.treasuryPool.fetch(
        treasuryPoolPDA,
        'confirmed' // Force confirmed commitment to get latest state
      );
      
      // Use new struct fields: liquidBalance for available funds
      const liquidBalanceSOL = (treasuryPoolAccount.liquidBalance?.toNumber() || 0) / 1_000_000_000;
      // Fallback to legacy field if needed
      const totalDepositedSOL = (treasuryPoolAccount.totalDeposited?.toNumber() || treasuryPoolAccount.totalStaked?.toNumber() || 0) / 1_000_000_000;
      const availableBalance = liquidBalanceSOL || totalDepositedSOL;
      const minRequiredSOL = 3; // Minimum 3 SOL for at least 1 deployment
      
      this.logger.log(`   Liquid Balance: ${liquidBalanceSOL.toFixed(4)} SOL`);
      this.logger.log(`   Total Deposited: ${totalDepositedSOL.toFixed(4)} SOL`);
      this.logger.log(`   Min Required: ${minRequiredSOL} SOL`);
      
      if (availableBalance >= minRequiredSOL) {
        this.logger.log(`✅ Treasury Pool has sufficient funds`);
        return;
      }

      // Insufficient funds; just warn and provide guidance instead of auto-staking
      this.logger.warn(`⚠️  Insufficient funds in Treasury Pool`);
      this.logger.warn(`   Additional stake required: ${(minRequiredSOL - availableBalance).toFixed(4)} SOL`);
      this.logger.warn('   Please stake manually via stakeSolToTreasury() or the staking UI.');
      this.logger.warn('');
      this.logger.warn('   Example CLI:');
      this.logger.warn('     pnpm ts-node backend/scripts/stake-to-treasury.ts <amountSOL>');
      this.logger.warn('');
      this.logger.warn('   The backend will continue running, but deployments may fail');
      this.logger.warn('   until sufficient funds are available in the Treasury Pool.');
      this.logger.warn('');
    } catch (error: any) {
      // Check if it's a deserialization error
      if (error.message?.includes('offset') || 
          error.message?.includes('AccountDidNotDeserialize') ||
          error.message?.includes('Failed to deserialize') ||
          error.message?.includes('beyond buffer length')) {
        this.logger.error('═══════════════════════════════════════════════');
        this.logger.error('❌ TREASURY POOL DESERIALIZATION ERROR!');
        this.logger.error(`   Error: ${error.message}`);
        this.logger.error('');
        this.logger.error('💡 The treasury pool account has an incompatible struct layout.');
        this.logger.error('   This happens when the on-chain account was created with an old struct.');
        this.logger.error('');
        this.logger.error('📋 To fix:');
        this.logger.error('   1. Close the old treasury pool account:');
        const [treasuryPoolPDA] = this.getTreasuryPoolPDA();
        this.logger.error(`      solana program close ${treasuryPoolPDA.toString()} --bypass-warning`);
        this.logger.error('   2. Run reset script:');
        this.logger.error('      cd d2d_back_end && pnpm ts-node scripts/reset-treasury-pool.ts');
        this.logger.error('═══════════════════════════════════════════════');
      } else {
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
      
      // Note: dev_wallet is used in new model (receives deposits)
      // Just pass admin's pubkey as dev_wallet for now
      const tx = await this.program.methods
        .initialize(
          initialApy,
          this.adminKeypair.publicKey // Use admin as dev_wallet
        )
        .accountsPartial({
          admin: this.adminKeypair.publicKey,
          devWallet: this.adminKeypair.publicKey, // Dev wallet that receives deposits
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
   * Get Reward Pool PDA
   */
  getRewardPoolPDA(): [PublicKey, number] {
    return PublicKey.findProgramAddressSync(
      [Buffer.from('reward_pool')],
      PROGRAM_ID
    );
  }

  /**
   * Get Platform Pool PDA
   */
  getPlatformPoolPDA(): [PublicKey, number] {
    return PublicKey.findProgramAddressSync(
      [Buffer.from('platform_pool')],
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
      
      // Use new struct fields
      const liquidBalanceSOL = (treasuryPoolAccount.liquidBalance?.toNumber() || 0) / 1_000_000_000;
      const totalDepositedSOL = (treasuryPoolAccount.totalDeposited?.toNumber() || treasuryPoolAccount.totalStaked?.toNumber() || 0) / 1_000_000_000;
      const availableBalance = liquidBalanceSOL || totalDepositedSOL;
      
      this.logger.log(`✅ Verified on-chain state:`);
      this.logger.log(`   Liquid Balance: ${liquidBalanceSOL.toFixed(4)} SOL`);
      this.logger.log(`   Total Deposited: ${totalDepositedSOL.toFixed(4)} SOL`);
      
      if (availableBalance < amount * 0.9) { // Allow 10% tolerance for fees
        this.logger.warn(`⚠️  Warning: Expected ${amount} SOL but found ${availableBalance} SOL`);
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
  /**
   * Create deploy request after payment verification (admin-only)
   * Payment has already been verified and transferred to treasury pool
   * This instruction creates the deploy_request and updates user stats
   */
  async createDeployRequest(
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
      const [treasuryPoolPDA] = this.getTreasuryPoolPDA();
      const [deployRequestPDA] = PublicKey.findProgramAddressSync(
        [Buffer.from('deploy_request'), programHash],
        this.program.programId,
      );
      const [userStatsPDA] = PublicKey.findProgramAddressSync(
        [Buffer.from('user_stats'), developer.toBuffer()],
        this.program.programId,
      );

      this.logger.log('═══════════════════════════════════════════════');
      this.logger.log('📋 Creating deploy request (admin-only)...');
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

      // Fetch treasury pool to verify admin
      let treasuryPoolAccount;
      try {
        treasuryPoolAccount = await this.program.account.treasuryPool.fetch(treasuryPoolPDA);
        this.logger.log('📋 Treasury Pool Info:');
        this.logger.log(`   Treasury Pool Admin: ${treasuryPoolAccount.admin.toString()}`);
        this.logger.log(`   Backend Admin: ${this.adminKeypair.publicKey.toString()}`);
        
        if (!treasuryPoolAccount.admin.equals(this.adminKeypair.publicKey)) {
          this.logger.error('═══════════════════════════════════════════════');
          this.logger.error('❌ ADMIN MISMATCH DETECTED!');
          this.logger.error(`   Treasury Pool Admin: ${treasuryPoolAccount.admin.toString()}`);
          this.logger.error(`   Backend Admin: ${this.adminKeypair.publicKey.toString()}`);
          this.logger.error('');
          this.logger.error('💡 The backend admin keypair does not match the treasury pool admin.');
          this.logger.error('   This will cause "Unauthorized" errors.');
          this.logger.error('');
          this.logger.error('📋 To fix:');
          this.logger.error('   1. Check ADMIN_WALLET_PATH in .env');
          this.logger.error('   2. Ensure the wallet matches the treasury pool admin');
          this.logger.error('   3. Or re-initialize treasury pool with current admin');
          this.logger.error('═══════════════════════════════════════════════');
          throw new Error(`Admin mismatch: Treasury pool admin is ${treasuryPoolAccount.admin.toString()}, but backend admin is ${this.adminKeypair.publicKey.toString()}`);
        }
        this.logger.log('✅ Admin verification passed');
      } catch (error: any) {
        if (error.message?.includes('Admin mismatch')) {
          throw error;
        }
        
        // Check if it's a deserialization error
        if (error.message?.includes('AccountDidNotDeserialize') || 
            error.message?.includes('offset') ||
            error.message?.includes('Failed to deserialize')) {
          this.logger.error('═══════════════════════════════════════════════');
          this.logger.error('❌ TREASURY POOL DESERIALIZATION ERROR!');
          this.logger.error(`   Error: ${error.message}`);
          this.logger.error('');
          this.logger.error('💡 The treasury pool account has an incompatible struct layout.');
          this.logger.error('   This happens when the on-chain account was created with an old struct.');
          this.logger.error('');
          this.logger.error('📋 To fix:');
          this.logger.error('   1. Close the old treasury pool account:');
          this.logger.error(`      solana program close ${treasuryPoolPDA.toString()} --bypass-warning`);
          this.logger.error('   2. Reinitialize with new layout:');
          this.logger.error('      Call initialize() instruction again');
          this.logger.error('═══════════════════════════════════════════════');
          throw new Error(`Treasury pool deserialization failed: ${error.message}. Please reset and reinitialize the treasury pool.`);
        }
        
        this.logger.warn(`⚠️  Could not fetch treasury pool: ${error.message}`);
        this.logger.warn('   Continuing anyway, but may fail with Unauthorized error');
      }

      // Check if accounts already exist (to avoid unnecessary rent)
      const deployRequestInfo = await this.connection.getAccountInfo(deployRequestPDA);
      const userStatsInfo = await this.connection.getAccountInfo(userStatsPDA);
      const accountsExist = deployRequestInfo !== null && userStatsInfo !== null;
      
      // If deploy_request exists, check if it matches current request
      if (deployRequestInfo !== null) {
        try {
          const existingDeployRequest = await this.program.account.deployRequest.fetch(deployRequestPDA);
          const existingProgramHash = Buffer.from(existingDeployRequest.programHash);
          const existingDeveloper = existingDeployRequest.developer;
          const currentProgramHash = programHash;
          
          this.logger.log('📋 Existing Deploy Request Found:');
          this.logger.log(`   Existing Program Hash: ${existingProgramHash.toString('hex')}`);
          this.logger.log(`   Current Program Hash: ${currentProgramHash.toString('hex')}`);
          this.logger.log(`   Existing Developer: ${existingDeveloper.toString()}`);
          this.logger.log(`   Current Developer: ${developer.toString()}`);
          this.logger.log(`   Status: ${JSON.stringify(existingDeployRequest.status)}`);
          this.logger.log(`   Ephemeral Key: ${existingDeployRequest.ephemeralKey ? existingDeployRequest.ephemeralKey.toString() : 'None'}`);
          this.logger.log(`   Deployed Program ID: ${existingDeployRequest.deployedProgramId ? existingDeployRequest.deployedProgramId.toString() : 'None'}`);
          this.logger.log(`   Subscription Paid Until: ${new Date(existingDeployRequest.subscriptionPaidUntil.toNumber() * 1000).toISOString()}`);
          
          // Check if it's a match
          const hashMatch = existingProgramHash.equals(currentProgramHash);
          const developerMatch = existingDeveloper.equals(developer);
          
          if (!hashMatch || !developerMatch) {
            const currentTime = Math.floor(Date.now() / 1000);
            const subscriptionExpired = currentTime > existingDeployRequest.subscriptionPaidUntil.toNumber();
            
            // Anchor enum can be object like { pendingDeployment: {} } or string
            const statusValue = typeof existingDeployRequest.status === 'object' 
              ? Object.keys(existingDeployRequest.status)[0] 
              : existingDeployRequest.status;
            
            const canReset = 
              statusValue === 'failed' ||
              statusValue === 'cancelled' ||
              statusValue === 'closed' ||
              statusValue === 'subscriptionExpired' ||
              statusValue === 'suspended' ||
              (statusValue === 'pendingDeployment' && !existingDeployRequest.ephemeralKey) ||
              (statusValue === 'active' && subscriptionExpired);
            
            this.logger.error('═══════════════════════════════════════════════');
            this.logger.error('❌ DEPLOY REQUEST MISMATCH!');
            this.logger.error(`   Existing deploy_request does not match current request.`);
            this.logger.error(`   Status: ${JSON.stringify(existingDeployRequest.status)} (parsed: ${statusValue})`);
            this.logger.error(`   Can Reset: ${canReset}`);
            this.logger.error(`   Subscription Expired: ${subscriptionExpired}`);
            this.logger.error(`   Ephemeral Key: ${existingDeployRequest.ephemeralKey ? 'exists' : 'none'}`);
            this.logger.error(`   This can happen if:`);
            this.logger.error(`   1. Same program_hash was used by different developer`);
            this.logger.error(`   2. Previous deployment is still active`);
            this.logger.error('');
            
            if (!canReset) {
              this.logger.error('💡 Solutions:');
              this.logger.error('   1. Use a different program (different hash)');
              this.logger.error('   2. Wait for subscription to expire');
              this.logger.error('   3. Contact admin to close the existing deploy_request');
              this.logger.error('═══════════════════════════════════════════════');
              throw new Error(`Deploy request already exists with different developer and cannot be reset. Status: ${statusValue}, Subscription expires: ${new Date(existingDeployRequest.subscriptionPaidUntil.toNumber() * 1000).toISOString()}`);
            } else {
              this.logger.log('⚠️  Deploy request exists but can be reset - will proceed');
            }
          } else {
            this.logger.log('✅ Existing deploy_request matches current request - will update');
          }
        } catch (fetchError: any) {
          this.logger.warn(`⚠️  Could not fetch existing deploy_request: ${fetchError.message}`);
          this.logger.warn('   Continuing anyway, but may fail with InvalidRequestId error');
        }
      }
      
      // Check admin balance before creating accounts
      const adminBalance = await this.connection.getBalance(this.adminKeypair.publicKey);
      const estimatedFee = 10000; // Transaction fee (higher estimate for safety)
      
      // Calculate required balance
      let requiredBalance = estimatedFee;
      if (!accountsExist) {
        // Need rent exemption if accounts don't exist
        const deployRequestRent = await this.connection.getMinimumBalanceForRentExemption(8 + 200);
        const userStatsRent = await this.connection.getMinimumBalanceForRentExemption(8 + 100);
        requiredBalance += deployRequestRent + userStatsRent;
      }
      
      this.logger.log('📝 Transaction Details:');
      this.logger.log(`   Developer: ${developer.toString()} (not a signer, payment already verified)`);
      this.logger.log(`   Admin: ${this.adminKeypair.publicKey.toString()} (signer)`);
      this.logger.log(`   Admin Balance: ${(adminBalance / 1e9).toFixed(4)} SOL`);
      this.logger.log(`   Accounts Exist: ${accountsExist ? 'Yes' : 'No'}`);
      this.logger.log(`   Required Balance: ${(requiredBalance / 1e9).toFixed(4)} SOL (${accountsExist ? 'fees only' : 'rent + fees'})`);
      
      if (adminBalance < requiredBalance) {
        const shortfall = requiredBalance - adminBalance;
        this.logger.warn(`⚠️  Admin balance insufficient. Shortfall: ${(shortfall / 1e9).toFixed(4)} SOL`);
        
        // In devnet, try to request airdrop
        if (process.env.SOLANA_ENV === 'devnet') {
          this.logger.log('💰 Requesting airdrop for admin account...');
          try {
            const airdropAmount = Math.max(shortfall + 0.1 * 1e9, 1 * 1e9); // At least 1 SOL, add buffer
            const airdropSig = await this.connection.requestAirdrop(
              this.adminKeypair.publicKey,
              airdropAmount
            );
            this.logger.log(`   Airdrop signature: ${airdropSig}`);
            
            // Wait for confirmation
            await this.connection.confirmTransaction(airdropSig, 'confirmed');
            this.logger.log('✅ Airdrop confirmed');
            
            // Recheck balance
            const newBalance = await this.connection.getBalance(this.adminKeypair.publicKey);
            this.logger.log(`   New Admin Balance: ${(newBalance / 1e9).toFixed(4)} SOL`);
          } catch (airdropError: any) {
            this.logger.error(`❌ Airdrop failed: ${airdropError.message}`);
            throw new Error(`Admin balance insufficient (${(adminBalance / 1e9).toFixed(4)} SOL) and airdrop failed. Please fund admin account with at least ${(requiredBalance / 1e9).toFixed(4)} SOL`);
          }
        } else {
          throw new Error(`Admin balance insufficient (${(adminBalance / 1e9).toFixed(4)} SOL). Required: ${(requiredBalance / 1e9).toFixed(4)} SOL`);
        }
      }

      // Call create_deploy_request instruction (admin-only, no developer signature needed)
      const tx = await this.program.methods
        .createDeployRequest(
          Array.from(programHash),
          serviceFeeU64,
          monthlyFeeU64,
          initialMonths,
          deploymentCostU64
        )
        .accountsPartial({
          developer: developer,
          admin: this.adminKeypair.publicKey,
        })
        .signers([this.adminKeypair]) // Only admin needs to sign
        .rpc();

      this.logger.log('');
      this.logger.log('✅ Deploy request created successfully!');
      this.logger.log(`   Transaction: ${tx}`);
      this.logger.log(`   Deploy request created with status: PendingDeployment`);
      this.logger.log(`   Developer payment already verified and transferred`);
      this.logger.log(`   Deployment cost reserved: ${deploymentCost / 1e9} SOL`);
      this.logger.log('   Deployment cost reserved in Treasury Pool (temporary wallet will be funded later)');
      this.logger.log(`   Note: Temporary wallet will be funded separately by backend`);
      this.logger.log(`   Explorer: https://explorer.solana.com/tx/${tx}?cluster=${process.env.SOLANA_ENV || 'devnet'}`);
      this.logger.log('═══════════════════════════════════════════════');
      
      return tx;
    } catch (error: any) {
      this.logger.error('═══════════════════════════════════════════════');
      this.logger.error(`❌ Failed to create deploy request`);
      this.logger.error(`   Error: ${error.message}`);
      
      // Extract Anchor error details
      if (error.programError) {
        this.logger.error(`   Program Error Code: ${error.programError.code}`);
        this.logger.error(`   Program Error Name: ${error.programError.name}`);
        this.logger.error(`   Program Error Message: ${error.programError.msg || 'N/A'}`);
      }
      
      // Extract logs if available
      if (error.logs && Array.isArray(error.logs)) {
        this.logger.error(`   Program Logs:`);
        error.logs.forEach((log: string, i: number) => {
          this.logger.error(`     [${i}] ${log}`);
        });
      }
      
      // Try to get logs from error object if not directly available
      if (error.error && error.error.logs) {
        this.logger.error(`   Error Logs (from error.error):`);
        error.error.logs.forEach((log: string, i: number) => {
          this.logger.error(`     [${i}] ${log}`);
        });
      }
      
      // Log full error object for debugging
      this.logger.error(`   Error Type: ${error.constructor?.name || typeof error}`);
      if (error.stack) {
        this.logger.error(`   Stack: ${error.stack}`);
      }
      
      // Build detailed error message
      let errorMessage = error.message || 'Unknown error';
      if (error.programError) {
        errorMessage += ` (Program Error: ${error.programError.name || error.programError.code})`;
      }
      if (error.logs && error.logs.length > 0) {
        errorMessage += ` - Check logs above for details`;
      }
      
      this.logger.error('═══════════════════════════════════════════════');
      
      throw new Error(`Failed to create deploy request: ${errorMessage}`);
    }
  }

  /**
   * @deprecated Use createDeployRequest instead (admin-only, no developer signature needed)
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

      // Get treasury wallet from treasury pool (or use admin as fallback)
      // The treasury wallet is stored in the treasury pool account
      // For now, we'll use admin's pubkey as it's set during initialization
      const treasuryWallet = this.adminKeypair.publicKey;

      this.logger.log('📝 Transaction Details:');
      this.logger.log(`   Developer: ${effectiveDeveloper.toString()}`);
      this.logger.log(`   Admin: ${this.adminKeypair.publicKey.toString()}`);
      this.logger.log(`   Treasury Wallet: ${treasuryWallet.toString()}`);
      this.logger.log(`   Using same keypair for dev/admin: ${isDevelopment}`);

      // Call request_deployment_funds instruction
      // Note: Both developer and admin must sign, but if they're the same in dev mode,
      // we only need one signer
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
          treasuryWallet: treasuryWallet,
        })
        .signers([this.adminKeypair]) // Both developer and admin are the same in dev mode
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
    } catch (error: any) {
      this.logger.error('═══════════════════════════════════════════════');
      this.logger.error(`❌ Failed to request deployment funds`);
      this.logger.error(`   Error: ${error.message}`);
      
      // Extract Anchor error details
      if (error.programError) {
        this.logger.error(`   Program Error Code: ${error.programError.code}`);
        this.logger.error(`   Program Error Name: ${error.programError.name}`);
        this.logger.error(`   Program Error Message: ${error.programError.msg || 'N/A'}`);
      }
      
      // Extract logs if available
      if (error.logs && Array.isArray(error.logs)) {
        this.logger.error(`   Program Logs:`);
        error.logs.forEach((log: string, i: number) => {
          this.logger.error(`     [${i}] ${log}`);
        });
      }
      
      // Try to get logs from error object if not directly available
      if (error.error && error.error.logs) {
        this.logger.error(`   Error Logs (from error.error):`);
        error.error.logs.forEach((log: string, i: number) => {
          this.logger.error(`     [${i}] ${log}`);
        });
      }
      
      // Log full error object for debugging
      this.logger.error(`   Error Type: ${error.constructor?.name || typeof error}`);
      if (error.stack) {
        this.logger.error(`   Stack: ${error.stack}`);
      }
      
      // Build detailed error message
      let errorMessage = error.message || 'Unknown error';
      if (error.programError) {
        errorMessage += ` (Program Error: ${error.programError.name || error.programError.code})`;
      }
      if (error.logs && error.logs.length > 0) {
        errorMessage += ` - Check logs above for details`;
      }
      
      this.logger.error('═══════════════════════════════════════════════');
      
      throw new Error(`Failed to request deployment funds: ${errorMessage}`);
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
      // Parameters: request_id: [u8; 32], amount: u64, use_admin_pool: bool
      const requestIdArray = Array.from(programHash);
      const useAdminPool = false; // false = use Reward Pool (preferred)
      
      this.logger.log('   Preparing instruction parameters:');
      this.logger.log(`     requestId: ${Buffer.from(programHash).toString('hex')}`);
      this.logger.log(`     amount: ${deploymentCostU64.toString()} lamports`);
      this.logger.log(`     useAdminPool: ${useAdminPool}`);
      this.logger.log('   Accounts:');
      this.logger.log(`     treasury_pool: ${treasuryPoolPDA.toString()}`);
      this.logger.log(`     deploy_request: ${deployRequestPDA.toString()}`);
      this.logger.log(`     treasury_pda: ${treasuryPoolPDA.toString()}`);
      this.logger.log(`     temporary_wallet: ${temporaryWalletPubkey.toString()}`);
      
      try {
        const tx = await this.program.methods
          .fundTemporaryWallet(
            requestIdArray,
            deploymentCostU64,
            useAdminPool
          )
          .accountsPartial({
            treasuryPool: treasuryPoolPDA,
            deployRequest: deployRequestPDA,
            admin: this.adminKeypair.publicKey,
            treasuryPda: treasuryPoolPDA, // Same as treasuryPool (Treasury Pool PDA)
            temporaryWallet: temporaryWalletPubkey,
          } as any) // TypeScript types use camelCase, but IDL uses snake_case - Anchor handles conversion
          .signers([this.adminKeypair])
          .rpc();
        
        this.logger.log('');
        this.logger.log('✅ Temporary wallet funded successfully!');
        this.logger.log(`   Transaction: ${tx}`);
        this.logger.log(`   Temporary wallet received: ${deploymentCost / 1e9} SOL`);
        this.logger.log(`   Explorer: https://explorer.solana.com/tx/${tx}?cluster=${process.env.SOLANA_ENV || 'devnet'}`);
        this.logger.log('═══════════════════════════════════════════════');
        
        return tx;
      } catch (innerError: any) {
        this.logger.error('❌ Failed to fund temporary wallet (inner error)');
        this.logger.error(`   Error: ${innerError.message}`);
        if (innerError.logs) {
          this.logger.error('   Program logs:');
          innerError.logs.forEach((log: string) => {
            this.logger.error(`     ${log}`);
          });
        }
        throw innerError;
      }
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

      // Get Reward Pool PDA (for refunds on failure)
      const [rewardPoolPDA] = this.getRewardPoolPDA();

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
          treasuryPda: treasuryPoolPDA, // Treasury Pool PDA (recovered funds go here)
          rewardPool: rewardPoolPDA,     // Reward Pool PDA (for refunds on failure)
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
      
      // Get Platform Pool and Reward Pool PDAs
      const [platformPoolPDA] = this.getPlatformPoolPDA();
      const [rewardPoolPDA] = this.getRewardPoolPDA();
      
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
          adminPool: platformPoolPDA, // Platform Pool PDA (recovered funds go here)
          rewardPool: rewardPoolPDA,   // Reward Pool PDA (for refunds on failure)
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
   * Get Backer Deposit PDA
   */
  getBackerDepositPDA(backer: PublicKey): [PublicKey, number] {
    return PublicKey.findProgramAddressSync(
      [Buffer.from('lender_stake'), backer.toBuffer()],
      PROGRAM_ID
    );
  }

  /**
   * Credit fees to pools and update reward_per_share
   * Admin-only instruction
   */
  async creditFeeToPool(feeReward: number, feePlatform: number): Promise<string> {
    try {
      const [treasuryPoolPDA] = this.getTreasuryPoolPDA();
      const [rewardPoolPDA] = PublicKey.findProgramAddressSync(
        [Buffer.from('reward_pool')],
        PROGRAM_ID
      );
      const [platformPoolPDA] = PublicKey.findProgramAddressSync(
        [Buffer.from('platform_pool')],
        PROGRAM_ID
      );

      const tx = await this.program.methods
        .creditFeeToPool(new BN(feeReward), new BN(feePlatform))
        .accountsPartial({
          admin: this.adminKeypair.publicKey,
        })
        .signers([this.adminKeypair])
        .rpc();

      this.logger.log(`✅ Fees credited: reward=${feeReward}, platform=${feePlatform} lamports`);
      this.logger.log(`   Transaction: ${tx}`);
      return tx;
    } catch (error) {
      this.logger.error(`Failed to credit fees: ${error.message}`);
      throw error;
    }
  }

  /**
   * Note: Treasury wallet concept removed - Treasury Pool PDA handles all SOL
   * Use getTreasuryPoolPDA() instead
   */
}

