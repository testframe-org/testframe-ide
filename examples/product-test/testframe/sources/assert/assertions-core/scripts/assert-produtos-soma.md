-------------------
script-name: assertProdutosSoma
name-source: assertions-core
type-source: assert
project: product-test
--------body----------
assert $sum(Account.Order.Product.(Price * Quantity)) == 336.36

