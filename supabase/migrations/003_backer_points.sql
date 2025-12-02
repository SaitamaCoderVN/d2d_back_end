-- Migration 003: Backer Points System
-- Adds points system to incentivize long-term staking

-- ============================================================================
-- BACKER_POINTS TABLE - Track points for each backer
-- ============================================================================
CREATE TABLE IF NOT EXISTS backer_points (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  wallet_address TEXT UNIQUE NOT NULL,
  
  -- Points tracking
  total_points NUMERIC(20, 2) NOT NULL DEFAULT 0, -- Total accumulated points
  current_deposited_amount BIGINT NOT NULL DEFAULT 0, -- Current SOL deposited (in lamports)
  
  -- Historical tracking for point calculation
  last_calculated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(), -- Last time points were calculated
  last_deposited_amount BIGINT NOT NULL DEFAULT 0, -- Deposited amount at last calculation
  
  -- Timestamps
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Add indexes
CREATE INDEX IF NOT EXISTS idx_backer_points_wallet ON backer_points(wallet_address);
CREATE INDEX IF NOT EXISTS idx_backer_points_total_points ON backer_points(total_points DESC);
CREATE INDEX IF NOT EXISTS idx_backer_points_last_calculated ON backer_points(last_calculated_at);

-- Add trigger for updated_at
CREATE TRIGGER update_backer_points_updated_at
  BEFORE UPDATE ON backer_points
  FOR EACH ROW
  EXECUTE FUNCTION update_updated_at_column();

-- Enable RLS on backer_points table
ALTER TABLE backer_points ENABLE ROW LEVEL SECURITY;

-- Policy: Users can view their own points
CREATE POLICY "Users can view own points"
  ON backer_points
  FOR SELECT
  USING (true); -- Allow all reads for now

-- Policy: Service role has full access
CREATE POLICY "Service role has full access to backer_points"
  ON backer_points
  FOR ALL
  USING (true)
  WITH CHECK (true);

-- Grant permissions
GRANT ALL ON backer_points TO service_role;
GRANT SELECT ON backer_points TO authenticated;

-- ============================================================================
-- POINT_HISTORY TABLE - Track point accumulation history
-- ============================================================================
CREATE TABLE IF NOT EXISTS point_history (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  wallet_address TEXT NOT NULL,
  
  -- Point calculation details
  points_earned NUMERIC(20, 2) NOT NULL DEFAULT 0,
  deposited_amount BIGINT NOT NULL DEFAULT 0, -- SOL amount at time of calculation
  time_elapsed_seconds BIGINT NOT NULL DEFAULT 0, -- Time since last calculation
  
  -- Calculation metadata
  calculated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  
  -- Timestamps
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Add indexes
CREATE INDEX IF NOT EXISTS idx_point_history_wallet ON point_history(wallet_address);
CREATE INDEX IF NOT EXISTS idx_point_history_calculated_at ON point_history(calculated_at DESC);

-- Enable RLS
ALTER TABLE point_history ENABLE ROW LEVEL SECURITY;

-- Policy: Users can view their own point history
CREATE POLICY "Users can view own point history"
  ON point_history
  FOR SELECT
  USING (true);

-- Policy: Service role has full access
CREATE POLICY "Service role has full access to point_history"
  ON point_history
  FOR ALL
  USING (true)
  WITH CHECK (true);

-- Grant permissions
GRANT ALL ON point_history TO service_role;
GRANT SELECT ON point_history TO authenticated;

-- ============================================================================
-- COMMENTS
-- ============================================================================
COMMENT ON TABLE backer_points IS 'Tracks points for each backer based on SOL deposit and hold time';
COMMENT ON COLUMN backer_points.total_points IS 'Total accumulated points (increases over time based on deposit amount)';
COMMENT ON COLUMN backer_points.current_deposited_amount IS 'Current SOL deposited (in lamports) - used to calculate point generation rate';
COMMENT ON COLUMN backer_points.last_calculated_at IS 'Last time points were calculated - used to determine time elapsed';
COMMENT ON COLUMN backer_points.last_deposited_amount IS 'Deposited amount at last calculation - used to calculate points for time period';
COMMENT ON TABLE point_history IS 'Historical record of point calculations for audit and analytics';

