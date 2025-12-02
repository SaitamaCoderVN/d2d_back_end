import { Controller, Get, Param, Post, Logger } from '@nestjs/common';
import { PointsService } from './points.service';

@Controller('points')
export class PointsController {
  private readonly logger = new Logger(PointsController.name);

  constructor(private readonly pointsService: PointsService) {}

  /**
   * Get points for a wallet address
   * GET /api/points/:walletAddress
   */
  @Get(':walletAddress')
  async getPoints(@Param('walletAddress') walletAddress: string) {
    try {
      const points = await this.pointsService.getPoints(walletAddress);
      
      // Calculate points with current timestamp for real-time accuracy
      const pointsWithTimestamp = await this.pointsService.calculatePointsRealTime(
        walletAddress,
        points.currentDeposit
      );
      
      return {
        success: true,
        data: {
          walletAddress,
          totalPoints: pointsWithTimestamp.totalPoints,
          currentDeposit: points.currentDeposit,
          currentDepositSOL: points.currentDeposit / 1e9,
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

