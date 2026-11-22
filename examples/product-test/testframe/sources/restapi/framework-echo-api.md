-------------------
base-url: http://localhost:18080
-------------------
# TestFrame Echo API

## Endpoints

| Method | Route           | Returns                              |
|--------|---------------|--------------------------------------|
| POST   | /echo         | 201 with request_id and echoed body  |
| GET    | /health       | service status                       |
| POST   | /frames       | writes the project .md frames        |
| GET    | /frames/{proj}| lists saved frames                   |
