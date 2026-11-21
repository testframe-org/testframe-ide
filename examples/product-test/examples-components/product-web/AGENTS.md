# AGENTS.md — product-web (exemplo de front)

Vite + React + TypeScript puro (sem Tailwind; CSS único em `src/index.css`). Consumidor do `product-api` via proxy — par do exemplo `product-test`.

## Rodar

```bash
bun install
bun run dev      # http://localhost:15174 (strictPort)
bun run build
```

Porta 15174 e proxy `/api` → `http://localhost:18081` estão em `vite.config.ts`.

## Estrutura

- `src/App.tsx` — catálogo: lista com filtro visual, criação (nome/categoria/preço), toggle ativo/inativo (reenvio do doc via POST), exclusão. Helper `api<T>()` centraliza fetch + erro HTTP.
- `Product` espelha o record do `product-api` — se o backend mudar o payload, atualize a interface e o `DataSeeder`/docs.

## Convenções

- Todo acesso de rede passa por `api<T>()` com tipo de retorno; sem `fetch` solto nos componentes.
- Erros da API aparecem no banner (não silenciar com `.catch(() => {})`).
- UI pt-BR.
