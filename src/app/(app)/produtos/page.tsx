"use client";
import Link from "next/link";
import { useState } from "react";
import { supabase, q } from "@/lib/supabase";
import { brl, horas, pct } from "@/lib/format";
import { Badge, Button, Input, Loading, PageHeader, Table, td, tdNum, useData } from "@/components/ui";

export default function Produtos() {
  const { data, loading } = useData(() => q(supabase.from("vw_produtos_margem").select("*").order("nome")));
  const [busca, setBusca] = useState("");
  const [inativos, setInativos] = useState(false);
  const lista = (data || []).filter(
    (p: any) => (inativos || p.ativo) && `${p.nome} ${p.variacao || ""} ${p.sku || ""}`.toLowerCase().includes(busca.toLowerCase())
  );

  return (
    <>
      <PageHeader title="Produtos e margens" subtitle="Margem de contribuição por unidade vendida na Shopee (1 item por pedido, já com embalagem e frete padrão)">
        <Link href="/produtos/novo"><Button>+ Novo produto</Button></Link>
      </PageHeader>
      <div className="mb-3 flex items-center gap-4">
        <Input placeholder="Buscar nome ou SKU" value={busca} onChange={(e) => setBusca(e.target.value)} className="max-w-xs" />
        <label className="flex items-center gap-2 text-sm text-zinc-600"><input type="checkbox" checked={inativos} onChange={(e) => setInativos(e.target.checked)} /> mostrar inativos</label>
      </div>
      {loading ? <Loading /> : (
        <Table head={["Produto", "SKU", "Tempo", "Preço", "Custo produção", "Taxa Shopee", "Imposto", "Emb.+frete", "Margem contrib.", "MC %", "Prontos"]} empty={lista.length === 0}>
          {lista.map((p: any) => {
            const mc = Number(p.margem_contribuicao_pct);
            const cor = mc < 15 ? "bg-rose-100 text-rose-700" : mc < 30 ? "bg-amber-100 text-amber-800" : "bg-emerald-100 text-emerald-800";
            return (
              <tr key={p.id} className={`hover:bg-zinc-50 ${p.ativo ? "" : "opacity-50"}`}>
                <td className={td}><Link href={`/produtos/${p.id}`} className="font-medium text-orange-700 hover:underline">{p.nome}</Link>{p.variacao && <span className="text-zinc-500"> · {p.variacao}</span>}</td>
                <td className={td}>{p.sku || "—"}</td>
                <td className={tdNum}>{horas(p.tempo_impressao_min)}</td>
                <td className={tdNum}>{brl(p.preco_venda)}</td>
                <td className={tdNum}>{brl(p.custo_producao)}</td>
                <td className={tdNum}>{brl(p.taxa_shopee)}</td>
                <td className={tdNum}>{brl(p.imposto)}</td>
                <td className={tdNum}>{brl(Number(p.custo_embalagem) + Number(p.frete_vendedor))}</td>
                <td className={`${tdNum} font-medium`}>{brl(p.margem_contribuicao)}</td>
                <td className={tdNum}><Badge className={cor}>{pct(p.margem_contribuicao_pct)}</Badge></td>
                <td className={tdNum}>{p.estoque_pronto}</td>
              </tr>
            );
          })}
        </Table>
      )}
    </>
  );
}
