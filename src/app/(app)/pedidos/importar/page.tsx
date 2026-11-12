"use client";
import { useMemo, useState } from "react";
import Link from "next/link";
import * as XLSX from "xlsx";
import { supabase, q } from "@/lib/supabase";
import { brl, dataBR, STATUS_PEDIDO } from "@/lib/format";
import { CAMPOS, agruparPedidos, casarProduto, detectarMapa, PedidoImport } from "@/lib/shopeeImport";
import { Badge, Button, Card, Field, PageHeader, Select, Table, td, tdNum, useData } from "@/components/ui";

const TERMINAIS = ["enviado", "entregue", "cancelado", "devolvido"];

export default function Importar() {
  const { data: base, reload: reloadBase } = useData(async () => {
    const [produtos, aliases, existentes] = await Promise.all([
      q(supabase.from("produtos").select("id,nome,variacao,sku").order("nome")),
      q(supabase.from("produto_aliases").select("texto,produto_id")),
      q(supabase.from("pedidos").select("id,numero_shopee,status").not("numero_shopee", "is", null)),
    ]);
    return { produtos, aliases, existentes };
  });

  const [arquivo, setArquivo] = useState("");
  const [cabecalhos, setCabecalhos] = useState<string[]>([]);
  const [linhas, setLinhas] = useState<any[]>([]);
  const [mapa, setMapa] = useState<Record<string, string>>({});
  const [vinculos, setVinculos] = useState<Record<string, string>>({}); // chave item -> produto_id
  const [historico, setHistorico] = useState(true);
  const [ignorarCancelados, setIgnorarCancelados] = useState(true);
  const [busy, setBusy] = useState(false);
  const [resultado, setResultado] = useState<string>("");

  async function lerArquivo(f: File) {
    const buf = await f.arrayBuffer();
    const wb = XLSX.read(buf, { type: "array", cellDates: true });
    const ws = wb.Sheets[wb.SheetNames[0]];
    const rows: any[] = XLSX.utils.sheet_to_json(ws, { defval: "", raw: true });
    const heads = rows.length ? Object.keys(rows[0]) : [];
    setArquivo(f.name);
    setCabecalhos(heads);
    setLinhas(rows);
    setMapa(detectarMapa(heads));
    setVinculos({});
    setResultado("");
  }

  const pedidos: PedidoImport[] = useMemo(() => (linhas.length ? agruparPedidos(linhas, mapa) : []), [linhas, mapa]);

  const analise = useMemo(() => {
    if (!base) return null;
    const existentes = new Map(base.existentes.map((p: any) => [p.numero_shopee, p]));
    const semProduto = new Map<string, { chave: string; sku: string; qtd: number }>();
    let novos = 0, atualizar = 0, ignorados = 0;
    for (const p of pedidos) {
      const ex: any = existentes.get(p.numero);
      if (p.status === "nao_pago" || (ignorarCancelados && p.status === "cancelado" && !ex)) { ignorados++; continue; }
      if (ex) { if (TERMINAIS.includes(p.status) && ex.status !== p.status) atualizar++; continue; }
      novos++;
      for (const it of p.itens) {
        if (!casarProduto(it, base.produtos, base.aliases) && !vinculos[it.chave]) {
          const s = semProduto.get(it.chave);
          semProduto.set(it.chave, { chave: it.chave, sku: it.sku, qtd: (s?.qtd || 0) + it.qtd });
        }
      }
    }
    return { existentes, novos, atualizar, ignorados, semProduto: [...semProduto.values()] };
  }, [pedidos, base, vinculos, ignorarCancelados]);

  const faltaCampo = CAMPOS.filter((c) => c.obrig && !mapa[c.key]);

  async function importar() {
    if (!base || !analise) return;
    setBusy(true);
    let criados = 0, atualizados = 0, erros = 0;
    try {
      // salva os vínculos novos como apelidos para as próximas importações
      const novosAliases = Object.entries(vinculos).filter(([, id]) => id).map(([texto, produto_id]) => ({ texto, produto_id }));
      if (novosAliases.length) await supabase.from("produto_aliases").upsert(novosAliases, { onConflict: "texto" });
      const aliases = [...base.aliases, ...novosAliases];

      for (const p of pedidos) {
        const ex: any = analise.existentes.get(p.numero);
        if (p.status === "nao_pago") continue;
        if (ex) {
          if (TERMINAIS.includes(p.status) && ex.status !== p.status) {
            const { error } = await supabase.from("pedidos").update({ status: p.status }).eq("id", ex.id);
            error ? erros++ : atualizados++;
          }
          continue;
        }
        if (ignorarCancelados && p.status === "cancelado") continue;
        const ehHistorico = historico && TERMINAIS.includes(p.status);
        const { data: ped, error } = await supabase
          .from("pedidos")
          .insert({
            numero_shopee: p.numero,
            origem: "shopee",
            cliente: p.cliente || null,
            status: p.status,
            data_pedido: (p.data || new Date()).toISOString(),
            prazo_envio: p.prazo ? p.prazo.toISOString().slice(0, 10) : null,
            desconto_loja: p.cupom || 0,
            taxas_reais: p.taxas,
            historico: ehHistorico,
            embalagem_baixada: ehHistorico,
          })
          .select("id")
          .single();
        if (error) { erros++; continue; }
        const itens = p.itens.map((it) => ({
          pedido_id: ped.id,
          produto_id: casarProduto(it, base.produtos, aliases) || vinculos[it.chave] || null,
          descricao: it.chave,
          quantidade: it.qtd,
          preco_unitario: it.preco,
        }));
        const r = await supabase.from("pedido_itens").insert(itens);
        r.error ? erros++ : criados++;
      }
      setResultado(`${criados} pedidos importados · ${atualizados} atualizados${erros ? ` · ${erros} com erro` : ""}.`);
      setLinhas([]);
      reloadBase();
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      <PageHeader title="Importar pedidos da Shopee" subtitle="Seller Centre → Meus pedidos → Exportar. Envie o .xlsx gerado.">
        <Link href="/pedidos"><Button variant="ghost">← Voltar</Button></Link>
      </PageHeader>

      {resultado && <div className="mb-4 rounded-lg bg-emerald-50 p-3 text-sm text-emerald-800">{resultado} <Link href="/pedidos" className="underline">Ver pedidos</Link></div>}

      <Card>
        <label className="flex cursor-pointer flex-col items-center justify-center rounded-lg border-2 border-dashed border-zinc-300 p-8 text-center hover:border-orange-400">
          <span className="text-sm font-medium">{arquivo || "Clique para escolher a planilha (.xlsx ou .csv)"}</span>
          <span className="text-xs text-zinc-500">Pedidos já importados não duplicam: só atualizam o status (enviado, entregue, cancelado).</span>
          <input type="file" accept=".xlsx,.xls,.csv" className="hidden" onChange={(e) => e.target.files?.[0] && lerArquivo(e.target.files[0])} />
        </label>
      </Card>

      {cabecalhos.length > 0 && (
        <>
          <Card className="mt-4" title="Colunas da planilha">
            <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
              {CAMPOS.map((c) => (
                <Field key={c.key} label={`${c.label}${c.obrig ? " *" : ""}`}>
                  <Select value={mapa[c.key] || ""} onChange={(e) => setMapa((m) => ({ ...m, [c.key]: e.target.value }))} className={c.obrig && !mapa[c.key] ? "border-rose-400" : ""}>
                    <option value="">— não usar —</option>
                    {cabecalhos.map((h) => <option key={h} value={h}>{h}</option>)}
                  </Select>
                </Field>
              ))}
            </div>
            <div className="mt-4 flex flex-wrap gap-6 text-sm">
              <label className="flex items-center gap-2">
                <input type="checkbox" checked={historico} onChange={(e) => setHistorico(e.target.checked)} />
                Pedidos já enviados/entregues entram como histórico (sem produção e sem baixa de estoque)
              </label>
              <label className="flex items-center gap-2">
                <input type="checkbox" checked={ignorarCancelados} onChange={(e) => setIgnorarCancelados(e.target.checked)} />
                Ignorar pedidos cancelados novos
              </label>
            </div>
          </Card>

          {faltaCampo.length > 0 ? (
            <p className="mt-4 text-sm text-rose-600">Escolha a coluna de: {faltaCampo.map((c) => c.label).join(", ")}.</p>
          ) : analise && (
            <>
              {analise.semProduto.length > 0 && (
                <Card className="mt-4" title={`Itens sem produto cadastrado (${analise.semProduto.length}) — vincule para calcular custo e gerar produção`}>
                  <div className="space-y-2">
                    {analise.semProduto.map((s) => (
                      <div key={s.chave} className="grid items-center gap-2 text-sm sm:grid-cols-[2fr_1fr]">
                        <div><span className="font-medium">{s.chave}</span> <span className="text-xs text-zinc-500">{s.sku && `SKU ${s.sku} · `}{s.qtd} un.</span></div>
                        <Select value={vinculos[s.chave] || ""} onChange={(e) => setVinculos((v) => ({ ...v, [s.chave]: e.target.value }))}>
                          <option value="">Deixar sem vínculo (vincular depois)</option>
                          {base!.produtos.map((p: any) => <option key={p.id} value={p.id}>{p.nome}{p.variacao ? ` · ${p.variacao}` : ""}</option>)}
                        </Select>
                      </div>
                    ))}
                  </div>
                  <p className="mt-2 text-xs text-zinc-500">O vínculo fica salvo: nas próximas importações esse item é reconhecido sozinho. Dica: cadastre o SKU da Shopee no produto.</p>
                </Card>
              )}

              <div className="mt-4 flex flex-wrap items-center justify-between gap-3">
                <div className="text-sm text-zinc-600">
                  <b>{analise.novos}</b> novos · <b>{analise.atualizar}</b> com status para atualizar · {analise.ignorados} ignorados
                </div>
                <Button onClick={importar} disabled={busy || (analise.novos === 0 && analise.atualizar === 0)}>
                  {busy ? "Importando…" : "Importar"}
                </Button>
              </div>

              <div className="mt-3">
                <Table head={["Pedido", "Data", "Cliente", "Itens", "Total", "Taxas Shopee", "Status", ""]}>
                  {pedidos.slice(0, 200).map((p) => {
                    const ex = analise.existentes.get(p.numero);
                    const st = STATUS_PEDIDO[p.status];
                    return (
                      <tr key={p.numero}>
                        <td className={td}>{p.numero}</td>
                        <td className={td}>{dataBR(p.data)}</td>
                        <td className={td}>{p.cliente || "—"}</td>
                        <td className={td}>{p.itens.map((i) => `${i.qtd}× ${i.chave}`).join("; ")}</td>
                        <td className={tdNum}>{brl(p.itens.reduce((s, i) => s + i.qtd * i.preco, 0))}</td>
                        <td className={tdNum}>{p.taxas === null ? "calculada" : brl(p.taxas)}</td>
                        <td className={td}>{st ? <Badge className={st.cor}>{st.label}</Badge> : <Badge className="bg-zinc-100">não pago</Badge>}</td>
                        <td className={td}>{ex ? <Badge className="bg-zinc-100 text-zinc-500">já existe</Badge> : null}</td>
                      </tr>
                    );
                  })}
                </Table>
              </div>
            </>
          )}
        </>
      )}
    </>
  );
}
