-------------------
script-name: obterProdutosPorCategoria
name-source: products-db
type-source: mongo
project: product-test
--------body----------
db.products.find({ categoria: "Ferramentas" })

