"use client";
import { useEffect, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import { supabase, q } from "@/lib/supabase";
import { brl, num, pct } from "@/lib/format";
import { custoProducao, faixaDoPreco, precoParaMargem, taxaShopee } from "@/lib/calculos";
import { Button, Card, Field, Input, Loading, PageHeader, Select, useData } from "@/components/ui";

type Linha = { insumo_id: string; quantidade: number };

export default function EditarProduto() {
  const { id } = useParams<{ id: string }>();
  const novo = id === "novo";
  const r = useRouter();

  const { data: base, loading } = useData(async () => {
    const [insumos, cfg, faixas, emb] = await Promise.all([
      q(supabase.from("insumos").select("id,nome,unidade,custo_unitario,categoria").eq("ativo", true).order("categoria").order("nome")),
      q(supabase.from("configuracoes").select("*").eq("id", 1).single()),
      q(supabase.from("faixas_taxa_shopee").select("*")),
      q(supabase.from("embalagem_padrao").select("quantidade, insumos(custo_unitario)")),
    ]);
    const custoEmb = (emb || []).reduce((s: number, e: any) => s + Number(e.quantidade) * Number(e.insumos?.custo_unitario || 0), 0);
    let produto: any = null, ficha: Linha[] = [];
    if (!novo) {
      produto = await q(supabase.from("produtos").select("*").eq("id", id).single());
      ficha = await q(supabase.from("produto_insumos").select("insumo_id,quantidade").eq("produto_id", id));
    }
    return { insumos, cfg, faixas, custoEmb, produto, ficha };
  }, [id]);

  const [p, setP] = useState<any>({ nome: "", variacao: "", sku: "", preco_venda: 0, tempo_impressao_min: 0, custo_extra: 0, ativo: true });
  const [ficha, setFicha] = useState<Linha[]>([]);
  const [meta, setMeta] = useState(30);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!base) return;
    if (base.produto) setP(base.produto);
    setFicha(base.ficha.map((f: any) => ({ insumo_id: f.insumo_id, quantidade: Number(f.quantidade) })));
    setMeta(Number(base.cfg.meta_margem_pct));
  }, [base]);

  if (loading || !base) return <Loading />;
  const { cfg, faixas, insumos, custoEmb } = base;
  const set = (k: string, v: any) => setP((x: any) => ({ ...x, [k]: v }));
  const insumo = (iid: string) => insumos.find((i: any) => i.id === iid);

  const linhasCusto = ficha.filter((f) => f.insumo_id).map((f) => ({
    quantidade: f.quantidade, custo_unitario: Number(insumo(f.insumo_id)?.custo_unitario || 0), categoria: insumo(f.insumo_id)?.categoria,
  }));
  const custo = custoProducao(cfg, Number(p.tempo_impressao_min), Number(p.custo_extra), linhasCusto);
  const preco = Number(p.preco_venda) || 0;
  const taxa = taxaShopee(faixas, cfg, preco);
  const imposto = (preco * Number(cfg.aliquota_imposto_pct)) / 100;
  const frete = Number(cfg.frete_vendedor_padrao);
  const mc = preco - custo.total - taxa - imposto - custoEmb - frete;
  const mcPct = preco ? (mc / preco) * 100 : 0;
  const faixa = faixaDoPreco(faixas, preco);
  const precoMin = precoParaMargem(faixas, cfg, custo.total, custoEmb, 0);
  const precoMeta = precoParaMargem(faixas, cfg, custo.total, custoEmb, meta);

  async function salvar(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    try {
      const dados = {
        nome: p.nome, variacao: p.variacao || null, sku: p.sku || null, preco_venda: preco,
        tempo_impressao_min: Number(p.tempo_impressao_min), custo_extra: Number(p.custo_extra), ativo: p.ativo,
      };
      let pid = id;
      if (novo) pid = (await q(supabase.from("produtos").insert(dados).select("id").single())).id;
      else await q(supabase.from("produtos").update(dados).eq("id", id));
      await q(supabase.from("produto_insumos").delete().eq("produto_id", pid));
      const linhas = ficha.filter((f) => f.insumo_id && f.quantidade > 0);
      // agrupa insumos repetidos
      const agrup = Object.values(linhas.reduce((a: any, f) => {
        a[f.insumo_id] = { produto_id: pid, insumo_id: f.insumo_id, quantidade: (a[f.insumo_id]?.quantidade || 0) + f.quantidade };
        return a;
      }, {}));
      if (agrup.length) await q(supabase.from("produto_insumos").insert(agrup));
      r.push("/produtos");
    } finally {
      setBusy(false);
    }
  }

  async function excluir() {
    if (!confirm("Excluir o produto? Se ele já tiver pedidos, prefira desmarcar “ativo”.")) return;
    const { error } = await supabase.from("produtos").delete().eq("id", id);
    if (error) alert("Não foi possível excluir (há pedidos ligados). Desative o produto.");
    else r.push("/produtos");
  }

  return (
    <>
      <PageHeader title={novo ? "Novo produto" : p.nome} subtitle="Ficha técnica: o que cada unidade consome. A baixa de estoque e o custo saem daqui." />
      <form onSubmit={salvar} className="grid gap-4 lg:grid-cols-[3fr_2fr]">
        <div className="space-y-4">
          <Card title="Dados">
            <div className="grid gap-3 sm:grid-cols-2">
              <Field label="Nome" className="sm:col-span-2"><Input value={p.nome} onChange={(e) => set("nome", e.target.value)} required /></Field>
              <Field label="Variação (cor, tamanho…)"><Input value={p.variacao || ""} onChange={(e) => set("variacao", e.target.value)} /></Field>
              <Field label="SKU (o mesmo da Shopee)" hint="Usado para reconhecer o produto na importação"><Input value={p.sku || ""} onChange={(e) => set("sku", e.target.value)} /></Field>
              <Field label="Preço de venda (R$)"><Input type="number" step="0.01" value={p.preco_venda} onChange={(e) => set("preco_venda", e.target.value)} /></Field>
              <Field label="Tempo de impressão por unidade (min)"><Input type="number" value={p.tempo_impressao_min} onChange={(e) => set("tempo_impressao_min", e.target.value)} /></Field>
              <Field label="Custo extra por unidade (R$)" hint="Mão de obra, tinta, cola, acabamento"><Input type="number" step="0.01" value={p.custo_extra} onChange={(e) => set("custo_extra", e.target.value)} /></Field>
              <label className="flex items-center gap-2 self-end pb-2 text-sm"><input type="checkbox" checked={p.ativo} onChange={(e) => set("ativo", e.target.checked)} /> Produto ativo</label>
            </div>
          </Card>

          <Card title="Ficha técnica (por unidade)">
            <div className="space-y-2">
              {ficha.map((f, i) => {
                const ins = insumo(f.insumo_id);
                return (
                  <div key={i} className="grid grid-cols-[1fr_110px_90px_auto] items-center gap-2">
                    <Select value={f.insumo_id} onChange={(e) => setFicha((xs) => xs.map((x, j) => (j === i ? { ...x, insumo_id: e.target.value } : x)))}>
                      <option value="">Insumo…</option>
                      {insumos.map((x: any) => <option key={x.id} value={x.id}>{x.nome} ({x.unidade})</option>)}
                    </Select>
                    <Input type="number" step="0.01" value={f.quantidade} onChange={(e) => setFicha((xs) => xs.map((x, j) => (j === i ? { ...x, quantidade: Number(e.target.value) } : x)))} />
                    <span className="text-right text-xs text-zinc-500">{ins ? brl(f.quantidade * Number(ins.custo_unitario)) : ""}</span>
                    <Button type="button" variant="danger" size="sm" onClick={() => setFicha((xs) => xs.filter((_, j) => j !== i))}>✕</Button>
                  </div>
                );
              })}
            </div>
            <Button type="button" variant="soft" className="mt-3" onClick={() => setFicha((xs) => [...xs, { insumo_id: "", quantidade: 1 }])}>+ Insumo</Button>
            <p className="mt-2 text-xs text-zinc-500">Filamento em gramas (veja no fatiador). A caixa de envio fica em Configurações → embalagem por pedido, não aqui.</p>
          </Card>

          <div className="flex justify-between">
            {!novo ? <Button type="button" variant="danger" onClick={excluir}>Excluir produto</Button> : <span />}
            <div className="flex gap-2">
              <Button type="button" variant="ghost" onClick={() => r.back()}>Cancelar</Button>
              <Button disabled={busy}>{busy ? "Salvando…" : "Salvar"}</Button>
            </div>
          </div>
        </div>

        <div className="space-y-4">
          <Card title="Composição do preço (1 unidade)">
            <dl className="grid grid-cols-2 gap-y-1.5 text-sm">
              <dt>Preço de venda</dt><dd className="text-right font-medium">{brl(preco)}</dd>
              <dt className="text-zinc-500">Materiais (+{num(cfg.perda_falhas_pct)}% perdas)</dt><dd className="text-right">−{brl(custo.materiais)}</dd>
              <dt className="text-zinc-500">Energia</dt><dd className="text-right">−{brl(custo.energia)}</dd>
              <dt className="text-zinc-500">Depreciação máquina</dt><dd className="text-right">−{brl(custo.depreciacao)}</dd>
              <dt className="text-zinc-500">Custo extra</dt><dd className="text-right">−{brl(custo.extra)}</dd>
              <dt className="text-zinc-500">Taxa Shopee {faixa ? `(${num(faixa.comissao_pct)}% + ${brl(Math.min(Number(faixa.taxa_fixa), preco * 0.5))})` : ""}</dt><dd className="text-right">−{brl(taxa)}</dd>
              <dt className="text-zinc-500">Imposto ({num(cfg.aliquota_imposto_pct, 2)}%)</dt><dd className="text-right">−{brl(imposto)}</dd>
              <dt className="text-zinc-500">Embalagem</dt><dd className="text-right">−{brl(custoEmb)}</dd>
              <dt className="text-zinc-500">Frete pago pela loja</dt><dd className="text-right">−{brl(frete)}</dd>
              <dt className="border-t pt-2 font-semibold">Margem de contribuição</dt>
              <dd className={`border-t pt-2 text-right font-semibold ${mc < 0 ? "text-rose-600" : "text-emerald-700"}`}>{brl(mc)} · {pct(mcPct)}</dd>
            </dl>
          </Card>

          <Card title="Simulador de preço">
            <div className="space-y-3 text-sm">
              <div className="flex justify-between"><span className="text-zinc-500">Preço mínimo (margem zero)</span><b>{precoMin ? brl(precoMin) : "—"}</b></div>
              <div className="flex items-center justify-between gap-2">
                <span className="text-zinc-500">Preço para margem de</span>
                <Input type="number" value={meta} onChange={(e) => setMeta(Number(e.target.value))} className="w-20" />
                <span>%</span>
                <b className="ml-auto">{precoMeta ? brl(precoMeta) : "—"}</b>
              </div>
              {precoMeta && (
                <Button type="button" variant="soft" size="sm" onClick={() => set("preco_venda", precoMeta.toFixed(2))}>Usar este preço</Button>
              )}
              <p className="text-xs text-zinc-500">Atenção aos degraus da Shopee: a partir de R$ 80 a taxa fixa sobe de R$ 4,50 para R$ 16, então R$ 79,99 pode render mais que R$ 85.</p>
            </div>
          </Card>
        </div>
      </form>
    </>
  );
}
