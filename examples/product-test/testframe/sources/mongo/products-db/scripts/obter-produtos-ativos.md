-------------------
script-name: obterProdutosAtivos
name-source: products-db
type-source: mongo
project: product-test
--------body----------
db.products.find({ ativo: true })

