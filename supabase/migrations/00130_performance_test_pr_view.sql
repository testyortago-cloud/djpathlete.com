-- Performance Test PR View
-- =====================================================================
-- Returns the current PR (single row) per (client_user_id, test_type).
-- "Best" depends on best_method:
--   lowest -> min(result_value)
--   highest / mean / median -> max(result_value) (latter two treated as higher-is-better)

CREATE OR REPLACE VIEW performance_test_pr_view AS
SELECT DISTINCT ON (client_user_id, test_type)
  client_user_id, test_type, custom_name, result_value, result_unit,
  test_date, id AS test_id, best_method
FROM performance_tests
ORDER BY client_user_id, test_type,
  CASE best_method
    WHEN 'lowest' THEN result_value
    ELSE -result_value
  END,
  test_date DESC;
