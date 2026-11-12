"use client";
import { useState } from "react";
import { supabase, q } from "@/lib/supabase";
import { brl, num, pct } from "@/lib/format";
import { Button, Card, Input, Loading, PageHeader, Table, td, tdNum, useData } from "@/components/ui";

export default function Financeiro() {
  const { data, loading, reload } = useData(async () => {
    const [mensal, custos] = await Promise.all([
      q(supabase.from("vw_resultado_mensal").select("*").limit(24)),
      q(supabase.from("custos_fixos").select("*").order("created_at")),
    ]);
    return { mensal, custos };
  });
  const [novo, setNovo] = useState({ descricao: "", valor_mensal: "" });

  if (loading || !data) return <Loading />;
  const totalFixos = data.custos.filter((c: any) => c.ativo).reduce((s: number, c: any) => s + Number(c.valor_mensal), 0);

  async function addCusto(e: React.FormEvent) {
    e.preventDefault();
    if (!novo.descricao) return;
    await q(supabase.from("custos_fixos").insert({ descricao: novo.descricao, valor_mensal: Number(novo.valor_mensal) || 0 }));
    setNovo({ descricao: "", valor_mensal: "" });
    reload();
  }
  async function upd(id: string, patch: any) {
    await q(supabase.from("custos_fixos").update(patch).eq("id", id));
    reload();
  }
  async function del(id: string) {
    if (!confirm("Remover este custo fixo?")) return;
    await q(supabase.from("custos_fixos").delete().eq("id", id));
    reload();
  }

  return (
    <>
      <PageHeader title="Financeiro" subtitle="Margem de contribuição − custos fixos = lucro líquido. Ponto de equilíbrio = custos fixos ÷ margem de contribuição %." />

      <Table head={["Mês", "Pedidos", "Faturamento", "Taxas Shopee", "Impostos", "Custos variáveis", "Margem contrib.", "MC %", "Custos fixos", "Lucro líquido", "Margem final", "Ponto de equilíbrio"]} empty={data.mensal.length === 0}>
        {data.mensal.map((m: any) => (
          <tr key={m.mes}>
            <td className={td}>{new Date(m.mes + "T12:00").toLocaleDateString("pt-BR", { month: "short", year: "numeric" })}</td>
            <td className={tdNum}>{m.pedidos}</td>
            <td className={tdNum}>{brl(m.faturamento)}</td>
            <td className={tdNum}>{brl(m.taxas)}</td>
            <td className={tdNum}>{brl(m.impostos)}</td>
            <td className={tdNum}>{brl(m.custos_variaveis)}</td>
            <td className={`${tdNum} font-medium`}>{brl(m.margem_contribuicao)}</td>
            <td className={tdNum}>{pct(m.margem_contribuicao_pct)}</td>
            <td className={tdNum}>{brl(m.custos_fixos)}</td>
            <td className={`${tdNum} font-semibold ${Number(m.lucro_liquido) < 0 ? "text-rose-600" : "text-emerald-700"}`}>{brl(m.lucro_liquido)}</td>
            <td className={tdNum}>{pct(m.margem_lucro_pct)}</td>
            <td className={tdNum}>{m.faturamento_equilibrio ? `${brl(m.faturamento_equilibrio)} · ${num(m.pedidos_equilibrio)} ped.` : "—"}</td>
          </tr>
        ))}
      </Table>
      <p className="mt-2 text-xs text-zinc-500">Os custos fixos usados são os cadastrados hoje (aplicados a todos os meses). Pedidos cancelados e devolvidos ficam de fora.</p>

      <Card className="mt-6 max-w-2xl" title={`Custos fixos mensais · total ${brl(totalFixos)}`}>
        <div className="space-y-2">
          {data.custos.map((c: any) => (
            <div key={c.id} className="grid grid-cols-[auto_1fr_140px_auto] items-center gap-2">
              <input type="checkbox" checked={c.ativo} onChange={(e) => upd(c.id, { ativo: e.target.checked })} title="Ativo" />
              <Input defaultValue={c.descricao} onBlur={(e) => e.target.value !== c.descricao && upd(c.id, { descricao: e.target.value })} />
              <Input type="number" step="0.01" defaultValue={c.valor_mensal} onBlur={(e) => Number(e.target.value) !== Number(c.valor_mensal) && upd(c.id, { valor_mensal: Number(e.target.value) })} />
              <Button size="sm" variant="danger" onClick={() => del(c.id)}>✕</Button>
            </div>
          ))}
        </div>
        <form onSubmit={addCusto} className="mt-3 grid grid-cols-[1fr_140px_auto] gap-2 border-t pt-3">
          <Input placeholder="Ex.: DAS MEI, aluguel, internet, Canva, pró-labore…" value={novo.descricao} onChange={(e) => setNovo({ ...novo, descricao: e.target.value })} />
          <Input type="number" step="0.01" placeholder="R$/mês" value={novo.valor_mensal} onChange={(e) => setNovo({ ...novo, valor_mensal: e.target.value })} />
          <Button>Adicionar</Button>
        </form>
        <p className="mt-2 text-xs text-zinc-500">Entra aqui o que você paga todo mês vendendo ou não. Energia das impressões e desgaste da máquina já estão no custo de cada peça.</p>
      </Card>
    </>
  );
}
