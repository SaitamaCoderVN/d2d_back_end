import { Injectable, Logger, OnModuleInit, OnModuleDestroy } from '@nestjs/common';
import { SupabaseService } from '../supabase/supabase.service';
import { PoolService } from '../pool/pool.service';
import { LAMPORTS_PER_SOL } from '@solana/web3.js';

// Point calculation constants
const MIN_DEPOSIT_FOR_POINTS = 0.01 * LAMPORTS_PER_SOL; // 0.01 SOL minimum
const POINTS_PER_SOL_PER_HOUR = 1; // 1 point per SOL per hour
const POINTS_PER_SOL_PER_DAY = POINTS_PER_SOL_PER_HOUR * 24; // 24 points per SOL per day

export interface BackerPoints {
  wallet_address: string;
  total_points: number;
  current_deposited_amount: number;
  last_calculated_at: string;
  last_deposited_amount: number;
  created_at: string;
  updated_at: string;
}

export interface PointCalculationResult {
  pointsEarned: number;
  timeElapsedSeconds: number;
  depositedAmount: number;
}

@Injectable()
export class PointsService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(PointsService.name);
  private syncInterval: NodeJS.Timeout | null = null;

  constructor(
    private readonly supabaseService: SupabaseService,
    private readonly poolService: PoolService,
  ) {}

  /**
   * Start periodic sync of points (every hour)
   */
  onModuleInit() {
    // Sync points every hour (3600000 ms)
    this.syncInterval = setInterval(() => {
      this.syncAllBackerPoints().catch((error) => {
        this.logger.error(`Failed to sync points: ${error.message}`);
      });
    }, 3600000); // 1 hour

    this.logger.log('Points service initialized - periodic sync enabled (every 1 hour)');
    
    // Initial sync after 30 seconds (to let app fully start)
    setTimeout(() => {
      this.syncAllBackerPoints().catch((error) => {
        this.logger.error(`Failed to initial sync points: ${error.message}`);
      });
    }, 30000);
  }

  /**
   * Cleanup interval on module destroy
   */
  onModuleDestroy() {
    if (this.syncInterval) {
      clearInterval(this.syncInterval);
      this.logger.log('Points service destroyed - periodic sync stopped');
    }
  }

  /**
   * Get or create backer points record
   */
  async getOrCreateBackerPoints(walletAddress: string): Promise<BackerPoints | null> {
    const { data: points, error } = await this.supabaseService.getClient()
      .from('backer_points')
      .select('*')
      .eq('wallet_address', walletAddress)
      .single();

    if (error) {
      if (error.code === 'PGRST116') {
        // Create new points record
        return this.createBackerPoints(walletAddress);
      }
      this.logger.error(`Failed to get backer points: ${error.message}`);
      return null;
    }

    return points as BackerPoints;
  }

  /**
   * Create new backer points record
   */
  async createBackerPoints(walletAddress: string): Promise<BackerPoints> {
    const { data: points, error } = await this.supabaseService.getClient()
      .from('backer_points')
      .insert({
        wallet_address: walletAddress,
        total_points: 0,
        current_deposited_amount: 0,
        last_calculated_at: new Date().toISOString(),
        last_deposited_amount: 0,
      })
      .select()
      .single();

    if (error) {
      this.logger.error(`Failed to create backer points: ${error.message}`);
      throw new Error(`Failed to create backer points: ${error.message}`);
    }

    return points as BackerPoints;
  }

  /**
   * Calculate points earned since last calculation
   * Formula: points = (deposited_amount / LAMPORTS_PER_SOL) * (time_elapsed_hours) * POINTS_PER_SOL_PER_HOUR
   */
  async calculatePoints(
    walletAddress: string,
    currentDepositedAmount: number,
  ): Promise<PointCalculationResult> {
    const pointsRecord = await this.getOrCreateBackerPoints(walletAddress);
    
    if (!pointsRecord) {
      throw new Error('Failed to get or create points record');
    }

    // Check if deposit is below minimum threshold
    if (currentDepositedAmount < MIN_DEPOSIT_FOR_POINTS) {
      this.logger.log(
        `Wallet ${walletAddress} has deposit ${currentDepositedAmount} below minimum ${MIN_DEPOSIT_FOR_POINTS}, no points earned`
      );
      return {
        pointsEarned: 0,
        timeElapsedSeconds: 0,
        depositedAmount: currentDepositedAmount,
      };
    }

    const now = new Date();
    const lastCalculated = new Date(pointsRecord.last_calculated_at);
    const timeElapsedSeconds = Math.floor((now.getTime() - lastCalculated.getTime()) / 1000);
    const timeElapsedHours = timeElapsedSeconds / 3600;

    // Use average of last_deposited_amount and current_deposited_amount for calculation
    // This handles cases where deposit changes during the period
    const averageDepositedAmount = 
      (pointsRecord.last_deposited_amount + currentDepositedAmount) / 2;

    // Calculate points: (SOL amount) * (hours elapsed) * (points per SOL per hour)
    const solAmount = averageDepositedAmount / LAMPORTS_PER_SOL;
    const pointsEarned = solAmount * timeElapsedHours * POINTS_PER_SOL_PER_HOUR;

    this.logger.log(
      `Calculated points for ${walletAddress}: ${pointsEarned.toFixed(2)} points ` +
      `(${solAmount.toFixed(4)} SOL × ${timeElapsedHours.toFixed(2)} hours × ${POINTS_PER_SOL_PER_HOUR} points/SOL/hour)`
    );

    return {
      pointsEarned: Math.max(0, pointsEarned), // Ensure non-negative
      timeElapsedSeconds,
      depositedAmount: currentDepositedAmount,
    };
  }

  /**
   * Update points for a backer based on current deposit
   * This should be called when:
   * 1. Backer stakes (deposit increases)
   * 2. Backer unstakes (deposit decreases)
   * 3. Periodic calculation (cron job)
   */
  async updatePoints(walletAddress: string, currentDepositedAmount: number): Promise<BackerPoints> {
    const calculation = await this.calculatePoints(walletAddress, currentDepositedAmount);
    
    const pointsRecord = await this.getOrCreateBackerPoints(walletAddress);
    if (!pointsRecord) {
      throw new Error('Failed to get or create points record');
    }

    // Update total points
    const newTotalPoints = parseFloat(pointsRecord.total_points.toString()) + calculation.pointsEarned;

    // Update points record
    const { data: updated, error } = await this.supabaseService.getClient()
      .from('backer_points')
      .update({
        total_points: newTotalPoints,
        current_deposited_amount: currentDepositedAmount,
        last_calculated_at: new Date().toISOString(),
        last_deposited_amount: currentDepositedAmount,
      })
      .eq('wallet_address', walletAddress)
      .select()
      .single();

    if (error) {
      this.logger.error(`Failed to update points: ${error.message}`);
      throw new Error(`Failed to update points: ${error.message}`);
    }

    // Record point history
    if (calculation.pointsEarned > 0) {
      await this.recordPointHistory(
        walletAddress,
        calculation.pointsEarned,
        calculation.depositedAmount,
        calculation.timeElapsedSeconds,
      );
    }

    this.logger.log(
      `Updated points for ${walletAddress}: ${newTotalPoints.toFixed(2)} total points ` +
      `(+${calculation.pointsEarned.toFixed(2)} points)`
    );

    return updated as BackerPoints;
  }

  /**
   * Record point calculation history
   */
  async recordPointHistory(
    walletAddress: string,
    pointsEarned: number,
    depositedAmount: number,
    timeElapsedSeconds: number,
  ): Promise<void> {
    const { error } = await this.supabaseService.getClient()
      .from('point_history')
      .insert({
        wallet_address: walletAddress,
        points_earned: pointsEarned,
        deposited_amount: depositedAmount,
        time_elapsed_seconds: timeElapsedSeconds,
        calculated_at: new Date().toISOString(),
      });

    if (error) {
      this.logger.error(`Failed to record point history: ${error.message}`);
      // Don't throw - this is not critical
    }
  }

  /**
   * Get points for a wallet address
   */
  async getPoints(walletAddress: string): Promise<{ totalPoints: number; currentDeposit: number }> {
    const pointsRecord = await this.getOrCreateBackerPoints(walletAddress);
    
    if (!pointsRecord) {
      return { totalPoints: 0, currentDeposit: 0 };
    }

    return {
      totalPoints: parseFloat(pointsRecord.total_points.toString()),
      currentDeposit: pointsRecord.current_deposited_amount,
    };
  }

  /**
   * Calculate points in real-time (for API responses)
   * This calculates points up to the current moment without saving to DB
   * Used for displaying accurate points on frontend
   */
  async calculatePointsRealTime(
    walletAddress: string,
    currentDepositedAmount: number,
  ): Promise<{ totalPoints: number; pointsPerSecond: number }> {
    const pointsRecord = await this.getOrCreateBackerPoints(walletAddress);
    
    if (!pointsRecord) {
      return { totalPoints: 0, pointsPerSecond: 0 };
    }

    // Check if deposit is below minimum threshold
    if (currentDepositedAmount < MIN_DEPOSIT_FOR_POINTS) {
      return {
        totalPoints: parseFloat(pointsRecord.total_points.toString()),
        pointsPerSecond: 0,
      };
    }

    const now = new Date();
    const lastCalculated = new Date(pointsRecord.last_calculated_at);
    const timeElapsedSeconds = Math.floor((now.getTime() - lastCalculated.getTime()) / 1000);
    const timeElapsedHours = timeElapsedSeconds / 3600;

    // Use average of last_deposited_amount and current_deposited_amount
    const averageDepositedAmount = 
      (pointsRecord.last_deposited_amount + currentDepositedAmount) / 2;

    // Calculate points earned since last calculation
    const solAmount = averageDepositedAmount / LAMPORTS_PER_SOL;
    const pointsEarned = solAmount * timeElapsedHours * POINTS_PER_SOL_PER_HOUR;

    // Calculate points per second for frontend animation
    const currentSolAmount = currentDepositedAmount / LAMPORTS_PER_SOL;
    const pointsPerSecond = currentSolAmount * (POINTS_PER_SOL_PER_HOUR / 3600);

    // Total points = stored points + newly earned points
    const basePoints = parseFloat(pointsRecord.total_points.toString());
    const totalPoints = basePoints + Math.max(0, pointsEarned);

    return {
      totalPoints,
      pointsPerSecond,
    };
  }

  /**
   * Sync points for all active backers
   * This should be called periodically (cron job)
   * Fetches current deposit from on-chain for accuracy
   */
  async syncAllBackerPoints(): Promise<void> {
    this.logger.log('Starting sync of all backer points...');

    try {
      // Get all active backers from database
      const { data: backers, error } = await this.supabaseService.getClient()
        .from('backers')
        .select('wallet_address, deposited_amount, is_active')
        .eq('is_active', true)
        .gt('deposited_amount', 0);

      if (error) {
        this.logger.error(`Failed to fetch backers: ${error.message}`);
        return;
      }

      if (!backers || backers.length === 0) {
        this.logger.log('No active backers found');
        return;
      }

      this.logger.log(`Found ${backers.length} active backers, updating points...`);

      // Update points for each backer
      // Note: We use database deposited_amount as fallback, but ideally should fetch from on-chain
      for (const backer of backers) {
        try {
          // Use database value for now
          // In the future, we can fetch from on-chain for more accuracy
          await this.updatePoints(
            backer.wallet_address,
            backer.deposited_amount,
          );
        } catch (error) {
          this.logger.error(
            `Failed to update points for ${backer.wallet_address}: ${error.message}`
          );
          // Continue with other backers
        }
      }

      this.logger.log('Completed sync of all backer points');
    } catch (error) {
      this.logger.error(`Failed to sync backer points: ${error.message}`);
    }
  }

  /**
   * Handle stake event - update points when backer stakes
   */
  async handleStake(walletAddress: string, newDepositAmount: number): Promise<void> {
    this.logger.log(`Handling stake for ${walletAddress}, new deposit: ${newDepositAmount}`);
    
    // First, calculate points for the previous deposit amount
    const pointsRecord = await this.getOrCreateBackerPoints(walletAddress);
    if (pointsRecord && pointsRecord.current_deposited_amount > 0) {
      // Calculate points for the period before the new stake
      await this.updatePoints(walletAddress, pointsRecord.current_deposited_amount);
    }

    // Then update to new deposit amount
    await this.updatePoints(walletAddress, newDepositAmount);
  }

  /**
   * Handle unstake event - update points when backer unstakes
   */
  async handleUnstake(walletAddress: string, newDepositAmount: number): Promise<void> {
    this.logger.log(`Handling unstake for ${walletAddress}, new deposit: ${newDepositAmount}`);
    
    // Calculate points for the period before unstake
    const pointsRecord = await this.getOrCreateBackerPoints(walletAddress);
    if (pointsRecord && pointsRecord.current_deposited_amount > 0) {
      await this.updatePoints(walletAddress, pointsRecord.current_deposited_amount);
    }

    // Update to new deposit amount (may be 0 or below minimum)
    await this.updatePoints(walletAddress, newDepositAmount);
  }
}

