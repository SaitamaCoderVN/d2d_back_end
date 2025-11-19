import { Injectable, Logger, NotFoundException, BadRequestException } from '@nestjs/common';
import {
  Connection,
  Keypair,
  PublicKey,
  LAMPORTS_PER_SOL,
  Transaction,
  SystemProgram,
  sendAndConfirmTransaction,
} from '@solana/web3.js';
import { exec, spawn } from 'child_process';
import { promisify } from 'util';
import * as fs from 'fs';
import * as path from 'path';
import * as crypto from 'crypto';
import { WalletService } from '../wallet/wallet.service';
import { ProgramService } from '../program/program.service';
import { TransactionService } from '../transaction/transaction.service';
import { CryptoService } from '../crypto/crypto.service';
import { ConfigService } from '../config/config.service';
import { SupabaseService, Deployment, DeploymentStatus } from '../supabase/supabase.service';
import { 
  VerifyProgramDto, 
  VerifyProgramResponseDto 
} from './dto/verify-program.dto';
import { 
  CalculateCostDto, 
  CostBreakdownDto 
} from './dto/calculate-cost.dto';
import { 
  ExecuteDeployDto, 
  ExecuteDeployResponseDto 
} from './dto/execute-deploy.dto';
import {
  calculateRentExemption,
  calculateServiceFee,
  calculateDeploymentPlatformFee,
  calculateMonthlyFee,
  calculateTotalPayment,
  lamportsToSOL,
} from './utils/rent-calculator';
import {
  calculateBufferAccountSize,
  setProgramAuthority,
  getProgramDataAddress,
} from './utils/bpf-loader-deployment';

const execAsync = promisify(exec);

@Injectable()
export class DeploymentService {
  private readonly logger = new Logger(DeploymentService.name);
  private devnetConnection: Connection;
  private mainnetConnection: Connection;
  private currentConnection: Connection;
  private tempDir: string;
  private tempWalletDir: string;

  constructor(
    private configService: ConfigService,
    private supabaseService: SupabaseService,
    private walletService: WalletService,
    private programService: ProgramService,
    private transactionService: TransactionService,
    private cryptoService: CryptoService,
  ) {
    // Initialize temp directory
    this.tempDir = path.join(process.cwd(), 'temp');
    if (!fs.existsSync(this.tempDir)) {
      fs.mkdirSync(this.tempDir, { recursive: true });
    }

    // Directory to persist temporary deployment wallets funded from treasury
    this.tempWalletDir = path.join(this.tempDir, 'temporary-wallets');
    if (!fs.existsSync(this.tempWalletDir)) {
      fs.mkdirSync(this.tempWalletDir, { recursive: true });
    }
    
    // Defer connection initialization - will be done lazily when needed
  }
  
  /**
   * Get connections (lazy initialization)
   */
  private ensureInitialized() {
    if (!this.devnetConnection) {
      const config = this.configService.getConfig();
      
      this.devnetConnection = new Connection(
        config.devnetRpc,
        'confirmed',
      );
      this.mainnetConnection = new Connection(
        config.mainnetRpc,
        'confirmed',
      );
      
      // Set current connection based on environment
      this.currentConnection = config.environment === 'devnet' 
        ? this.devnetConnection 
        : this.mainnetConnection;
      
      this.logger.log(`🌐 Deployment Service initialized for ${config.environment.toUpperCase()}`);
    }
  }

  // ============================================================================
  // PHASE 1: VERIFY PROGRAM
  // ============================================================================

  async verifyProgram(dto: VerifyProgramDto): Promise<VerifyProgramResponseDto> {
    this.ensureInitialized();
    this.logger.log(`[PHASE 1] Verifying program: ${dto.programId}`);

    try {
      const publicKey = new PublicKey(dto.programId);
      const accountInfo = await this.devnetConnection.getAccountInfo(publicKey);

      if (!accountInfo) {
        return {
          isValid: false,
          programId: dto.programId,
          error: 'Program not found on devnet',
        };
      }

      if (!accountInfo.executable) {
        return {
          isValid: false,
          programId: dto.programId,
          error: 'Account is not an executable program',
        };
      }

      this.logger.log(`✅ Program verified on devnet`);
      this.logger.log(`   Program size: ${accountInfo.data.length} bytes`);

      return {
        isValid: true,
        programId: dto.programId,
        programSize: accountInfo.data.length,
      };
    } catch (error) {
      this.logger.error(`Program verification failed: ${error.message}`);
      return {
        isValid: false,
        programId: dto.programId,
        error: `Invalid program ID or verification failed: ${error.message}`,
      };
    }
  }

  // ============================================================================
  // PHASE 2: CALCULATE COSTS & DUMP PROGRAM
  // ============================================================================

