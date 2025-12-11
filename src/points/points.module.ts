import { Module, forwardRef } from '@nestjs/common';
import { PointsService } from './points.service';
import { PointsController } from './points.controller';
import { SupabaseModule } from '../supabase/supabase.module';
import { ProgramModule } from '../program/program.module';

@Module({
  imports: [SupabaseModule, forwardRef(() => ProgramModule)],
  controllers: [PointsController],
  providers: [PointsService],
  exports: [PointsService],
})
export class PointsModule {}

