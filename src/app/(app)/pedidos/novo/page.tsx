"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";
import { supabase, q } from "@/lib/supabase";
import { brl } from "@/lib/format";
import { Button, Card, Field, Input, Loading, PageHeader, Select, useData } from "@/components/ui";

type Item = { produto_id: string; quantidade: number; preco_unitario: number };

export default function NovoPedido() {
  const r = useRouter();
  const { data: produtos, loading } = useData(() => q(supabase.from("produtos").select("id,nome,variacao,preco_venda").eq("ativo", true).order("nome")));
  const { data: cfg } = useData(() => q(supabase.from("configuracoes").select("frete_vendedor_padrao").eq("id", 1).single()));
  const hoje = new Date().toISOString().slice(0, 10);
  const [f, setF] = useState<any>({ origem: "shopee", numero_shopee: "", cliente: "", data_pedido: hoje, prazo_envio: "", desconto_loja: 0, frete_vendedor: "", observacoes: "" });
  const [itens, setItens] = useState<Item[]>([{ produto_id: "", quantidade: 1, preco_unitario: 0 }]);
  const [busy, setBusy] = useState(false);

  const set = (k: string, v: any) => setF((x: any) => ({ ...x, [k]: v }));
  const setItem = (i: number, k: keyof Item, v: any) =>
    setItens((xs) =>
      xs.map((x, j) => {
        if (j !== i) return x;
        const n = { ...x, [k]: v };
        if (k === "produto_id") n.preco_unitario = Number(produtos?.find((p: any) => p.id === v)?.preco_venda || 0);
        return n;
      })
    );

  const total = itens.reduce((s, i) => s + i.quantidade * i.preco_unitario, 0);

  async function salvar(e: React.FormEvent) {
    e.preventDefault();
    const validos = itens.filter((i) => i.produto_id && i.quantidade > 0);
    if (!validos.length) return alert("Adicione pelo menos um item.");
    setBusy(true);
    try {
      const ped = await q(
        supabase
          .from("pedidos")
          .insert({
            origem: f.origem,
            numero_shopee: f.numero_shopee || null,
            cliente: f.cliente || null,
            data_pedido: new Date(f.data_pedido + "T12:00").toISOString(),
            prazo_envio: f.prazo_envio || null,
            desconto_loja: Number(f.desconto_loja) || 0,
            frete_vendedor: f.frete_vendedor === "" ? Number(cfg?.frete_vendedor_padrao || 0) : Number(f.frete_vendedor),
            observacoes: f.observacoes || null,
          })
          .select("id")
          .single()
      );
      await q(supabase.from("pedido_itens").insert(validos.map((i) => ({ ...i, pedido_id: ped.id }))));
      r.push("/pedidos");
    } finally {
      setBusy(false);
    }
  }

  if (loading) return <Loading />;

  return (
    <>
      <PageHeader title="Novo pedido" subtitle="Ao salvar, os itens entram automaticamente na fila de produção." />
      <form onSubmit={salvar} className="grid gap-4 lg:grid-cols-[1fr_2fr]">
        <Card title="Dados do pedido">
          <div className="space-y-3">
            <Field label="Origem">
              <Select value={f.origem} onChange={(e) => set("origem", e.target.value)}>
                <option value="shopee">Shopee (calcula taxas)</option>
                <option value="manual">Venda direta (sem taxa)</option>
                <option value="outro">Outro canal</option>
              </Select>
            </Field>
            <Field label="Nº do pedido"><Input value={f.numero_shopee} onChange={(e) => set("numero_shopee", e.target.value)} /></Field>
            <Field label="Cliente"><Input value={f.cliente} onChange={(e) => set("cliente", e.target.value)} /></Field>
            <div className="grid grid-cols-2 gap-3">
              <Field label="Data"><Input type="date" value={f.data_pedido} onChange={(e) => set("data_pedido", e.target.value)} /></Field>
              <Field label="Prazo de envio"><Input type="date" value={f.prazo_envio} onChange={(e) => set("prazo_envio", e.target.value)} /></Field>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <Field label="Cupom da loja (R$)"><Input type="number" step="0.01" value={f.desconto_loja} onChange={(e) => set("desconto_loja", e.target.value)} /></Field>
              <Field label="Frete pago pela loja" hint={`padrão ${brl(cfg?.frete_vendedor_padrao || 0)}`}>
                <Input type="number" step="0.01" value={f.frete_vendedor} placeholder="padrão" onChange={(e) => set("frete_vendedor", e.target.value)} />
              </Field>
            </div>
            <Field label="Observações (personalização, cor, nome…)">
              <textarea className="w-full rounded-lg border border-zinc-300 p-2 text-sm" rows={3} value={f.observacoes} onChange={(e) => set("observacoes", e.target.value)} />
            </Field>
          </div>
        </Card>

        <Card title="Itens">
          <div className="space-y-2">
            {itens.map((it, i) => (
              <div key={i} className="grid grid-cols-[1fr_80px_110px_auto] items-end gap-2">
                <Field label={i === 0 ? "Produto" : ""}>
                  <Select value={it.produto_id} onChange={(e) => setItem(i, "produto_id", e.target.value)}>
                    <option value="">Selecione…</option>
                    {(produtos || []).map((p: any) => <option key={p.id} value={p.id}>{p.nome}{p.variacao ? ` · ${p.variacao}` : ""}</option>)}
                  </Select>
                </Field>
                <Field label={i === 0 ? "Qtd" : ""}><Input type="number" min={1} value={it.quantidade} onChange={(e) => setItem(i, "quantidade", Number(e.target.value))} /></Field>
                <Field label={i === 0 ? "Preço un." : ""}><Input type="number" step="0.01" value={it.preco_unitario} onChange={(e) => setItem(i, "preco_unitario", Number(e.target.value))} /></Field>
                <Button type="button" variant="danger" onClick={() => setItens((xs) => xs.filter((_, j) => j !== i))}>✕</Button>
              </div>
            ))}
          </div>
          <div className="mt-3 flex items-center justify-between">
            <Button type="button" variant="soft" onClick={() => setItens((xs) => [...xs, { produto_id: "", quantidade: 1, preco_unitario: 0 }])}>+ Item</Button>
            <div className="text-right">
              <div className="text-xs text-zinc-500">Total dos produtos</div>
              <div className="text-xl font-semibold">{brl(total)}</div>
            </div>
          </div>
          <div className="mt-6 flex justify-end gap-2">
            <Button type="button" variant="ghost" onClick={() => r.back()}>Cancelar</Button>
            <Button disabled={busy}>{busy ? "Salvando…" : "Salvar pedido"}</Button>
          </div>
        </Card>
      </form>
    </>
  );
}
