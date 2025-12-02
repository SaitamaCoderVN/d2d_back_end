import { Injectable, Logger } from '@nestjs/common';
import { Connection, PublicKey, ParsedTransactionWithMeta, LAMPORTS_PER_SOL } from '@solana/web3.js';
import { ConfigService } from '../config/config.service';

export interface TransactionVerification {
  isValid: boolean;
  fromAddress?: string;
  toAddress?: string;
  amount?: number;
  blockTime?: number;
  slot?: number;
  error?: string;
}

@Injectable()
export class TransactionService {
  private readonly logger = new Logger(TransactionService.name);
  private devnetConnection: Connection;
  private mainnetConnection: Connection;
  private currentConnection: Connection;

  constructor(private configService: ConfigService) {
    // Defer initialization - will be done lazily when needed
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
      
      this.logger.log(`🔗 Transaction Service initialized for ${config.environment.toUpperCase()}`);
    }
  }

  /**
   * Verify a transaction signature exists and matches expected criteria
   */
  async verifyTransaction(
    signature: string,
    expectedFrom: string,
    expectedTo: string,
    expectedAmount: number,
    network?: 'devnet' | 'mainnet',
  ): Promise<TransactionVerification> {
    this.ensureInitialized();
    
    // Use current environment if network not specified
    const targetNetwork = network || this.configService.getEnvironment();
    const connection = targetNetwork === 'devnet' ? this.devnetConnection : this.mainnetConnection;

    try {
      this.logger.log(`Verifying transaction: ${signature}`);
      this.logger.log(`  Network: ${targetNetwork}`);
      this.logger.log(`  Expected from: ${expectedFrom}`);
      this.logger.log(`  Expected to: ${expectedTo}`);
      this.logger.log(`  Expected amount: ${expectedAmount} lamports`);

      // Fetch transaction with retries
      const transaction = await this.fetchTransactionWithRetry(connection, signature);

      if (!transaction) {
        return {
          isValid: false,
          error: 'Transaction not found',
        };
      }

      // Check if transaction failed
      if (transaction.meta?.err) {
        return {
          isValid: false,
          error: `Transaction failed: ${JSON.stringify(transaction.meta.err)}`,
        };
      }

      // Parse transaction to extract transfer details
      const transferDetails = this.extractTransferDetails(transaction);

      if (!transferDetails) {
        return {
          isValid: false,
          error: 'Could not extract transfer details from transaction',
        };
      }

      // Verify from address
      if (transferDetails.from !== expectedFrom) {
        return {
          isValid: false,
          fromAddress: transferDetails.from,
          toAddress: transferDetails.to,
          amount: transferDetails.amount,
          error: `From address mismatch. Expected: ${expectedFrom}, Got: ${transferDetails.from}`,
        };
      }

      // Verify to address
      if (transferDetails.to !== expectedTo) {
        return {
          isValid: false,
          fromAddress: transferDetails.from,
          toAddress: transferDetails.to,
          amount: transferDetails.amount,
          error: `To address mismatch. Expected: ${expectedTo}, Got: ${transferDetails.to}`,
        };
      }

      // Verify amount (allow small variance for fees)
      const amountDifference = Math.abs(transferDetails.amount - expectedAmount);
      const tolerance = 0.001 * LAMPORTS_PER_SOL; // 0.001 SOL tolerance

      if (amountDifference > tolerance) {
        return {
          isValid: false,
          fromAddress: transferDetails.from,
          toAddress: transferDetails.to,
          amount: transferDetails.amount,
          error: `Amount mismatch. Expected: ${expectedAmount}, Got: ${transferDetails.amount}`,
        };
      }

      this.logger.log('✅ Transaction verified successfully');
      return {
        isValid: true,
        fromAddress: transferDetails.from,
        toAddress: transferDetails.to,
        amount: transferDetails.amount,
        blockTime: transaction.blockTime || undefined,
        slot: transaction.slot,
      };
    } catch (error) {
      this.logger.error(`Transaction verification failed: ${error.message}`);
      return {
        isValid: false,
        error: `Verification error: ${error.message}`,
      };
    }
  }

  /**
   * Fetch transaction with retry logic
   */
  private async fetchTransactionWithRetry(
    connection: Connection,
    signature: string,
    maxRetries: number = 5,
  ): Promise<ParsedTransactionWithMeta | null> {
    for (let i = 0; i < maxRetries; i++) {
      try {
        const tx = await connection.getParsedTransaction(signature, {
          commitment: 'confirmed',
          maxSupportedTransactionVersion: 0,
        });

        if (tx) {
          return tx;
        }

        // Wait before retry
        await new Promise(resolve => setTimeout(resolve, 1000 * (i + 1)));
      } catch (error) {
        this.logger.warn(`Retry ${i + 1}/${maxRetries} failed: ${error.message}`);
        if (i === maxRetries - 1) {
          throw error;
        }
        await new Promise(resolve => setTimeout(resolve, 1000 * (i + 1)));
      }
    }

    return null;
  }

  /**
   * Extract transfer details from parsed transaction
   * Returns all transfers in the transaction (for multi-transfer support)
   */
  private extractTransferDetails(transaction: ParsedTransactionWithMeta): {
    from: string;
    to: string;
    amount: number;
  } | null {
    try {
      // Look for system program transfer instruction
      const instructions = transaction.transaction.message.instructions;

      // Find first transfer (for backward compatibility)
      for (const instruction of instructions) {
        if ('parsed' in instruction && instruction.program === 'system') {
          const parsed = instruction.parsed;
          
          if (parsed.type === 'transfer') {
            return {
              from: parsed.info.source,
              to: parsed.info.destination,
              amount: parsed.info.lamports,
            };
          }
        }
      }

      return null;
    } catch (error) {
      this.logger.error(`Failed to extract transfer details: ${error.message}`);
      return null;
    }
  }

  /**
   * Extract all transfer details from parsed transaction
   * Returns array of all transfers (for multi-transfer verification)
   */
  private extractAllTransferDetails(transaction: ParsedTransactionWithMeta): Array<{
    from: string;
    to: string;
    amount: number;
  }> {
    try {
      const instructions = transaction.transaction.message.instructions;
      const transfers: Array<{ from: string; to: string; amount: number }> = [];

      for (const instruction of instructions) {
        if ('parsed' in instruction && instruction.program === 'system') {
          const parsed = instruction.parsed;
          
          if (parsed.type === 'transfer') {
            transfers.push({
              from: parsed.info.source,
              to: parsed.info.destination,
              amount: parsed.info.lamports,
            });
          }
        }
      }

      return transfers;
    } catch (error) {
      this.logger.error(`Failed to extract all transfer details: ${error.message}`);
      return [];
    }
  }

  /**
   * Verify multiple transfers in a single transaction
   * Used when developer pays fees to multiple pools (RewardPool + PlatformPool)
   */
  async verifyMultipleTransfers(
    signature: string,
    expectedFrom: string,
    expectedTransfers: Array<{ to: string; amount: number }>,
    network?: 'devnet' | 'mainnet',
  ): Promise<TransactionVerification> {
    this.ensureInitialized();
    
    const targetNetwork = network || this.configService.getEnvironment();
    const connection = targetNetwork === 'devnet' ? this.devnetConnection : this.mainnetConnection;

    try {
      this.logger.log(`Verifying multiple transfers in transaction: ${signature}`);
      this.logger.log(`  Network: ${targetNetwork}`);
      this.logger.log(`  Expected from: ${expectedFrom}`);
      this.logger.log(`  Expected transfers: ${expectedTransfers.length}`);

      const transaction = await this.fetchTransactionWithRetry(connection, signature);

      if (!transaction) {
        return {
          isValid: false,
          error: 'Transaction not found',
        };
      }

      if (transaction.meta?.err) {
        return {
          isValid: false,
          error: `Transaction failed: ${JSON.stringify(transaction.meta.err)}`,
        };
      }

      const transfers = this.extractAllTransferDetails(transaction);

      // Log all found transfers for debugging
      this.logger.log(`   Found ${transfers.length} transfer(s) in transaction:`);
      transfers.forEach((t, i) => {
        this.logger.log(`     [${i + 1}] From: ${t.from.slice(0, 8)}...${t.from.slice(-8)} → To: ${t.to} (${t.amount / 1e9} SOL)`);
      });

      // Filter out transfers with 0 amount (they might be filtered out or not sent)
      const nonZeroExpectedTransfers = expectedTransfers.filter(t => t.amount > 0);
      
      if (transfers.length < nonZeroExpectedTransfers.length) {
        this.logger.warn(`   Expected ${nonZeroExpectedTransfers.length} non-zero transfers, found ${transfers.length}`);
        this.logger.warn(`   Expected transfers:`);
        nonZeroExpectedTransfers.forEach((t, i) => {
          this.logger.warn(`     [${i + 1}] To: ${t.to} (${t.amount / 1e9} SOL)`);
        });
        
        // If we have fewer transfers than expected, check if amounts match when combined
        const totalExpected = nonZeroExpectedTransfers.reduce((sum, t) => sum + t.amount, 0);
        const totalFound = transfers
          .filter(t => t.from === expectedFrom)
          .reduce((sum, t) => sum + t.amount, 0);
        
        const totalDifference = Math.abs(totalFound - totalExpected);
        const tolerance = 0.001 * LAMPORTS_PER_SOL;
        
        if (totalDifference <= tolerance) {
          this.logger.log(`   ✅ Total amount matches (${totalFound / 1e9} SOL), allowing combined transfer`);
          // Allow if total matches (user might have sent combined payment)
        } else {
        return {
          isValid: false,
            error: `Expected ${nonZeroExpectedTransfers.length} transfers, found ${transfers.length}. Total amount mismatch: Expected ${totalExpected / 1e9} SOL, Got ${totalFound / 1e9} SOL`,
        };
        }
      }

      // Verify each expected transfer (only non-zero amounts)
      for (const expected of nonZeroExpectedTransfers) {
        const found = transfers.find(
          t => t.from === expectedFrom && t.to === expected.to
        );

        if (!found) {
          // Check if this transfer might be combined with another
          const totalToExpectedAddress = transfers
            .filter(t => t.from === expectedFrom && t.to === expected.to)
            .reduce((sum, t) => sum + t.amount, 0);
          
          if (totalToExpectedAddress === 0) {
            // Check if amount is 0 (should be skipped)
            if (expected.amount === 0) {
              this.logger.log(`   Skipping zero-amount transfer to ${expected.to}`);
              continue;
            }
            
          return {
            isValid: false,
              error: `Transfer to ${expected.to} not found. Expected: ${expected.amount / 1e9} SOL`,
          };
        }

          // If we found transfers to this address but amount doesn't match exactly,
          // check if it's close enough
          const amountDifference = Math.abs(totalToExpectedAddress - expected.amount);
          const tolerance = 0.001 * LAMPORTS_PER_SOL;
          
          if (amountDifference > tolerance) {
            return {
              isValid: false,
              error: `Amount mismatch for ${expected.to}. Expected: ${expected.amount / 1e9} SOL, Got: ${totalToExpectedAddress / 1e9} SOL`,
            };
          }
        } else {
        const amountDifference = Math.abs(found.amount - expected.amount);
        const tolerance = 0.001 * LAMPORTS_PER_SOL;

        if (amountDifference > tolerance) {
          return {
            isValid: false,
              error: `Amount mismatch for ${expected.to}. Expected: ${expected.amount / 1e9} SOL, Got: ${found.amount / 1e9} SOL`,
          };
          }
        }
      }

      this.logger.log('✅ All transfers verified successfully');
      return {
        isValid: true,
        fromAddress: expectedFrom,
        amount: expectedTransfers.reduce((sum, t) => sum + t.amount, 0),
      };
    } catch (error) {
      this.logger.error(`Multiple transfer verification failed: ${error.message}`);
      return {
        isValid: false,
        error: `Verification error: ${error.message}`,
      };
    }
  }

  /**
   * Check if a transaction exists (simple existence check)
   */
  async transactionExists(
    signature: string,
    network: 'devnet' | 'mainnet' = 'mainnet',
  ): Promise<boolean> {
    this.ensureInitialized();
    const connection = network === 'devnet' ? this.devnetConnection : this.mainnetConnection;

    try {
      const tx = await connection.getTransaction(signature, {
        commitment: 'confirmed',
        maxSupportedTransactionVersion: 0,
      });

      return tx !== null;
    } catch (error) {
      this.logger.error(`Error checking transaction existence: ${error.message}`);
      return false;
    }
  }

  /**
   * Wait for transaction confirmation
   */
  async waitForConfirmation(
    signature: string,
    network: 'devnet' | 'mainnet' = 'mainnet',
    timeout: number = 60000,
  ): Promise<boolean> {
    this.ensureInitialized();
    const connection = network === 'devnet' ? this.devnetConnection : this.mainnetConnection;
    const startTime = Date.now();

    while (Date.now() - startTime < timeout) {
      try {
        const status = await connection.getSignatureStatus(signature);

        if (status?.value?.confirmationStatus === 'confirmed' || 
            status?.value?.confirmationStatus === 'finalized') {
          this.logger.log(`Transaction ${signature} confirmed`);
          return true;
        }

        if (status?.value?.err) {
          this.logger.error(`Transaction ${signature} failed: ${JSON.stringify(status.value.err)}`);
          return false;
        }

        // Wait before checking again
        await new Promise(resolve => setTimeout(resolve, 2000));
      } catch (error) {
        this.logger.warn(`Error checking transaction status: ${error.message}`);
        await new Promise(resolve => setTimeout(resolve, 2000));
      }
    }

    this.logger.error(`Transaction ${signature} confirmation timeout`);
    return false;
  }

  /**
   * Get connection for devnet
   */
  getDevnetConnection(): Connection {
    this.ensureInitialized();
    return this.devnetConnection;
  }

  /**
   * Get connection for mainnet
   */
  getMainnetConnection(): Connection {
    this.ensureInitialized();
    return this.mainnetConnection;
  }
}

