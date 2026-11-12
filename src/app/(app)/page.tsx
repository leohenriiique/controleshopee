"use client";
import Link from "next/link";
import { supabase } from "@/lib/supabase";
import { brl, num, pct, horas, STATUS_PEDIDO, SITUACAO_ESTOQUE } from "@/lib/format";
import { Badge, Card, Kpi, Loading, PageHeader, useData } from "@/components/ui";

export default function Painel() {
  const { data, loading } = useData(async () => {
    const inicioMes = new Date();
    inicioMes.setDate(1);
    const mesISO = inicioMes.toISOString().slice(0, 7);
    const [mensal, pedidos, fila, estoque, produtos, cf] = await Promise.all([
      supabase.from("vw_resultado_mensal").select("*"),
      supabase.from("pedidos").select("status").in("status", ["novo", "em_producao", "pronto"]),
      supabase.from("vw_fila").select("status,tempo_total_min,prazo").in("status", ["aguardando", "imprimindo", "acabamento"]),
      supabase.from("vw_estoque_reposicao").select("id,nome,unidade,disponivel,ponto_pedido,situacao,sugestao_compra,dias_cobertura").neq("situacao", "ok"),
      supabase.from("vw_produtos_margem").select("id,nome,variacao,margem_contribuicao_pct").eq("ativo", true).order("margem_contribuicao_pct"),
      supabase.from("custos_fixos").select("valor_mensal").eq("ativo", true),
    ]);
    const mes = (mensal.data || []).find((m: any) => String(m.mes).startsWith(mesISO));
    const custosFixos = (cf.data || []).reduce((s: number, c: any) => s + Number(c.valor_mensal), 0);
    return { mes, custosFixos, pedidos: pedidos.data || [], fila: fila.data || [], estoque: estoque.data || [], produtos: produtos.data || [] };
  });

  if (loading || !data) return <Loading />;
  const m = data.mes || {};
  const fat = Number(m.faturamento || 0);
  const mc = Number(m.margem_contribuicao || 0);
  const lucro = mc - data.custosFixos;
  const equilibrio = m.faturamento_equilibrio ? Number(m.faturamento_equilibrio) : null;
  const progresso = equilibrio ? Math.min(100, (fat / equilibrio) * 100) : mc > 0 ? 100 : 0;
  const mcMedioPedido = m.pedidos ? mc / m.pedidos : 0;
  const faltamPedidos = lucro < 0 && mcMedioPedido > 0 ? Math.ceil(-lucro / mcMedioPedido) : 0;
  const tempoFila = data.fila.reduce((s: number, f: any) => s + Number(f.tempo_total_min || 0), 0);
  const hoje = new Date().toISOString().slice(0, 10);
  const atrasados = data.fila.filter((f: any) => f.prazo && f.prazo < hoje).length;
  const porStatus = (s: string) => data.pedidos.filter((p: any) => p.status === s).length;
  const margemBaixa = data.produtos.filter((p: any) => p.margem_contribuicao_pct !== null && Number(p.margem_contribuicao_pct) < 15);

  return (
    <>
      <PageHeader title="Painel" subtitle={new Date().toLocaleDateString("pt-BR", { month: "long", year: "numeric" })} />

      <div className="grid grid-cols-2 gap-3 lg:grid-cols-5">
        <Kpi label="Faturamento do mês" value={brl(fat)} hint={`${num(m.pedidos || 0)} pedidos · ${num(m.unidades || 0)} un.`} />
        <Kpi label="Margem de contribuição" value={brl(mc)} hint={pct(m.margem_contribuicao_pct)} />
        <Kpi label="Custos fixos" value={brl(data.custosFixos)} hint="mensal" />
        <Kpi label="Lucro líquido" value={brl(lucro)} tone={lucro < 0 ? "text-rose-600" : "text-emerald-600"} hint={`margem final ${fat ? pct((lucro / fat) * 100) : "—"}`} />
        <Kpi label="Ponto de equilíbrio" value={equilibrio ? brl(equilibrio) : "—"} hint={m.pedidos_equilibrio ? `≈ ${num(m.pedidos_equilibrio)} pedidos no mês` : "precisa de vendas no mês"} />
      </div>

      <Card className="mt-3">
        <div className="mb-2 flex justify-between text-sm">
          <span className="font-medium">Caminho até o ponto de equilíbrio</span>
          <span className="text-zinc-500">
            {lucro >= 0 ? "Custos fixos cobertos ✓" : faltamPedidos ? `faltam ~${faltamPedidos} pedidos (${brl(-lucro)} de MC)` : `faltam ${brl(-lucro)} de margem`}
          </span>
        </div>
        <div className="h-3 overflow-hidden rounded-full bg-zinc-100">
          <div className={`h-full ${lucro >= 0 ? "bg-emerald-500" : "bg-orange-500"}`} style={{ width: `${progresso}%` }} />
        </div>
      </Card>

      <div className="mt-6 grid gap-4 lg:grid-cols-3">
        <Card title="Pedidos em aberto">
          <div className="space-y-2">
            {["novo", "em_producao", "pronto"].map((s) => (
              <Link key={s} href={`/pedidos?status=${s}`} className="flex items-center justify-between rounded-lg px-2 py-1.5 hover:bg-zinc-50">
                <Badge className={STATUS_PEDIDO[s].cor}>{STATUS_PEDIDO[s].label}</Badge>
                <span className="text-lg font-semibold tabular-nums">{porStatus(s)}</span>
              </Link>
            ))}
          </div>
        </Card>

        <Card title="Fila de produção">
          <div className="text-3xl font-semibold tabular-nums">{data.fila.length}</div>
          <div className="text-sm text-zinc-500">tarefas · {horas(tempoFila)} de impressão</div>
          {atrasados > 0 && <div className="mt-2 text-sm font-medium text-rose-600">{atrasados} com prazo vencido</div>}
          <Link href="/producao" className="mt-3 inline-block text-sm text-orange-700 hover:underline">Abrir fila →</Link>
        </Card>

        <Card title="Estoque: o que precisa de atenção">
          {data.estoque.length === 0 ? (
            <p className="text-sm text-emerald-700">Tudo acima do ponto de pedido ✓</p>
          ) : (
            <ul className="space-y-1.5 text-sm">
              {data.estoque.slice(0, 8).map((e: any) => (
                <li key={e.id} className="flex items-center justify-between gap-2">
                  <span className="truncate">{e.nome}</span>
                  <span className="flex items-center gap-2">
                    <span className="text-xs text-zinc-500">comprar {num(e.sugestao_compra)} {e.unidade}</span>
                    <Badge className={SITUACAO_ESTOQUE[e.situacao].cor}>{SITUACAO_ESTOQUE[e.situacao].label}</Badge>
                  </span>
                </li>
              ))}
            </ul>
          )}
          <Link href="/estoque" className="mt-3 inline-block text-sm text-orange-700 hover:underline">Ver estoque →</Link>
        </Card>
      </div>

      {margemBaixa.length > 0 && (
        <Card className="mt-4" title="Produtos com margem de contribuição abaixo de 15%">
          <ul className="grid gap-1 text-sm sm:grid-cols-2">
            {margemBaixa.map((p: any) => (
              <li key={p.id}>
                <Link href={`/produtos/${p.id}`} className="flex justify-between rounded px-2 py-1 hover:bg-zinc-50">
                  <span>{p.nome}{p.variacao ? ` · ${p.variacao}` : ""}</span>
                  <span className="font-medium text-rose-600">{pct(p.margem_contribuicao_pct)}</span>
                </Link>
              </li>
            ))}
          </ul>
        </Card>
      )}
    </>
  );
}
