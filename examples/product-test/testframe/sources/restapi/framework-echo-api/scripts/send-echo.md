-------------------
script-name: sendEcho
name-source: framework-echo-api
type-source: restapi
project: product-test
--------body----------
await api.post('/api/v2/echo', {
  payload
})

