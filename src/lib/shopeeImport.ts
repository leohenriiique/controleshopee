import { parseNum } from "./format";

/** Campos que o importador entende e os cabeçalhos conhecidos da exportação do Seller Centre. */
export const CAMPOS: { key: string; label: string; obrig?: boolean; aliases: string[] }[] = [
  { key: "pedido", label: "ID do pedido", obrig: true, aliases: ["id do pedido", "order id", "n do pedido", "numero do pedido", "no. do pedido", "pedido"] },
  { key: "status", label: "Status do pedido", aliases: ["status do pedido", "order status", "status"] },
  { key: "data", label: "Data do pedido", aliases: ["data de criacao do pedido", "order creation date", "data do pedido", "data de criacao", "hora do pagamento do pedido"] },
  { key: "prazo", label: "Prazo de envio", aliases: ["data prevista de envio", "ship by date", "prazo de envio", "data limite de envio", "enviar ate"] },
  { key: "nome", label: "Nome do produto", obrig: true, aliases: ["nome do produto", "product name", "produto"] },
  { key: "sku", label: "SKU", aliases: ["numero de referencia sku", "sku reference no.", "sku da variacao", "sku", "referencia sku", "numero de referencia do sku principal", "parent sku reference no."] },
  { key: "variacao", label: "Variação", aliases: ["nome da variacao", "variation name", "variacao"] },
  { key: "preco", label: "Preço unitário", obrig: true, aliases: ["preco acordado", "deal price", "preco com desconto", "preco de venda", "preco original", "original price", "preco"] },
  { key: "qtd", label: "Quantidade", obrig: true, aliases: ["quantidade", "quantity", "qtd"] },
  { key: "cliente", label: "Cliente", aliases: ["nome de usuario (comprador)", "username (buyer)", "nome do comprador", "nome do destinatario", "receiver name", "comprador"] },
  { key: "cupom", label: "Cupom da loja", aliases: ["cupom do vendedor", "seller voucher", "desconto do vendedor", "cupom da loja"] },
  { key: "comissao", label: "Taxa de comissão", aliases: ["taxa de comissao", "commission fee", "comissao"] },
  { key: "servico", label: "Taxa de serviço", aliases: ["taxa de servico", "service fee"] },
  { key: "transacao", label: "Taxa de transação", aliases: ["taxa de transacao", "transaction fee"] },
];

export const normaliza = (s: any) =>
  String(s ?? "")
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[º°]/g, "")
    .replace(/\s+/g, " ")
    .trim()
    .toLowerCase();

/** Descobre automaticamente qual coluna corresponde a cada campo. */
export function detectarMapa(cabecalhos: string[]) {
  const norm = cabecalhos.map(normaliza);
  const mapa: Record<string, string> = {};
  for (const c of CAMPOS) {
    // 1º: igualdade exata, na ordem de preferência dos aliases
    let idx = -1;
    for (const a of c.aliases) {
      idx = norm.indexOf(a);
      if (idx >= 0) break;
    }
    // 2º: começa com o alias
    if (idx < 0) for (const a of c.aliases) { idx = norm.findIndex((h) => h.startsWith(a)); if (idx >= 0) break; }
    if (idx >= 0) mapa[c.key] = cabecalhos[idx];
  }
  return mapa;
}

export function mapearStatus(s: any): string {
  const n = normaliza(s);
  if (!n) return "novo";
  if (n.includes("cancel")) return "cancelado";
  if (n.includes("devol") || n.includes("reembols") || n.includes("return") || n.includes("refund")) return "devolvido";
  if (n.includes("nao pago") || n.includes("unpaid") || n.includes("aguardando pagamento")) return "nao_pago";
  if (n.includes("conclu") || n.includes("entregue") || n.includes("completed") || n.includes("delivered")) return "entregue";
  if (n.includes("enviado") || n.includes("transito") || n.includes("shipping") || n.includes("shipped")) return "enviado";
  return "novo"; // "A enviar", "To ship", "Processado"...
}

export function parseData(v: any): Date | null {
  if (!v) return null;
  if (v instanceof Date) return isNaN(v.getTime()) ? null : v;
  if (typeof v === "number") return new Date(Math.round((v - 25569) * 86400 * 1000)); // serial Excel
  const s = String(v).trim();
  let m = s.match(/^(\d{4})-(\d{2})-(\d{2})(?:[ T](\d{2}):(\d{2}))?/);
  if (m) return new Date(+m[1], +m[2] - 1, +m[3], +(m[4] || 12), +(m[5] || 0));
  m = s.match(/^(\d{2})\/(\d{2})\/(\d{4})(?:\s+(\d{2}):(\d{2}))?/);
  if (m) return new Date(+m[3], +m[2] - 1, +m[1], +(m[4] || 12), +(m[5] || 0));
  const d = new Date(s);
  return isNaN(d.getTime()) ? null : d;
}

export type PedidoImport = {
  numero: string;
  status: string;
  data: Date | null;
  prazo: Date | null;
  cliente: string;
  cupom: number;
  taxas: number | null;
  itens: { nome: string; sku: string; variacao: string; preco: number; qtd: number; chave: string }[];
};

/** Agrupa as linhas da planilha (1 linha por item) em pedidos. */
export function agruparPedidos(linhas: Record<string, any>[], mapa: Record<string, string>): PedidoImport[] {
  const get = (l: Record<string, any>, k: string) => (mapa[k] ? l[mapa[k]] : undefined);
  const porNumero = new Map<string, PedidoImport>();
  for (const l of linhas) {
    const numero = String(get(l, "pedido") ?? "").trim();
    if (!numero) continue;
    let p = porNumero.get(numero);
    if (!p) {
      const temTaxa = ["comissao", "servico", "transacao"].some((k) => mapa[k] && get(l, k) !== "" && get(l, k) !== undefined);
      p = {
        numero,
        status: mapearStatus(get(l, "status")),
        data: parseData(get(l, "data")),
        prazo: parseData(get(l, "prazo")),
        cliente: String(get(l, "cliente") ?? "").trim(),
        cupom: Math.abs(parseNum(get(l, "cupom"))),
        taxas: temTaxa
          ? Math.abs(parseNum(get(l, "comissao"))) + Math.abs(parseNum(get(l, "servico"))) + Math.abs(parseNum(get(l, "transacao")))
          : null,
        itens: [],
      };
      porNumero.set(numero, p);
    }
    const nome = String(get(l, "nome") ?? "").trim();
    const variacao = String(get(l, "variacao") ?? "").trim();
    const sku = String(get(l, "sku") ?? "").trim();
    const qtd = Math.max(1, Math.round(parseNum(get(l, "qtd")) || 1));
    p.itens.push({ nome, sku, variacao, qtd, preco: parseNum(get(l, "preco")), chave: chaveItem(nome, variacao) });
  }
  return [...porNumero.values()];
}

export const chaveItem = (nome: string, variacao: string) => (variacao ? `${nome} | ${variacao}` : nome);

/** Encontra o produto: SKU do produto → alias por SKU → alias por nome/variação. */
export function casarProduto(
  item: { sku: string; chave: string },
  produtos: { id: string; sku: string | null }[],
  aliases: { texto: string; produto_id: string }[]
): string | null {
  if (item.sku) {
    const p = produtos.find((x) => x.sku && normaliza(x.sku) === normaliza(item.sku));
    if (p) return p.id;
    const a = aliases.find((x) => normaliza(x.texto) === normaliza(item.sku));
    if (a) return a.produto_id;
  }
  const a = aliases.find((x) => normaliza(x.texto) === normaliza(item.chave));
  return a ? a.produto_id : null;
}
