-------------------
card-id: card-2-pre-1
step-id: step-2
step-number: 2
frame-name: Payload entrada
var-name: payloadEcho
card-type: json
phase: pre
order: 1
type-source: inline
type-name-source: payload-step2
endpoint: Input Binding
timeout: 1000
width: 195
height: 150
--------body----------
{
  "produtos": "{{obterProdutosAtivos}}",
  "primeiro": "{{obterProdutosAtivos.0.nome}}",
  "competencia": "2026-11"
}
