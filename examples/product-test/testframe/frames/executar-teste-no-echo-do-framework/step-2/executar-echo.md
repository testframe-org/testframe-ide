-------------------
card-id: card-2-pre-2
step-id: step-2
step-number: 2
frame-name: Executar teste no echo do framework
var-name: executarEcho
card-type: request
phase: pre
order: 2
type-source: restapi
type-name-source: framework-echo-api
http-method: POST
endpoint: POST /api/v2/echo
timeout: 8000
width: 360
height: 300
--------body----------
// Sends the bound payload to the framework echo endpoint
const response = await api.post('/api/v2/echo', payloadEcho);

return response.data;
