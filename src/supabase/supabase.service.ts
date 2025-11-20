import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { createClient, SupabaseClient } from '@supabase/supabase-js';

export enum DeploymentStatus {
  PENDING = 'pending',
  DUMPING = 'dumping',
  DEPLOYING = 'deploying',
  SUCCESS = 'success',
  FAILED = 'failed',
}

export interface Deployment {
  id: string;
  user_wallet_address: string;
  devnet_program_id: string;
  mainnet_program_id?: string;
  deployer_wallet_address: string;
  deployer_wallet_private_key: string; // AES encrypted
  status: DeploymentStatus;
  transaction_signature?: string;
  payment_signature?: string;
  on_chain_deploy_tx?: string;
  on_chain_confirm_tx?: string;
  error_message?: string;
  program_file_path?: string;
  program_hash?: string;
  service_fee: number;
  deployment_platform_fee: number;
  deployment_cost: number;
  subscription_expires_at?: string; // ISO timestamp when subscription expires
  created_at: string;
  updated_at: string;
}

export interface DeploymentLog {
  id?: string;
  deployment_id: string;
  phase: 'verify' | 'calculate' | 'execute' | 'deploy' | 'confirm';
  log_level: 'info' | 'warn' | 'error' | 'debug';
  message: string;
  metadata?: Record<string, any>;
  created_at?: string;
}

export interface UserStats {
  id?: string;
  wallet_address: string;
  total_deployments: number;
  successful_deployments: number;
  failed_deployments: number;
  total_fees_paid: number;
  first_deployment_at?: string;
  last_deployment_at?: string;
  created_at?: string;
  updated_at?: string;
}

@Injectable()
export class SupabaseService implements OnModuleInit {
  private readonly logger = new Logger(SupabaseService.name);
  private supabase: SupabaseClient;

  async onModuleInit() {
    await this.initialize();
  }

  private async initialize() {
    const supabaseUrl = process.env.SUPABASE_URL;
    const supabaseServiceKey = process.env.SUPABASE_SERVICE_KEY;

    if (!supabaseUrl || !supabaseServiceKey) {
      throw new Error(
        'SUPABASE_URL and SUPABASE_SERVICE_KEY must be set in environment variables'
      );
    }

    this.supabase = createClient(supabaseUrl, supabaseServiceKey, {
      auth: {
        autoRefreshToken: false,
        persistSession: false,
      },
    });

    this.logger.log('✅ Supabase client initialized');
    this.logger.log(`   URL: ${supabaseUrl}`);
  }

  // ============================================================================
  // DEPLOYMENT CRUD OPERATIONS
  // ============================================================================

  /**
   * Create a new deployment record
   */
  async createDeployment(data: Partial<Deployment>): Promise<Deployment> {
    const { data: deployment, error } = await this.supabase
      .from('deployments')
      .insert({
        user_wallet_address: data.user_wallet_address,
        devnet_program_id: data.devnet_program_id,
        deployer_wallet_address: data.deployer_wallet_address,
        deployer_wallet_private_key: data.deployer_wallet_private_key,
        status: data.status || DeploymentStatus.PENDING,
        service_fee: data.service_fee || 5000000000,
        deployment_platform_fee: data.deployment_platform_fee || 100000000,
        deployment_cost: data.deployment_cost || 10000000000,
        payment_signature: data.payment_signature,
        program_hash: data.program_hash,
      })
      .select()
      .single();

    if (error) {
      this.logger.error(`Failed to create deployment: ${error.message}`);
      throw new Error(`Failed to create deployment: ${error.message}`);
    }

    this.logger.log(`✅ Deployment created: ${deployment.id}`);
    return deployment as Deployment;
  }

  /**
   * Update deployment by ID
   */
  async updateDeployment(
    id: string,
    updates: Partial<Deployment>
  ): Promise<Deployment> {
    const { data: deployment, error } = await this.supabase
      .from('deployments')
      .update(updates)
      .eq('id', id)
      .select()
      .single();

    if (error) {
      this.logger.error(`Failed to update deployment ${id}: ${error.message}`);
      throw new Error(`Failed to update deployment: ${error.message}`);
    }

    return deployment as Deployment;
  }

  /**
   * Get deployment by ID
   */
  async getDeploymentById(id: string): Promise<Deployment | null> {
    const { data: deployment, error } = await this.supabase
      .from('deployments')
      .select('*')
      .eq('id', id)
      .single();

    if (error) {
      if (error.code === 'PGRST116') {
        // Row not found
        return null;
      }
      this.logger.error(`Failed to get deployment ${id}: ${error.message}`);
      throw new Error(`Failed to get deployment: ${error.message}`);
    }

    return deployment as Deployment;
  }

  /**
   * Get deployments by user wallet address
   */
  async getDeploymentsByUser(
    userWalletAddress: string
  ): Promise<Deployment[]> {
    const { data: deployments, error } = await this.supabase
      .from('deployments')
      .select('*')
      .eq('user_wallet_address', userWalletAddress)
      .order('created_at', { ascending: false });

    if (error) {
      this.logger.error(
        `Failed to get deployments for user ${userWalletAddress}: ${error.message}`
      );
      throw new Error(`Failed to get deployments: ${error.message}`);
    }

    return (deployments as Deployment[]) || [];
  }

  /**
   * Get all deployments (paginated)
   */
  async getAllDeployments(
    limit: number = 100,
    offset: number = 0
  ): Promise<Deployment[]> {
    const { data: deployments, error } = await this.supabase
      .from('deployments')
      .select('*')
      .order('created_at', { ascending: false })
      .range(offset, offset + limit - 1);

    if (error) {
      this.logger.error(`Failed to get all deployments: ${error.message}`);
      throw new Error(`Failed to get deployments: ${error.message}`);
    }

    return (deployments as Deployment[]) || [];
  }

