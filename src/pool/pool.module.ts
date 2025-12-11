import { Module, forwardRef } from '@nestjs/common';
import { PoolController } from './pool.controller';
import { PoolService } from './pool.service';
import { PoolEventsService } from './pool-events.service';
import { ProgramModule } from '../program/program.module';
import { SupabaseModule } from '../supabase/supabase.module';
import { PointsModule } from '../points/points.module';

@Module({
  imports: [ProgramModule, SupabaseModule, forwardRef(() => PointsModule)],
  controllers: [PoolController],
  providers: [PoolService, PoolEventsService],
  exports: [PoolService, PoolEventsService],
})
export class PoolModule {}

