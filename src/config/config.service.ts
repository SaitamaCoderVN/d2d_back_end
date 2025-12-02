import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { PublicKey } from '@solana/web3.js';
import * as fs from 'fs';
import { getD2DProgramId } from '../program/utils/pda.utils';

export interface AppConfig {
  programId: string;
  devnetRpc: string;
  mainnetRpc: string;
  currentRpc: string;
  environment: 'devnet' | 'mainnet';
  serviceFeePercentage: number;
  monthlyFeeLamports: number;
  // Note: No treasury wallet needed - Treasury Pool PDA holds all SOL
}

@Injectable()
export class ConfigService implements OnModuleInit {
  private readonly logger = new Logger(ConfigService.name);
  private config: AppConfig;

  async onModuleInit() {
    await this.initialize();
  }

  private async initialize() {
    try {
      // Determine environment (devnet or mainnet)
      const environment = (process.env.SOLANA_ENV || 'devnet').toLowerCase() as 'devnet' | 'mainnet';
      
      // Get program ID from IDL (single source of truth)
      // Allow override via environment variable for flexibility
      const programId = process.env.D2D_PROGRAM_ID || getD2DProgramId().toString();

      // RPC endpoints
      const devnetRpc = process.env.SOLANA_DEVNET_RPC || 'https://api.devnet.solana.com';
      const mainnetRpc = process.env.SOLANA_MAINNET_RPC || 'https://api.mainnet-beta.solana.com';
      const currentRpc = environment === 'devnet' ? devnetRpc : mainnetRpc;

      // Validate program ID
      try {
        new PublicKey(programId);
      } catch (error) {
        throw new Error(`Invalid D2D_PROGRAM_ID format: ${programId}`);
      }

      this.config = {
        programId,
        devnetRpc,
        mainnetRpc,
        currentRpc,
        environment,
        serviceFeePercentage: parseFloat(process.env.SERVICE_FEE_PERCENTAGE || '0.5'),
        monthlyFeeLamports: parseInt(process.env.MONTHLY_FEE_LAMPORTS || '1000000000', 10),
      };

      this.logger.log('✅ Config Service initialized');
      this.logger.log(`   🌐 Environment: ${environment.toUpperCase()}`);
      this.logger.log(`   🔗 RPC: ${currentRpc}`);
      this.logger.log(`   📦 Program ID: ${this.config.programId}`);
      this.logger.log(`   💵 Service Fee: ${this.config.serviceFeePercentage}%`);
      this.logger.log(`   💰 Treasury: Treasury Pool PDA (program-owned account)`);
      
      if (environment === 'devnet') {
        this.logger.log('   🧪 DEVNET MODE: Using test SOL only');
      } else {
        this.logger.warn('   ⚠️  MAINNET MODE: Real SOL transactions!');
      }
    } catch (error) {
      this.logger.error(`❌ Failed to initialize config service: ${error.message}`);
      throw error;
    }
  }

  /**
   * Get application configuration
   */
  getConfig(): AppConfig {
    if (!this.config) {
      throw new Error('Config service not initialized');
    }
    return this.config;
  }

  /**
   * Get D2D program ID
   */
  getProgramId(): string {
    return this.config.programId;
  }

  /**
   * Get service fee percentage
   */
  getServiceFeePercentage(): number {
    return this.config.serviceFeePercentage;
  }

  /**
   * Get monthly fee in lamports
   */
  getMonthlyFeeLamports(): number {
    return this.config.monthlyFeeLamports;
  }

  /**
   * Get Solana RPC endpoints
   */
  getRpcEndpoints(): { devnet: string; mainnet: string } {
    return {
      devnet: this.config.devnetRpc,
      mainnet: this.config.mainnetRpc,
    };
  }

  /**
   * Get current RPC endpoint based on environment
   */
  getCurrentRpc(): string {
    return this.config.currentRpc;
  }

  /**
   * Get current environment
   */
  getEnvironment(): 'devnet' | 'mainnet' {
    return this.config.environment;
  }

  /**
   * Check if running in devnet mode
   */
  isDevnet(): boolean {
    return this.config.environment === 'devnet';
  }

  /**
   * Check if running in mainnet mode
   */
  isMainnet(): boolean {
    return this.config.environment === 'mainnet';
  }

  /**
   * Health check
   */
  healthCheck(): boolean {
    return !!this.config;
  }
}

