-------------------
script-name: assertProdutosQuantidade
name-source: assertions-core
type-source: assert
project: product-test
--------body----------
assert $count(Account.Order.Product) >= 1

