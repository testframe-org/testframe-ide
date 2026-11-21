import React, { useCallback, useEffect, useState } from 'react'

interface Product {
  id: string
  nome: string
  categoria: string
  preco: number
  ativo: boolean
}

interface ProductDraft {
  nome: string
  categoria: string
  preco: string
}

const EMPTY_DRAFT: ProductDraft = { nome: '', categoria: '', preco: '' }

async function api<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(`/api/products${path}`, init)
  if (!res.ok) {
    const body = await res.text().catch(() => '')
    throw new Error(`HTTP ${res.status} ${body}`)
  }
  if (res.status === 204) return undefined as T
  return (await res.json()) as T
}

export default function App() {
  const [products, setProducts] = useState<Product[]>([])
  const [draft, setDraft] = useState<ProductDraft>(EMPTY_DRAFT)
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)

  const refresh = useCallback(async () => {
    try {
      setProducts(await api<Product[]>(''))
      setError(null)
    } catch (err) {
      setError(`product-api indisponível: ${(err as Error).message}`)
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    refresh()
  }, [refresh])

  const create = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!draft.nome.trim()) return
    try {
      await api<Product>('', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          nome: draft.nome.trim(),
          categoria: draft.categoria.trim() || 'Geral',
          preco: Number(draft.preco || '0'),
          ativo: true
        })
      })
      setDraft(EMPTY_DRAFT)
      await refresh()
    } catch (err) {
      setError(`Falha ao criar: ${(err as Error).message}`)
    }
  }

  const toggle = async (p: Product) => {
    try {
      await api<Product>('', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ...p, ativo: !p.ativo })
      })
      await refresh()
    } catch (err) {
      setError(`Falha ao atualizar: ${(err as Error).message}`)
    }
  }

  const remove = async (p: Product) => {
    try {
      await api<void>(`/${p.id}`, { method: 'DELETE' })
      await refresh()
    } catch (err) {
      setError(`Falha ao excluir: ${(err as Error).message}`)
    }
  }

  return (
    <div className="shell">
      <header>
        <h1>Catálogo de Produtos</h1>
        <span className="src">product-web → /api → product-api :18081 → MongoDB</span>
      </header>

      {error && <div className="banner error">{error}</div>}

      <form className="card form" onSubmit={create}>
        <input
          placeholder="Nome do produto"
          value={draft.nome}
          onChange={(e) => setDraft({ ...draft, nome: e.target.value })}
        />
        <input
          placeholder="Categoria"
          value={draft.categoria}
          onChange={(e) => setDraft({ ...draft, categoria: e.target.value })}
        />
        <input
          placeholder="Preço"
          type="number"
          min="0"
          step="0.01"
          value={draft.preco}
          onChange={(e) => setDraft({ ...draft, preco: e.target.value })}
        />
        <button type="submit">Adicionar</button>
      </form>

      {loading ? (
        <p className="muted">Carregando…</p>
      ) : (
        <table className="card">
          <thead>
            <tr>
              <th>Produto</th>
              <th>Categoria</th>
              <th>Preço</th>
              <th>Status</th>
              <th />
            </tr>
          </thead>
          <tbody>
            {products.map((p) => (
              <tr key={p.id}>
                <td>{p.nome}</td>
                <td>{p.categoria}</td>
                <td>{p.preco.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })}</td>
                <td>
                  <button className={`pill ${p.ativo ? 'on' : 'off'}`} onClick={() => toggle(p)}>
                    {p.ativo ? 'ATIVO' : 'INATIVO'}
                  </button>
                </td>
                <td>
                  <button className="danger" onClick={() => remove(p)}>
                    Excluir
                  </button>
                </td>
              </tr>
            ))}
            {!products.length && (
              <tr>
                <td colSpan={5} className="muted">Nenhum produto cadastrado.</td>
              </tr>
            )}
          </tbody>
        </table>
      )}
    </div>
  )
}
