import { Module } from '@nestjs/common';
import { ConfigModule as NestConfigModule } from '@nestjs/config';
import { ConfigModule } from './config/config.module';
import { DeploymentModule } from './deployment/deployment.module';
import { WalletModule } from './wallet/wallet.module';
import { ProgramModule } from './program/program.module';
import { TransactionModule } from './transaction/transaction.module';
import { CryptoModule } from './crypto/crypto.module';
import { SupabaseModule } from './supabase/supabase.module';
import { PoolModule } from './pool/pool.module';
import { CloseProgramModule } from './close-program/close-program.module';

@Module({
  imports: [
    NestConfigModule.forRoot({
      isGlobal: true,
      envFilePath: '.env',
    }),
    // Removed MongooseModule - using Supabase instead
    ConfigModule,
    SupabaseModule,
    DeploymentModule,
    WalletModule,
    ProgramModule,
    TransactionModule,
    CryptoModule,
    PoolModule,
    CloseProgramModule,
  ],
})
export class AppModule {}