  /**
   * Update deployment status
   */
  async updateDeploymentStatus(
    id: string,
    status: DeploymentStatus
  ): Promise<void> {
    const { error } = await this.supabase
      .from('deployments')
      .update({ status })
      .eq('id', id);

    if (error) {
      this.logger.error(
        `Failed to update deployment status ${id}: ${error.message}`
      );
      throw new Error(`Failed to update deployment status: ${error.message}`);
    }

    this.logger.log(`✅ Deployment ${id} status updated to: ${status}`);
  }

  /**
   * Delete deployment (soft delete by status, or hard delete)
   */
  async deleteDeployment(id: string): Promise<void> {
    const { error } = await this.supabase
      .from('deployments')
      .delete()
      .eq('id', id);

    if (error) {
      this.logger.error(`Failed to delete deployment ${id}: ${error.message}`);
      throw new Error(`Failed to delete deployment: ${error.message}`);
    }

    this.logger.log(`✅ Deployment ${id} deleted`);
  }

  // ============================================================================
  // DEPLOYMENT LOGS
  // ============================================================================

  /**
   * Add a deployment log entry
   */
  async addDeploymentLog(log: DeploymentLog): Promise<void> {
    const { error } = await this.supabase.from('deployment_logs').insert({
      deployment_id: log.deployment_id,
      phase: log.phase,
      log_level: log.log_level,
      message: log.message,
      metadata: log.metadata || {},
    });

    if (error) {
      this.logger.error(
        `Failed to add deployment log: ${error.message}`
      );
      // Don't throw error for logging failures (non-critical)
    }
  }

  /**
   * Get logs for a deployment
   */
  async getDeploymentLogs(deploymentId: string): Promise<DeploymentLog[]> {
    const { data: logs, error } = await this.supabase
      .from('deployment_logs')
      .select('*')
      .eq('deployment_id', deploymentId)
      .order('created_at', { ascending: true });

    if (error) {
      this.logger.error(
        `Failed to get deployment logs: ${error.message}`
      );
      return [];
    }

    return (logs as DeploymentLog[]) || [];
  }

  // ============================================================================
  // USER STATS
  // ============================================================================

  /**
   * Get or create user stats
   */
  async getUserStats(walletAddress: string): Promise<UserStats | null> {
    const { data: stats, error } = await this.supabase
      .from('user_stats')
      .select('*')
      .eq('wallet_address', walletAddress)
      .single();

    if (error) {
      if (error.code === 'PGRST116') {
        // Create new stats record
        return this.createUserStats(walletAddress);
      }
      this.logger.error(`Failed to get user stats: ${error.message}`);
      return null;
    }

    return stats as UserStats;
  }

  /**
   * Create user stats record
   */
  async createUserStats(walletAddress: string): Promise<UserStats> {
    const { data: stats, error } = await this.supabase
      .from('user_stats')
      .insert({
        wallet_address: walletAddress,
        total_deployments: 0,
        successful_deployments: 0,
        failed_deployments: 0,
        total_fees_paid: 0,
      })
      .select()
      .single();

    if (error) {
      this.logger.error(`Failed to create user stats: ${error.message}`);
      throw new Error(`Failed to create user stats: ${error.message}`);
    }

    return stats as UserStats;
  }

  /**
   * Update user stats (increment counters)
   */
  async updateUserStats(
    walletAddress: string,
    updates: {
      totalDeployments?: number;
      successfulDeployments?: number;
      failedDeployments?: number;
      feesPaid?: number;
    }
  ): Promise<void> {
    // Get current stats
    const stats = await this.getUserStats(walletAddress);
    if (!stats) return;

    const { error } = await this.supabase
      .from('user_stats')
      .update({
        total_deployments: stats.total_deployments + (updates.totalDeployments || 0),
        successful_deployments: stats.successful_deployments + (updates.successfulDeployments || 0),
        failed_deployments: stats.failed_deployments + (updates.failedDeployments || 0),
        total_fees_paid: stats.total_fees_paid + (updates.feesPaid || 0),
        last_deployment_at: new Date().toISOString(),
      })
      .eq('wallet_address', walletAddress);

    if (error) {
      this.logger.error(`Failed to update user stats: ${error.message}`);
    }
  }

  // ============================================================================
  // UTILITY METHODS
  // ============================================================================

  /**
   * Get deployment statistics summary
   */
  async getDeploymentStatsSummary(): Promise<{
    total: number;
    successful: number;
    failed: number;
    in_progress: number;
    total_fees: number;
  }> {
    const { data, error } = await this.supabase
      .from('deployment_stats_summary')
      .select('*')
      .single();

    if (error) {
      this.logger.error(`Failed to get stats summary: ${error.message}`);
      return {
        total: 0,
        successful: 0,
        failed: 0,
        in_progress: 0,
        total_fees: 0,
      };
    }

    return {
      total: data.total_deployments || 0,
      successful: data.successful || 0,
      failed: data.failed || 0,
      in_progress: data.in_progress || 0,
      total_fees: data.total_fees_collected || 0,
    };
  }

  /**
   * Get Supabase client (for advanced queries)
   */
  getClient(): SupabaseClient {
    return this.supabase;
  }

  /**
   * Health check
   */
  async healthCheck(): Promise<boolean> {
    try {
      const { error } = await this.supabase
        .from('deployments')
        .select('id')
        .limit(1);

      return !error;
    } catch (error) {
      return false;
    }
  }
}

