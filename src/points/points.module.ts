import { Module } from '@nestjs/common';
import { PointsService } from './points.service';
import { PointsController } from './points.controller';
import { SupabaseModule } from '../supabase/supabase.module';
import { PoolModule } from '../pool/pool.module';

@Module({
  imports: [SupabaseModule, PoolModule],
  controllers: [PointsController],
  providers: [PointsService],
  exports: [PointsService],
})
export class PointsModule {}

