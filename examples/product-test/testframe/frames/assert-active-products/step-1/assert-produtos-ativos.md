-------------------
card-id: card-1-post-2
step-id: step-1
step-number: 1
frame-name: Assert active products
var-name: assertProdutosAtivos
card-type: validation
phase: post
order: 2
type-source: inline
type-name-source: assercoes
endpoint: Chai/Jest assertion
timeout: 1000
width: 210
height: 135
--------body----------
expect(res.length).toBeGreaterThan(0);
expect(res.every((p) => p.preco > 0)).toBe(true);
