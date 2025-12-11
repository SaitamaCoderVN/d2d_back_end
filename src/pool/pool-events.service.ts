import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { Connection, PublicKey, Commitment } from '@solana/web3.js';
import { ProgramService } from '../program/program.service';
import { PointsService } from '../points/points.service';
import { SupabaseService } from '../supabase/supabase.service';

/**
 * Pool Events Service
 *
 * Listens to on-chain events and syncs points with backend database
 * This solves the issue where points don't update when users stake/unstake
 */
@Injectable()
export class PoolEventsService implements OnModuleInit {
  private readonly logger = new Logger(PoolEventsService.name);
  private isListening = false;

  constructor(
    private readonly programService: ProgramService,
    private readonly pointsService: PointsService,
    private readonly supabaseService: SupabaseService,
  ) {}

  /**
   * Start listening to on-chain events when module initializes
   */
  async onModuleInit() {
    // Wait a bit before starting to ensure all services are ready
    setTimeout(() => {
      this.startEventListener();
    }, 5000);
  }

  /**
   * Start listening to on-chain Solana logs for stake/unstake events
   */
  private async startEventListener() {
    if (this.isListening) {
      return;
    }

    try {
      const program = this.programService.getProgram();
      const connection = this.programService.getConnection();

      this.logger.log('🎧 Starting event listener for stake/unstake events...');
      this.logger.log(`   Program ID: ${program.programId.toString()}`);

      this.isListening = true;

      // Listen to program logs
      const subscriptionId = connection.onLogs(
        program.programId,
        async (logs, ctx) => {
          try {
            await this.handleProgramLogs(logs);
          } catch (error) {
            this.logger.error(`Error handling program logs: ${error.message}`);
          }
        },
        'confirmed' as Commitment,
      );

      this.logger.log(`✅ Event listener started (subscription ID: ${subscriptionId})`);
      this.logger.log('   Listening for: Deposited, Withdrawn, Claimed events');

    } catch (error) {
      this.logger.error(`Failed to start event listener: ${error.message}`);
      this.isListening = false;
    }
  }

  /**
   * Handle program logs and extract events
   */
  private async handleProgramLogs(logs: any) {
    const logMessages = logs.logs || [];

    // Look for event signatures in logs
    for (const log of logMessages) {
      const logStr = String(log);

      // Check for Deposited event (stake)
      if (logStr.includes('Deposited')) {
        await this.handleDepositEvent(logStr);
      }

      // Check for Withdrawn event (unstake)
      if (logStr.includes('Withdrawn')) {
        await this.handleWithdrawEvent(logStr);
      }

      // Check for Claimed event (claim rewards)
      if (logStr.includes('Claimed')) {
        await this.handleClaimEvent(logStr);
      }
    }
  }

  /**
   * Handle deposit (stake) event
   */
  private async handleDepositEvent(logStr: string) {
    try {
      // Parse event from log (format: "Program log: Deposited { backer: ..., amount: ... }")
      const match = logStr.match(/backer:\s*([A-Za-z0-9]+).*amount:\s*(\d+)/);
      if (!match) return;

      const walletAddress = match[1];
      const newDepositAmount = parseInt(match[2]);

      this.logger.log(`📥 Deposit detected: ${walletAddress.slice(0, 8)}... deposited ${newDepositAmount / 1e9} SOL`);

      // Sync points
      await this.pointsService.handleStake(walletAddress, newDepositAmount);

      // Update backer record in database
      await this.updateBackerInDatabase(walletAddress, newDepositAmount, true);

    } catch (error) {
      this.logger.error(`Error handling deposit event: ${error.message}`);
    }
  }

  /**
   * Handle withdraw (unstake) event
   */
  private async handleWithdrawEvent(logStr: string) {
    try {
      const match = logStr.match(/backer:\s*([A-Za-z0-9]+).*amount:\s*(\d+)/);
      if (!match) return;

      const walletAddress = match[1];
      const newDepositAmount = parseInt(match[2]);

      this.logger.log(`📤 Withdraw detected: ${walletAddress.slice(0, 8)}... withdrew, remaining ${newDepositAmount / 1e9} SOL`);

      // Sync points
      await this.pointsService.handleUnstake(walletAddress, newDepositAmount);

      // Update backer record in database
      const isActive = newDepositAmount > 0;
      await this.updateBackerInDatabase(walletAddress, newDepositAmount, isActive);

    } catch (error) {
      this.logger.error(`Error handling withdraw event: ${error.message}`);
    }
  }

  /**
   * Handle claim rewards event
   */
  private async handleClaimEvent(logStr: string) {
    try {
      const match = logStr.match(/backer:\s*([A-Za-z0-9]+).*amount:\s*(\d+)/);
      if (!match) return;

      const walletAddress = match[1];
      const claimedAmount = parseInt(match[2]);

      this.logger.log(`💰 Claim detected: ${walletAddress.slice(0, 8)}... claimed ${claimedAmount / 1e9} SOL`);

      // Note: Points calculation is not affected by claims, only by deposit changes
      // But we could track claim history here if needed

    } catch (error) {
      this.logger.error(`Error handling claim event: ${error.message}`);
    }
  }

  /**
   * Update backer record in Supabase database
   */
  private async updateBackerInDatabase(
    walletAddress: string,
    depositedAmount: number,
    isActive: boolean,
  ): Promise<void> {
    try {
      const { error } = await this.supabaseService.getClient()
        .from('backers')
        .upsert({
          wallet_address: walletAddress,
          deposited_amount: depositedAmount,
          is_active: isActive,
          updated_at: new Date().toISOString(),
        }, {
          onConflict: 'wallet_address',
        });

      if (error) {
        this.logger.error(`Failed to update backer in database: ${error.message}`);
      } else {
        this.logger.log(`✅ Updated backer record in database: ${walletAddress.slice(0, 8)}...`);
      }
    } catch (error) {
      this.logger.error(`Error updating backer in database: ${error.message}`);
    }
  }

  /**
   * Manual sync - fetch all backers from on-chain and sync points
   * This can be called via API endpoint for admin
   */
  async manualSyncAllBackers(): Promise<{ success: boolean; syncedCount: number }> {
    this.logger.log('🔄 Starting manual sync of all backers...');

    try {
      const program = this.programService.getProgram();

      // Fetch all BackerDeposit accounts
      let accounts: any[] = [];
      try {
        accounts = await (program.account as any).backerDeposit?.all() || [];
      } catch {
        accounts = await (program.account as any).lenderStake?.all() || [];
      }

      this.logger.log(`   Found ${accounts.length} backer accounts`);

      let syncedCount = 0;
      for (const account of accounts) {
        try {
          const acc = account.account;
          const backerPubkey = acc.backer instanceof PublicKey
            ? acc.backer.toString()
            : String(acc.backer);

          const depositedAmount = (acc.depositedAmount as any)?.toNumber
            ? (acc.depositedAmount as any).toNumber()
            : Number(acc.depositedAmount || 0);

          // Sync points
          await this.pointsService.updatePoints(backerPubkey, depositedAmount);

          // Update database
          await this.updateBackerInDatabase(
            backerPubkey,
            depositedAmount,
            acc.isActive || false,
          );

          syncedCount++;
        } catch (error) {
          this.logger.error(`Error syncing backer: ${error.message}`);
        }
      }

      this.logger.log(`✅ Manual sync completed: ${syncedCount} backers synced`);

      return { success: true, syncedCount };
    } catch (error) {
      this.logger.error(`Manual sync failed: ${error.message}`);
      return { success: false, syncedCount: 0 };
    }
  }
}