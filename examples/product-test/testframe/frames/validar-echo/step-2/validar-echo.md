-------------------
card-id: card-2-post-2
step-id: step-2
step-number: 2
frame-name: Validar echo
var-name: validarEcho
card-type: validation
phase: post
order: 2
type-source: inline
type-name-source: assercoes
endpoint: Filter & Rule
timeout: 1000
width: 190
height: 135
--------body----------
expect(res.status).toBe('PROCESSADO');
expect(res.request_id).toMatch(/^REQ-/);
