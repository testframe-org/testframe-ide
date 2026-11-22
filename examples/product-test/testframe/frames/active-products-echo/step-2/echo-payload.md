-------------------
title: Echo payload
order: 1
timeout: 2000
--------body----------
{
  "products": "{{getActiveProducts}}",
  "first": "{{getActiveProducts.0.nome}}",
  "period": "2026-11"
}
