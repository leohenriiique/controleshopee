export const brl = (v: any) =>
  v === null || v === undefined || v === ""
    ? "—"
    : Number(v).toLocaleString("pt-BR", { style: "currency", currency: "BRL" });

export const num = (v: any, d = 0) =>
  v === null || v === undefined || v === ""
    ? "—"
    : Number(v).toLocaleString("pt-BR", { maximumFractionDigits: d, minimumFractionDigits: 0 });

export const pct = (v: any) => (v === null || v === undefined ? "—" : `${num(v, 1)}%`);

export const dataBR = (v: any) => (v ? new Date(v).toLocaleDateString("pt-BR") : "—");

export const horas = (min: number) => {
  const h = Math.floor((min || 0) / 60);
  const m = Math.round((min || 0) % 60);
  return h ? `${h}h${m ? String(m).padStart(2, "0") : ""}` : `${m}min`;
};

/** Converte "R$ 1.234,56", "19,90", 19.9 → número */
export function parseNum(v: any): number {
  if (typeof v === "number") return v;
  if (v === null || v === undefined) return 0;
  let s = String(v).replace(/[R$\s]/g, "").trim();
  if (!s) return 0;
  if (s.includes(",") && s.includes(".")) s = s.replace(/\./g, "").replace(",", ".");
  else if (s.includes(",")) s = s.replace(",", ".");
  const n = Number(s);
  return isNaN(n) ? 0 : n;
}

export const STATUS_PEDIDO: Record<string, { label: string; cor: string }> = {
  novo: { label: "Novo", cor: "bg-sky-100 text-sky-800" },
  em_producao: { label: "Em produção", cor: "bg-amber-100 text-amber-800" },
  pronto: { label: "Pronto p/ envio", cor: "bg-violet-100 text-violet-800" },
  enviado: { label: "Enviado", cor: "bg-emerald-100 text-emerald-800" },
  entregue: { label: "Entregue", cor: "bg-emerald-200 text-emerald-900" },
  cancelado: { label: "Cancelado", cor: "bg-zinc-200 text-zinc-600" },
  devolvido: { label: "Devolvido", cor: "bg-rose-100 text-rose-800" },
};

export const SITUACAO_ESTOQUE: Record<string, { label: string; cor: string }> = {
  falta: { label: "Em falta", cor: "bg-rose-600 text-white" },
  critico: { label: "Crítico", cor: "bg-rose-100 text-rose-800" },
  comprar: { label: "Comprar", cor: "bg-amber-100 text-amber-800" },
  ok: { label: "OK", cor: "bg-emerald-100 text-emerald-800" },
};
