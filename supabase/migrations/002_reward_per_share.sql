-- Migration 003: Reward-Per-Share Model
-- Adds reward-per-share tracking and withdraw request queue

-- ============================================================================
-- BACKERS TABLE - Create if not exists, then add reward-per-share fields
-- ============================================================================
CREATE TABLE IF NOT EXISTS backers (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  wallet_address TEXT UNIQUE NOT NULL,
  
  -- Basic info
  is_active BOOLEAN NOT NULL DEFAULT true,
  
  -- Reward-per-share fields (will be populated from on-chain)
  reward_debt BIGINT NOT NULL DEFAULT 0,
  deposited_amount BIGINT NOT NULL DEFAULT 0,
  claimed_total BIGINT NOT NULL DEFAULT 0,
  
  -- Timestamps
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Add columns if they don't exist (for existing tables)
DO $$ 
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns 
    WHERE table_name = 'backers' AND column_name = 'reward_debt'
  ) THEN
    ALTER TABLE backers ADD COLUMN reward_debt BIGINT NOT NULL DEFAULT 0;
  END IF;
  
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns 
    WHERE table_name = 'backers' AND column_name = 'deposited_amount'
  ) THEN
    ALTER TABLE backers ADD COLUMN deposited_amount BIGINT NOT NULL DEFAULT 0;
  END IF;
  
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns 
    WHERE table_name = 'backers' AND column_name = 'claimed_total'
  ) THEN
    ALTER TABLE backers ADD COLUMN claimed_total BIGINT NOT NULL DEFAULT 0;
  END IF;
END $$;

-- Add indexes
CREATE INDEX IF NOT EXISTS idx_backers_wallet ON backers(wallet_address);
CREATE INDEX IF NOT EXISTS idx_backers_reward_debt ON backers(reward_debt) WHERE reward_debt > 0;
CREATE INDEX IF NOT EXISTS idx_backers_deposited_amount ON backers(deposited_amount) WHERE deposited_amount > 0;
CREATE INDEX IF NOT EXISTS idx_backers_is_active ON backers(is_active) WHERE is_active = true;

-- Add trigger for updated_at
CREATE TRIGGER update_backers_updated_at
  BEFORE UPDATE ON backers
  FOR EACH ROW
  EXECUTE FUNCTION update_updated_at_column();

-- Enable RLS on backers table
ALTER TABLE backers ENABLE ROW LEVEL SECURITY;

-- Policy: Users can view their own backer record
CREATE POLICY "Users can view own backer record"
  ON backers
  FOR SELECT
  USING (true); -- Allow all reads for now

-- Policy: Service role has full access
CREATE POLICY "Service role has full access to backers"
  ON backers
  FOR ALL
  USING (true)
  WITH CHECK (true);

-- Grant permissions
GRANT ALL ON backers TO service_role;
GRANT SELECT ON backers TO authenticated;

-- ============================================================================
-- POOL TABLE - Add reward-per-share and liquidity tracking
-- ============================================================================
-- Create pool table if it doesn't exist
CREATE TABLE IF NOT EXISTS pool (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  
  -- Reward-per-share tracking
  reward_per_share NUMERIC(30, 0) NOT NULL DEFAULT 0, -- Store as integer (scaled by PRECISION = 1e12)
  total_deposited BIGINT NOT NULL DEFAULT 0,
  liquid_balance BIGINT NOT NULL DEFAULT 0,
  
  -- Pool balances
  reward_pool_balance BIGINT NOT NULL DEFAULT 0,
  platform_pool_balance BIGINT NOT NULL DEFAULT 0,
  
  -- Metadata
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  
  -- Ensure single row
  CONSTRAINT single_pool CHECK (id = '00000000-0000-0000-0000-000000000000'::uuid)
);

-- Insert default pool row if not exists
INSERT INTO pool (id, reward_per_share, total_deposited, liquid_balance, reward_pool_balance, platform_pool_balance)
VALUES ('00000000-0000-0000-0000-000000000000'::uuid, 0, 0, 0, 0, 0)
ON CONFLICT (id) DO NOTHING;

-- Add trigger for updated_at
CREATE TRIGGER update_pool_updated_at
  BEFORE UPDATE ON pool
  FOR EACH ROW
  EXECUTE FUNCTION update_updated_at_column();

-- ============================================================================
-- WITHDRAW_REQUESTS TABLE - Queue for withdrawals when liquid_balance insufficient
-- ============================================================================
CREATE TABLE IF NOT EXISTS withdraw_requests (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  
  -- Backer info
  backer_wallet_address TEXT NOT NULL,
  
  -- Request details
  amount BIGINT NOT NULL,
  request_id BYTEA NOT NULL UNIQUE, -- 32-byte unique ID (from on-chain or tx signature)
  tx_signature TEXT UNIQUE, -- Transaction signature for idempotency
  
  -- Status
  status TEXT NOT NULL DEFAULT 'pending',
  -- Status values: 'pending', 'processing', 'completed', 'failed', 'cancelled'
  
  -- Processing info
  processed_at TIMESTAMPTZ,
  processed_tx_signature TEXT,
  error_message TEXT,
  
  -- Timestamps
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  
  -- Constraints
  CONSTRAINT valid_status CHECK (status IN ('pending', 'processing', 'completed', 'failed', 'cancelled')),
  CONSTRAINT positive_amount CHECK (amount > 0)
);

