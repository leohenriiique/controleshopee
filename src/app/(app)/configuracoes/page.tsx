"use client";
import { useEffect, useState } from "react";
import { supabase, q } from "@/lib/supabase";
import { brl } from "@/lib/format";
import { Button, Card, Field, Input, Loading, PageHeader, Select, useData } from "@/components/ui";

const CAMPOS_CFG: { k: string; l: string; hint?: string; step?: string }[] = [
  { k: "aliquota_imposto_pct", l: "Imposto sobre a venda (%)", hint: "MEI: 0 (o DAS vai em custos fixos). Simples Anexo I: ~4% a 6%.", step: "0.01" },
  { k: "adicional_cpf_item", l: "Adicional CPF por item (R$)", hint: "Shopee cobra R$ 3/item de vendedor CPF com +450 pedidos em 90 dias.", step: "0.01" },
  { k: "frete_vendedor_padrao", l: "Frete pago pela loja por pedido (R$)", step: "0.01" },
  { k: "custo_kwh", l: "Energia (R$/kWh)", hint: "Veja na conta de luz, com impostos.", step: "0.01" },
  { k: "potencia_impressora_w", l: "Consumo médio da impressora (W)", hint: "Bambu/Ender com mesa quente: ~100–200 W." },
  { k: "depreciacao_hora", l: "Depreciação por hora de impressão (R$)", hint: "Ex.: impressora de R$ 3.000 ÷ 6.000 h + peças = ~R$ 0,60/h", step: "0.01" },
  { k: "perda_falhas_pct", l: "Perdas e falhas de filamento (%)", hint: "Purga, suportes, peças que falham.", step: "0.1" },
  { k: "dias_seguranca", l: "Estoque de segurança (dias de consumo)" },
  { k: "dias_horizonte_compra", l: "Cada compra deve cobrir (dias)" },
  { k: "dias_media_consumo", l: "Janela para consumo médio (dias)" },
  { k: "meta_margem_pct", l: "Meta de margem de contribuição (%)", step: "0.1" },
];

