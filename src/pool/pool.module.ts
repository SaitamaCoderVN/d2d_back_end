import { Module } from '@nestjs/common';
import { PoolController } from './pool.controller';
import { PoolService } from './pool.service';
import { ProgramModule } from '../program/program.module';
import { SupabaseModule } from '../supabase/supabase.module';

@Module({
  imports: [ProgramModule, SupabaseModule],
  controllers: [PoolController],
  providers: [PoolService],
  exports: [PoolService],
})
export class PoolModule {}

