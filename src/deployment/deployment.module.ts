import { Module } from '@nestjs/common';
import { DeploymentController } from './deployment.controller';
import { DeploymentService } from './deployment.service';
import { ConfigModule } from '../config/config.module';
import { WalletModule } from '../wallet/wallet.module';
import { ProgramModule } from '../program/program.module';
import { TransactionModule } from '../transaction/transaction.module';
import { CryptoModule } from '../crypto/crypto.module';
import { SupabaseModule } from '../supabase/supabase.module';

@Module({
  imports: [
    ConfigModule,
    WalletModule,
    ProgramModule,
    TransactionModule,
    CryptoModule,
    SupabaseModule, // Replaced MongooseModule
  ],
  controllers: [DeploymentController],
  providers: [DeploymentService],
  exports: [DeploymentService],
})
export class DeploymentModule {}
