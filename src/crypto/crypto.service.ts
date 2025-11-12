import { Injectable, Logger } from '@nestjs/common';
import * as CryptoJS from 'crypto-js';

@Injectable()
export class CryptoService {
  private readonly logger = new Logger(CryptoService.name);
  private readonly encryptionKey: string;

  constructor() {
    // Get encryption key from environment variable
    this.encryptionKey = process.env.ENCRYPTION_KEY || this.generateDefaultKey();
    
    if (!process.env.ENCRYPTION_KEY) {
      this.logger.warn(
        '⚠️  ENCRYPTION_KEY not set in environment. Using default key. ' +
        'This is INSECURE for production!'
      );
    }
  }

  /**
   * Generate a default key (only for development)
   * In production, ENCRYPTION_KEY MUST be set in environment
   */
  private generateDefaultKey(): string {
    return 'D2D-DEFAULT-ENCRYPTION-KEY-CHANGE-IN-PRODUCTION-PLEASE';
  }

  /**
   * Encrypt sensitive data (e.g., private keys)
   */
  encrypt(plaintext: string): string {
    try {
      const encrypted = CryptoJS.AES.encrypt(plaintext, this.encryptionKey).toString();
      this.logger.debug('Successfully encrypted data');
      return encrypted;
    } catch (error) {
      this.logger.error(`Encryption failed: ${error.message}`);
      throw new Error('Failed to encrypt data');
    }
  }

  /**
   * Decrypt encrypted data
   */
  decrypt(ciphertext: string): string {
    try {
      const bytes = CryptoJS.AES.decrypt(ciphertext, this.encryptionKey);
      const decrypted = bytes.toString(CryptoJS.enc.Utf8);
      
      if (!decrypted) {
        throw new Error('Decryption resulted in empty string');
      }
      
      this.logger.debug('Successfully decrypted data');
      return decrypted;
    } catch (error) {
      this.logger.error(`Decryption failed: ${error.message}`);
      throw new Error('Failed to decrypt data. Invalid ciphertext or encryption key.');
    }
  }

  /**
   * Hash data (one-way, for comparison purposes)
   */
  hash(data: string): string {
    return CryptoJS.SHA256(data).toString();
  }

  /**
   * Verify if a plaintext matches a hash
   */
  verifyHash(plaintext: string, hash: string): boolean {
    return this.hash(plaintext) === hash;
  }

  /**
   * Generate a random encryption key (for initial setup)
   * Use this to generate a secure key, then store it in environment variables
   */
  static generateSecureKey(length: number = 64): string {
    const characters = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789!@#$%^&*()_+-=[]{}|;:,.<>?';
    let result = '';
    const charactersLength = characters.length;
    
    for (let i = 0; i < length; i++) {
      result += characters.charAt(Math.floor(Math.random() * charactersLength));
    }
    
    return result;
  }
}