  async calculateCosts(dto: CalculateCostDto): Promise<CostBreakdownDto> {
    this.ensureInitialized();
    this.logger.log(`[PHASE 2] Calculating costs for: ${dto.programId}`);

    try {
      // Phase 2.1: Verify program exists
      const verification = await this.verifyProgram({ programId: dto.programId });
      if (!verification.isValid) {
        throw new BadRequestException(verification.error);
      }

      let programSize: number;
      let usedFallback = false;

      // Phase 2.2: Try to get actual program size
      try {
      const programFilePath = await this.dumpProgramFromDevnet(dto.programId);
      const stats = fs.statSync(programFilePath);
        programSize = stats.size;
      this.logger.log(`Program dumped successfully. Size: ${programSize} bytes`);
        this.cleanupTempFile(programFilePath);
      } catch (dumpError) {
        // Fallback: Use account data length from verification
        this.logger.warn(`Failed to dump program, using account size instead: ${dumpError.message}`);
        programSize = verification.programSize || 100000; // Default to ~100KB if unknown
        usedFallback = true;
        this.logger.log(`Using ${usedFallback ? 'estimated' : 'actual'} program size: ${programSize} bytes`);
      }

      // Phase 2.3: Calculate costs
      const bufferSize = calculateBufferAccountSize(programSize);

      let rentCost: number;
      const rentBufferLamports = Number(
        process.env.DEPLOYMENT_RENT_BUFFER_LAMPORTS ?? '6000000',
      ); // default ~0.006 SOL buffer for CLI overhead

      try {
        rentCost = await this.currentConnection.getMinimumBalanceForRentExemption(bufferSize);
        this.logger.log(`   Cluster rent (buffer account): ${rentCost} lamports`);
      } catch (rentError) {
        this.logger.warn(`Failed to fetch rent from cluster: ${rentError.message}`);
        this.logger.warn('Falling back to estimated rent calculator');
        rentCost = calculateRentExemption(bufferSize);
      }

      rentCost += rentBufferLamports;
      const serviceFee = calculateServiceFee(rentCost);
      const deploymentPlatformFee = calculateDeploymentPlatformFee(rentCost);
      const monthlyFee = calculateMonthlyFee();
      const initialMonths = 1;
      const totalPayment = calculateTotalPayment(
        serviceFee,
        deploymentPlatformFee,
        monthlyFee,
        initialMonths,
      );

      // Phase 2.4: Generate program hash for PDA
      const programHash = crypto.createHash('sha256')
        .update(dto.programId)
        .digest('hex');

      // Note: Treasury wallet removed - Treasury Pool PDA handles all SOL
      const breakdown: CostBreakdownDto = {
        programSize,
        rentCost,
        serviceFee,
        deploymentPlatformFee,
        monthlyFee,
        initialMonths,
        totalPayment,
        totalPaymentSOL: lamportsToSOL(totalPayment),
        programHash,
      };

      this.logger.log(`✅ Cost breakdown calculated ${usedFallback ? '(estimated)' : ''}:`);
      this.logger.log(`   Program Size: ${(programSize / 1024).toFixed(2)} KB`);
      this.logger.log(`   Rent (with buffer): ${lamportsToSOL(rentCost)} SOL`);
      this.logger.log(`   Service Fee (0.5%): ${lamportsToSOL(serviceFee)} SOL (${serviceFee} lamports)`);
      this.logger.log(`   Platform Deploy Fee (0.1%): ${lamportsToSOL(deploymentPlatformFee)} SOL (${deploymentPlatformFee} lamports)`);
      this.logger.log(`   Monthly Fee: ${lamportsToSOL(monthlyFee)} SOL x ${initialMonths}`);
      this.logger.log(`   Total Payment: ${lamportsToSOL(totalPayment)} SOL (${totalPayment} lamports)`);

      return breakdown;
    } catch (error) {
      this.logger.error(`Cost calculation failed: ${error.message}`);
      if (error instanceof BadRequestException) {
      throw error;
      }
      throw new BadRequestException(`Failed to calculate costs: ${error.message}`);
    }
  }

  // ============================================================================
  // PHASE 3: EXECUTE DEPLOYMENT
  // ============================================================================

