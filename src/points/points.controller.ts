import { Controller, Get, Param, Post, Logger, Inject, forwardRef } from '@nestjs/common';
import { PointsService } from './points.service';
import { ProgramService } from '../program/program.service';
import { PublicKey } from '@solana/web3.js';

@Controller('points')
export class PointsController {
  private readonly logger = new Logger(PointsController.name);

  constructor(
    private readonly pointsService: PointsService,
    @Inject(forwardRef(() => ProgramService))
    private readonly programService: ProgramService,
  ) {}

  /**
   * Get points for a wallet address
   * GET /api/points/:walletAddress
   * Fetches current deposit from on-chain for real-time accuracy
   */
  @Get(':walletAddress')
  async getPoints(@Param('walletAddress') walletAddress: string) {
    try {
      // Get points from database
      const points = await this.pointsService.getPoints(walletAddress);

      // Try to get current deposit from on-chain for real-time data
      let currentDepositLamports = points.currentDeposit;
      try {
        const program = this.programService.getProgram();
        const wallet = new PublicKey(walletAddress);

        // Derive LenderStake PDA
        const [lenderStakePDA] = PublicKey.findProgramAddressSync(
          [Buffer.from('lender_stake'), wallet.toBuffer()],
          program.programId
        );

        // Fetch stake account from blockchain
        // Try backerDeposit first, fallback to lenderStake (legacy)
        let stakeAccount: any = null;
        try {
          stakeAccount = await (program.account as any).backerDeposit.fetch(lenderStakePDA);
        } catch {
          stakeAccount = await (program.account as any).lenderStake.fetch(lenderStakePDA);
        }
        currentDepositLamports = stakeAccount?.depositedAmount?.toNumber() || 0;

        this.logger.log(
          `Fetched on-chain deposit for ${walletAddress.slice(0, 8)}...: ${currentDepositLamports / 1e9} SOL`
        );
      } catch (onChainError) {
        // If on-chain fetch fails, use database value
        this.logger.warn(
          `Could not fetch on-chain deposit for ${walletAddress}, using DB value: ${onChainError.message}`
        );
      }

      // Calculate points with current timestamp for real-time accuracy
      const pointsWithTimestamp = await this.pointsService.calculatePointsRealTime(
        walletAddress,
        currentDepositLamports
      );

      return {
        success: true,
        data: {
          walletAddress,
          totalPoints: pointsWithTimestamp.totalPoints,
          currentDeposit: currentDepositLamports,
          currentDepositSOL: currentDepositLamports / 1e9,
          lastSyncTime: new Date().toISOString(),
        },
      };
    } catch (error) {
      this.logger.error(`Failed to get points: ${error.message}`);
      return {
        success: false,
        error: error.message,
      };
    }
  }

  /**
   * Sync points for a specific wallet (manual trigger)
   * POST /api/points/:walletAddress/sync
   */
  @Post(':walletAddress/sync')
  async syncPoints(@Param('walletAddress') walletAddress: string) {
    try {
      // Get current deposit from on-chain
      // For now, we'll use the points service to sync
      // In the future, we can fetch from on-chain here
      const points = await this.pointsService.getPoints(walletAddress);
      
      // Update points based on current deposit
      await this.pointsService.updatePoints(walletAddress, points.currentDeposit);
      
      const updatedPoints = await this.pointsService.getPoints(walletAddress);
      
      return {
        success: true,
        data: {
          walletAddress,
          totalPoints: updatedPoints.totalPoints,
          currentDeposit: updatedPoints.currentDeposit,
          currentDepositSOL: updatedPoints.currentDeposit / 1e9,
        },
      };
    } catch (error) {
      this.logger.error(`Failed to sync points: ${error.message}`);
      return {
        success: false,
        error: error.message,
      };
    }
  }
}

