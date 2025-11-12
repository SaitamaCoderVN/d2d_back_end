import { Controller, Get } from '@nestjs/common';
import { ApiTags, ApiOperation, ApiResponse } from '@nestjs/swagger';
import { ConfigService } from './config.service';

export class ConfigResponseDto {
  programId: string;
  serviceFeePercentage: number;
  monthlyFeeLamports: number;
  environment: 'devnet' | 'mainnet';
  currentRpc: string;
  rpcEndpoints: {
    devnet: string;
    mainnet: string;
  };
  // Note: No treasury wallet - Treasury Pool PDA handles all SOL
}

@ApiTags('config')
@Controller('config')
export class ConfigController {
  constructor(private readonly configService: ConfigService) {}

  /**
   * Get application configuration (treasury wallet, program ID, etc.)
   */
  @Get('treasury')
  @ApiOperation({ summary: 'Get treasury wallet and program configuration' })
  @ApiResponse({
    status: 200,
    description: 'Configuration details',
    type: ConfigResponseDto,
  })
  getTreasuryConfig(): ConfigResponseDto {
    const config = this.configService.getConfig();
    return {
      programId: config.programId,
      serviceFeePercentage: config.serviceFeePercentage,
      monthlyFeeLamports: config.monthlyFeeLamports,
      environment: config.environment,
      currentRpc: config.currentRpc,
      rpcEndpoints: this.configService.getRpcEndpoints(),
    };
  }

  /**
   * Health check endpoint
   */
  @Get('health')
  @ApiOperation({ summary: 'Check config service health' })
  @ApiResponse({ status: 200, description: 'Service is healthy' })
  healthCheck(): { status: string; healthy: boolean } {
    const healthy = this.configService.healthCheck();
    return {
      status: healthy ? 'ok' : 'error',
      healthy,
    };
  }
}

