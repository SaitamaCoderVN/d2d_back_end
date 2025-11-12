import { 
  Controller, 
  Get, 
  Post, 
  Body, 
  Param, 
  Query, 
  HttpCode, 
  HttpStatus,
  NotFoundException 
} from '@nestjs/common';
import { ApiTags, ApiOperation, ApiResponse } from '@nestjs/swagger';
import { DeploymentService } from './deployment.service';
import { VerifyProgramDto, VerifyProgramResponseDto } from './dto/verify-program.dto';
import { CalculateCostDto, CostBreakdownDto } from './dto/calculate-cost.dto';
import { ExecuteDeployDto, ExecuteDeployResponseDto } from './dto/execute-deploy.dto';

@ApiTags('deployments')
@Controller('deployments')
export class DeploymentController {
  constructor(private readonly deploymentService: DeploymentService) {}

  /**
   * Phase 1: Verify program exists on devnet
   */
  @Post('verify')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Verify program ID on devnet (Phase 1)' })
  @ApiResponse({ 
    status: 200, 
    description: 'Program verification result',
    type: VerifyProgramResponseDto,
  })
  async verifyProgram(@Body() dto: VerifyProgramDto): Promise<VerifyProgramResponseDto> {
    return this.deploymentService.verifyProgram(dto);
  }

  /**
   * Phase 2: Calculate deployment costs
   */
  @Post('calculate-cost')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Calculate deployment costs (Phase 2)' })
  @ApiResponse({ 
    status: 200, 
    description: 'Cost breakdown',
    type: CostBreakdownDto,
  })
  async calculateCost(@Body() dto: CalculateCostDto): Promise<CostBreakdownDto> {
    return this.deploymentService.calculateCosts(dto);
  }

  /**
   * Phase 3: Execute deployment
   */
  @Post('execute')
  @HttpCode(HttpStatus.ACCEPTED)
  @ApiOperation({ summary: 'Execute deployment to mainnet (Phase 3)' })
  @ApiResponse({ 
    status: 202, 
    description: 'Deployment initiated',
    type: ExecuteDeployResponseDto,
  })
  async executeDeploy(@Body() dto: ExecuteDeployDto): Promise<ExecuteDeployResponseDto> {
    return this.deploymentService.executeDeploy(dto);
  }

  /**
   * Get deployment by ID
   */
  @Get(':id')
  @ApiOperation({ summary: 'Get deployment details by ID' })
  @ApiResponse({ status: 200, description: 'Deployment details' })
  @ApiResponse({ status: 404, description: 'Deployment not found' })
  async getDeployment(@Param('id') id: string) {
    const deployment = await this.deploymentService.getDeploymentById(id);
    if (!deployment) {
      throw new NotFoundException(`Deployment with ID ${id} not found`);
    }
    return deployment;
  }

  /**
   * Get deployments by user wallet
   */
  @Get()
  @ApiOperation({ summary: 'Get deployments by user wallet address' })
  @ApiResponse({ status: 200, description: 'List of deployments' })
  async getDeploymentsByUser(@Query('userWalletAddress') userWalletAddress?: string) {
    if (userWalletAddress) {
      return this.deploymentService.getDeploymentsByUser(userWalletAddress);
    }
    return this.deploymentService.getAllDeployments();
  }
}
