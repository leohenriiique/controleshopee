"use client";
import Link from "next/link";
import { Suspense, useState } from "react";
import { useSearchParams } from "next/navigation";
import { supabase, q } from "@/lib/supabase";
import { brl, dataBR, STATUS_PEDIDO } from "@/lib/format";
import { Badge, Button, Input, Loading, PageHeader, Select, Table, td, tdNum, useData } from "@/components/ui";

const FILTROS = [
  { v: "abertos", l: "Em aberto" },
  { v: "novo", l: "Novos" },
  { v: "em_producao", l: "Em produção" },
  { v: "pronto", l: "Prontos" },
  { v: "enviado", l: "Enviados" },
  { v: "todos", l: "Todos" },
];

function Pedidos() {
  const sp = useSearchParams();
  const [filtro, setFiltro] = useState(sp.get("status") || "abertos");
  const [busca, setBusca] = useState("");
  const [aberto, setAberto] = useState<string | null>(null);

  const { data, loading, reload } = useData(async () => {
    let qy = supabase.from("vw_pedidos_resultado").select("*").order("data_pedido", { ascending: false }).limit(300);
    if (filtro === "abertos") qy = qy.in("status", ["novo", "em_producao", "pronto"]);
    else if (filtro !== "todos") qy = qy.eq("status", filtro);
    const [peds, prods] = await Promise.all([q(qy), q(supabase.from("produtos").select("id,nome,variacao,sku").eq("ativo", true).order("nome"))]);
    return { peds, prods };
  }, [filtro]);

  const lista = (data?.peds || []).filter((p: any) =>
    !busca ? true : `${p.numero_shopee || ""} ${p.cliente || ""}`.toLowerCase().includes(busca.toLowerCase())
  );

  async function mudarStatus(id: string, status: string) {
    await q(supabase.from("pedidos").update({ status }).eq("id", id));
    reload();
  }
  async function excluir(id: string) {
    if (!confirm("Excluir este pedido? Tarefas da fila ligadas a ele também serão removidas.")) return;
    await q(supabase.from("pedidos").delete().eq("id", id));
    reload();
  }

  return (
    <>
      <PageHeader title="Pedidos" subtitle="Margem de contribuição calculada por pedido (taxas Shopee, imposto, produção, embalagem e frete)">
        <Link href="/pedidos/importar"><Button variant="soft">⇪ Importar planilha Shopee</Button></Link>
        <Link href="/pedidos/novo"><Button>+ Novo pedido</Button></Link>
      </PageHeader>

      <div className="mb-4 flex flex-wrap items-center gap-2">
        {FILTROS.map((f) => (
          <button
            key={f.v}
            onClick={() => setFiltro(f.v)}
            className={`rounded-full px-3 py-1 text-sm ${filtro === f.v ? "bg-zinc-900 text-white" : "bg-white text-zinc-600 ring-1 ring-zinc-200"}`}
          >
            {f.l}
          </button>
        ))}
        <Input placeholder="Buscar nº ou cliente" value={busca} onChange={(e) => setBusca(e.target.value)} className="ml-auto max-w-xs" />
      </div>

      {loading ? (
        <Loading />
      ) : (
        <Table head={["Data", "Pedido", "Cliente", "Un.", "Receita", "Taxas", "Margem contrib.", "Status", ""]} empty={lista.length === 0}>
          {lista.map((p: any) => {
            const mcPct = p.receita_liquida > 0 ? (p.margem_contribuicao / p.receita_liquida) * 100 : 0;
            return (
              <FragmentRow key={p.id}>
                <tr className="hover:bg-zinc-50">
                  <td className={td}>{dataBR(p.data_pedido)}</td>
                  <td className={td}>
                    <button onClick={() => setAberto(aberto === p.id ? null : p.id)} className="font-medium text-orange-700 hover:underline">
                      {p.numero_shopee || "s/ nº"}
                    </button>
                    {p.itens_sem_produto > 0 && <Badge className="ml-2 bg-rose-100 text-rose-700">vincular produto</Badge>}
                    {p.historico && <Badge className="ml-2 bg-zinc-100 text-zinc-500">histórico</Badge>}
                  </td>
                  <td className={td}>{p.cliente || "—"}</td>
                  <td className={tdNum}>{p.unidades}</td>
                  <td className={tdNum}>{brl(p.receita_liquida)}</td>
                  <td className={tdNum}>{brl(p.taxas_shopee)}</td>
                  <td className={`${tdNum} ${p.margem_contribuicao < 0 ? "text-rose-600" : ""}`}>
                    {brl(p.margem_contribuicao)} <span className="text-xs text-zinc-400">{mcPct.toFixed(0)}%</span>
                  </td>
                  <td className={td}>
                    <select
                      value={p.status}
                      onChange={(e) => mudarStatus(p.id, e.target.value)}
                      className={`rounded-full border-0 px-2 py-0.5 text-xs font-medium ${STATUS_PEDIDO[p.status].cor}`}
                    >
                      {Object.entries(STATUS_PEDIDO).map(([k, v]) => <option key={k} value={k}>{v.label}</option>)}
                    </select>
                  </td>
                  <td className={td}><Button size="sm" variant="danger" onClick={() => excluir(p.id)}>Excluir</Button></td>
                </tr>
                {aberto === p.id && (
                  <tr>
                    <td colSpan={9} className="bg-zinc-50 px-3 py-3">
                      <Detalhe pedido={p} produtos={data!.prods} onChange={reload} />
                    </td>
                  </tr>
                )}
              </FragmentRow>
            );
          })}
        </Table>
      )}
    </>
  );
}

