/**
 * Script to sync liquid_balance with actual account balance
 * 
 * This fixes the issue where liquid_balance in the struct is out of sync
 * with the actual SOL balance in the treasury pool account.
 * 
 * Usage:
 *   ts-node scripts/sync-liquid-balance.ts
 */

import { NestFactory } from '@nestjs/core';
import { AppModule } from '../src/app.module';
import { ProgramService } from '../src/program/program.service';
import { Logger } from '@nestjs/common';

async function main() {
  const logger = new Logger('SyncLiquidBalanceScript');
  
  try {
    logger.log('🚀 Starting liquid_balance sync script...');
    
    // Create NestJS application context
    const app = await NestFactory.createApplicationContext(AppModule, {
      logger: ['error', 'warn', 'log'],
    });
    
    const programService = app.get(ProgramService);
    
    logger.log('📊 Syncing liquid_balance with account balance...');
    const txSignature = await programService.syncLiquidBalance();
    
    logger.log('✅ Sync completed successfully!');
    logger.log(`   Transaction: ${txSignature}`);
    logger.log(`   Explorer: https://explorer.solana.com/tx/${txSignature}?cluster=devnet`);
    
    await app.close();
    process.exit(0);
  } catch (error: any) {
    logger.error('❌ Failed to sync liquid_balance');
    logger.error(`   Error: ${error.message}`);
    
    if (error.message?.includes('sync_liquid_balance') || error.message?.includes('not found')) {
      logger.error('');
      logger.error('💡 The sync_liquid_balance instruction is not found in the deployed program.');
      logger.error('   Please build and deploy the updated smart contract first:');
      logger.error('');
      logger.error('   cd ../d2d-program-sol');
      logger.error('   anchor build');
      logger.error('   anchor deploy');
      logger.error('');
      logger.error('   Then run this script again.');
    }
    
    process.exit(1);
  }
}

main();