  async executeDeploy(dto: ExecuteDeployDto): Promise<ExecuteDeployResponseDto> {
    this.ensureInitialized();
    this.logger.log(`[PHASE 3] Executing deployment for: ${dto.devnetProgramId}`);
    this.logger.log(`   Developer: ${dto.userWalletAddress}`);
    this.logger.log(`   Payment signature: ${dto.paymentSignature}`);

    try {
      // Step 1: Verify payment transaction
      this.logger.log('Step 1: Verifying payment transaction...');
      // Payment is split: monthlyFee (1%) → RewardPool, platformFee (0.1%) → PlatformPool
      const [rewardPoolPDA] = this.programService.getRewardPoolPDA();
      const [platformPoolPDA] = this.programService.getPlatformPoolPDA();
      const rewardPoolAddress = rewardPoolPDA.toString();
      const platformPoolAddress = platformPoolPDA.toString();
      
      // Calculate fee breakdown:
      // - monthlyFee (1% monthly) → RewardPool
      // - deploymentPlatformFee (0.1% platform) → PlatformPool
      // - serviceFee → RewardPool (part of reward fees)
      const monthlyFeeAmount = dto.monthlyFee * dto.initialMonths;
      const rewardPoolAmount = monthlyFeeAmount + dto.serviceFee; // Monthly fee + service fee → RewardPool
      const platformPoolAmount = dto.deploymentPlatformFee; // Platform fee → PlatformPool
      const totalPayment = rewardPoolAmount + platformPoolAmount;

      // Check if this is a simulated transaction (for testing)
      const isSimulated = dto.paymentSignature.startsWith('SIMULATED_');
      
      if (isSimulated) {
        this.logger.warn('⚠️  SIMULATED TRANSACTION DETECTED');
        this.logger.warn('   Payment signature:', dto.paymentSignature);
        this.logger.warn('   Skipping payment verification for simulation mode');
        this.logger.warn('   ⚠️  THIS SHOULD NOT BE USED IN PRODUCTION!');
      } else {
        // Verify payment on current network (devnet or mainnet based on SOLANA_ENV)
        this.logger.log('   Payment signature:', dto.paymentSignature);
        this.logger.log('   Verifying on network...');
        this.logger.log('   Expected transfers:');
        this.logger.log(`     - Reward Pool: ${rewardPoolAmount} lamports (${rewardPoolAmount / 1e9} SOL)`);
        this.logger.log(`     - Platform Pool: ${platformPoolAmount} lamports (${platformPoolAmount / 1e9} SOL)`);

        // Verify multiple transfers in one transaction
        const verification = await this.transactionService.verifyMultipleTransfers(
          dto.paymentSignature,
          dto.userWalletAddress,
          [
            { to: rewardPoolAddress, amount: rewardPoolAmount },
            { to: platformPoolAddress, amount: platformPoolAmount },
          ],
        );

        if (!verification.isValid) {
          this.logger.error('❌ Payment verification failed');
          this.logger.error('   Error:', verification.error);
          this.logger.error('   Expected from:', dto.userWalletAddress);
          this.logger.error('   Expected transfers:');
          this.logger.error(`     - Reward Pool: ${rewardPoolAmount} lamports`);
          this.logger.error(`     - Platform Pool: ${platformPoolAmount} lamports`);
          throw new BadRequestException(`Payment verification failed: ${verification.error}`);
        }

        this.logger.log('✅ Payment verified successfully');
        this.logger.log('   From:', verification.fromAddress);
        this.logger.log('   Total amount:', verification.amount, 'lamports');
      }

      // Step 2: Create Supabase deployment record
      this.logger.log('Step 2: Creating deployment record in Supabase...');
      
      // Note: Temporary wallet will be generated later in processDeployment
      // Store placeholder values for database compatibility
      const deployment = await this.supabaseService.createDeployment({
        user_wallet_address: dto.userWalletAddress,
        devnet_program_id: dto.devnetProgramId,
        deployer_wallet_address: 'TBD', // Temporary wallet generated in processDeployment
        deployer_wallet_private_key: 'TBD', // Not stored for security (temporary wallet)
        status: DeploymentStatus.PENDING,
        service_fee: dto.serviceFee,
        deployment_cost: dto.deploymentCost,
        deployment_platform_fee: dto.deploymentPlatformFee,
        payment_signature: dto.paymentSignature,
        program_hash: dto.programHash,
      });

      this.logger.log(`✅ Deployment record created in Supabase: ${deployment.id}`);

      // Log to deployment_logs
      await this.supabaseService.addDeploymentLog({
        deployment_id: deployment.id,
        phase: 'execute',
        log_level: 'info',
        message: 'Deployment request received and verified',
        metadata: {
          user_wallet: dto.userWalletAddress,
          payment_signature: dto.paymentSignature,
        },
      });

      // Step 3: Request deployment funds from D2D Pool
      this.logger.log('═══════════════════════════════════════════════');
      this.logger.log('💰 Step 3: Requesting deployment funds from Treasury Pool...');
      this.logger.log('═══════════════════════════════════════════════');
      
      const programHashBuffer = Buffer.from(dto.programHash, 'hex');
      const developerPubkey = new PublicKey(dto.userWalletAddress);

      // Log all parameters
      this.logger.log('📦 Deployment Parameters:');
      this.logger.log(`   Program Hash: ${dto.programHash}`);
      this.logger.log(`   Developer: ${dto.userWalletAddress}`);
      this.logger.log('   Deployment wallet: will be generated by backend during processing');
      this.logger.log(`   Service Fee: ${dto.serviceFee} lamports (${dto.serviceFee / 1e9} SOL)`);
      this.logger.log(`   Monthly Fee: ${dto.monthlyFee} lamports (${dto.monthlyFee / 1e9} SOL)`);
      this.logger.log(`   Initial Months: ${dto.initialMonths}`);
      this.logger.log(`   Deployment Cost: ${dto.deploymentCost} lamports (${dto.deploymentCost / 1e9} SOL)`);
      this.logger.log('───────────────────────────────────────────────');

      // Validate inputs
      if (!(programHashBuffer instanceof Buffer) || programHashBuffer.length !== 32) {
        throw new BadRequestException('Invalid program hash: must be 32-byte Buffer');
      }

      try {
        // Create deploy request after payment verification (admin-only)
        // Payment has already been verified and transferred to treasury pool
        // This creates the deploy_request and updates user stats
        const fundsTx = await this.programService.createDeployRequest(
          programHashBuffer,
          dto.serviceFee,
          dto.monthlyFee,
          dto.initialMonths,
          dto.deploymentCost,
          developerPubkey,
        );

        this.logger.log('✅ Deployment funds requested successfully!');
        this.logger.log(`   Transaction: ${fundsTx}`);
        this.logger.log('   Deployment cost reserved in Treasury Pool (temporary wallet will be funded later)');

        await this.supabaseService.updateDeployment(deployment.id, {
          on_chain_deploy_tx: fundsTx,
        });

        await this.supabaseService.addDeploymentLog({
          deployment_id: deployment.id,
          phase: 'execute',
          log_level: 'info',
          message: 'Deployment funds requested from treasury pool',
          metadata: { transaction: fundsTx },
        });
      } catch (error) {
        this.logger.error('═══════════════════════════════════════════════');
        this.logger.error(`❌ Failed to request deployment funds`);
        this.logger.error(`   Error: ${error.message}`);
        this.logger.error('═══════════════════════════════════════════════');
        
        await this.supabaseService.updateDeployment(deployment.id, {
          status: DeploymentStatus.FAILED,
          error_message: `Failed to request funds: ${error.message}`,
        });

        await this.supabaseService.addDeploymentLog({
          deployment_id: deployment.id,
          phase: 'execute',
          log_level: 'error',
          message: `Failed to request deployment funds: ${error.message}`,
        });

        throw new BadRequestException(`Failed to request deployment funds: ${error.message}`);
      }

      // Step 4: Start background deployment process (pure Web3.js)
      this.logger.log('');
      this.logger.log('🚀 Step 4: Starting background deployment process...');
      this.logger.log('   Using pure Web3.js (BPFLoaderUpgradeable)');
      this.logger.log('   No Solana CLI required ✅');
      this.logger.log(`   Deployment ID: ${deployment.id}`);
      this.logger.log(`   This will:`);
      this.logger.log(`   1. Generate temporary wallet`);
      this.logger.log(`   2. Fund temporary wallet from Treasury Pool (SOL will be deducted here)`);
      this.logger.log(`   3. Deploy program to devnet`);
      this.logger.log(`   4. Transfer authority`);
      this.logger.log(`   5. Confirm deployment`);
      
      // Start background process and log errors
      this.processDeployment(
        deployment.id,
        programHashBuffer,
        developerPubkey,
      )
        .then(() => {
          this.logger.log(`[${deployment.id}] ✅ Background deployment process completed successfully`);
        })
        .catch((error) => {
          this.logger.error(`[${deployment.id}] ❌ Background deployment failed: ${error.message}`);
          this.logger.error(`[${deployment.id}] Stack: ${error.stack}`);
        });

      return {
        deploymentId: deployment.id,
        status: DeploymentStatus.PENDING,
        message: 'Deployment started. Check status for progress.',
      };
    } catch (error) {
      this.logger.error(`Deployment execution failed: ${error.message}`);
      throw error;
    }
  }

