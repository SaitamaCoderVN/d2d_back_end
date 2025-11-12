import { Module } from '@nestjs/common';
import { TransactionService } from './transaction.service';
import { ConfigModule } from '../config/config.module';

@Module({
  imports: [ConfigModule],
  providers: [TransactionService],
  exports: [TransactionService],
})
export class TransactionModule {}

