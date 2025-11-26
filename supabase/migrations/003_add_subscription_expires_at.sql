-- Add subscription_expires_at field to deployments table
-- This field stores the timestamp when the subscription expires (from on-chain DeployRequest)

ALTER TABLE deployments 
ADD COLUMN IF NOT EXISTS subscription_expires_at TIMESTAMPTZ;

-- Add index for efficient queries on expiration date
CREATE INDEX IF NOT EXISTS idx_deployments_subscription_expires_at 
ON deployments(subscription_expires_at) 
WHERE subscription_expires_at IS NOT NULL;

-- Add comment
COMMENT ON COLUMN deployments.subscription_expires_at IS 'Timestamp when subscription expires (fetched from on-chain DeployRequest.subscription_paid_until)';

