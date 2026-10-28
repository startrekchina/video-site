CREATE INDEX email_deliveries_sender_quota_idx ON email_deliveries (user_id, created_at)
  WHERE purpose = 'email_change_verification';