  // ============================================================================
  // BACKGROUND DEPLOYMENT PROCESS
  // ============================================================================

  private async processDeployment(
    deploymentId: string,
    programHash: Buffer,
    developer: PublicKey,
  ): Promise<void> {
    let temporaryWallet: Keypair | null = null;
    let temporaryWalletPath: string | null = null;
    let temporaryWalletKeypairPath: string | null = null;
    let recoveredLamports = 0;

    try {
      const deployment = await this.supabaseService.getDeploymentById(deploymentId);
      if (!deployment) {
        throw new Error('Deployment not found');
      }

      // ========================================================================
      // NEW FLOW: Generate temporary wallet (dev doesn't know about it)
      // ========================================================================
      this.logger.log(`[${deploymentId}] 🔑 Generating temporary deployment wallet...`);
      temporaryWallet = Keypair.generate();
      this.logger.log(`   Temporary Wallet: ${temporaryWallet.publicKey.toString()}`);
      this.logger.log(`   Note: This wallet is NOT known to the developer`);

      const timestamp = Date.now();
      temporaryWalletPath = path.join(
        this.tempWalletDir,
        `${deploymentId}-${timestamp}.json`,
      );
      temporaryWalletKeypairPath = path.join(
        this.tempWalletDir,
        `${deploymentId}-${timestamp}-keypair.json`,
      );

      try {
        const walletPayload = {
          deploymentId,
          publicKey: temporaryWallet.publicKey.toBase58(),
          secretKey: Array.from(temporaryWallet.secretKey),
          createdAt: new Date().toISOString(),
          filePath: temporaryWalletPath,
          keypairFile: temporaryWalletKeypairPath,
        };
        fs.writeFileSync(temporaryWalletPath, JSON.stringify(walletPayload, null, 2), {
          encoding: 'utf8',
        });
        fs.writeFileSync(
          temporaryWalletKeypairPath,
          JSON.stringify(Array.from(temporaryWallet.secretKey)),
          { encoding: 'utf8' },
        );
        this.logger.log(`   📁 Temporary wallet metadata: ${temporaryWalletPath}`);
        this.logger.log(`   🔐 Temporary wallet keypair: ${temporaryWalletKeypairPath}`);
      } catch (persistError) {
        this.logger.warn(
          `[${deploymentId}] Failed to persist temporary wallet to disk: ${persistError instanceof Error ? persistError.message : persistError
          }`,
        );
      }

      // Step 1: Dump program from devnet
      this.logger.log(`[${deploymentId}] Step 1: Dumping program from devnet...`);
      await this.supabaseService.updateDeploymentStatus(deploymentId, DeploymentStatus.DUMPING);
      
      await this.supabaseService.addDeploymentLog({
        deployment_id: deploymentId,
        phase: 'deploy',
        log_level: 'info',
        message: 'Dumping program from devnet',
      });

      const programFilePath = await this.dumpProgramFromDevnet(deployment.devnet_program_id);
      
      await this.supabaseService.updateDeployment(deploymentId, {
        program_file_path: programFilePath,
      });

      // ========================================================================
      // Step 2: Fund temporary wallet (backend admin only)
      // ========================================================================
      this.logger.log(`[${deploymentId}] Step 2: Funding temporary wallet...`);
      
      await this.supabaseService.addDeploymentLog({
        deployment_id: deploymentId,
        phase: 'deploy',
        log_level: 'info',
        message: `Funding temporary wallet ${temporaryWallet.publicKey.toString()} with deployment cost`,
      });

      // Call on-chain instruction to transfer SOL from Treasury Pool to temporary wallet
      this.logger.log(`   📊 Treasury Pool balance BEFORE funding: Checking...`);
      const treasuryBefore = await this.programService.getTreasuryPoolState();
      if (treasuryBefore) {
        this.logger.log(`   📊 Treasury Pool total_staked BEFORE: ${treasuryBefore.totalStaked} lamports (${treasuryBefore.totalStaked / 1e9} SOL)`);
      }
      
      this.logger.log(`   💸 Transferring ${deployment.deployment_cost} lamports (${deployment.deployment_cost / 1e9} SOL) from Treasury Pool to temporary wallet...`);
      
      await this.programService.fundTemporaryWallet(
        programHash,
        temporaryWallet.publicKey,
        deployment.deployment_cost,
      );

      this.logger.log(`   📊 Treasury Pool balance AFTER funding: Checking...`);
      const treasuryAfter = await this.programService.getTreasuryPoolState();
      if (treasuryAfter) {
        this.logger.log(`   📊 Treasury Pool total_staked AFTER: ${treasuryAfter.totalStaked} lamports (${treasuryAfter.totalStaked / 1e9} SOL)`);
        const deducted = (treasuryBefore?.totalStaked || 0) - treasuryAfter.totalStaked;
        this.logger.log(`   ✅ SOL deducted from Treasury Pool: ${deducted} lamports (${deducted / 1e9} SOL)`);
      }

      this.logger.log(`✅ Temporary wallet funded successfully`);

      // ========================================================================
      // Step 3: Deploy program using Solana CLI with temporary wallet
      // ========================================================================
      const targetNetwork = 'Devnet'; // Always devnet for testing
      
      this.logger.log(`[${deploymentId}] Step 3: Deploying to ${targetNetwork}...`);
      await this.supabaseService.updateDeploymentStatus(deploymentId, DeploymentStatus.DEPLOYING);
      
      await this.supabaseService.addDeploymentLog({
        deployment_id: deploymentId,
        phase: 'deploy',
        log_level: 'info',
        message: `Deploying program to ${targetNetwork} using Solana CLI`,
      });

      // 🚀 Run Solana CLI deployment (program deploy)
      if (!temporaryWalletKeypairPath) {
        throw new Error('Temporary wallet keypair path not initialized');
      }

      const { programId, signature, programDataAddress } = await this.deployProgramCli(
        programFilePath,
        temporaryWalletKeypairPath,
      );

      this.logger.log(`✅ Program deployed: ${programId}`);
      this.logger.log(`   Program Data: ${programDataAddress}`);
      this.logger.log(`   Deploy TX: ${signature}`);

      // Step 3: Transfer authority
      this.logger.log(`[${deploymentId}] Step 3: Transferring authority...`);
      
      await this.supabaseService.addDeploymentLog({
        deployment_id: deploymentId,
        phase: 'deploy',
        log_level: 'info',
        message: 'Transferring program authority to D2D program',
      });

      // Use pure Web3.js authority transfer
      const authConfig = this.configService.getConfig();
      const connection = authConfig.environment === 'devnet' 
        ? this.devnetConnection 
        : this.mainnetConnection;
      
      // Note: Program authority must be a keypair, not a PDA
      // Use admin's public key as the program authority (D2D controls deployed programs)
      const d2dProgramAuthority = this.programService.getAdminKeypair().publicKey;
      const adminKeypairPath = this.programService.getAdminKeypairPath();

      let authoritySignature: string | null = null;
      let authorityTransferred = false;

      if (adminKeypairPath) {
        try {
          authoritySignature = await this.setProgramAuthorityCli(
            programId,
            temporaryWalletKeypairPath,
            d2dProgramAuthority,
            adminKeypairPath,
          );
          authorityTransferred = true;
          this.logger.log(`✅ Authority transferred to D2D admin via CLI`);
          this.logger.log(`   New authority: ${d2dProgramAuthority.toString()}`);
          if (authoritySignature) {
            this.logger.log(`   Authority TX: ${authoritySignature}`);
          }
          
          await this.supabaseService.addDeploymentLog({
            deployment_id: deploymentId,
            phase: 'deploy',
            log_level: 'info',
            message: authoritySignature
              ? `Authority transferred successfully via CLI: ${authoritySignature}`
              : `Authority transferred successfully via CLI`,
          });
        } catch (authorityError) {
          this.logger.warn(`Authority transfer via CLI failed: ${authorityError.message}`);
          await this.supabaseService.addDeploymentLog({
            deployment_id: deploymentId,
            phase: 'deploy',
            log_level: 'warn',
            message: `Authority transfer via CLI failed: ${authorityError.message}`,
          });
        }
      } else {
        this.logger.warn(
          'Admin keypair path not available; falling back to Web3.js authority transfer.',
        );
      }

      if (!authorityTransferred) {
        try {
          const fallbackSignature = await setProgramAuthority({
            connection,
            programId: new PublicKey(programId),
            currentAuthorityKeypair: temporaryWallet,
            newAuthority: d2dProgramAuthority,
            commitment: 'confirmed',
          });
          authoritySignature = fallbackSignature;
          authorityTransferred = true;
          this.logger.log(`✅ Authority transferred to D2D admin via Web3.js`);
          this.logger.log(`   Signature: ${fallbackSignature}`);
          
          await this.supabaseService.addDeploymentLog({
            deployment_id: deploymentId,
            phase: 'deploy',
            log_level: 'info',
            message: `Authority transferred via Web3.js fallback: ${fallbackSignature}`,
          });
        } catch (fallbackError) {
          this.logger.warn(`Authority transfer fallback failed: ${fallbackError.message}`);
          await this.supabaseService.addDeploymentLog({
            deployment_id: deploymentId,
            phase: 'deploy',
            log_level: 'warn',
            message: `Authority transfer fallback failed: ${fallbackError.message}`,
          });
        }
      }

      if (!authorityTransferred) {
        this.logger.warn(
          `⚠️  Authority remains with temporary wallet ${temporaryWallet.publicKey.toBase58()}. Manual intervention required.`,
        );
      }

      const [treasuryPoolPDA] = this.programService.getTreasuryPoolPDA();
      const sweepResult = await this.sweepTemporaryWallet(
        connection,
        temporaryWallet,
        treasuryPoolPDA,
      );
      recoveredLamports = sweepResult.recoveredLamports;
      if (recoveredLamports > 0) {
        await this.supabaseService.addDeploymentLog({
          deployment_id: deploymentId,
          phase: 'deploy',
          log_level: 'info',
          message: `Swept ${recoveredLamports} lamports back to treasury pool`,
        });
      }

      // ========================================================================
      // Step 4: Confirm deployment success and close temporary wallet
      // ========================================================================
      this.logger.log(`[${deploymentId}] Step 4: Confirming deployment on-chain...`);
      
      // Check temporary wallet balance before closing
      const tempWalletBalance = await connection.getBalance(temporaryWallet.publicKey);
      this.logger.log(`   Temporary wallet balance: ${tempWalletBalance / 1e9} SOL`);
      this.logger.log(`   Remaining SOL will be returned to Treasury Pool PDA`);
      
      await this.supabaseService.addDeploymentLog({
        deployment_id: deploymentId,
        phase: 'confirm',
        log_level: 'info',
        message: 'Confirming deployment success on-chain and returning excess funds',
      });

      // Confirm deployment success on-chain
      // This will transfer remaining SOL from temporary wallet back to Treasury Pool
      const confirmTx = await this.programService.confirmDeploymentSuccess(
        programHash,
        new PublicKey(programId),
        temporaryWallet.publicKey, // Temporary wallet drained moments ago
        recoveredLamports,
      );

      this.logger.log(`✅ Deployment confirmed on-chain: ${confirmTx}`);

      // Step 5: Update Supabase with success
      const deploymentConfig = this.configService.getConfig();
      await this.supabaseService.updateDeployment(deploymentId, {
        status: DeploymentStatus.SUCCESS,
        devnet_program_id: programId, // Changed from mainnet_program_id to devnet_program_id
        transaction_signature: signature,
        on_chain_confirm_tx: confirmTx,
      });

      await this.supabaseService.addDeploymentLog({
        deployment_id: deploymentId,
        phase: 'confirm',
        log_level: 'info',
        message: `Deployment completed successfully on ${deploymentConfig.environment}`,
        metadata: {
          program_id: programId,
          environment: deploymentConfig.environment,
          transaction_signature: signature,
          confirm_tx: confirmTx,
        },
      });

      // Update user stats
      await this.supabaseService.updateUserStats(deployment.user_wallet_address, {
        totalDeployments: 1,
        successfulDeployments: 1,
        feesPaid: deployment.service_fee,
      });

      // Cleanup
      this.cleanupTempFile(programFilePath);

      this.logger.log(`[${deploymentId}] ✅ DEPLOYMENT COMPLETED SUCCESSFULLY`);
      this.logger.log(`   Program ID: ${programId}`);
      this.logger.log(`   Environment: ${deploymentConfig.environment}`);
      this.logger.log(`   Deploy TX: ${signature}`);
      this.logger.log(`   Confirm TX: ${confirmTx}`);
    } catch (error) {
      this.logger.error(`[${deploymentId}] Deployment process failed: ${error.message}`);
      
      try {
        if (temporaryWallet && temporaryWalletKeypairPath) {
          const config = this.configService.getConfig();
          const connection = config.environment === 'devnet'
            ? this.devnetConnection
            : this.mainnetConnection;
          const [treasury] = this.programService.getTreasuryPoolPDA();
          const sweepResult = await this.sweepTemporaryWallet(connection, temporaryWallet, treasury);
          recoveredLamports = sweepResult.recoveredLamports;
        }

        const deployment = await this.supabaseService.getDeploymentById(deploymentId);
        if (deployment) {
          const programHashBuffer = Buffer.from(deployment.program_hash, 'hex');
          const requestId = programHashBuffer;
          
          if (temporaryWallet) {
            await this.programService.confirmDeploymentFailure(
              requestId,
              programHashBuffer,
              new PublicKey(deployment.user_wallet_address),
              temporaryWallet.publicKey,
              error.message,
            );

            await this.supabaseService.addDeploymentLog({
              deployment_id: deploymentId,
              phase: 'confirm',
              log_level: 'error',
              message: `Deployment failure confirmed on-chain: ${error.message}`,
            });
          } else {
            this.logger.warn(
              `[${deploymentId}] Skipping on-chain failure confirmation: temporary wallet not available`,
            );
          }

          // Update user stats for failure
          await this.supabaseService.updateUserStats(deployment.user_wallet_address, {
            totalDeployments: 1,
            failedDeployments: 1,
          });
        }
      } catch (confirmError) {
        this.logger.error(`Failed to confirm failure on-chain: ${confirmError.message}`);
      }

      await this.supabaseService.updateDeployment(deploymentId, {
        status: DeploymentStatus.FAILED,
        error_message: error.message,
      });
    }
  }

