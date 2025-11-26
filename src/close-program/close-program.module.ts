import { Module } from '@nestjs/common';
import { CloseProgramController } from './close-program.controller';
import { CloseProgramService } from './close-program.service';
import { ConfigModule } from '../config/config.module';
import { ProgramModule } from '../program/program.module';
import { SupabaseModule } from '../supabase/supabase.module';

@Module({
  imports: [
    ConfigModule,
    ProgramModule,
    SupabaseModule,
  ],
  controllers: [CloseProgramController],
  providers: [CloseProgramService],
  exports: [CloseProgramService],
})
export class CloseProgramModule {}

