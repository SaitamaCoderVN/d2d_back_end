import { 
  Controller, 
  Post, 
  Body, 
  HttpCode, 
  HttpStatus,
} from '@nestjs/common';
import { ApiTags, ApiOperation, ApiResponse } from '@nestjs/swagger';
import { CloseProgramService } from './close-program.service';
import { CloseProgramDto, CloseProgramResponseDto } from './dto/close-program.dto';

@ApiTags('close-program')
@Controller('close-program')
export class CloseProgramController {
  constructor(private readonly closeProgramService: CloseProgramService) {}

  /**
   * Close a deployed program and return all SOL to treasury pool
   */
  @Post()
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Close a deployed program' })
  @ApiResponse({ 
    status: 200, 
    description: 'Program closed successfully',
    type: CloseProgramResponseDto,
  })
  @ApiResponse({ 
    status: 400, 
    description: 'Bad request - invalid deployment or user does not own it',
  })
  @ApiResponse({ 
    status: 404, 
    description: 'Deployment not found',
  })
  async closeProgram(@Body() dto: CloseProgramDto): Promise<CloseProgramResponseDto> {
    return this.closeProgramService.closeProgram(
      dto.deploymentId,
      dto.userWalletAddress,
    );
  }
}