  // ============================================================================
  // HELPER METHODS
  // ============================================================================

  private async dumpProgramFromDevnet(programId: string): Promise<string> {
    const outputPath = path.join(this.tempDir, `${programId}.so`);
    
    this.logger.log(`Dumping program ${programId} from Devnet...`);
    
    // Try Web3.js first (more reliable)
    try {
      this.logger.log('   Method: Using @solana/web3.js (recommended)');
      
      const programPubkey = new PublicKey(programId);
      
      // Get program account info
      const accountInfo = await this.devnetConnection.getAccountInfo(programPubkey);
      
      if (!accountInfo) {
        throw new Error(`Program ${programId} not found on Devnet`);
      }
      
      if (!accountInfo.executable) {
        throw new Error(`Account ${programId} is not an executable program`);
      }
      
      // For BPF Loader Upgradeable programs, we need to get the program data account
      const BPF_LOADER_UPGRADEABLE_PROGRAM_ID = new PublicKey('BPFLoaderUpgradeab1e11111111111111111111111');
      
      if (accountInfo.owner.equals(BPF_LOADER_UPGRADEABLE_PROGRAM_ID)) {
        this.logger.log('   Detected BPF Loader Upgradeable program');
        
        // Get program data address from account data
        // The first 4 bytes are discriminator, next 32 bytes are program data address
        const programDataAddress = new PublicKey(accountInfo.data.slice(4, 36));
        this.logger.log(`   Program Data Address: ${programDataAddress.toString()}`);
        
        // Fetch program data account
        const programDataInfo = await this.devnetConnection.getAccountInfo(programDataAddress);
        
        if (!programDataInfo) {
          throw new Error(`Program data account not found: ${programDataAddress.toString()}`);
        }
        
        // Program data starts at offset 45 (skip header)
        const programData = programDataInfo.data.slice(45);
        
        // Write to file
        fs.writeFileSync(outputPath, programData);
        
        this.logger.log(`✅ Program dumped successfully via Web3.js`);
        this.logger.log(`   Output: ${outputPath}`);
        this.logger.log(`   Size: ${(programData.length / 1024).toFixed(2)} KB`);
        
        return outputPath;
      } else {
        // Legacy BPF Loader
        this.logger.log('   Detected legacy BPF Loader program');
        const programData = accountInfo.data;
        
        fs.writeFileSync(outputPath, programData);
        
        this.logger.log(`✅ Program dumped successfully via Web3.js`);
        this.logger.log(`   Output: ${outputPath}`);
        this.logger.log(`   Size: ${(programData.length / 1024).toFixed(2)} KB`);
        
        return outputPath;
      }
      
    } catch (web3Error: any) {
      this.logger.warn(`Web3.js dump failed: ${web3Error.message}`);
      this.logger.log('   Falling back to Solana CLI...');
      
      // Fallback to CLI
      const solanaCliPath = process.env.SOLANA_CLI_PATH || 'solana';
      const config = this.configService.getConfig();

    try {
        const command = `${solanaCliPath} program dump --url ${config.devnetRpc} ${programId} ${outputPath}`;
      this.logger.log(`Executing: ${command}`);

      const { stdout, stderr } = await execAsync(command, {
        timeout: 120000,
      });

      if (stderr && !stderr.includes('Wrote')) {
        this.logger.warn(`Dump stderr: ${stderr}`);
      }

      if (!fs.existsSync(outputPath)) {
        throw new Error('Program dump file was not created');
      }

        this.logger.log(`✅ Program dumped successfully via CLI`);
        this.logger.log(`   Output: ${outputPath}`);

      return outputPath;
      } catch (cliError: any) {
        this.logger.error(`❌ Both Web3.js and CLI dump methods failed`);
        this.logger.error(`   Web3.js error: ${web3Error.message}`);
        this.logger.error(`   CLI error: ${cliError.message}`);
        
        if (cliError.message.includes('No such file or directory')) {
          this.logger.error('');
          this.logger.error('💡 Solana CLI not found! Fix:');
          this.logger.error('   1. Install: sh -c "$(curl -sSfL https://release.solana.com/stable/install)"');
          this.logger.error('   2. Or set SOLANA_CLI_PATH in .env:');
          this.logger.error('      SOLANA_CLI_PATH=/path/to/solana');
          this.logger.error('   3. Find path: which solana');
        }
        
        throw new Error(`Failed to dump program from devnet: ${cliError.message}`);
      }
    }
  }

