import { exec } from 'child_process';
import { promisify } from 'util';
import { Logger } from '@nestjs/common';

const execAsync = promisify(exec);
const logger = new Logger('AuthorityTransfer');

/**
 * Transfer program authority to D2D program using Solana CLI
 */
export async function transferProgramAuthority(
  programId: string,
  currentAuthorityKeypairPath: string,
  newAuthority: string,
  solanaCliPath: string = 'solana',
): Promise<{ success: boolean; signature?: string; error?: string }> {
  try {
    logger.log(`Transferring authority for program ${programId}`);
    logger.log(`  New authority: ${newAuthority}`);

    const command = `${solanaCliPath} program set-upgrade-authority ${programId} --new-upgrade-authority ${newAuthority} --keypair ${currentAuthorityKeypairPath} -u devnet`;
    
    logger.log(`Executing: ${command}`);

    const { stdout, stderr } = await execAsync(command, {
      timeout: 60000, // 1 minute timeout
    });

    logger.log(`Authority transfer stdout: ${stdout}`);
    
    if (stderr && !stderr.includes('Signature:')) {
      logger.warn(`Authority transfer stderr: ${stderr}`);
    }

    // Extract signature from output
    const signatureMatch = stdout.match(/Signature: ([1-9A-HJ-NP-Za-km-z]{64,88})/);
    const signature = signatureMatch ? signatureMatch[1] : undefined;

    if (signature) {
      logger.log(`✅ Authority transferred successfully. Signature: ${signature}`);
      return {
        success: true,
        signature,
      };
    } else {
      logger.warn('Authority transfer completed but signature not found in output');
      return {
        success: true,
      };
    }
  } catch (error) {
    logger.error(`Failed to transfer authority: ${error.message}`);
    return {
      success: false,
      error: error.message,
    };
  }
}

/**
 * Get current program authority
 */
export async function getProgramAuthority(
  programId: string,
  solanaCliPath: string = 'solana',
): Promise<{ authority?: string; error?: string }> {
  try {
    const command = `${solanaCliPath} program show ${programId} -u devnet`;
    
    const { stdout } = await execAsync(command, {
      timeout: 30000,
    });

    // Parse authority from output
    const authorityMatch = stdout.match(/Upgrade Authority: ([1-9A-HJ-NP-Za-km-z]{32,44})/);
    const authority = authorityMatch ? authorityMatch[1] : undefined;

    return { authority };
  } catch (error) {
    logger.error(`Failed to get program authority: ${error.message}`);
    return {
      error: error.message,
    };
  }
}

