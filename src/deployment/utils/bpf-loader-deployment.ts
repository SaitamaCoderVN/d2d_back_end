import {
  Connection,
  Keypair,
  PublicKey,
  Transaction,
  TransactionInstruction,
  SystemProgram,
  SYSVAR_RENT_PUBKEY,
  SYSVAR_CLOCK_PUBKEY,
  sendAndConfirmTransaction,
  Commitment,
} from '@solana/web3.js';
import { Logger } from '@nestjs/common';
import * as fs from 'fs';

const logger = new Logger('BPFLoaderDeployment');

// BPF Loader Upgradeable Program ID
export const BPF_LOADER_UPGRADEABLE_PROGRAM_ID = new PublicKey(
  'BPFLoaderUpgradeab1e11111111111111111111111'
);

/**
 * Calculate the minimum balance needed for a buffer account
 */
export function calculateBufferAccountSize(programDataLength: number): number {
  // Buffer account structure:
  // - 1 byte: account type (buffer = 0)
  // - 4 bytes: authority option (1 if present, 0 if none)
  // - 32 bytes: authority pubkey (if present)
  // - N bytes: program data
  return 1 + 4 + 32 + programDataLength;
}

/**
 * Get Program Derived Address for program data account
 */
export function getProgramDataAddress(programId: PublicKey): [PublicKey, number] {
  return PublicKey.findProgramAddressSync(
    [programId.toBuffer()],
    BPF_LOADER_UPGRADEABLE_PROGRAM_ID
  );
}

/**
 * Deploy a Solana program using BPFLoaderUpgradeable (equivalent to `solana program deploy`)
 * 
 * This is a pure Web3.js implementation that doesn't require Solana CLI
 */
export async function deployProgram(params: {
  connection: Connection;
  programBinary: Buffer;
  payerKeypair: Keypair;
  programKeypair?: Keypair; // Optional: if not provided, a new one will be generated
  authority?: PublicKey; // Optional: program upgrade authority (defaults to payer)
  commitment?: Commitment;
}): Promise<{
  programId: PublicKey;
  programDataAddress: PublicKey;
  deploymentSignature: string;
  bufferAddress: PublicKey;
}> {
  const {
    connection,
    programBinary,
    payerKeypair,
    programKeypair = Keypair.generate(),
    authority = payerKeypair.publicKey,
    commitment = 'confirmed',
  } = params;

  logger.log('═══════════════════════════════════════════════');
  logger.log('🚀 Starting BPF Loader Upgradeable Deployment');
  logger.log('═══════════════════════════════════════════════');
  logger.log(`   Program size: ${(programBinary.length / 1024).toFixed(2)} KB`);
  logger.log(`   Payer: ${payerKeypair.publicKey.toString()}`);
  logger.log(`   Program ID: ${programKeypair.publicKey.toString()}`);
  logger.log(`   Authority: ${authority.toString()}`);

  try {
    // Step 1: Create and initialize buffer account
    logger.log('');
    logger.log('📦 Step 1: Creating buffer account...');
    const bufferKeypair = Keypair.generate();
    const bufferSize = calculateBufferAccountSize(programBinary.length);
    
    logger.log(`   Buffer address: ${bufferKeypair.publicKey.toString()}`);
    logger.log(`   Buffer size: ${bufferSize} bytes`);

    const rentExemptBalance = await connection.getMinimumBalanceForRentExemption(
      bufferSize
    );

    logger.log(`   Rent-exempt balance: ${rentExemptBalance} lamports`);

    // Create buffer account transaction
    const createBufferTx = new Transaction().add(
      SystemProgram.createAccount({
        fromPubkey: payerKeypair.publicKey,
        newAccountPubkey: bufferKeypair.publicKey,
        lamports: rentExemptBalance,
        space: bufferSize,
        programId: BPF_LOADER_UPGRADEABLE_PROGRAM_ID,
      })
    );

    // Initialize buffer
    const initializeBufferInstruction = createInitializeBufferInstruction(
      bufferKeypair.publicKey,
      authority
    );

    createBufferTx.add(initializeBufferInstruction);

    logger.log('   Sending buffer creation transaction...');
    const bufferSignature = await sendAndConfirmTransaction(
      connection,
      createBufferTx,
      [payerKeypair, bufferKeypair],
      { commitment }
    );

    logger.log(`✅ Buffer created: ${bufferSignature}`);

    // Step 2: Write program data to buffer
    logger.log('');
    logger.log('📝 Step 2: Writing program data to buffer...');
    await writeBufferData(
      connection,
      bufferKeypair.publicKey,
      payerKeypair,
      authority,
      programBinary,
      commitment
    );

    logger.log('✅ Program data written to buffer');

    // Step 3: Deploy program from buffer
    logger.log('');
    logger.log('🎯 Step 3: Deploying program from buffer...');
    
    const [programDataAddress] = getProgramDataAddress(programKeypair.publicKey);
    
    logger.log(`   Program data address: ${programDataAddress.toString()}`);

    const programDataSize = programBinary.length;
    const programDataRent = await connection.getMinimumBalanceForRentExemption(
      programDataSize + 45 // Program data header size
    );

    logger.log(`   Program data rent: ${programDataRent} lamports`);

    const deployProgramInstruction = createDeployWithMaxDataLenInstruction(
      payerKeypair.publicKey,
      programDataAddress,
      programKeypair.publicKey,
      bufferKeypair.publicKey,
      authority,
      programDataSize,
      programDataRent
    );

    const deployTx = new Transaction().add(deployProgramInstruction);

    logger.log('   Sending deployment transaction...');
    const deploymentSignature = await sendAndConfirmTransaction(
      connection,
      deployTx,
      [payerKeypair, programKeypair],
      { commitment }
    );

    logger.log(`✅ Program deployed: ${deploymentSignature}`);

    logger.log('');
    logger.log('═══════════════════════════════════════════════');
    logger.log('🎉 Deployment Complete!');
    logger.log('═══════════════════════════════════════════════');
    logger.log(`   Program ID: ${programKeypair.publicKey.toString()}`);
    logger.log(`   Program Data: ${programDataAddress.toString()}`);
    logger.log(`   Deploy Signature: ${deploymentSignature}`);
    logger.log(`   Explorer: https://explorer.solana.com/address/${programKeypair.publicKey.toString()}?cluster=devnet`);
    logger.log('═══════════════════════════════════════════════');

    return {
      programId: programKeypair.publicKey,
      programDataAddress,
      deploymentSignature,
      bufferAddress: bufferKeypair.publicKey,
    };
  } catch (error) {
    logger.error('═══════════════════════════════════════════════');
    logger.error('❌ Deployment failed');
    logger.error(`   Error: ${error.message}`);
    
    if (error.logs) {
      logger.error('   Transaction logs:');
      error.logs.forEach((log: string, i: number) => {
        logger.error(`     [${i}] ${log}`);
      });
    }
    
    logger.error('═══════════════════════════════════════════════');
    throw error;
  }
}