  private cleanupTempFile(filePath: string): void {
    try {
      if (fs.existsSync(filePath)) {
        fs.unlinkSync(filePath);
        this.logger.log(`Cleaned up temp file: ${filePath}`);
      }
    } catch (error) {
      this.logger.error(`Failed to cleanup temp file: ${error.message}`);
    }
  }

  private async sweepTemporaryWallet(
    connection: Connection,
    temporaryWallet: Keypair,
    treasuryPool: PublicKey,
  ): Promise<{ signature: string | null; recoveredLamports: number }> {
    try {
      const balance = await connection.getBalance(temporaryWallet.publicKey, 'confirmed');
      // Leave enough lamports to cover a transfer fee (~5000)
      const feeBuffer = Number(process.env.TEMP_WALLET_FEE_BUFFER_LAMPORTS ?? '5000');
      if (balance <= feeBuffer) {
        return { signature: null, recoveredLamports: 0 };
      }

      const transferLamports = balance - feeBuffer;
      const tx = new Transaction().add(
        SystemProgram.transfer({
          fromPubkey: temporaryWallet.publicKey,
          toPubkey: treasuryPool,
          lamports: transferLamports,
        }),
      );
      tx.feePayer = temporaryWallet.publicKey;
      const { blockhash, lastValidBlockHeight } = await connection.getLatestBlockhash('confirmed');
      tx.recentBlockhash = blockhash;

      const signature = await sendAndConfirmTransaction(
        connection,
        tx,
        [temporaryWallet],
        { commitment: 'confirmed' },
      );

      this.logger.log(`✅ Temporary wallet swept back to treasury`);
      this.logger.log(`   Signature: ${signature}`);
      this.logger.log(`   Lamports returned: ${transferLamports}`);

      return { signature, recoveredLamports: transferLamports };
    } catch (error) {
      this.logger.warn(
        `Failed to sweep temporary wallet ${temporaryWallet.publicKey.toBase58()}: ${error instanceof Error ? error.message : error
        }`,
      );
      return { signature: null, recoveredLamports: 0 };
    }
  }

