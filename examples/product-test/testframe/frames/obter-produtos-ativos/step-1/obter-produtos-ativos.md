-------------------
card-id: card-1-pre-1
step-id: step-1
step-number: 1
frame-name: Obter produtos ativos
var-name: obterProdutosAtivos
card-type: script
phase: pre
order: 1
type-source: mongo
type-name-source: products-db
endpoint: db.products.find({ ativo: true })
timeout: 5000
width: 340
height: 290
--------body----------
// Custom query from products-db (scripts/obter-produtos-ativos.md)
const products = await db
  .collection('products')
  .find({ ativo: true })
  .toArray();

return products.map((p) => ({
  id: String(p._id),
  nome: p.nome,
  categoria: p.categoria,
  preco: p.preco
}));
