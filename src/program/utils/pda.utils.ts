/**
 * PDA (Program Derived Address) Utility Functions
 * 
 * Centralized utility for deriving all PDAs used in the D2D program.
 * This eliminates hardcoded addresses throughout the codebase.
 */

import { PublicKey } from '@solana/web3.js';
import IDL from '../idl/d2d_program_sol.json';

/**
 * Get D2D Program ID from IDL
 * This is the single source of truth for the program ID
 */
export const getD2DProgramId = (): PublicKey => {
  return new PublicKey(IDL.address);
};

/**
 * Get Treasury Pool PDA
 * Seed: "treasury_pool"
 */
export const getTreasuryPoolPDA = (): [PublicKey, number] => {
  return PublicKey.findProgramAddressSync(
    [Buffer.from('treasury_pool')],
    getD2DProgramId()
  );
};

/**
 * Get Reward Pool PDA
 * Seed: "reward_pool"
 */
export const getRewardPoolPDA = (): [PublicKey, number] => {
  return PublicKey.findProgramAddressSync(
    [Buffer.from('reward_pool')],
    getD2DProgramId()
  );
};

/**
 * Get Platform Pool PDA
 * Seed: "platform_pool"
 */
export const getPlatformPoolPDA = (): [PublicKey, number] => {
  return PublicKey.findProgramAddressSync(
    [Buffer.from('platform_pool')],
    getD2DProgramId()
  );
};

/**
 * Get Backer Deposit PDA
 * Seed: "lender_stake" + backer pubkey
 */
export const getBackerDepositPDA = (backer: PublicKey): [PublicKey, number] => {
  return PublicKey.findProgramAddressSync(
    [Buffer.from('lender_stake'), backer.toBuffer()],
    getD2DProgramId()
  );
};

/**
 * Get Deploy Request PDA
 * Seed: "deploy_request" + program_hash
 */
export const getDeployRequestPDA = (programHash: Buffer): [PublicKey, number] => {
  return PublicKey.findProgramAddressSync(
    [Buffer.from('deploy_request'), programHash],
    getD2DProgramId()
  );
};

/**
 * Get User Deploy Stats PDA
 * Seed: "user_stats" + developer pubkey
 */
export const getUserStatsPDA = (developer: PublicKey): [PublicKey, number] => {
  return PublicKey.findProgramAddressSync(
    [Buffer.from('user_stats'), developer.toBuffer()],
    getD2DProgramId()
  );
};

/**
 * Convenience functions that return only the PublicKey (not the bump)
 */
export const getTreasuryPoolAddress = (): PublicKey => {
  const [pda] = getTreasuryPoolPDA();
  return pda;
};

export const getRewardPoolAddress = (): PublicKey => {
  const [pda] = getRewardPoolPDA();
  return pda;
};

export const getPlatformPoolAddress = (): PublicKey => {
  const [pda] = getPlatformPoolPDA();
  return pda;
};