-- Indexes for withdraw_requests
CREATE INDEX IF NOT EXISTS idx_withdraw_requests_backer ON withdraw_requests(backer_wallet_address);
CREATE INDEX IF NOT EXISTS idx_withdraw_requests_status ON withdraw_requests(status);
CREATE INDEX IF NOT EXISTS idx_withdraw_requests_created_at ON withdraw_requests(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_withdraw_requests_request_id ON withdraw_requests(request_id);
CREATE INDEX IF NOT EXISTS idx_withdraw_requests_tx_signature ON withdraw_requests(tx_signature) WHERE tx_signature IS NOT NULL;

-- ============================================================================
-- POOLS_SNAPSHOT TABLE - Historical snapshots for reconciliation
-- ============================================================================
CREATE TABLE IF NOT EXISTS pools_snapshot (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  
  -- Snapshot timestamp
  snapshot_timestamp TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  
  -- Pool state
  reward_per_share NUMERIC(30, 0) NOT NULL,
  total_deposited BIGINT NOT NULL,
  liquid_balance BIGINT NOT NULL,
  reward_pool_balance BIGINT NOT NULL,
  platform_pool_balance BIGINT NOT NULL,
  
  -- On-chain verification
  treasury_pool_pda TEXT NOT NULL,
  on_chain_tx_signature TEXT,
  
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Index for time-based queries
CREATE INDEX IF NOT EXISTS idx_pools_snapshot_timestamp ON pools_snapshot(snapshot_timestamp DESC);

-- ============================================================================
-- COMMENTS
-- ============================================================================
COMMENT ON COLUMN pool.reward_per_share IS 'Accumulator for rewards, scaled by PRECISION (1e12). Formula: reward_per_share += (fee_reward * PRECISION) / total_deposited';
COMMENT ON COLUMN pool.total_deposited IS 'Total SOL deposited by all backers (in lamports, net after fees)';
COMMENT ON COLUMN pool.liquid_balance IS 'Available balance for withdrawals (decreases when funds used for deployments)';
COMMENT ON COLUMN backers.reward_debt IS 'Tracks accumulated rewards at deposit time: deposited_amount * reward_per_share';
COMMENT ON COLUMN backers.deposited_amount IS 'Net deposit amount (after 1.1% fees deducted)';
COMMENT ON COLUMN backers.claimed_total IS 'Total rewards claimed so far (in lamports)';
COMMENT ON COLUMN withdraw_requests.request_id IS '32-byte unique ID for idempotency (can be derived from tx signature or generated)';

-- ============================================================================
-- GRANTS - Permissions for new tables
-- ============================================================================

-- Grant all privileges to service role
GRANT ALL ON pool TO service_role;
GRANT ALL ON withdraw_requests TO service_role;
GRANT ALL ON pools_snapshot TO service_role;

-- Grant read access to authenticated users
GRANT SELECT ON pool TO authenticated;
GRANT SELECT ON withdraw_requests TO authenticated;
GRANT SELECT ON pools_snapshot TO authenticated;

-- Enable RLS on new tables
ALTER TABLE pool ENABLE ROW LEVEL SECURITY;
ALTER TABLE withdraw_requests ENABLE ROW LEVEL SECURITY;
ALTER TABLE pools_snapshot ENABLE ROW LEVEL SECURITY;

-- Policy: Service role has full access to pool
CREATE POLICY "Service role has full access to pool"
  ON pool
  FOR ALL
  USING (true)
  WITH CHECK (true);

-- Policy: Authenticated users can read pool
CREATE POLICY "Authenticated users can read pool"
  ON pool
  FOR SELECT
  USING (true);

-- Policy: Service role has full access to withdraw_requests
CREATE POLICY "Service role has full access to withdraw_requests"
  ON withdraw_requests
  FOR ALL
  USING (true)
  WITH CHECK (true);

-- Policy: Users can view their own withdraw requests
CREATE POLICY "Users can view own withdraw requests"
  ON withdraw_requests
  FOR SELECT
  USING (true); -- Allow all reads for now

-- Policy: Service role has full access to pools_snapshot
CREATE POLICY "Service role has full access to pools_snapshot"
  ON pools_snapshot
  FOR ALL
  USING (true)
  WITH CHECK (true);

-- Policy: Authenticated users can read pools_snapshot
CREATE POLICY "Authenticated users can read pools_snapshot"
  ON pools_snapshot
  FOR SELECT
  USING (true);

