import { Injectable, Logger } from '@nestjs/common';
import { Keypair } from '@solana/web3.js';
import * as bs58 from 'bs58';
import * as fs from 'fs';

@Injectable()
export class WalletService {
  private readonly logger = new Logger(WalletService.name);

  /**
   * Generate a new random keypair for deployment
   * Returns base58 encoded private key (for backward compatibility)
   */
  generateKeypair(): { publicKey: string; privateKey: string } {
    const keypair = Keypair.generate();
    
    this.logger.log(`Generated new keypair: ${keypair.publicKey.toString()}`);

    return {
      publicKey: keypair.publicKey.toString(),
      privateKey: bs58.encode(keypair.secretKey),
    };
  }

  /**
   * Generate a Keypair object (returns the actual Keypair)
   */
  generateKeypairObject(): Keypair {
    const keypair = Keypair.generate();
    this.logger.log(`Generated new keypair object: ${keypair.publicKey.toString()}`);
    return keypair;
  }

  /**
   * Load keypair from base58 encoded private key
   */
  loadKeypairFromPrivateKey(privateKey: string): Keypair {
    try {
      const secretKey = bs58.decode(privateKey);
      return Keypair.fromSecretKey(secretKey);
    } catch (error) {
      this.logger.error(`Failed to load keypair: ${error.message}`);
      throw new Error('Invalid private key format');
    }
  }

  /**
   * Load admin keypair from file path
   */
  loadAdminKeypair(): Keypair {
    const adminWalletPath = process.env.ADMIN_WALLET_PATH;
    
    if (!adminWalletPath) {
      throw new Error('ADMIN_WALLET_PATH not configured');
    }

    try {
      const fs = require('fs');
      const secretKey = JSON.parse(fs.readFileSync(adminWalletPath, 'utf-8'));
      return Keypair.fromSecretKey(Uint8Array.from(secretKey));
    } catch (error) {
      this.logger.error(`Failed to load admin keypair: ${error.message}`);
      throw new Error('Failed to load admin wallet');
    }
  }
}
