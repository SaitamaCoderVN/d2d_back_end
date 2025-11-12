-- D2D Deployment System - Initial Schema
-- Replaces MongoDB collections with PostgreSQL tables

-- ============================================================================
-- DEPLOYMENTS TABLE
-- ============================================================================
CREATE TABLE IF NOT EXISTS deployments (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  
  -- Program and Wallet Info
  user_wallet_address TEXT NOT NULL,
  devnet_program_id TEXT NOT NULL,
  mainnet_program_id TEXT,
  
  -- Deployer Wallet (ephemeral)
  deployer_wallet_address TEXT NOT NULL,
  deployer_wallet_private_key TEXT NOT NULL, -- AES encrypted
  
  -- Status and Progress
  status TEXT NOT NULL DEFAULT 'pending',
  -- Status values: 'pending', 'dumping', 'deploying', 'success', 'failed'
  
  -- Transaction Signatures
  transaction_signature TEXT,
  payment_signature TEXT,
  on_chain_deploy_tx TEXT,
  on_chain_confirm_tx TEXT,
  
  -- Error Handling
  error_message TEXT,
  
  -- Program Details
  program_file_path TEXT,
  program_hash TEXT, -- SHA256 hash for PDA seed
  
  -- Financial Info (in lamports)
  service_fee BIGINT NOT NULL DEFAULT 5000000000,
  deployment_platform_fee BIGINT NOT NULL DEFAULT 100000000,
  deployment_cost BIGINT NOT NULL DEFAULT 10000000000,
  
  -- Timestamps
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  
  -- Indexes
  CONSTRAINT valid_status CHECK (status IN ('pending', 'dumping', 'deploying', 'success', 'failed'))
);

-- Create indexes for common queries
CREATE INDEX IF NOT EXISTS idx_deployments_user_wallet ON deployments(user_wallet_address);
CREATE INDEX IF NOT EXISTS idx_deployments_status ON deployments(status);
CREATE INDEX IF NOT EXISTS idx_deployments_created_at ON deployments(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_deployments_devnet_program ON deployments(devnet_program_id);
CREATE INDEX IF NOT EXISTS idx_deployments_mainnet_program ON deployments(mainnet_program_id) WHERE mainnet_program_id IS NOT NULL;

-- ============================================================================
-- DEPLOYMENT_LOGS TABLE
-- ============================================================================
CREATE TABLE IF NOT EXISTS deployment_logs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  deployment_id UUID NOT NULL REFERENCES deployments(id) ON DELETE CASCADE,
  
  -- Log Details
  phase TEXT NOT NULL, -- 'verify', 'calculate', 'execute', 'deploy', 'confirm'
  log_level TEXT NOT NULL DEFAULT 'info', -- 'info', 'warn', 'error', 'debug'
  message TEXT NOT NULL,
  metadata JSONB, -- Additional structured data
  
  -- Timestamp
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  
  CONSTRAINT valid_phase CHECK (phase IN ('verify', 'calculate', 'execute', 'deploy', 'confirm')),
  CONSTRAINT valid_log_level CHECK (log_level IN ('info', 'warn', 'error', 'debug'))
);