  private async deployProgramCli(
    programFilePath: string,
    payerKeypairPath: string,
  ): Promise<{ programId: string; signature: string; programDataAddress: string }> {
    const config = this.configService.getConfig();
    const args = [
      'program',
      'deploy',
      programFilePath,
      '--url',
      config.currentRpc,
      '--keypair',
      payerKeypairPath,
    ];

    let stdout: string;
    let stderr: string;
    try {
      ({ stdout, stderr } = await this.runSolanaCli(args, 'program deploy', {
        timeoutMs: this.getCliTimeoutMs(),
      }));
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      this.logCliRecoveryHint(message, payerKeypairPath);
      throw error;
    }

    const combinedOutput = `${stdout}\n${stderr}`;
    const programIdMatch = combinedOutput.match(/Program Id:\s*([1-9A-HJ-NP-Za-km-z]{32,44})/);
    if (!programIdMatch) {
      throw new Error(
        `Solana CLI deploy did not return a Program Id.\nOutput:\n${combinedOutput}`,
      );
    }

    const programId = programIdMatch[1];
    const signatureMatch = combinedOutput.match(/Signature:\s*([1-9A-HJ-NP-Za-km-z]{64,88})/);
    const signature = signatureMatch ? signatureMatch[1] : '';

    const [programDataAddress] = getProgramDataAddress(new PublicKey(programId));

    return {
      programId,
      signature,
      programDataAddress: programDataAddress.toBase58(),
    };
  }

  private async setProgramAuthorityCli(
    programId: string,
    payerKeypairPath: string,
    newAuthority: PublicKey,
    newAuthorityKeypairPath: string,
  ): Promise<string | null> {
    const config = this.configService.getConfig();
    const args = [
      'program',
      'set-upgrade-authority',
      programId,
      '--new-upgrade-authority',
      newAuthorityKeypairPath,
      '--url',
      config.currentRpc,
      '--keypair',
      payerKeypairPath,
    ];

    let stdout: string;
    let stderr: string;
    try {
      this.logger.log(`   New authority (pubkey): ${newAuthority.toBase58()}`);
      ({ stdout, stderr } = await this.runSolanaCli(args, 'set-upgrade-authority', {
        timeoutMs: Math.min(this.getCliTimeoutMs(), 180_000),
      }));
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      this.logCliRecoveryHint(message, payerKeypairPath);
      throw error;
    }

    const combinedOutput = `${stdout}\n${stderr}`;
    const signatureMatch = combinedOutput.match(/Signature:\s*([1-9A-HJ-NP-Za-km-z]{64,88})/);
    return signatureMatch ? signatureMatch[1] : null;
  }

  private getCliTimeoutMs(): number {
    const raw = process.env.SOLANA_CLI_TIMEOUT_MS;
    const parsed = raw ? Number(raw) : NaN;
    const fallback = 900_000; // 15 minutes
    if (!Number.isFinite(parsed) || parsed <= 0) {
      return fallback;
    }
    return parsed;
  }