function FragmentRow({ children }: { children: React.ReactNode }) {
  return <>{children}</>;
}

function Detalhe({ pedido, produtos, onChange }: { pedido: any; produtos: any[]; onChange: () => void }) {
  const { data: itens, reload } = useData(() => q(supabase.from("pedido_itens").select("*, produtos(nome,variacao)").eq("pedido_id", pedido.id)), [pedido.id]);

  async function vincular(item: any, produtoId: string, lembrar: boolean) {
    await q(supabase.from("pedido_itens").update({ produto_id: produtoId }).eq("id", item.id));
    if (lembrar && item.descricao) {
      await supabase.from("produto_aliases").upsert({ texto: item.descricao, produto_id: produtoId }, { onConflict: "texto" });
    }
    reload();
    onChange();
  }

  return (
    <div className="grid gap-4 md:grid-cols-[2fr_1fr]">
      <div className="space-y-2">
        {(itens || []).map((it: any) => (
          <div key={it.id} className="flex flex-wrap items-center justify-between gap-2 rounded-lg bg-white p-2 text-sm ring-1 ring-zinc-200">
            <div>
              <div className="font-medium">{it.produtos ? `${it.produtos.nome}${it.produtos.variacao ? " · " + it.produtos.variacao : ""}` : it.descricao}</div>
              <div className="text-xs text-zinc-500">
                {it.quantidade} × {brl(it.preco_unitario)} · custo {brl(it.custo_unitario)} · taxa {brl(it.taxa_unitaria)}
              </div>
            </div>
            {!it.produto_id && (
              <Select className="max-w-xs" defaultValue="" onChange={(e) => e.target.value && vincular(it, e.target.value, true)}>
                <option value="">Vincular a um produto…</option>
                {produtos.map((p) => <option key={p.id} value={p.id}>{p.nome}{p.variacao ? ` · ${p.variacao}` : ""}</option>)}
              </Select>
            )}
          </div>
        ))}
      </div>
      <dl className="grid grid-cols-2 gap-x-3 gap-y-1 rounded-lg bg-white p-3 text-sm ring-1 ring-zinc-200">
        <dt className="text-zinc-500">Receita</dt><dd className="text-right">{brl(pedido.receita_liquida)}</dd>
        <dt className="text-zinc-500">Taxas Shopee{pedido.taxas_reais !== null ? " (reais)" : ""}</dt><dd className="text-right">−{brl(pedido.taxas_shopee)}</dd>
        <dt className="text-zinc-500">Imposto</dt><dd className="text-right">−{brl(pedido.imposto)}</dd>
        <dt className="text-zinc-500">Produção</dt><dd className="text-right">−{brl(pedido.custo_produtos)}</dd>
        <dt className="text-zinc-500">Embalagem</dt><dd className="text-right">−{brl(pedido.custo_embalagem)}</dd>
        <dt className="text-zinc-500">Frete loja</dt><dd className="text-right">−{brl(pedido.frete_vendedor)}</dd>
        <dt className="border-t pt-1 font-medium">Margem contrib.</dt><dd className="border-t pt-1 text-right font-medium">{brl(pedido.margem_contribuicao)}</dd>
        {pedido.prazo_envio && (<><dt className="text-zinc-500">Prazo envio</dt><dd className="text-right">{dataBR(pedido.prazo_envio + "T12:00")}</dd></>)}
      </dl>
    </div>
  );
}

export default function Page() {
  return (
    <Suspense fallback={<Loading />}>
      <Pedidos />
    </Suspense>
  );
}
