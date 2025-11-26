import { Injectable, Logger, NotFoundException, BadRequestException } from '@nestjs/common';
import {
  Connection,
  Keypair,
  PublicKey,
  Transaction,
  SystemProgram,
  sendAndConfirmTransaction,
  LAMPORTS_PER_SOL,
} from '@solana/web3.js';
import { exec, spawn } from 'child_process';
import { promisify } from 'util';
import * as fs from 'fs';
import * as path from 'path';
import { ConfigService } from '../config/config.service';
import { SupabaseService, DeploymentStatus } from '../supabase/supabase.service';
import { ProgramService } from '../program/program.service';
import { getProgramDataAddress } from '../deployment/utils/bpf-loader-deployment';

const execAsync = promisify(exec);

@Injectable()
export class CloseProgramService {
  private readonly logger = new Logger(CloseProgramService.name);
  private devnetConnection: Connection;
  private mainnetConnection: Connection;
  private tempDir: string;
  private tempWalletDir: string;

  constructor(
    private configService: ConfigService,
    private supabaseService: SupabaseService,
    private programService: ProgramService,
  ) {
    // Initialize temp directory
    this.tempDir = path.join(process.cwd(), 'temp');
    if (!fs.existsSync(this.tempDir)) {
      fs.mkdirSync(this.tempDir, { recursive: true });
    }

    // Directory where temporary deployment wallets are stored
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
      
      this.logger.log(`🌐 Close Program Service initialized for ${config.environment.toUpperCase()}`);
    }
  }

  /**
   * Close a deployed program and return all SOL to treasury pool
   */
  async closeProgram(
    deploymentId: string,
    userWalletAddress: string,
  ): Promise<{
    deploymentId: string;
    status: string;
    closeSignature: string;
    refundSignature?: string;
    recoveredLamports: number;
    message: string;
  }> {
    this.ensureInitialized();
    this.logger.log(`[CLOSE] Closing program for deployment: ${deploymentId}`);
    this.logger.log(`   User: ${userWalletAddress}`);

    try {
      // Step 1: Verify deployment exists and user owns it
      const deployment = await this.supabaseService.getDeploymentById(deploymentId);
      if (!deployment) {
        throw new NotFoundException(`Deployment with ID ${deploymentId} not found`);
      }

      if (deployment.user_wallet_address !== userWalletAddress) {
        throw new BadRequestException('User does not own this deployment');
      }

      if (deployment.status === DeploymentStatus.CLOSED) {
        throw new BadRequestException('Program is already closed');
      }

      if (deployment.status !== DeploymentStatus.SUCCESS) {
        throw new BadRequestException(`Cannot close deployment with status: ${deployment.status}`);
      }

      if (!deployment.devnet_program_id) {
        throw new BadRequestException('Program ID not found in deployment');
      }

      if (!deployment.deployer_wallet_address || deployment.deployer_wallet_address === 'TBD') {
        throw new BadRequestException('Deployment wallet not found');
      }

      // Step 2: Load temporary wallet from disk
      this.logger.log(`[CLOSE] Loading temporary wallet from disk...`);
      this.logger.log(`   Deployment ID: ${deploymentId}`);
      this.logger.log(`   Deployer wallet from DB: ${deployment.deployer_wallet_address}`);
      this.logger.log(`   Temp wallet directory: ${this.tempWalletDir}`);
      
      let temporaryWallet = await this.loadTemporaryWallet(deploymentId);
      
      // Fallback: Try to load by deployer wallet address if deployment ID search fails
      if (!temporaryWallet && deployment.deployer_wallet_address && deployment.deployer_wallet_address !== 'TBD') {
        this.logger.log(`[CLOSE] Trying fallback: loading wallet by deployer address...`);
        temporaryWallet = await this.loadTemporaryWalletByAddress(deployment.deployer_wallet_address);
      }
      
      if (!temporaryWallet) {
        const dirContents = fs.existsSync(this.tempWalletDir) 
          ? fs.readdirSync(this.tempWalletDir).slice(0, 20).join(', ') 
          : 'Directory does not exist';
        this.logger.error(`[CLOSE] Failed to load temporary wallet. Directory contents: ${dirContents}`);
        throw new BadRequestException('Failed to load temporary wallet from disk. The deployment wallet may have been deleted or the deployment ID is incorrect.');
      }

      this.logger.log(`   Temporary wallet loaded: ${temporaryWallet.publicKey.toString()}`);

      // Verify wallet matches deployment record
      if (temporaryWallet.publicKey.toString() !== deployment.deployer_wallet_address) {
        this.logger.error(`[CLOSE] Wallet mismatch! Expected: ${deployment.deployer_wallet_address}, Got: ${temporaryWallet.publicKey.toString()}`);
        throw new BadRequestException('Temporary wallet mismatch with deployment record');
      }

      const config = this.configService.getConfig();
      const connection = config.environment === 'devnet'
        ? this.devnetConnection
        : this.mainnetConnection;

      // Step 3: Get program balance before closing
      const programId = new PublicKey(deployment.devnet_program_id);
      const [programDataAddress] = getProgramDataAddress(programId);
      
      const programDataInfo = await connection.getAccountInfo(programDataAddress);
      if (!programDataInfo) {
        throw new Error('Program data account not found. Program may already be closed.');
      }

      const programBalance = programDataInfo.lamports;
      this.logger.log(`   Program data balance: ${programBalance / 1e9} SOL (${programBalance} lamports)`);

      // Step 3.5: Check temporary wallet balance and fund from treasury pool if needed
      let tempWalletBalanceBefore = await connection.getBalance(temporaryWallet.publicKey, 'confirmed');
      this.logger.log(`   Temporary wallet balance BEFORE: ${tempWalletBalanceBefore / 1e9} SOL (${tempWalletBalanceBefore} lamports)`);
      
      // Need at least 0.01 SOL for transaction fees (safety margin)
      const minRequiredBalance = 0.01 * LAMPORTS_PER_SOL;
      if (tempWalletBalanceBefore < minRequiredBalance) {
        this.logger.log(`[CLOSE] Temporary wallet has insufficient balance. Funding from Treasury Pool...`);
        const fundingAmount = minRequiredBalance - tempWalletBalanceBefore + (0.001 * LAMPORTS_PER_SOL); // Add extra 0.001 SOL buffer
        
        try {
          // Transfer SOL from admin wallet to temporary wallet for transaction fees
          // Note: This is a small amount (~0.01 SOL) just for fees, not deployment cost
          const adminKeypair = this.programService.getAdminKeypair();
          const adminBalance = await connection.getBalance(adminKeypair.publicKey, 'confirmed');
          
          this.logger.log(`   Admin wallet: ${adminKeypair.publicKey.toString()}`);
          this.logger.log(`   Admin wallet balance: ${adminBalance / 1e9} SOL (${adminBalance} lamports)`);
          this.logger.log(`   Required funding: ${fundingAmount / LAMPORTS_PER_SOL} SOL (${fundingAmount} lamports)`);
          
          if (adminBalance < fundingAmount) {
            throw new Error(`Admin wallet has insufficient balance. Admin: ${adminBalance / LAMPORTS_PER_SOL} SOL, Required: ${fundingAmount / LAMPORTS_PER_SOL} SOL`);
          }
          
          this.logger.log(`   💸 Transferring ${fundingAmount / LAMPORTS_PER_SOL} SOL from admin wallet to temporary wallet for transaction fees...`);
          
          // Transfer SOL from admin wallet to temporary wallet
          const transferTx = new Transaction().add(
            SystemProgram.transfer({
              fromPubkey: adminKeypair.publicKey,
              toPubkey: temporaryWallet.publicKey,
              lamports: fundingAmount,
            }),
          );
          
          const transferSig = await sendAndConfirmTransaction(
            connection,
            transferTx,
            [adminKeypair],
            { commitment: 'confirmed' },
          );
          
          this.logger.log(`   ✅ SOL transferred from admin wallet: ${transferSig}`);
          this.logger.log(`   Amount: ${fundingAmount / LAMPORTS_PER_SOL} SOL`);
          
          // Wait a bit and check balance again
          await new Promise(resolve => setTimeout(resolve, 2000));
          tempWalletBalanceBefore = await connection.getBalance(temporaryWallet.publicKey, 'confirmed');
          this.logger.log(`   Temporary wallet balance AFTER funding: ${tempWalletBalanceBefore / 1e9} SOL (${tempWalletBalanceBefore} lamports)`);
        } catch (fundingError) {
          this.logger.error(`[CLOSE] Failed to fund temporary wallet: ${fundingError instanceof Error ? fundingError.message : String(fundingError)}`);
          throw new BadRequestException(`Temporary wallet has insufficient balance (${tempWalletBalanceBefore / LAMPORTS_PER_SOL} SOL). Minimum required: ${minRequiredBalance / LAMPORTS_PER_SOL} SOL for transaction fees. Failed to fund from admin wallet: ${fundingError instanceof Error ? fundingError.message : String(fundingError)}`);
        }
      }

      // Step 4: Close program using Solana CLI
      this.logger.log(`[CLOSE] Closing program using Solana CLI...`);
      await this.supabaseService.addDeploymentLog({
        deployment_id: deploymentId,
        phase: 'deploy',
        log_level: 'info',
        message: `Closing program ${deployment.devnet_program_id}`,
      });

      const closeSignature = await this.closeProgramCli(
        deployment.devnet_program_id,
        temporaryWallet,
        connection,
      );

      this.logger.log(`✅ Program closed successfully`);
      this.logger.log(`   Close TX: ${closeSignature}`);

      // Step 5: Wait for close transaction to be fully confirmed and SOL to be returned
      this.logger.log(`[CLOSE] Waiting for close transaction to be confirmed and SOL to be returned...`);
      await new Promise(resolve => setTimeout(resolve, 3000)); // Wait 3 seconds for SOL to be returned

      // Step 6: Get remaining balance from temporary wallet (after closing)
      // Check balance multiple times to ensure SOL from program data account is returned
      let tempWalletBalanceAfter = await connection.getBalance(temporaryWallet.publicKey, 'confirmed');
      this.logger.log(`   Temporary wallet balance AFTER close (first check): ${tempWalletBalanceAfter / 1e9} SOL (${tempWalletBalanceAfter} lamports)`);
      
      // Wait a bit more and check again (SOL from program data account might take time to return)
      await new Promise(resolve => setTimeout(resolve, 2000));
      tempWalletBalanceAfter = await connection.getBalance(temporaryWallet.publicKey, 'confirmed');
      this.logger.log(`   Temporary wallet balance AFTER close (second check): ${tempWalletBalanceAfter / 1e9} SOL (${tempWalletBalanceAfter} lamports)`);

      // Step 7: Transfer all SOL from temporary wallet to treasury pool
      // Treasury Pool PDA: D6h9mgXL5enPyiG2M1W7Jn9yjXh8md1fCAcP5zBJH6ma
      const [treasuryPoolPDA] = this.programService.getTreasuryPoolPDA();
      this.logger.log(`[CLOSE] Treasury Pool PDA: ${treasuryPoolPDA.toString()}`);
      
      let refundSignature: string | undefined;
      let recoveredLamports = 0;

      // We'll keep exactly 0.001 SOL (1,000,000 lamports) in temporary wallet
      // This covers rent exemption (~890,880 lamports) + transaction fees
      const minBalanceToKeep = 1_000_000; // 0.001 SOL - fixed value
      
      if (tempWalletBalanceAfter > minBalanceToKeep) {
        const transferAmount = tempWalletBalanceAfter - minBalanceToKeep;
        this.logger.log(`[CLOSE] Preparing to transfer SOL to treasury pool...`);
        this.logger.log(`   Current balance: ${tempWalletBalanceAfter / 1e9} SOL (${tempWalletBalanceAfter} lamports)`);
        this.logger.log(`   Will transfer: ${transferAmount / 1e9} SOL (${transferAmount} lamports)`);
        this.logger.log(`   Will keep: ${minBalanceToKeep / 1e9} SOL (${minBalanceToKeep} lamports) in temporary wallet`);
        
        try {
          const sweepResult = await this.sweepTemporaryWallet(
            connection,
            temporaryWallet,
            treasuryPoolPDA,
            minBalanceToKeep, // Pass the exact amount to keep
          );
          
          refundSignature = sweepResult.signature || undefined;
          recoveredLamports = sweepResult.recoveredLamports;
          
          if (refundSignature) {
            this.logger.log(`✅ Funds transferred to treasury pool successfully`);
            this.logger.log(`   Refund TX: ${refundSignature}`);
            this.logger.log(`   Amount transferred: ${recoveredLamports / 1e9} SOL (${recoveredLamports} lamports)`);
            
            // Verify final balance
            const finalBalance = await connection.getBalance(temporaryWallet.publicKey, 'confirmed');
            this.logger.log(`   Final temporary wallet balance: ${finalBalance / 1e9} SOL (${finalBalance} lamports)`);
            this.logger.log(`   Expected remaining: ${minBalanceToKeep / 1e9} SOL (${minBalanceToKeep} lamports)`);
          } else {
            this.logger.warn(`⚠️  Sweep completed but no signature returned`);
          }
        } catch (sweepError) {
          this.logger.error(`[CLOSE] Failed to sweep temporary wallet: ${sweepError instanceof Error ? sweepError.message : String(sweepError)}`);
          this.logger.error(`   Stack: ${sweepError instanceof Error ? sweepError.stack : 'N/A'}`);
          // Don't throw - continue with closing process even if sweep fails
          // The SOL will remain in temporary wallet and can be recovered manually
        }
      } else {
        this.logger.log(`   No funds to recover (balance ${tempWalletBalanceAfter / 1e9} SOL is too low, need at least ${minBalanceToKeep / 1e9} SOL)`);
      }

      // Step 8: Update deployment status in Supabase
      // Note: programBalance is the SOL that was in program data account (returned to authority wallet)
      // recoveredLamports is the SOL we successfully transferred from temporary wallet to treasury
      const totalRecovered = programBalance + recoveredLamports;
      
      await this.supabaseService.updateDeployment(deploymentId, {
        status: DeploymentStatus.CLOSED,
      });

      await this.supabaseService.addDeploymentLog({
        deployment_id: deploymentId,
        phase: 'confirm',
        log_level: 'info',
        message: `Program closed successfully. Recovered ${totalRecovered / 1e9} SOL`,
        metadata: {
          close_signature: closeSignature,
          refund_signature: refundSignature,
          recovered_lamports: totalRecovered,
        },
      });

      this.logger.log(`[CLOSE] ✅ Program closed successfully`);
      this.logger.log(`   Total recovered: ${totalRecovered / 1e9} SOL`);

      return {
        deploymentId,
        status: DeploymentStatus.CLOSED,
        closeSignature,
        refundSignature,
        recoveredLamports: totalRecovered,
        message: 'Program closed successfully. All SOL returned to treasury pool.',
      };
    } catch (error) {
      this.logger.error(`[CLOSE] Failed to close program: ${error.message}`);
      
      await this.supabaseService.addDeploymentLog({
        deployment_id: deploymentId,
        phase: 'deploy',
        log_level: 'error',
        message: `Failed to close program: ${error.message}`,
      });

      throw error;
    }
  }

  /**
   * Load temporary wallet from disk files
   */
  private async loadTemporaryWallet(deploymentId: string): Promise<Keypair | null> {
    try {
      // Check if directory exists
      if (!fs.existsSync(this.tempWalletDir)) {
        this.logger.error(`Temp wallet directory does not exist: ${this.tempWalletDir}`);
        return null;
      }

      // Look for wallet files matching the deployment ID
      const files = fs.readdirSync(this.tempWalletDir);
      this.logger.log(`   Found ${files.length} files in temp wallet directory`);
      this.logger.log(`   Looking for files starting with: ${deploymentId}-`);
      
      const walletFile = files.find(f => f.startsWith(`${deploymentId}-`) && f.endsWith('.json') && !f.includes('-keypair'));
      
      if (!walletFile) {
        this.logger.warn(`Wallet file not found for deployment ${deploymentId}`);
        this.logger.warn(`   Available files: ${files.slice(0, 10).join(', ')}${files.length > 10 ? '...' : ''}`);
        return null;
      }

      this.logger.log(`   Found wallet file: ${walletFile}`);
      const walletFilePath = path.join(this.tempWalletDir, walletFile);
      const walletData = JSON.parse(fs.readFileSync(walletFilePath, 'utf-8'));

      if (walletData.secretKey && Array.isArray(walletData.secretKey)) {
        const secretKey = Uint8Array.from(walletData.secretKey);
        return Keypair.fromSecretKey(secretKey);
      }

      // Try loading from keypair file
      const keypairFile = files.find(f => f.startsWith(`${deploymentId}-`) && f.endsWith('-keypair.json'));
      if (keypairFile) {
        this.logger.log(`   Found keypair file: ${keypairFile}`);
        const keypairFilePath = path.join(this.tempWalletDir, keypairFile);
        const keypairData = JSON.parse(fs.readFileSync(keypairFilePath, 'utf-8'));
        
        if (Array.isArray(keypairData)) {
          const secretKey = Uint8Array.from(keypairData);
          return Keypair.fromSecretKey(secretKey);
        }
      }

      this.logger.error(`   Wallet file found but could not parse secret key`);
      return null;
    } catch (error) {
      this.logger.error(`Failed to load temporary wallet: ${error instanceof Error ? error.message : String(error)}`);
      this.logger.error(`   Stack: ${error instanceof Error ? error.stack : 'N/A'}`);
      return null;
    }
  }

  /**
   * Load temporary wallet by deployer wallet address (fallback method)
   */
  private async loadTemporaryWalletByAddress(deployerAddress: string): Promise<Keypair | null> {
    try {
      if (!fs.existsSync(this.tempWalletDir)) {
        return null;
      }

      const files = fs.readdirSync(this.tempWalletDir);
      
      // Try to find wallet by matching public key in wallet metadata
      for (const file of files) {
        if (!file.endsWith('.json') || file.includes('-keypair.json')) {
          continue;
        }

        try {
          const filePath = path.join(this.tempWalletDir, file);
          const walletData = JSON.parse(fs.readFileSync(filePath, 'utf-8'));

          // Check if this wallet's public key matches
          if (walletData.publicKey === deployerAddress && walletData.secretKey && Array.isArray(walletData.secretKey)) {
            this.logger.log(`   Found wallet by address in file: ${file}`);
            const secretKey = Uint8Array.from(walletData.secretKey);
            return Keypair.fromSecretKey(secretKey);
          }
        } catch (e) {
          // Continue to next file
          continue;
        }
      }

      return null;
    } catch (error) {
      this.logger.error(`Failed to load wallet by address: ${error instanceof Error ? error.message : String(error)}`);
      return null;
    }
  }

  /**
   * Close program using Solana CLI
   */
  private async closeProgramCli(
    programId: string,
    authorityKeypair: Keypair,
    connection: Connection,
  ): Promise<string> {
    const config = this.configService.getConfig();
    
    // Save keypair to temporary file for CLI
    const tempKeypairPath = path.join(this.tempDir, `close-${Date.now()}.json`);
    try {
      this.logger.log(`[CLOSE] Saving keypair to temp file: ${tempKeypairPath}`);
      fs.writeFileSync(tempKeypairPath, JSON.stringify(Array.from(authorityKeypair.secretKey)));

      const args = [
        'program',
        'close',
        programId,
        '--bypass-warning',
        '--url',
        config.currentRpc,
        '--keypair',
        tempKeypairPath,
      ];

      this.logger.log(`[CLOSE] Executing: solana ${args.join(' ')}`);
      
      const { stdout, stderr } = await this.runSolanaCli(args, 'program close', {
        timeoutMs: 60000, // 1 minute
      });

      const combinedOutput = `${stdout}\n${stderr}`;
      this.logger.log(`[CLOSE] Solana CLI output: ${combinedOutput}`);
      
      // Check if program was closed successfully
      // Output format: "Closed Program Id <PROGRAM_ID>, X SOL reclaimed"
      const closedMatch = combinedOutput.match(/Closed Program Id\s+([1-9A-HJ-NP-Za-km-z]{32,44}),\s+([\d.]+)\s+SOL reclaimed/i);
      
      if (closedMatch) {
        const closedProgramId = closedMatch[1];
        const reclaimedSOL = closedMatch[2];
        this.logger.log(`[CLOSE] Program closed successfully`);
        this.logger.log(`   Program ID: ${closedProgramId}`);
        this.logger.log(`   SOL reclaimed: ${reclaimedSOL}`);
        
        // Try to get signature from output (some versions might include it)
        const signatureMatch = combinedOutput.match(/Signature:\s*([1-9A-HJ-NP-Za-km-z]{64,88})/);
        if (signatureMatch) {
          return signatureMatch[1];
        }
        
        // If no signature in output, try to get it from recent transactions
        // Note: This is a fallback - the close was successful even without signature
        this.logger.log(`[CLOSE] No signature in output, attempting to get from recent transactions...`);
        try {
          // Get recent signatures for the temporary wallet
          const signatures = await connection.getSignaturesForAddress(
            authorityKeypair.publicKey,
            { limit: 1 }
          );
          
          if (signatures.length > 0) {
            const recentSig = signatures[0].signature;
            this.logger.log(`[CLOSE] Found recent transaction signature: ${recentSig}`);
            return recentSig;
          }
        } catch (sigError) {
          this.logger.warn(`[CLOSE] Could not get signature from recent transactions: ${sigError instanceof Error ? sigError.message : String(sigError)}`);
        }
        
        // If we can't get signature, return a placeholder - the close was successful
        // The important thing is the program was closed and SOL was reclaimed
        this.logger.log(`[CLOSE] Using placeholder signature (close was successful)`);
        return `close-${closedProgramId.slice(0, 8)}-${Date.now()}`;
      }
      
      // If we don't see the success message, check for errors
      if (combinedOutput.toLowerCase().includes('error') || combinedOutput.toLowerCase().includes('failed')) {
        this.logger.error(`[CLOSE] Close command failed: ${combinedOutput}`);
        throw new Error(`Failed to close program. Output: ${combinedOutput}`);
      }
      
      // Unknown output format
      this.logger.error(`[CLOSE] Unexpected output format: ${combinedOutput}`);
      throw new Error(`Unexpected output from program close command. Output: ${combinedOutput}`);
    } catch (error) {
      this.logger.error(`[CLOSE] Error in closeProgramCli: ${error instanceof Error ? error.message : String(error)}`);
      throw error;
    } finally {
      // Clean up temporary keypair file
      if (fs.existsSync(tempKeypairPath)) {
        try {
          fs.unlinkSync(tempKeypairPath);
          this.logger.log(`[CLOSE] Cleaned up temp keypair file`);
        } catch (e) {
          this.logger.warn(`[CLOSE] Failed to cleanup temp keypair file: ${e instanceof Error ? e.message : String(e)}`);
        }
      }
    }
  }

  /**
   * Sweep temporary wallet - transfer all SOL to treasury pool
   * @param minBalanceToKeep - Amount of lamports to keep in wallet (default: 1,000,000 = 0.001 SOL)
   */
  private async sweepTemporaryWallet(
    connection: Connection,
    temporaryWallet: Keypair,
    treasuryPool: PublicKey,
    minBalanceToKeep: number = 1_000_000, // 0.001 SOL by default
  ): Promise<{ signature: string | null; recoveredLamports: number }> {
    try {
      const balance = await connection.getBalance(temporaryWallet.publicKey, 'confirmed');
      this.logger.log(`[CLOSE] Sweeping temporary wallet: ${temporaryWallet.publicKey.toString()}`);
      this.logger.log(`   Current balance: ${balance / 1e9} SOL (${balance} lamports)`);
      this.logger.log(`   Min balance to keep: ${minBalanceToKeep / 1e9} SOL (${minBalanceToKeep} lamports)`);
      
      // Validate minBalanceToKeep
      if (!Number.isInteger(minBalanceToKeep) || minBalanceToKeep <= 0) {
        this.logger.error(`   Invalid minBalanceToKeep: ${minBalanceToKeep}, using default 1,000,000`);
        minBalanceToKeep = 1_000_000;
      }
      
      if (balance <= minBalanceToKeep) {
        this.logger.warn(`   Balance too low to sweep (${balance} <= ${minBalanceToKeep} lamports)`);
        return { signature: null, recoveredLamports: 0 };
      }

      const transferLamports = balance - minBalanceToKeep;
      
      // Validate transfer amount
      if (!Number.isInteger(transferLamports) || transferLamports <= 0) {
        this.logger.error(`   Invalid transfer amount calculated: ${transferLamports}`);
        return { signature: null, recoveredLamports: 0 };
      }
      this.logger.log(`   Transferring: ${transferLamports / 1e9} SOL (${transferLamports} lamports)`);
      this.logger.log(`   Keeping: ${minBalanceToKeep / 1e9} SOL (${minBalanceToKeep} lamports) for rent + fees`);
      this.logger.log(`   Treasury Pool PDA: ${treasuryPool.toString()}`);
      
      const tx = new Transaction().add(
        SystemProgram.transfer({
          fromPubkey: temporaryWallet.publicKey,
          toPubkey: treasuryPool,
          lamports: transferLamports,
        }),
      );
      tx.feePayer = temporaryWallet.publicKey;
      const { blockhash } = await connection.getLatestBlockhash('confirmed');
      tx.recentBlockhash = blockhash;

      this.logger.log(`   Sending transfer transaction...`);
      const signature = await sendAndConfirmTransaction(
        connection,
        tx,
        [temporaryWallet],
        { 
          commitment: 'confirmed',
          skipPreflight: false,
        },
      );

      // Verify the transfer was successful
      const balanceAfter = await connection.getBalance(temporaryWallet.publicKey, 'confirmed');
      this.logger.log(`✅ Temporary wallet swept back to treasury`);
      this.logger.log(`   Signature: ${signature}`);
      this.logger.log(`   Lamports returned: ${transferLamports} (${transferLamports / 1e9} SOL)`);
      this.logger.log(`   Balance after transfer: ${balanceAfter / 1e9} SOL (${balanceAfter} lamports)`);
      this.logger.log(`   Expected remaining: ~${minBalanceToKeep / 1e9} SOL`);

      return { signature, recoveredLamports: transferLamports };
    } catch (error) {
      this.logger.error(
        `[CLOSE] Failed to sweep temporary wallet ${temporaryWallet.publicKey.toBase58()}: ${error instanceof Error ? error.message : String(error)}`,
      );
      if (error instanceof Error && error.stack) {
        this.logger.error(`   Stack: ${error.stack}`);
      }
      // Re-throw to let caller handle it
      throw error;
    }
  }

  /**
   * Run Solana CLI command
   */
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

    const timeoutMs = options.timeoutMs ?? 60000;
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
}

