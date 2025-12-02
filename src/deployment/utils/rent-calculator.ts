import { LAMPORTS_PER_SOL } from '@solana/web3.js';

/**
 * Calculate rent-exempt minimum for a given data size
 * Based on Solana's rent calculation formula
 */
export function calculateRentExemption(dataSize: number): number {
  // Solana rent formula: (dataSize + 128) * rentEpoch * rentPerByte
  // For program accounts, we need approximately 2x the program size + 45 bytes
  const programAccountSize = 2 * dataSize + 45;
  
  // Approximate rent calculation (1.2 SOL per ~86KB program)
  // This is a simplified calculation - actual rent varies by epoch
  const rentPerByte = 0.00000348; // Approximate lamports per byte
  const lamports = Math.ceil(programAccountSize * rentPerByte * LAMPORTS_PER_SOL);
  
  return lamports;
}

/**
 * Calculate service fee (0.5% of rent cost)
 */
export function calculateServiceFee(rentCost: number): number {
  return Math.ceil(rentCost * 0.005); // 0.5%
}

/**
 * Calculate deployment platform fee (0.1% of rent cost)
 */
export function calculateDeploymentPlatformFee(rentCost: number): number {
  return Math.ceil(rentCost * 0.001); // 0.1%
}

/**
 * Calculate monthly subscription fee
 * 1% of deployment cost (borrowed amount) per month
 * This ensures backers receive 1-1.2% returns when their SOL is fully utilized
 */
export function calculateMonthlyFee(deploymentCost: number): number {
  return Math.ceil(deploymentCost * 0.01); // 1% of deployment cost
}

/**
 * Calculate total payment
 */
export function calculateTotalPayment(
  serviceFee: number,
  deploymentPlatformFee: number,
  monthlyFee: number,
  initialMonths: number,
): number {
  return serviceFee + deploymentPlatformFee + (monthlyFee * initialMonths);
}

/**
 * Estimate deployment time based on program size
 */
export function estimateDeploymentTime(programSize: number): number {
  // Base time: 10 seconds
  // Additional time: ~1 second per 10KB
  const baseTime = 10;
  const additionalTime = Math.ceil(programSize / 10000);
  return baseTime + additionalTime;
}

/**
 * Convert lamports to SOL with precision
 */
export function lamportsToSOL(lamports: number, precision: number = 9): number {
  return parseFloat((lamports / LAMPORTS_PER_SOL).toFixed(precision));
}

/**
 * Convert SOL to lamports
 */
export function solToLamports(sol: number): number {
  return Math.floor(sol * LAMPORTS_PER_SOL);
}