/**
 * Upgrade an existing program using BPFLoaderUpgradeable
 */
export async function upgradeProgram(params: {
  connection: Connection;
  programBinary: Buffer;
  programId: PublicKey;
  payerKeypair: Keypair;
  authorityKeypair: Keypair;
  commitment?: Commitment;
}): Promise<{
  upgradeSignature: string;
  bufferAddress: PublicKey;
}> {
  const {
    connection,
    programBinary,
    programId,
    payerKeypair,
    authorityKeypair,
    commitment = 'confirmed',
  } = params;

  logger.log('═══════════════════════════════════════════════');
  logger.log('🔄 Starting Program Upgrade');
  logger.log('═══════════════════════════════════════════════');
  logger.log(`   Program ID: ${programId.toString()}`);
  logger.log(`   New program size: ${(programBinary.length / 1024).toFixed(2)} KB`);

  try {
    // Step 1: Create and write to buffer (same as deployment)
    logger.log('');
    logger.log('📦 Step 1: Creating buffer account...');
    
    const bufferKeypair = Keypair.generate();
    const bufferSize = calculateBufferAccountSize(programBinary.length);
    
    const rentExemptBalance = await connection.getMinimumBalanceForRentExemption(
      bufferSize
    );

    const createBufferTx = new Transaction().add(
      SystemProgram.createAccount({
        fromPubkey: payerKeypair.publicKey,
        newAccountPubkey: bufferKeypair.publicKey,
        lamports: rentExemptBalance,
        space: bufferSize,
        programId: BPF_LOADER_UPGRADEABLE_PROGRAM_ID,
      }),
      createInitializeBufferInstruction(
        bufferKeypair.publicKey,
        authorityKeypair.publicKey
      )
    );

    await sendAndConfirmTransaction(
      connection,
      createBufferTx,
      [payerKeypair, bufferKeypair],
      { commitment }
    );

    logger.log('✅ Buffer created');

    // Step 2: Write program data
    logger.log('');
    logger.log('📝 Step 2: Writing program data...');
    await writeBufferData(
      connection,
      bufferKeypair.publicKey,
      payerKeypair,
      authorityKeypair.publicKey,
      programBinary,
      commitment
    );

    logger.log('✅ Data written');

    // Step 3: Upgrade program
    logger.log('');
    logger.log('🎯 Step 3: Upgrading program...');
    
    const [programDataAddress] = getProgramDataAddress(programId);

    const upgradeInstruction = createUpgradeProgramInstruction(
      programDataAddress,
      programId,
      bufferKeypair.publicKey,
      authorityKeypair.publicKey,
      payerKeypair.publicKey
    );

    const upgradeTx = new Transaction().add(upgradeInstruction);

    const upgradeSignature = await sendAndConfirmTransaction(
      connection,
      upgradeTx,
      [payerKeypair, authorityKeypair],
      { commitment }
    );

    logger.log(`✅ Program upgraded: ${upgradeSignature}`);

    logger.log('');
    logger.log('═══════════════════════════════════════════════');
    logger.log('🎉 Upgrade Complete!');
    logger.log('═══════════════════════════════════════════════');

    return {
      upgradeSignature,
      bufferAddress: bufferKeypair.publicKey,
    };
  } catch (error) {
    logger.error(`❌ Upgrade failed: ${error.message}`);
    throw error;
  }
}

