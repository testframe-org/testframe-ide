-------------------
script-name: checkHealth
name-source: framework-echo-api
type-source: restapi
project: product-test
--------body----------
await api.get('/api/v2/health')

