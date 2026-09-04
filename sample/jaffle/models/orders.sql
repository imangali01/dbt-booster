select
  1 as order_id,
  customer_id,
  100 as amount
from {{ ref('customers') }}