/**
 * Write program data to buffer in chunks
 */
async function writeBufferData(
  connection: Connection,
  bufferAddress: PublicKey,
  payerKeypair: Keypair,
  authority: PublicKey,
  programData: Buffer,
  commitment: Commitment
): Promise<void> {
  // BPF Loader Upgradeable has a max write size per transaction
  const MAX_WRITE_SIZE = 900; // Conservative size to avoid transaction limits
  const totalChunks = Math.ceil(programData.length / MAX_WRITE_SIZE);

  logger.log(`   Writing ${totalChunks} chunks...`);

  for (let i = 0; i < totalChunks; i++) {
    const offset = i * MAX_WRITE_SIZE;
    const chunk = programData.slice(offset, offset + MAX_WRITE_SIZE);

    const writeInstruction = createWriteBufferInstruction(
      bufferAddress,
      authority,
      offset,
      chunk
    );

    const writeTx = new Transaction().add(writeInstruction);

    await sendAndConfirmTransaction(
      connection,
      writeTx,
      [payerKeypair],
      { commitment }
    );

    const progress = ((i + 1) / totalChunks * 100).toFixed(1);
    logger.log(`   Progress: ${progress}% (${i + 1}/${totalChunks} chunks)`);
  }
}

/**
 * Create InitializeBuffer instruction
 */
function createInitializeBufferInstruction(
  bufferAddress: PublicKey,
  authority: PublicKey
): TransactionInstruction {
  // InitializeBuffer instruction layout:
  // [0-3]: instruction discriminator (u32) = 0
  // (no additional data, authority passed through account metas)
  const instructionData = Buffer.alloc(4);
  instructionData.writeUInt32LE(0, 0); // InitializeBuffer discriminator

  return new TransactionInstruction({
    keys: [
      { pubkey: bufferAddress, isSigner: false, isWritable: true },
      { pubkey: authority, isSigner: false, isWritable: false },
    ],
    programId: BPF_LOADER_UPGRADEABLE_PROGRAM_ID,
    data: instructionData,
  });
}

/**
 * Create Write instruction for buffer
 */
function createWriteBufferInstruction(
  bufferAddress: PublicKey,
  authority: PublicKey,
  offset: number,
  bytes: Buffer
): TransactionInstruction {
  // Write instruction layout:
  // [0-3]: instruction discriminator (u32) = 1
  // [4-7]: offset (u32)
  // [8-11]: length (u32)
  // [12-...]: bytes

  const instructionData = Buffer.alloc(12 + bytes.length);
  instructionData.writeUInt32LE(1, 0); // Write discriminator
  instructionData.writeUInt32LE(offset, 4);
  instructionData.writeUInt32LE(bytes.length, 8);
  bytes.copy(instructionData, 12);

  return new TransactionInstruction({
    keys: [
      { pubkey: bufferAddress, isSigner: false, isWritable: true },
      { pubkey: authority, isSigner: true, isWritable: false },
    ],
    programId: BPF_LOADER_UPGRADEABLE_PROGRAM_ID,
    data: instructionData,
  });
}

/**
 * Create DeployWithMaxDataLen instruction
 */