-- Index for querying logs by deployment
CREATE INDEX IF NOT EXISTS idx_deployment_logs_deployment_id ON deployment_logs(deployment_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_deployment_logs_level ON deployment_logs(log_level);

-- ============================================================================
-- USER_STATS TABLE (Optional - for analytics)
-- ============================================================================
CREATE TABLE IF NOT EXISTS user_stats (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  wallet_address TEXT UNIQUE NOT NULL,
  
  -- Deployment Stats
  total_deployments INTEGER NOT NULL DEFAULT 0,
  successful_deployments INTEGER NOT NULL DEFAULT 0,
  failed_deployments INTEGER NOT NULL DEFAULT 0,
  
  -- Financial Stats (in lamports)
  total_fees_paid BIGINT NOT NULL DEFAULT 0,
  
  -- Timestamps
  first_deployment_at TIMESTAMPTZ,
  last_deployment_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_user_stats_wallet ON user_stats(wallet_address);

-- ============================================================================
-- FUNCTIONS
-- ============================================================================

-- Automatically update updated_at timestamp
CREATE OR REPLACE FUNCTION update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Apply trigger to deployments table
CREATE TRIGGER update_deployments_updated_at
  BEFORE UPDATE ON deployments
  FOR EACH ROW
  EXECUTE FUNCTION update_updated_at_column();

-- Apply trigger to user_stats table
CREATE TRIGGER update_user_stats_updated_at
  BEFORE UPDATE ON user_stats
  FOR EACH ROW
  EXECUTE FUNCTION update_updated_at_column();

-- ============================================================================
-- ROW LEVEL SECURITY (RLS) POLICIES
-- ============================================================================

-- Enable RLS on deployments table
ALTER TABLE deployments ENABLE ROW LEVEL SECURITY;

-- Policy: Users can read their own deployments
CREATE POLICY "Users can view own deployments"
  ON deployments
  FOR SELECT
  USING (true); -- Allow all reads for now (can be restricted by user_wallet_address in app logic)

-- Policy: Service role can do everything
CREATE POLICY "Service role has full access to deployments"
  ON deployments
  FOR ALL
  USING (true)
  WITH CHECK (true);

-- Enable RLS on deployment_logs
ALTER TABLE deployment_logs ENABLE ROW LEVEL SECURITY;

-- Policy: Users can read logs for their deployments
CREATE POLICY "Users can view logs for their deployments"
  ON deployment_logs
  FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM deployments d
      WHERE d.id = deployment_logs.deployment_id
    )
  );

-- Policy: Service role has full access to logs
CREATE POLICY "Service role has full access to logs"
  ON deployment_logs
  FOR ALL
  USING (true)
  WITH CHECK (true);

-- Enable RLS on user_stats
ALTER TABLE user_stats ENABLE ROW LEVEL SECURITY;

-- Policy: Users can view their own stats
CREATE POLICY "Users can view own stats"
  ON user_stats
  FOR SELECT
  USING (true);

-- Policy: Service role has full access to stats
CREATE POLICY "Service role has full access to stats"
  ON user_stats
  FOR ALL
  USING (true)
  WITH CHECK (true);

-- ============================================================================
-- HELPER VIEWS
-- ============================================================================

-- View: Recent deployments with basic info
CREATE OR REPLACE VIEW recent_deployments AS
SELECT 
  id,
  user_wallet_address,
  devnet_program_id,
  mainnet_program_id,
  status,
  service_fee,
  deployment_cost,
  created_at,
  updated_at
FROM deployments
ORDER BY created_at DESC
LIMIT 100;

-- View: Deployment statistics summary
CREATE OR REPLACE VIEW deployment_stats_summary AS
SELECT 
  COUNT(*) as total_deployments,
  COUNT(*) FILTER (WHERE status = 'success') as successful,
  COUNT(*) FILTER (WHERE status = 'failed') as failed,
  COUNT(*) FILTER (WHERE status IN ('pending', 'dumping', 'deploying')) as in_progress,
  SUM(service_fee) as total_fees_collected,
  MAX(created_at) as last_deployment_at
FROM deployments;

-- ============================================================================
-- GRANTS (Ensure service role has access)
-- ============================================================================

-- Grant all privileges to service role (authenticated by SUPABASE_SERVICE_KEY)
GRANT ALL ON deployments TO service_role;
GRANT ALL ON deployment_logs TO service_role;
GRANT ALL ON user_stats TO service_role;
GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO service_role;

-- Grant read access to authenticated users (optional, based on app needs)
GRANT SELECT ON deployments TO authenticated;
GRANT SELECT ON deployment_logs TO authenticated;
GRANT SELECT ON user_stats TO authenticated;

-- ============================================================================
-- INITIAL DATA (Optional)
-- ============================================================================

-- Example: You can insert initial configuration or test data here
-- INSERT INTO ...

-- ============================================================================
-- COMMENTS
-- ============================================================================

COMMENT ON TABLE deployments IS 'Stores all program deployment records';
COMMENT ON TABLE deployment_logs IS 'Stores detailed logs for each deployment phase';
COMMENT ON TABLE user_stats IS 'Aggregated statistics per user wallet';

COMMENT ON COLUMN deployments.deployer_wallet_private_key IS 'AES encrypted ephemeral wallet private key';
COMMENT ON COLUMN deployments.program_hash IS 'SHA256 hash used as PDA seed for on-chain program';
COMMENT ON COLUMN deployments.status IS 'Current deployment status: pending, dumping, deploying, success, failed';