  private async runSolanaCli(
    args: string[],
    context: string,
    options: { timeoutMs?: number } = {},
  ): Promise<{ stdout: string; stderr: string }> {
    // Try to find Solana CLI path
    let cliPath = process.env.SOLANA_CLI_PATH;
    
    if (!cliPath) {
      // Try to find which solana
      try {
        const { stdout } = await execAsync('which solana', { timeout: 5000 });
        if (stdout.trim()) {
          cliPath = stdout.trim();
          this.logger.log(`   Found Solana CLI via 'which': ${cliPath}`);
        }
      } catch (e) {
        // which failed, try common paths
        const commonPaths = [
          process.env.HOME + '/.local/share/solana/install/active_release/bin/solana',
          '/root/.local/share/solana/install/active_release/bin/solana',
          '/usr/local/bin/solana',
          '/usr/bin/solana',
        ];
        
        for (const path of commonPaths) {
          try {
            await execAsync(`test -x "${path}"`, { timeout: 1000 });
            cliPath = path;
            this.logger.log(`   Found Solana CLI at: ${cliPath}`);
            break;
          } catch (e) {
            // Path doesn't exist, try next
          }
        }
      }
      
      // Default to 'solana' if nothing found (will fail with better error)
      if (!cliPath) {
        cliPath = 'solana';
        this.logger.warn(`   ⚠️  Solana CLI not found, using 'solana' (must be in PATH or set SOLANA_CLI_PATH)`);
      }
    }
    
    this.logger.log(`🔧 Running Solana CLI (${context}): ${cliPath} ${args.join(' ')}`);

    const timeoutMs = options.timeoutMs ?? this.getCliTimeoutMs();
    const heartbeatMs = Number(process.env.SOLANA_CLI_HEARTBEAT_MS ?? '60000');
    const heartbeatEnabled = heartbeatMs > 0;
    const startTime = Date.now();

    return new Promise((resolve, reject) => {
      const child = spawn(cliPath, args, {
        env: {
          ...process.env,
          // Ensure CLI respects our RPC endpoint if SOLANA_URL is used
          SOLANA_URL: undefined,
        },
        stdio: ['ignore', 'pipe', 'pipe'],
      });

      let stdout = '';
      let stderr = '';
      let timeoutHandle: NodeJS.Timeout | undefined;
      let heartbeatHandle: NodeJS.Timeout | undefined;
      let killed = false;
      let lastOutput = Date.now();

      const logStream = (chunk: Buffer, label: 'stdout' | 'stderr') => {
        const text = chunk.toString();
        if (label === 'stdout') {
          stdout += text;
        } else {
          stderr += text;
        }

        lastOutput = Date.now();

        const trimmed = text.trim();
        if (trimmed.length > 0) {
          const prefix = label === 'stdout' ? 'CLI ▶︎' : 'CLI ⚠︎';
          this.logger.log(`${prefix} ${trimmed}`);
        }
      };

      child.stdout.on('data', (data) => logStream(data, 'stdout'));
      child.stderr.on('data', (data) => logStream(data, 'stderr'));

      child.on('error', (error) => {
        if (timeoutHandle) {
          clearTimeout(timeoutHandle);
        }
        if (heartbeatHandle) {
          clearInterval(heartbeatHandle);
        }
        reject(new Error(`Failed to execute Solana CLI (${context}): ${error.message}`));
      });

      child.on('close', (code) => {
        if (timeoutHandle) {
          clearTimeout(timeoutHandle);
        }
        if (heartbeatHandle) {
          clearInterval(heartbeatHandle);
        }
        if (code !== 0 || killed) {
          const combined = `${stdout}\n${stderr}`.trim();
          const errorMessage = killed
            ? `Solana CLI (${context}) timed out after ${timeoutMs}ms`
            : `Solana CLI (${context}) exited with code ${code}`;
          reject(new Error(`${errorMessage}. Output:\n${combined}`));
        } else {
          resolve({ stdout, stderr });
        }
      });

      if (timeoutMs && timeoutMs > 0 && Number.isFinite(timeoutMs)) {
        timeoutHandle = setTimeout(() => {
          killed = true;
          child.kill('SIGKILL');
        }, timeoutMs);
      }

      if (heartbeatEnabled) {
        heartbeatHandle = setInterval(() => {
          const now = Date.now();
          const elapsedSeconds = Math.round((now - startTime) / 1000);
          const sinceLastOutputSeconds = Math.round((now - lastOutput) / 1000);
          this.logger.log(
            `⏳ Solana CLI (${context}) still running (elapsed ${elapsedSeconds}s, last output ${sinceLastOutputSeconds}s ago)`,
          );
        }, heartbeatMs);
      }
    });
  }

  private logCliRecoveryHint(message: string, keypairPath: string) {
    if (!message) {
      return;
    }

    if (message.includes('Recover the intermediate account')) {
      this.logger.warn('⚠️  Solana CLI reported an unfinished deploy buffer.');
      const mnemonicMatch = message.match(/seed phrase:\s*([a-z\s]+)/i);
      if (mnemonicMatch) {
        this.logger.warn(`   ▶️ Seed phrase: ${mnemonicMatch[1].trim()}`);
      }
      const closeMatch = message.match(/solana program close ([1-9A-HJ-NP-Za-km-z]{32,44})/);
      if (closeMatch) {
        this.logger.warn(
          `   ▶️ To reclaim lamports: solana-keygen recover -o buffer-keypair.json --force`,
        );
        this.logger.warn(
          `   ▶️ Then: solana program close ${closeMatch[1]} --url ${this.configService.getConfig().currentRpc} --keypair buffer-keypair.json`,
        );
      }
    }

    if (message.includes('insufficient funds')) {
      this.logger.warn(
        `⚠️  Temporary deploy wallet at ${keypairPath} ran out of SOL during CLI deployment.`,
      );
      this.logger.warn('   Consider increasing the deployment buffer or staking more SOL to the treasury.');
    }
  }

  // ============================================================================
  // QUERY METHODS
  // ============================================================================

  async getDeploymentsByUser(userWalletAddress: string): Promise<Deployment[]> {
    return this.supabaseService.getDeploymentsByUser(userWalletAddress);
  }

  async getDeploymentById(id: string): Promise<Deployment> {
    const deployment = await this.supabaseService.getDeploymentById(id);
    if (!deployment) {
      throw new NotFoundException(`Deployment with ID ${id} not found`);
    }
    return deployment;
  }

  async getAllDeployments(): Promise<Deployment[]> {
    return this.supabaseService.getAllDeployments();
  }
}

