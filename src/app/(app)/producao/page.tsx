"use client";
import { useState } from "react";
import { supabase, q } from "@/lib/supabase";
import { dataBR, horas, num } from "@/lib/format";
import { Badge, Button, Field, Input, Loading, Modal, PageHeader, Select, useData } from "@/components/ui";

const COLUNAS = [
  { s: "aguardando", l: "Aguardando", cor: "border-t-sky-400" },
  { s: "imprimindo", l: "Imprimindo", cor: "border-t-orange-500" },
  { s: "acabamento", l: "Acabamento", cor: "border-t-violet-400" },
];

export default function Producao() {
  const { data, loading, reload } = useData(async () => {
    const [fila, concluidos, faltas, produtos] = await Promise.all([
      q(supabase.from("vw_fila").select("*").in("status", ["aguardando", "imprimindo", "acabamento"])
        .order("prioridade", { ascending: false }).order("prazo", { ascending: true, nullsFirst: false }).order("created_at")),
      q(supabase.from("vw_fila").select("*").in("status", ["concluido", "falhou"]).order("concluido_em", { ascending: false }).limit(15)),
      q(supabase.from("vw_estoque_reposicao").select("nome,disponivel,unidade").eq("situacao", "falta")),
      q(supabase.from("produtos").select("id,nome,variacao").eq("ativo", true).order("nome")),
    ]);
    return { fila, concluidos, faltas, produtos };
  });
  const [novo, setNovo] = useState(false);
  const [form, setForm] = useState({ produto_id: "", quantidade: 1 });

  async function atualizar(id: string, patch: any) {
    await q(supabase.from("fila_producao").update(patch).eq("id", id));
    reload();
  }
  async function produzirEstoque(e: React.FormEvent) {
    e.preventDefault();
    if (!form.produto_id) return;
    await q(supabase.from("fila_producao").insert({ produto_id: form.produto_id, quantidade: form.quantidade }));
    setNovo(false);
    reload();
  }

  if (loading || !data) return <Loading />;
  const hoje = new Date().toISOString().slice(0, 10);
  const tempoTotal = data.fila.reduce((s: number, f: any) => s + Number(f.tempo_total_min || 0), 0);

  return (
    <>
      <PageHeader title="Fila de produção" subtitle={`${data.fila.length} tarefas · ${horas(tempoTotal)} de impressão na fila`}>
        <Button variant="soft" onClick={() => setNovo(true)}>+ Produzir para estoque</Button>
      </PageHeader>

      {data.faltas.length > 0 && (
        <div className="mb-4 rounded-lg bg-rose-50 p-3 text-sm text-rose-800">
          <b>Material insuficiente para a fila:</b> {data.faltas.map((f: any) => `${f.nome} (${num(f.disponivel)} ${f.unidade})`).join(", ")}
        </div>
      )}

      <div className="grid gap-4 lg:grid-cols-3">
        {COLUNAS.map((c) => {
          const itens = data.fila.filter((f: any) => f.status === c.s);
          return (
            <div key={c.s} className={`rounded-xl border border-t-4 border-zinc-200 bg-zinc-50 p-3 ${c.cor}`}>
              <div className="mb-3 flex justify-between text-sm font-semibold">
                <span>{c.l}</span>
                <span className="text-zinc-400">{itens.length} · {horas(itens.reduce((s: number, f: any) => s + Number(f.tempo_total_min || 0), 0))}</span>
              </div>
              <div className="space-y-2">
                {itens.map((f: any) => {
                  const atrasado = f.prazo && f.prazo < hoje;
                  return (
                    <div key={f.id} className="rounded-lg bg-white p-3 text-sm shadow-sm ring-1 ring-zinc-200">
                      <div className="flex items-start justify-between gap-2">
                        <div>
                          <div className="font-medium">{f.quantidade}× {f.produto_nome}{f.variacao ? ` · ${f.variacao}` : ""}</div>
                          <div className="text-xs text-zinc-500">
                            {f.pedido_id ? `Pedido ${f.numero_shopee || "s/ nº"}${f.cliente ? " · " + f.cliente : ""}` : "Para estoque"} · {horas(f.tempo_total_min)}
                          </div>
                        </div>
                        <button title="Subir prioridade" className="text-zinc-400 hover:text-orange-600" onClick={() => atualizar(f.id, { prioridade: f.prioridade + 1 })}>▲</button>
                      </div>
                      <div className="mt-1 flex flex-wrap items-center gap-1">
                        {f.prazo && <Badge className={atrasado ? "bg-rose-100 text-rose-700" : "bg-zinc-100 text-zinc-600"}>envio {dataBR(f.prazo + "T12:00")}</Badge>}
                        {f.prioridade > 0 && <Badge className="bg-orange-100 text-orange-700">prioridade {f.prioridade}</Badge>}
                      </div>
                      <input
                        defaultValue={f.impressora || ""}
                        placeholder="Impressora"
                        onBlur={(e) => e.target.value !== (f.impressora || "") && atualizar(f.id, { impressora: e.target.value || null })}
                        className="mt-2 w-full rounded border border-zinc-200 px-2 py-1 text-xs"
                      />
                      <div className="mt-2 flex flex-wrap gap-1">
                        {c.s === "aguardando" && <Button size="sm" onClick={() => atualizar(f.id, { status: "imprimindo" })}>▶ Imprimir</Button>}
                        {c.s === "aguardando" && f.pedido_id && f.estoque_pronto >= f.quantidade && (
                          <Button size="sm" variant="soft" onClick={() => atualizar(f.id, { do_estoque: true, status: "concluido" })}>
                            Usar pronto ({f.estoque_pronto})
                          </Button>
                        )}
                        {c.s === "imprimindo" && <Button size="sm" onClick={() => atualizar(f.id, { status: "acabamento" })}>→ Acabamento</Button>}
                        {c.s !== "aguardando" && <Button size="sm" variant="soft" onClick={() => atualizar(f.id, { status: "concluido" })}>✓ Concluir</Button>}
                        {c.s === "imprimindo" && (
                          <Button size="sm" variant="danger" onClick={() => confirm("Marcar como falha? O material conta como perda e a peça volta para a fila.") && atualizar(f.id, { status: "falhou" })}>
                            ✗ Falhou
                          </Button>
                        )}
                      </div>
                    </div>
                  );
                })}
                {itens.length === 0 && <div className="py-6 text-center text-xs text-zinc-400">vazio</div>}
              </div>
            </div>
          );
        })}
      </div>

      <h2 className="mb-2 mt-8 text-sm font-semibold text-zinc-700">Últimos concluídos</h2>
      <div className="flex flex-wrap gap-2">
        {data.concluidos.map((f: any) => (
          <Badge key={f.id} className={f.status === "falhou" ? "bg-rose-50 text-rose-700" : "bg-white text-zinc-600 ring-1 ring-zinc-200"}>
            {f.status === "falhou" ? "✗" : "✓"} {f.quantidade}× {f.produto_nome} {f.do_estoque ? "(estoque)" : ""}
          </Badge>
        ))}
      </div>

      <Modal open={novo} onClose={() => setNovo(false)} title="Produzir para estoque">
        <form onSubmit={produzirEstoque} className="space-y-3">
          <Field label="Produto">
            <Select value={form.produto_id} onChange={(e) => setForm({ ...form, produto_id: e.target.value })} required>
              <option value="">Selecione…</option>
              {data.produtos.map((p: any) => <option key={p.id} value={p.id}>{p.nome}{p.variacao ? ` · ${p.variacao}` : ""}</option>)}
            </Select>
          </Field>
          <Field label="Quantidade"><Input type="number" min={1} value={form.quantidade} onChange={(e) => setForm({ ...form, quantidade: Number(e.target.value) })} /></Field>
          <p className="text-xs text-zinc-500">Ao concluir, as peças somam no “estoque pronto” do produto e podem atender pedidos sem imprimir de novo.</p>
          <div className="flex justify-end"><Button>Adicionar à fila</Button></div>
        </form>
      </Modal>
    </>
  );
}
