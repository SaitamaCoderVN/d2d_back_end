-- Add 'closed' status to deployments table
-- This allows deployments to be marked as closed when programs are closed

ALTER TABLE deployments
DROP CONSTRAINT IF EXISTS valid_status;

ALTER TABLE deployments
ADD CONSTRAINT valid_status CHECK (status IN ('pending', 'dumping', 'deploying', 'success', 'failed', 'closed'));

