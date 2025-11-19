-- Backfill script for reward-per-share migration
-- Reads on-chain data and populates DB columns

-- ============================================================================
-- INSTRUCTIONS FOR RUNNING BACKFILL
-- ============================================================================
-- 1. This script should be run AFTER deploying the updated Anchor program
-- 2. Requires Node.js script to fetch on-chain data (see backfill_reward_per_share.ts)
-- 3. Run: node scripts/backfill_reward_per_share.js
--
-- OR manually run SQL after fetching on-chain data:
--
-- Example SQL (replace with actual on-chain values):
-- UPDATE pool SET
--   reward_per_share = <on_chain_reward_per_share>,
--   total_deposited = <on_chain_total_deposited>,
--   liquid_balance = <on_chain_liquid_balance>,
--   reward_pool_balance = <on_chain_reward_pool_balance>,
--   platform_pool_balance = <on_chain_platform_pool_balance>
-- WHERE id = '00000000-0000-0000-0000-000000000000'::uuid;
--
-- UPDATE backers SET
--   reward_debt = <on_chain_reward_debt>,
--   deposited_amount = <on_chain_deposited_amount>,
--   claimed_total = <on_chain_claimed_total>
-- WHERE wallet_address = <backer_wallet_address>;

-- ============================================================================
-- HELPER FUNCTION: Calculate claimable rewards
-- ============================================================================
CREATE OR REPLACE FUNCTION calculate_claimable_rewards(
  p_deposited_amount BIGINT,
  p_reward_debt BIGINT,
  p_reward_per_share NUMERIC
)
RETURNS BIGINT AS $$
DECLARE
  v_precision NUMERIC := 1000000000000; -- 1e12
  v_accumulated NUMERIC;
  v_claimable NUMERIC;
BEGIN
  -- Formula: (deposited_amount * reward_per_share - reward_debt) / PRECISION
  v_accumulated := (p_deposited_amount::NUMERIC * p_reward_per_share) - p_reward_debt::NUMERIC;
  v_claimable := v_accumulated / v_precision;
  
  -- Return 0 if negative (shouldn't happen, but safe)
  RETURN GREATEST(0, FLOOR(v_claimable))::BIGINT;
END;
$$ LANGUAGE plpgsql IMMUTABLE;

-- ============================================================================
-- VIEW: Backers with claimable rewards
-- ============================================================================
CREATE OR REPLACE VIEW backers_with_claimable AS
SELECT
  b.*,
  p.reward_per_share,
  calculate_claimable_rewards(
    COALESCE(b.deposited_amount, 0),
    COALESCE(b.reward_debt, 0),
    COALESCE(p.reward_per_share, 0)
  ) AS claimable_rewards
FROM backers b
CROSS JOIN pool p
WHERE COALESCE(b.deposited_amount, 0) > 0
  AND COALESCE(b.is_active, true) = true;

COMMENT ON VIEW backers_with_claimable IS 'View showing backers with their current claimable rewards calculated using reward-per-share formula';