function createDeployWithMaxDataLenInstruction(
  payerPubkey: PublicKey,
  programDataAddress: PublicKey,
  programId: PublicKey,
  bufferAddress: PublicKey,
  authority: PublicKey,
  maxDataLen: number,
  rentLamports: number
): TransactionInstruction {
  // DeployWithMaxDataLen instruction layout:
  // [0-3]: instruction discriminator (u32) = 2
  // [4-11]: max_data_len (u64)

  const instructionData = Buffer.alloc(12);
  instructionData.writeUInt32LE(2, 0); // DeployWithMaxDataLen discriminator

  const maxDataLenBigInt = BigInt(maxDataLen);
  instructionData.writeUInt32LE(Number(maxDataLenBigInt & BigInt(0xffffffff)), 4);
  instructionData.writeUInt32LE(Number(maxDataLenBigInt >> BigInt(32)), 8);

  return new TransactionInstruction({
    keys: [
      { pubkey: payerPubkey, isSigner: true, isWritable: true },
      { pubkey: programDataAddress, isSigner: false, isWritable: true },
      { pubkey: programId, isSigner: false, isWritable: true },
      { pubkey: bufferAddress, isSigner: false, isWritable: true },
      { pubkey: SYSVAR_RENT_PUBKEY, isSigner: false, isWritable: false },
      { pubkey: SYSVAR_CLOCK_PUBKEY, isSigner: false, isWritable: false },
      { pubkey: SystemProgram.programId, isSigner: false, isWritable: false },
      { pubkey: authority, isSigner: true, isWritable: false },
    ],
    programId: BPF_LOADER_UPGRADEABLE_PROGRAM_ID,
    data: instructionData,
  });
}

/**
 * Create Upgrade instruction
 */
function createUpgradeProgramInstruction(
  programDataAddress: PublicKey,
  programId: PublicKey,
  bufferAddress: PublicKey,
  authority: PublicKey,
  spillAddress: PublicKey
): TransactionInstruction {
  // Upgrade instruction layout:
  // [0-3]: instruction discriminator (u32) = 3

  const instructionData = Buffer.alloc(4);
  instructionData.writeUInt32LE(3, 0); // Upgrade discriminator

  return new TransactionInstruction({
    keys: [
      { pubkey: programDataAddress, isSigner: false, isWritable: true },
      { pubkey: programId, isSigner: false, isWritable: true },
      { pubkey: bufferAddress, isSigner: false, isWritable: true },
      { pubkey: spillAddress, isSigner: false, isWritable: true },
      { pubkey: SYSVAR_RENT_PUBKEY, isSigner: false, isWritable: false },
      { pubkey: SYSVAR_CLOCK_PUBKEY, isSigner: false, isWritable: false },
      { pubkey: authority, isSigner: true, isWritable: false },
    ],
    programId: BPF_LOADER_UPGRADEABLE_PROGRAM_ID,
    data: instructionData,
  });
}

/**
 * Set program upgrade authority
 */
export async function setProgramAuthority(params: {
  connection: Connection;
  programId: PublicKey;
  currentAuthorityKeypair: Keypair;
  newAuthority: PublicKey | null; // null to make program immutable
  commitment?: Commitment;
}): Promise<string> {
  const {
    connection,
    programId,
    currentAuthorityKeypair,
    newAuthority,
    commitment = 'confirmed',
  } = params;

  logger.log('🔐 Setting program authority...');
  logger.log(`   Program: ${programId.toString()}`);
  logger.log(`   New authority: ${newAuthority ? newAuthority.toString() : 'None (immutable)'}`);

  const [programDataAddress] = getProgramDataAddress(programId);

  // SetAuthority instruction layout:
  // [0-3]: instruction discriminator (u32) = 4
  // [4]: new_authority_option (u8) - 1 if present, 0 if none
  // [5-36]: new_authority (optional pubkey)

  const instructionData = Buffer.alloc(37);
  instructionData.writeUInt32LE(4, 0); // SetAuthority discriminator
  
  if (newAuthority) {
    instructionData.writeUInt8(1, 4); // Has new authority
    newAuthority.toBuffer().copy(instructionData, 5);
  } else {
    instructionData.writeUInt8(0, 4); // No new authority (immutable)
  }

  const setAuthorityInstruction = new TransactionInstruction({
    keys: [
      { pubkey: programDataAddress, isSigner: false, isWritable: true },
      { pubkey: currentAuthorityKeypair.publicKey, isSigner: true, isWritable: false },
      { pubkey: newAuthority || currentAuthorityKeypair.publicKey, isSigner: false, isWritable: false },
    ],
    programId: BPF_LOADER_UPGRADEABLE_PROGRAM_ID,
    data: instructionData,
  });

  const tx = new Transaction().add(setAuthorityInstruction);

  const signature = await sendAndConfirmTransaction(
    connection,
    tx,
    [currentAuthorityKeypair],
    { commitment }
  );

  logger.log(`✅ Authority updated: ${signature}`);

  return signature;
}

