"use client";
import { useState } from "react";
import { supabase, q } from "@/lib/supabase";
import { brl, dataBR, num, SITUACAO_ESTOQUE } from "@/lib/format";
import { Badge, Button, Card, Field, Input, Loading, Modal, PageHeader, Select, Table, td, tdNum, useData } from "@/components/ui";

const CATEGORIAS: Record<string, string> = { filamento: "Filamento", embalagem: "Embalagem", acessorio: "Acessório", outro: "Outro" };
const TIPOS_MOV: Record<string, string> = {
  entrada: "Entrada", saida_producao: "Produção", saida_embalagem: "Embalagem", perda: "Perda", ajuste: "Ajuste",
};

export default function Estoque() {
  const { data, loading, reload } = useData(async () => {
    const [rep, compras, movs] = await Promise.all([
      q(supabase.from("vw_estoque_reposicao").select("*").order("categoria").order("nome")),
      q(supabase.from("compras").select("*, insumos(nome,unidade)").eq("status", "pedido").order("data_compra")),
      q(supabase.from("movimentos_estoque").select("*, insumos(nome,unidade)").order("created_at", { ascending: false }).limit(40)),
    ]);
    return { rep, compras, movs };
  });
  const [cat, setCat] = useState("todas");
  const [insumoModal, setInsumoModal] = useState<any>(null);
  const [compraModal, setCompraModal] = useState<any>(null);
  const [ajusteModal, setAjusteModal] = useState<any>(null);

  if (loading || !data) return <Loading />;
  const ordem: Record<string, number> = { falta: 0, critico: 1, comprar: 2, ok: 3 };
  const lista = data.rep
    .filter((i: any) => cat === "todas" || i.categoria === cat)
    .sort((a: any, b: any) => ordem[a.situacao] - ordem[b.situacao]);
  const valorEstoque = data.rep.reduce((s: number, i: any) => s + Math.max(0, Number(i.estoque_atual)) * Number(i.custo_unitario), 0);
  const alertas = data.rep.filter((i: any) => i.situacao !== "ok").length;

  async function receber(c: any) {
    await q(supabase.from("compras").update({ status: "recebido" }).eq("id", c.id));
    reload();
  }
  async function cancelarCompra(c: any) {
    if (!confirm("Cancelar esta compra?")) return;
    await q(supabase.from("compras").update({ status: "cancelado" }).eq("id", c.id));
    reload();
  }

  return (
    <>
      <PageHeader title="Estoque e compras" subtitle={`Valor em estoque ${brl(valorEstoque)} · ${alertas} insumo(s) pedindo reposição`}>
        <Button variant="soft" onClick={() => setCompraModal({})}>+ Registrar compra</Button>
        <Button onClick={() => setInsumoModal({})}>+ Novo insumo</Button>
      </PageHeader>

      <Card className="mb-4">
        <p className="text-sm text-zinc-600">
          <b>Como o ponto de pedido é calculado:</b> consumo médio diário (últimos dias) × (prazo do fornecedor + dias de segurança), nunca abaixo do mínimo manual.
          O <b>disponível</b> já desconta o que a fila de produção e os pedidos ainda não enviados vão consumir. Quando disponível + em trânsito chega ao ponto de pedido, o item vira <b>Comprar</b>,
          e a sugestão cobre o prazo do fornecedor + o horizonte de compra.
        </p>
      </Card>

      <div className="mb-3 flex flex-wrap gap-2">
        {["todas", ...Object.keys(CATEGORIAS)].map((c) => (
          <button key={c} onClick={() => setCat(c)} className={`rounded-full px-3 py-1 text-sm ${cat === c ? "bg-zinc-900 text-white" : "bg-white text-zinc-600 ring-1 ring-zinc-200"}`}>
            {c === "todas" ? "Todas" : CATEGORIAS[c]}
          </button>
        ))}
      </div>

      <Table head={["Insumo", "Atual", "Comprometido", "Disponível", "Em trânsito", "Consumo/dia", "Cobertura", "Ponto de pedido", "Situação", "Sugestão", ""]} empty={lista.length === 0}>
        {lista.map((i: any) => (
          <tr key={i.id} className="hover:bg-zinc-50">
            <td className={td}>
              <button className="font-medium text-orange-700 hover:underline" onClick={() => setInsumoModal(i)}>{i.nome}</button>
              <div className="text-xs text-zinc-500">{CATEGORIAS[i.categoria]} · {brl(i.custo_unitario)}/{i.unidade} · entrega {i.lead_time_dias}d</div>
            </td>
            <td className={tdNum}>{num(i.estoque_atual, 1)} {i.unidade}</td>
            <td className={tdNum}>{num(i.comprometido, 1)}</td>
            <td className={`${tdNum} font-medium ${Number(i.disponivel) <= 0 ? "text-rose-600" : ""}`}>{num(i.disponivel, 1)}</td>
            <td className={tdNum}>{num(i.em_transito, 1)}</td>
            <td className={tdNum}>{num(i.consumo_diario, 2)}</td>
            <td className={tdNum}>{i.dias_cobertura === null ? "—" : `${num(i.dias_cobertura)} d`}</td>
            <td className={tdNum}>{num(i.ponto_pedido, 1)}</td>
            <td className={td}><Badge className={SITUACAO_ESTOQUE[i.situacao].cor}>{SITUACAO_ESTOQUE[i.situacao].label}</Badge></td>
            <td className={tdNum}>{Number(i.sugestao_compra) > 0 ? `${num(i.sugestao_compra)} ${i.unidade}` : "—"}</td>
            <td className={td}>
              <div className="flex gap-1">
                <Button size="sm" variant="soft" onClick={() => setCompraModal({ insumo_id: i.id, quantidade: Number(i.sugestao_compra) || "", fornecedor: i.fornecedor })}>Comprar</Button>
                <Button size="sm" variant="ghost" onClick={() => setAjusteModal(i)}>Ajustar</Button>
                {i.link_compra && <a href={i.link_compra} target="_blank" rel="noreferrer" className="px-2 py-1 text-xs text-zinc-500 hover:underline">link</a>}
              </div>
            </td>
          </tr>
        ))}
      </Table>

      <div className="mt-8 grid gap-4 lg:grid-cols-2">
        <Card title={`Compras a caminho (${data.compras.length})`}>
          {data.compras.length === 0 ? <p className="text-sm text-zinc-400">Nenhuma compra pendente.</p> : (
            <ul className="divide-y divide-zinc-100 text-sm">
              {data.compras.map((c: any) => (
                <li key={c.id} className="flex items-center justify-between gap-2 py-2">
                  <div>
                    <div className="font-medium">{num(c.quantidade)} {c.insumos?.unidade} · {c.insumos?.nome}</div>
                    <div className="text-xs text-zinc-500">{brl(c.valor_total)} · {c.fornecedor || "—"} · pedido {dataBR(c.data_compra + "T12:00")}{c.previsao_chegada ? ` · chega ${dataBR(c.previsao_chegada + "T12:00")}` : ""}</div>
                  </div>
                  <div className="flex gap-1">
                    <Button size="sm" onClick={() => receber(c)}>Recebido</Button>
                    <Button size="sm" variant="danger" onClick={() => cancelarCompra(c)}>✕</Button>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </Card>
        <Card title="Últimas movimentações">
          <ul className="max-h-96 divide-y divide-zinc-100 overflow-y-auto text-sm">
            {data.movs.map((m: any) => (
              <li key={m.id} className="flex justify-between gap-2 py-1.5">
                <span className="truncate">{m.insumos?.nome} <span className="text-xs text-zinc-400">· {TIPOS_MOV[m.tipo]}{m.observacao ? ` · ${m.observacao}` : ""}</span></span>
                <span className={`whitespace-nowrap tabular-nums ${Number(m.quantidade) < 0 ? "text-rose-600" : "text-emerald-700"}`}>
                  {Number(m.quantidade) > 0 ? "+" : ""}{num(m.quantidade, 1)} {m.insumos?.unidade}
                </span>
              </li>
            ))}
          </ul>
        </Card>
      </div>

      {insumoModal && <InsumoForm inicial={insumoModal} onClose={() => setInsumoModal(null)} onSaved={() => { setInsumoModal(null); reload(); }} />}
      {compraModal && <CompraForm inicial={compraModal} insumos={data.rep} onClose={() => setCompraModal(null)} onSaved={() => { setCompraModal(null); reload(); }} />}
      {ajusteModal && <AjusteForm insumo={ajusteModal} onClose={() => setAjusteModal(null)} onSaved={() => { setAjusteModal(null); reload(); }} />}
    </>
  );
}

function InsumoForm({ inicial, onClose, onSaved }: { inicial: any; onClose: () => void; onSaved: () => void }) {
  const novo = !inicial.id;
  const [f, setF] = useState<any>({
    nome: "", categoria: "filamento", unidade: "g", material: "", cor: "", lead_time_dias: 7, estoque_minimo_manual: 0,
    fornecedor: "", link_compra: "", ativo: true, estoque_inicial: 0, custo_inicial: 0, ...inicial,
  });
  const set = (k: string, v: any) => setF((x: any) => ({ ...x, [k]: v }));

  async function salvar(e: React.FormEvent) {
    e.preventDefault();
    const dados = {
      nome: f.nome, categoria: f.categoria, unidade: f.unidade, material: f.material || null, cor: f.cor || null,
      lead_time_dias: Number(f.lead_time_dias), estoque_minimo_manual: Number(f.estoque_minimo_manual),
      fornecedor: f.fornecedor || null, link_compra: f.link_compra || null, ativo: f.ativo,
    };
    if (novo) {
      const ins = await q(supabase.from("insumos").insert(dados).select("id").single());
      if (Number(f.estoque_inicial) > 0) {
        await q(supabase.from("movimentos_estoque").insert({
          insumo_id: ins.id, tipo: "entrada", quantidade: Number(f.estoque_inicial), custo_unitario: Number(f.custo_inicial), observacao: "Estoque inicial",
        }));
      } else if (Number(f.custo_inicial) > 0) {
        await q(supabase.from("insumos").update({ custo_unitario: Number(f.custo_inicial) }).eq("id", ins.id));
      }
    } else {
      await q(supabase.from("insumos").update(dados).eq("id", inicial.id));
    }
    onSaved();
  }

  const dicaUnidade = f.categoria === "filamento" ? "Use gramas: rolo de 1 kg = 1000 g. Custo por grama = preço do rolo ÷ 1000." : "";

  return (
    <Modal open onClose={onClose} title={novo ? "Novo insumo" : `Editar ${inicial.nome}`}>
      <form onSubmit={salvar} className="grid grid-cols-2 gap-3">
        <Field label="Nome" className="col-span-2"><Input value={f.nome} onChange={(e) => set("nome", e.target.value)} required placeholder="PLA Preto Voolt, Caixa 12x8x4, Argola 25mm…" /></Field>
        <Field label="Categoria">
          <Select value={f.categoria} onChange={(e) => { set("categoria", e.target.value); set("unidade", e.target.value === "filamento" ? "g" : "un"); }}>
            {Object.entries(CATEGORIAS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
          </Select>
        </Field>
        <Field label="Unidade" hint={dicaUnidade}>
          <Select value={f.unidade} onChange={(e) => set("unidade", e.target.value)}>
            <option value="g">g (gramas)</option><option value="un">un (unidade)</option><option value="m">m (metro)</option><option value="ml">ml</option>
          </Select>
        </Field>
        {f.categoria === "filamento" && (<>
          <Field label="Material"><Input value={f.material || ""} onChange={(e) => set("material", e.target.value)} placeholder="PLA, PETG…" /></Field>
          <Field label="Cor"><Input value={f.cor || ""} onChange={(e) => set("cor", e.target.value)} /></Field>
        </>)}
        <Field label="Prazo de entrega do fornecedor (dias)"><Input type="number" value={f.lead_time_dias} onChange={(e) => set("lead_time_dias", e.target.value)} /></Field>
        <Field label="Estoque mínimo manual" hint="Piso enquanto não há histórico de consumo"><Input type="number" value={f.estoque_minimo_manual} onChange={(e) => set("estoque_minimo_manual", e.target.value)} /></Field>
        <Field label="Fornecedor"><Input value={f.fornecedor || ""} onChange={(e) => set("fornecedor", e.target.value)} /></Field>
        <Field label="Link de compra"><Input value={f.link_compra || ""} onChange={(e) => set("link_compra", e.target.value)} /></Field>
        {novo && (<>
          <Field label={`Estoque inicial (${f.unidade})`}><Input type="number" step="0.01" value={f.estoque_inicial} onChange={(e) => set("estoque_inicial", e.target.value)} /></Field>
          <Field label={`Custo por ${f.unidade} (R$)`}><Input type="number" step="0.0001" value={f.custo_inicial} onChange={(e) => set("custo_inicial", e.target.value)} /></Field>
        </>)}
        {!novo && <label className="col-span-2 flex items-center gap-2 text-sm"><input type="checkbox" checked={f.ativo} onChange={(e) => set("ativo", e.target.checked)} /> Ativo</label>}
        <div className="col-span-2 flex justify-end"><Button>Salvar</Button></div>
      </form>
    </Modal>
  );
}

function CompraForm({ inicial, insumos, onClose, onSaved }: { inicial: any; insumos: any[]; onClose: () => void; onSaved: () => void }) {
  const [f, setF] = useState<any>({ insumo_id: "", quantidade: "", valor_total: "", fornecedor: "", status: "pedido", previsao_chegada: "", ...inicial });
  const set = (k: string, v: any) => setF((x: any) => ({ ...x, [k]: v }));
  const ins = insumos.find((i) => i.id === f.insumo_id);
  const unit = Number(f.quantidade) > 0 ? Number(f.valor_total) / Number(f.quantidade) : 0;

  async function salvar(e: React.FormEvent) {
    e.preventDefault();
    await q(supabase.from("compras").insert({
      insumo_id: f.insumo_id, quantidade: Number(f.quantidade), valor_total: Number(f.valor_total) || 0,
      fornecedor: f.fornecedor || null, status: f.status, previsao_chegada: f.previsao_chegada || null,
    }));
    onSaved();
  }

  return (
    <Modal open onClose={onClose} title="Registrar compra">
      <form onSubmit={salvar} className="grid grid-cols-2 gap-3">
        <Field label="Insumo" className="col-span-2">
          <Select value={f.insumo_id} onChange={(e) => set("insumo_id", e.target.value)} required>
            <option value="">Selecione…</option>
            {insumos.map((i) => <option key={i.id} value={i.id}>{i.nome}</option>)}
          </Select>
        </Field>
        <Field label={`Quantidade${ins ? ` (${ins.unidade})` : ""}`}><Input type="number" step="0.01" value={f.quantidade} onChange={(e) => set("quantidade", e.target.value)} required /></Field>
        <Field label="Valor total pago (com frete)" hint={unit ? `= ${brl(unit)} por ${ins?.unidade || "un"}` : ""}><Input type="number" step="0.01" value={f.valor_total} onChange={(e) => set("valor_total", e.target.value)} /></Field>
        <Field label="Fornecedor"><Input value={f.fornecedor || ""} onChange={(e) => set("fornecedor", e.target.value)} /></Field>
        <Field label="Previsão de chegada"><Input type="date" value={f.previsao_chegada} onChange={(e) => set("previsao_chegada", e.target.value)} /></Field>
        <Field label="Situação" className="col-span-2">
          <Select value={f.status} onChange={(e) => set("status", e.target.value)}>
            <option value="pedido">Comprado, aguardando entrega (conta como em trânsito)</option>
            <option value="recebido">Já recebido (entra no estoque agora)</option>
          </Select>
        </Field>
        <div className="col-span-2 flex justify-end"><Button>Salvar</Button></div>
      </form>
    </Modal>
  );
}

function AjusteForm({ insumo, onClose, onSaved }: { insumo: any; onClose: () => void; onSaved: () => void }) {
  const [modo, setModo] = useState<"contagem" | "perda">("contagem");
  const [valor, setValor] = useState<any>(insumo.estoque_atual);
  const [obs, setObs] = useState("");

  async function salvar(e: React.FormEvent) {
    e.preventDefault();
    const v = Number(valor);
    const quantidade = modo === "contagem" ? v - Number(insumo.estoque_atual) : -Math.abs(v);
    if (!quantidade) return onClose();
    await q(supabase.from("movimentos_estoque").insert({
      insumo_id: insumo.id, tipo: modo === "contagem" ? "ajuste" : "perda", quantidade,
      custo_unitario: insumo.custo_unitario, observacao: obs || (modo === "contagem" ? "Contagem física" : "Perda"),
    }));
    onSaved();
  }

  return (
    <Modal open onClose={onClose} title={`Ajustar ${insumo.nome}`}>
      <form onSubmit={salvar} className="space-y-3">
        <div className="flex gap-2">
          <Button type="button" variant={modo === "contagem" ? "primary" : "soft"} onClick={() => { setModo("contagem"); setValor(insumo.estoque_atual); }}>Contagem física</Button>
          <Button type="button" variant={modo === "perda" ? "primary" : "soft"} onClick={() => { setModo("perda"); setValor(""); }}>Registrar perda</Button>
        </div>
        <Field label={modo === "contagem" ? `Quantidade contada (${insumo.unidade})` : `Quantidade perdida (${insumo.unidade})`} hint={modo === "contagem" ? `Sistema: ${num(insumo.estoque_atual, 1)} ${insumo.unidade}` : ""}>
          <Input type="number" step="0.01" value={valor} onChange={(e) => setValor(e.target.value)} required />
        </Field>
        <Field label="Observação"><Input value={obs} onChange={(e) => setObs(e.target.value)} /></Field>
        <div className="flex justify-end"><Button>Salvar</Button></div>
      </form>
    </Modal>
  );
}