export default function Configuracoes() {
  const { data, loading, reload } = useData(async () => {
    const [cfg, faixas, emb, insumos] = await Promise.all([
      q(supabase.from("configuracoes").select("*").eq("id", 1).single()),
      q(supabase.from("faixas_taxa_shopee").select("*").order("preco_min")),
      q(supabase.from("embalagem_padrao").select("*, insumos(nome,unidade,custo_unitario)")),
      q(supabase.from("insumos").select("id,nome,unidade,categoria").eq("ativo", true).order("nome")),
    ]);
    return { cfg, faixas, emb, insumos };
  });
  const [cfg, setCfg] = useState<any>(null);
  const [salvo, setSalvo] = useState(false);
  const [novaEmb, setNovaEmb] = useState({ insumo_id: "", quantidade: 1 });

  useEffect(() => { if (data) setCfg(data.cfg); }, [data]);
  if (loading || !data || !cfg) return <Loading />;

  async function salvarCfg(e: React.FormEvent) {
    e.preventDefault();
    const { id, updated_at, ...rest } = cfg;
    const patch: any = { ...rest, updated_at: new Date().toISOString() };
    CAMPOS_CFG.forEach((c) => (patch[c.k] = Number(patch[c.k]) || 0));
    await q(supabase.from("configuracoes").update(patch).eq("id", 1));
    setSalvo(true);
    setTimeout(() => setSalvo(false), 2000);
  }
  async function updFaixa(id: string, k: string, v: string) {
    await q(supabase.from("faixas_taxa_shopee").update({ [k]: v === "" ? null : Number(v) }).eq("id", id));
    reload();
  }
  async function addFaixa() {
    await q(supabase.from("faixas_taxa_shopee").insert({ preco_min: 0, preco_max: null, comissao_pct: 14, taxa_fixa: 4 }));
    reload();
  }
  async function delFaixa(id: string) {
    await q(supabase.from("faixas_taxa_shopee").delete().eq("id", id));
    reload();
  }
  async function addEmb(e: React.FormEvent) {
    e.preventDefault();
    if (!novaEmb.insumo_id) return;
    await q(supabase.from("embalagem_padrao").upsert(novaEmb, { onConflict: "insumo_id" }));
    setNovaEmb({ insumo_id: "", quantidade: 1 });
    reload();
  }
  async function delEmb(id: string) {
    await q(supabase.from("embalagem_padrao").delete().eq("id", id));
    reload();
  }

  const custoEmb = data.emb.reduce((s: number, e: any) => s + Number(e.quantidade) * Number(e.insumos?.custo_unitario || 0), 0);

  return (
    <>
      <PageHeader title="Configurações" />
      <div className="grid gap-4 lg:grid-cols-2">
        <Card title="Custos e parâmetros">
          <form onSubmit={salvarCfg} className="grid gap-3 sm:grid-cols-2">
            <Field label="Nome da loja" className="sm:col-span-2"><Input value={cfg.nome_loja} onChange={(e) => setCfg({ ...cfg, nome_loja: e.target.value })} /></Field>
            <Field label="Tipo de vendedor">
              <Select value={cfg.tipo_vendedor} onChange={(e) => setCfg({ ...cfg, tipo_vendedor: e.target.value })}>
                <option value="cnpj">CNPJ</option><option value="cpf">CPF</option>
              </Select>
            </Field>
            {CAMPOS_CFG.map((c) => (
              <Field key={c.k} label={c.l} hint={c.hint}>
                <Input type="number" step={c.step || "1"} value={cfg[c.k]} onChange={(e) => setCfg({ ...cfg, [c.k]: e.target.value })} />
              </Field>
            ))}
            <div className="flex items-center justify-end gap-3 sm:col-span-2">
              {salvo && <span className="text-sm text-emerald-700">Salvo ✓</span>}
              <Button>Salvar</Button>
            </div>
          </form>
        </Card>

        <div className="space-y-4">
          <Card title="Taxas da Shopee por faixa de preço">
            <div className="grid grid-cols-[1fr_1fr_1fr_1fr_auto] gap-2 text-xs font-medium text-zinc-500">
              <span>De (R$)</span><span>Até (R$)</span><span>Comissão %</span><span>Taxa fixa R$</span><span />
            </div>
            <div className="mt-1 space-y-1">
              {data.faixas.map((f: any) => (
                <div key={f.id} className="grid grid-cols-[1fr_1fr_1fr_1fr_auto] gap-2">
                  {["preco_min", "preco_max", "comissao_pct", "taxa_fixa"].map((k) => (
                    <Input key={k} type="number" step="0.01" defaultValue={f[k] ?? ""} placeholder={k === "preco_max" ? "sem limite" : ""} onBlur={(e) => String(f[k] ?? "") !== e.target.value && updFaixa(f.id, k, e.target.value)} />
                  ))}
                  <Button size="sm" variant="danger" onClick={() => delFaixa(f.id)}>✕</Button>
                </div>
              ))}
            </div>
            <Button size="sm" variant="soft" className="mt-2" onClick={addFaixa}>+ Faixa</Button>
            <p className="mt-2 text-xs text-zinc-500">Pré-carregado com a tabela vigente desde 01/10/2026. Para itens baratos, a taxa fixa fica limitada a 50% do preço. Confira no Seller Centre quando a Shopee mudar.</p>
          </Card>

          <Card title={`Embalagem consumida por pedido · ${brl(custoEmb)}`}>
            <ul className="space-y-1 text-sm">
              {data.emb.map((e: any) => (
                <li key={e.id} className="flex items-center justify-between">
                  <span>{e.quantidade} {e.insumos?.unidade} · {e.insumos?.nome}</span>
                  <Button size="sm" variant="danger" onClick={() => delEmb(e.id)}>✕</Button>
                </li>
              ))}
            </ul>
            <form onSubmit={addEmb} className="mt-3 grid grid-cols-[1fr_80px_auto] gap-2 border-t pt-3">
              <Select value={novaEmb.insumo_id} onChange={(e) => setNovaEmb({ ...novaEmb, insumo_id: e.target.value })}>
                <option value="">Caixa, etiqueta, plástico bolha…</option>
                {data.insumos.map((i: any) => <option key={i.id} value={i.id}>{i.nome}</option>)}
              </Select>
              <Input type="number" step="0.01" value={novaEmb.quantidade} onChange={(e) => setNovaEmb({ ...novaEmb, quantidade: Number(e.target.value) })} />
              <Button>Adicionar</Button>
            </form>
            <p className="mt-2 text-xs text-zinc-500">Baixa do estoque quando o pedido é marcado como enviado.</p>
          </Card>
        </div>
      </div>
    </>
  );
}
